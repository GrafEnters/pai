import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import { prisma } from './db.js';

const app = Fastify({ logger: { level: env.logLevel } });

await app.register(cors, {
  origin: env.corsOrigins,
  credentials: true,
});

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

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`[api] слушаю http://localhost:${env.port}`);
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
