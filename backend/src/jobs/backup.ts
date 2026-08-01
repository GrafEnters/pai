import { env } from '../env.js';
import { runBackup, hoursSinceLastSuccess } from '../services/backup/index.js';
import { safeAlert } from '../services/notify/index.js';
import { registerJob, schedule } from './index.js';

export const BACKUP_RUN = 'backup.run';
export const BACKUP_WATCHDOG = 'backup.watchdog';

export interface BackupJob {
  kind: 'DB' | 'CONTENT' | 'MEDIA' | 'FULL';
  /** Не задано — основное хранилище из BACKUP_PROVIDER. */
  transport?: 'local-drive' | 'google-drive';
}

/**
 * Расписание из §9.4: контент каждый час, медиа каждый час,
 * дамп БД ночью, полная сверка хешей по воскресеньям.
 */
export async function registerBackupJobs(log: (m: string) => void = console.log): Promise<void> {
  await registerJob<BackupJob>(BACKUP_RUN, async ({ kind, transport }) => {
    await runBackup(kind, log, transport);
  });

  // Сторож: бэкап, который встал и никто не заметил, — худший исход (§9.0)
  await registerJob(BACKUP_WATCHDOG, async () => {
    const hours = await hoursSinceLastSuccess();
    if (hours === null) {
      await safeAlert('⚠️ Успешных бэкапов ещё не было. Запустите первый: кнопка «Запустить сейчас» в админке.');
      return;
    }
    if (hours > env.backup.staleAlertHours) {
      await safeAlert(
        `⚠️ Последний успешный бэкап был ${Math.round(hours)} ч назад ` +
          `(порог ${env.backup.staleAlertHours} ч). Проверьте раздел «Бэкапы» в админке.`,
      );
    }
  });

}

/** Расписания ставятся отдельно: они требуют уже запущенной очереди. */
export async function scheduleBackupJobs(): Promise<void> {
  await schedule(BACKUP_RUN, env.backup.contentCron, { kind: 'CONTENT' });
  await schedule(BACKUP_RUN, env.backup.mediaCron, { kind: 'MEDIA' });
  await schedule(BACKUP_RUN, env.backup.dbCron, { kind: 'DB' });
  await schedule(BACKUP_RUN, env.backup.verifyCron, { kind: 'FULL' });
  await schedule(BACKUP_WATCHDOG, '0 * * * *');
}
