import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { requireRole } from '../../auth.js';
import { audit } from '../../audit.js';
import { backupTransport, hoursSinceLastSuccess, runBackup } from '../../services/backup/index.js';
import { NoBackupsError, listManifests, restore } from '../../services/backup/restore.js';
import { enqueue } from '../../jobs/index.js';
import { BACKUP_RUN } from '../../jobs/backup.js';

export async function adminBackupRoutes(app: FastifyInstance) {
  const onlyAdmin = { preHandler: requireRole('ADMIN') };

  // ===== Состояние и последние прогоны =====
  app.get('/admin/backups', onlyAdmin, async () => {
    const [runs, hours, objectStats] = await Promise.all([
      prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
      hoursSinceLastSuccess(),
      prisma.backupObject.aggregate({
        _count: { _all: true },
        _sum: { sizeBytes: true },
        where: { deletedAt: null },
      }),
    ]);

    let quota: { total: number; used: number } | null = null;
    try {
      quota = await backupTransport.quota();
    } catch {
      quota = null;
    }

    return {
      transport: backupTransport.name,
      // Реальные пути после разбора переменных: опечатку в них видно сразу,
      // без похода в логи
      paths: { storage: env.storage.localDir, backups: env.backup.localDir },
      hoursSinceLastSuccess: hours,
      // Индикатор для баннера в админке (§9.6)
      stale: hours === null || hours > env.backup.staleAlertHours,
      staleThresholdHours: env.backup.staleAlertHours,
      objects: objectStats._count._all,
      bytes: (objectStats._sum.sizeBytes ?? BigInt(0)).toString(),
      quota,
      runs: runs.map((r) => ({ ...r, bytesUploaded: r.bytesUploaded.toString() })),
    };
  });

  app.get('/admin/backups/:id', onlyAdmin, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const run = await prisma.backupRun.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: 'Прогон не найден' });
    return { ...run, bytesUploaded: run.bytesUploaded.toString() };
  });

  // ===== Запустить сейчас =====
  app.post('/admin/backups/run', onlyAdmin, async (req, reply) => {
    const body = z
      .object({ kind: z.enum(['DB', 'CONTENT', 'MEDIA', 'FULL']).default('FULL'), sync: z.boolean().default(false) })
      .safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    await audit(req, 'backup.run', 'BackupRun', null, { kind: body.data.kind });

    // Синхронный режим нужен скриптам и проверке вручную; из UI — в очередь,
    // чтобы кнопка не висела пятнадцать минут
    if (body.data.sync) {
      const result = await runBackup(body.data.kind, (m) => req.log.info(m));
      return result;
    }
    await enqueue(BACKUP_RUN, { kind: body.data.kind });
    return { queued: true, kind: body.data.kind };
  });

  // ===== Доступные точки восстановления =====
  app.get('/admin/backups/manifests', onlyAdmin, async () => listManifests());

  // ===== Проверка целостности (ничего не меняет) =====
  app.post('/admin/backups/verify', onlyAdmin, async (req, reply) => {
    const body = z.object({ date: z.string().optional() }).safeParse(req.body ?? {});
    let report;
    try {
      report = await restore(
        { date: body.success ? body.data.date : undefined, target: 'check' },
        (m) => req.log.info(m),
      );
    } catch (e) {
      // Отсутствие бэкапов — не ошибка сервера, а состояние новой установки
      if (e instanceof NoBackupsError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    await audit(req, 'backup.verify', 'BackupRun', report.manifest.runId, {
      verified: report.objects.verified,
      mismatched: report.objects.mismatched.length,
    });
    return report;
  });

  // ===== Восстановление медиа =====
  // Полное восстановление БД намеренно НЕ выведено в веб-интерфейс:
  // операция разрушительная, ей место в консоли с явным флагом --yes (§9.5)
  app.post('/admin/backups/restore-media', onlyAdmin, async (req, reply) => {
    const body = z.object({ date: z.string().optional() }).safeParse(req.body ?? {});
    let report;
    try {
      report = await restore(
        { date: body.success ? body.data.date : undefined, target: 'media' },
        (m) => req.log.info(m),
      );
    } catch (e) {
      if (e instanceof NoBackupsError) return reply.code(400).send({ error: e.message });
      throw e;
    }
    await audit(req, 'backup.restore_media', 'BackupRun', report.manifest.runId, {
      restored: report.media.restored,
    });
    return report;
  });
}
