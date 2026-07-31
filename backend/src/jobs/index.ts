import PgBoss from 'pg-boss';
import { env } from '../env.js';

export type JobHandler<T> = (data: T) => Promise<void>;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss | null> | null = null;
const handlers = new Map<string, JobHandler<any>>();
const logger = { info: console.log, warn: console.warn, error: console.error };

export function setJobLogger(l: { info: (m: string) => void; warn: (m: string) => void; error: (m: unknown) => void }) {
  logger.info = l.info as never;
  logger.warn = l.warn as never;
  logger.error = l.error as never;
}

/**
 * pg-boss поверх того же Postgres — Redis не тянем (PLAN §3).
 *
 * Если очередь не поднялась (нет прав на создание схемы, старый Postgres),
 * система не встаёт: enqueue выполняет задачу прямо в процессе. Тогда теряются
 * ретраи и расписания, но обработка медиа и бэкапы продолжают работать —
 * молчаливого «задача поставлена и пропала» быть не должно.
 */
export async function startJobs(): Promise<PgBoss | null> {
  if (boss) return boss;
  if (starting) return starting;

  starting = (async () => {
    try {
      const instance = new PgBoss({
        connectionString: env.databaseUrl,
        schema: 'pgboss',
        // Хранить историю выполненных задач неделю — этого хватает, чтобы
        // разобраться, почему конкретное видео не обработалось
        archiveCompletedAfterSeconds: 7 * 86400,
        retentionDays: 14,
      });
      instance.on('error', (e) => logger.error(e));
      await instance.start();
      boss = instance;
      logger.info('[jobs] очередь pg-boss запущена');

      // Регистрируем всё, что успели объявить до старта
      for (const [name, handler] of handlers) await attach(instance, name, handler);
      return instance;
    } catch (e) {
      logger.warn(
        `[jobs] pg-boss не запустился (${String(e)}). Задачи будут выполняться прямо в процессе, без ретраев и расписаний.`,
      );
      boss = null;
      return null;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

async function attach<T>(instance: PgBoss, name: string, handler: JobHandler<T>) {
  await instance.work<T>(name, { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    await handler((job as { data: T }).data);
  });
}

/** Объявить обработчик задачи. Можно вызывать до startJobs(). */
export async function registerJob<T>(name: string, handler: JobHandler<T>): Promise<void> {
  handlers.set(name, handler);
  if (boss) await attach(boss, name, handler);
}

/** Поставить задачу. Без очереди — выполнить здесь же, не блокируя ответ. */
export async function enqueue<T>(name: string, data: T): Promise<void> {
  if (boss) {
    await boss.send(name, data as object);
    return;
  }
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn(`[jobs] нет обработчика для задачи ${name}`);
    return;
  }
  void handler(data).catch((e) => logger.error(`[jobs] задача ${name} упала: ${String(e)}`));
}

/** Расписание по cron. Без очереди расписания не работают — об этом пишем в лог. */
export async function schedule(name: string, cron: string, data: unknown = {}): Promise<void> {
  if (!cron.trim()) return;
  if (!boss) {
    logger.warn(`[jobs] расписание ${name} (${cron}) не установлено: очередь недоступна`);
    return;
  }
  await boss.schedule(name, cron, data as object, { tz: 'UTC' });
  logger.info(`[jobs] расписание ${name}: ${cron}`);
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true });
    boss = null;
  }
}

export function jobsAvailable(): boolean {
  return boss !== null;
}
