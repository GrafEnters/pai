import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { env } from '../env.js';
import { localStorage, verifyUploadSignature } from '../services/storage/local.provider.js';

/**
 * Приёмник presigned PUT для локального хранилища — местный аналог того, что
 * в проде делает R2. Авторизация здесь не по cookie, а по подписи в самой
 * ссылке: браузер шлёт файл напрямую, как и в R2, и никаких заголовков
 * авторизации к нему не добавляет (DECISIONS §6).
 *
 * При STORAGE_PROVIDER=r2 этот роут не используется — ссылка ведёт в бакет.
 */
export async function uploadRoutes(app: FastifyInstance) {
  app.put(
    '/upload/local',
    {
      // Лимит тела — по максимальному видео: глобальные 2 МБ здесь не годятся
      bodyLimit: env.media.videoMaxBytes,
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      if (env.storage.provider !== 'local') {
        return reply.code(404).send({ error: 'Локальная загрузка выключена' });
      }

      const q = z
        .object({
          key: z.string().min(1),
          mime: z.string().min(3),
          size: z.coerce.number().int().positive(),
          exp: z.coerce.number().int().positive(),
          sig: z.string().min(16),
        })
        .safeParse(req.query);
      if (!q.success) return reply.code(400).send({ error: 'Некорректная ссылка загрузки' });

      const { key, mime, size, exp, sig } = q.data;
      if (!verifyUploadSignature(key, mime, size, exp, sig)) {
        return reply.code(403).send({ error: 'Ссылка загрузки недействительна или устарела' });
      }

      const body = req.body as Readable | Buffer | undefined;
      if (!body) return reply.code(400).send({ error: 'Пустое тело запроса' });

      await localStorage.put(key, body as Readable, mime);
      return reply.code(200).send({ ok: true, key });
    },
  );
}
