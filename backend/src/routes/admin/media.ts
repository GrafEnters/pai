import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { currentUser, requireRole } from '../../auth.js';
import { audit } from '../../audit.js';
import { extForMime, storage } from '../../services/storage/index.js';
import { serializeMedia } from '../../services/mediaView.js';
import { enqueue } from '../../jobs/index.js';
import { MEDIA_PROCESS } from '../../jobs/media.js';

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
const FILE_MIMES = [
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function classify(mime: string): 'IMAGE' | 'VIDEO' | 'FILE' | null {
  if (IMAGE_MIMES.includes(mime)) return 'IMAGE';
  if (VIDEO_MIMES.includes(mime)) return 'VIDEO';
  if (FILE_MIMES.includes(mime)) return 'FILE';
  return null;
}

export async function adminMediaRoutes(app: FastifyInstance) {
  const editor = { preHandler: requireRole('EDITOR') };

  // ===== Ссылка на прямую загрузку =====
  // Файл идёт в хранилище напрямую из браузера, минуя backend: видео на 500 МБ
  // не должно дважды проходить через VPS (PLAN §3.2).
  app.post('/admin/media/presign', editor, async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(300),
        mime: z.string().min(3).max(120),
        size: z.number().int().positive(),
        // sha256 считает браузер (Web Crypto) — на нём же строится дедупликация
        sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Ожидается sha256 в hex'),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
    }

    const { name, mime, size, sha256 } = body.data;
    const type = classify(mime);
    if (!type) return reply.code(400).send({ error: `Формат ${mime} не поддерживается` });

    const limit = type === 'VIDEO' ? env.media.videoMaxBytes : env.media.imageMaxBytes;
    if (size > limit) {
      return reply.code(400).send({
        error: `Файл больше лимита ${Math.round(limit / 1024 / 1024)} МБ`,
      });
    }

    // Дедупликация: такой файл уже грузили — переиспользуем, не тратим трафик
    const existing = await prisma.media.findFirst({
      where: { sha256: sha256.toLowerCase(), status: { in: ['READY', 'PROCESSING'] } },
      orderBy: { id: 'asc' },
    });
    if (existing) {
      return { deduplicated: true, media: serializeMedia(existing) };
    }

    const key = `original/${sha256.toLowerCase()}.${extForMime(mime, name)}`;

    // Запись с таким ключом может остаться от прерванной загрузки: браузер
    // закрыли между presign и завершением. Ключ уникален, поэтому создавать
    // вторую нельзя — переиспользуем незавершённую, иначе файл оказался бы
    // заблокирован навсегда и повторная попытка падала бы с ошибкой уникальности.
    const stale = await prisma.media.findUnique({ where: { key } });
    const data = {
      type,
      status: 'PENDING' as const,
      originalName: name.slice(0, 300),
      mime,
      sizeBytes: BigInt(size),
      sha256: sha256.toLowerCase(),
      uploadedById: currentUser(req).id,
      error: null,
    };

    const media = stale
      ? await prisma.media.update({ where: { id: stale.id }, data })
      : await prisma.media.create({ data: { ...data, key } });

    const { url, headers } = await storage.presignPut(key, mime, size);
    return { deduplicated: false, mediaId: media.id, key, uploadUrl: url, headers };
  });

  // ===== Загрузка завершена — в очередь на обработку =====
  app.post('/admin/media/:id/complete', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) return reply.code(404).send({ error: 'Файл не найден' });

    // Проверяем, что объект реально долетел: иначе задача упадёт молча
    if (!(await storage.exists(media.key))) {
      await prisma.media.update({
        where: { id },
        data: { status: 'FAILED', error: 'Файл не найден в хранилище — загрузка не завершилась' },
      });
      return reply.code(409).send({ error: 'Файл не долетел в хранилище, попробуйте ещё раз' });
    }

    await prisma.media.update({ where: { id }, data: { status: 'UPLOADING' } });
    await enqueue(MEDIA_PROCESS, { mediaId: id });
    await audit(req, 'media.upload', 'Media', id, { name: media.originalName, size: media.sizeBytes.toString() });

    return { ok: true, mediaId: id };
  });

  // ===== Библиотека =====
  app.get('/admin/media', editor, async (req) => {
    const q = z
      .object({
        type: z.enum(['IMAGE', 'VIDEO', 'FILE']).optional(),
        q: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(48),
      })
      .parse(req.query);

    const where: any = { status: { not: 'PENDING' } };
    if (q.type) where.type = q.type;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { originalName: { contains: s, mode: 'insensitive' } },
        { alt: { contains: s, mode: 'insensitive' } },
        { title: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.media.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.media.count({ where }),
    ]);

    return { items: items.map(serializeMedia), total, page: q.page, limit: q.limit };
  });

  // ===== Один файл: статус обработки, варианты, где используется =====
  app.get('/admin/media/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        guides: { include: { guide: { select: { id: true, title: true, slug: true } } } },
        coverOf: { select: { id: true, title: true, slug: true } },
      },
    });
    if (!media) return reply.code(404).send({ error: 'Файл не найден' });

    const usedIn = [...media.guides.map((g) => g.guide), ...media.coverOf];
    return { ...serializeMedia(media), usedIn: dedupById(usedIn) };
  });

  // ===== Alt и заголовок =====
  app.patch('/admin/media/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({ alt: z.string().max(500).nullable().optional(), title: z.string().max(300).nullable().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const media = await prisma.media.update({ where: { id }, data: body.data });
    await audit(req, 'media.update', 'Media', id, body.data);
    return serializeMedia(media);
  });

  // ===== Удаление — только если не используется =====
  app.delete('/admin/media/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        guides: { include: { guide: { select: { id: true, title: true, slug: true } } } },
        coverOf: { select: { id: true, title: true, slug: true } },
      },
    });
    if (!media) return reply.code(404).send({ error: 'Файл не найден' });

    const usedIn = dedupById([...media.guides.map((g) => g.guide), ...media.coverOf]);
    if (usedIn.length) {
      return reply.code(409).send({
        error: `Файл используется в гайдах: ${usedIn.map((g) => g.title).join(', ')}`,
        usedIn,
      });
    }

    // Сначала файлы, потом запись: если упадём посередине, останется мусор
    // в хранилище, а не битая ссылка в базе
    const keys = [media.key, media.posterKey, ...((media.variants as { key: string }[]) ?? []).map((v) => v.key)];
    for (const key of keys) {
      if (key) await storage.delete(key).catch((e) => req.log.warn({ err: e, key }, 'не удалось удалить объект'));
    }
    await prisma.media.delete({ where: { id } });
    await audit(req, 'media.delete', 'Media', id, { name: media.originalName });

    return { ok: true };
  });
}

function dedupById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
