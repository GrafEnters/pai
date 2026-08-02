import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { prisma } from './db.js';
import { ACCESS_COOKIE } from './auth.js';
import { applySqlPatches } from './sqlPatches.js';
import { startBot } from './bot.js';
import { registerJob, setJobLogger, startJobs, stopJobs } from './jobs/index.js';
import { registerMediaJobs } from './jobs/media.js';
import { registerBackupJobs, scheduleBackupJobs } from './jobs/backup.js';
import { failStaleRuns } from './services/backup/index.js';
import { registerAnalyticsJobs, scheduleAnalyticsJobs } from './jobs/analytics.js';
import { authRoutes } from './routes/auth.js';
import { uploadRoutes } from './routes/upload.js';
import { publicRoutes } from './routes/public.js';
import { collectRoutes } from './routes/collect.js';
import { adminUserRoutes } from './routes/admin/users.js';
import { adminInviteRoutes } from './routes/admin/invites.js';
import { adminMediaRoutes } from './routes/admin/media.js';
import { adminGuideRoutes } from './routes/admin/guides.js';
import { adminTaxonomyRoutes } from './routes/admin/taxonomy.js';
import { adminBackupRoutes } from './routes/admin/backups.js';
import { adminStatsRoutes } from './routes/admin/stats.js';
import { adminSystemRoutes } from './routes/admin/system.js';

const app = Fastify({
  logger: { level: env.logLevel },
  // Свои две строки Fastify пишет как «incoming request» / «request completed»,
  // а метод, путь, статус и время кладёт в отдельные поля JSON. Панель Amvera
  // показывает только msg — и лог превращается в ленту одинаковых строк, по
  // которой не опознать ни одного запроса. Пишем сами: одна строка, всё в msg
  disableRequestLogging: true,
  // За Caddy и Cloudflare: доверяем X-Forwarded-* для корректного req.ip
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
});

/**
 * Пути, которые в info-логе не нужны: платформа дёргает их постоянно, а сказать
 * им нечего. Не выключены совсем, а понижены до debug — при LOG_LEVEL=debug
 * видно и их.
 */
const QUIET_PATHS = new Set(['/health']);

app.addHook('onResponse', async (req, reply) => {
  const line = `${req.method} ${req.url} → ${reply.statusCode} за ${reply.elapsedTime.toFixed(0)} мс`;
  if (QUIET_PATHS.has(req.url)) req.log.debug(line);
  else req.log.info(line);
});

// ===== Плагины =====
await app.register(helmet, {
  // API отдаёт JSON и файлы, CSP здесь только мешает; она живёт на web/admin
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

await app.register(cors, {
  origin: env.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(cookie);

// Тело неизвестного типа отдаём роуту как поток: так presigned PUT принимает
// файл, не буферизуя его в память. JSON и text/plain разбираются как обычно —
// у них есть свои, более специфичные парсеры.
app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

await app.register(jwt, {
  secret: env.jwtSecret,
  // Токен читается из httpOnly-cookie; Authorization: Bearer тоже работает
  cookie: { cookieName: ACCESS_COOKIE, signed: false },
});

await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute',
  // Ключ — IP клиента с учётом прокси
  keyGenerator: (req) => {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string') return cf;
    return req.ip;
  },
  errorResponseBuilder: () => ({ error: 'Слишком много запросов, подождите минуту' }),
});

// Раздача медиа при STORAGE_PROVIDER=local. В проде на R2 этого не нужно:
// файлы отдаёт CDN напрямую из бакета.
if (env.storage.provider === 'local') {
  await fs.mkdir(env.storage.localDir, { recursive: true });
  await app.register(fastifyStatic, {
    root: env.storage.localDir,
    prefix: '/media/',
    // Имена содержат content-hash ⇒ объект неизменяем
    cacheControl: true,
    maxAge: '365d',
    immutable: true,
    index: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  });
}

// ===== Здоровье =====
app.get('/health', async () => {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  let storageOk = false;
  try {
    await fs.access(env.storage.localDir);
    storageOk = true;
  } catch {
    storageOk = env.storage.provider !== 'local';
  }
  const lastBackup = await prisma.backupRun
    .findFirst({ where: { status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } })
    .catch(() => null);

  return {
    ok: db,
    db,
    storage: storageOk,
    storageProvider: env.storage.provider,
    lastBackupAt: lastBackup?.finishedAt ?? null,
  };
});

// ===== Роуты =====
await app.register(authRoutes, { prefix: '/api' });
await app.register(uploadRoutes, { prefix: '/api' });
await app.register(publicRoutes, { prefix: '/api' });
await app.register(collectRoutes, { prefix: '/api' });
await app.register(adminUserRoutes, { prefix: '/api' });
await app.register(adminInviteRoutes, { prefix: '/api' });
await app.register(adminMediaRoutes, { prefix: '/api' });
await app.register(adminGuideRoutes, { prefix: '/api' });
await app.register(adminTaxonomyRoutes, { prefix: '/api' });
await app.register(adminBackupRoutes, { prefix: '/api' });
await app.register(adminStatsRoutes, { prefix: '/api' });
await app.register(adminSystemRoutes, { prefix: '/api' });

// ===== Старт =====
try {
  await applySqlPatches((m) => app.log.info(m));

  // Хвосты прошлого запуска: прогон бэкапа живёт внутри процесса, и убитый
  // вместе с ним остаётся в RUNNING навсегда
  await failStaleRuns((m) => app.log.info(m));

  setJobLogger({
    info: (m) => app.log.info(m),
    warn: (m) => app.log.warn(m),
    error: (e) => app.log.error(e),
  });
  // Сначала обработчики — их можно объявлять до старта очереди
  await registerMediaJobs();
  await registerBackupJobs((m) => app.log.info(m));
  await registerAnalyticsJobs((m) => app.log.info(m));
  await startJobs();
  // Расписания — только после: без живой очереди cron ставить некуда
  await scheduleBackupJobs();
  await scheduleAnalyticsJobs();
  void registerJob; // обработчики остальных задач регистрируются в своих модулях

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`[api] слушаю http://localhost:${env.port}`);
  app.log.info(`[storage] провайдер: ${env.storage.provider}`);
  // Базовый образ в Dockerfile — плавающий тег node:20-alpine, и каждая
  // пересборка может принести другой рантайм. fetch в Node — это undici,
  // им ходит весь код бэкапа; сравнить «до» и «после» без этой строки нечем
  app.log.info(
    `[runtime] Node ${process.version}, undici ${process.versions.undici ?? '—'}, ` +
      `OpenSSL ${process.versions.openssl}`,
  );
  await startBot((m) => app.log.info(m));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`получен ${sig}, останавливаюсь`);
    await app.close();
    await stopJobs();
    await prisma.$disconnect();
    process.exit(0);
  });
}
