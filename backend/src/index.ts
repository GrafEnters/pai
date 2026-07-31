import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { env } from './env.js';
import { prisma } from './db.js';
import { ACCESS_COOKIE } from './auth.js';
import { applySqlPatches } from './sqlPatches.js';
import { startBot } from './bot.js';
import { authRoutes } from './routes/auth.js';
import { adminUserRoutes } from './routes/admin/users.js';
import { adminInviteRoutes } from './routes/admin/invites.js';
import { adminSystemRoutes } from './routes/admin/system.js';

const app = Fastify({
  logger: { level: env.logLevel },
  // За Caddy и Cloudflare: доверяем X-Forwarded-* для корректного req.ip
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
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

// ===== Здоровье =====
app.get('/health', async () => {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return { ok: db, db };
});

// ===== Роуты =====
await app.register(authRoutes, { prefix: '/api' });
await app.register(adminUserRoutes, { prefix: '/api' });
await app.register(adminInviteRoutes, { prefix: '/api' });
await app.register(adminSystemRoutes, { prefix: '/api' });

// ===== Старт =====
try {
  await applySqlPatches((m) => app.log.info(m));
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`[api] слушаю http://localhost:${env.port}`);
  await startBot((m) => app.log.info(m));
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`получен ${sig}, останавливаюсь`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
