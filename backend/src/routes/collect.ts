import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { EventType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { tryAuth } from '../auth.js';

const EVENT_TYPES = [
  'PAGE_VIEW', 'GUIDE_OPEN', 'GUIDE_SCROLL', 'GUIDE_HEARTBEAT', 'GUIDE_READ',
  'VIDEO_PLAY', 'VIDEO_PROGRESS', 'VIDEO_COMPLETE', 'VIDEO_SEEK',
  'SEARCH', 'SEARCH_EMPTY', 'LINK_CLICK', 'FILE_DOWNLOAD', 'FEEDBACK', 'CHECKLIST_TOGGLE',
] as const;

const batchSchema = z.object({
  v: z.string().min(1).max(64),
  s: z.string().min(1).max(64),
  referrer: z.string().max(500).optional(),
  events: z
    .array(
      z.object({
        t: z.enum(EVENT_TYPES),
        ts: z.string().datetime(),
        path: z.string().max(300),
        guideId: z.number().int().positive().optional(),
        mediaId: z.number().int().positive().optional(),
        props: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** mobile | tablet | desktop — по User-Agent, без внешней библиотеки. */
function deviceOf(ua: string | undefined): string {
  if (!ua) return 'unknown';
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Идемпотентность повторной доставки beacon'а (§8.2). Браузер вполне может
 * отправить один и тот же батч дважды — при закрытии вкладки и при возврате.
 *
 * props входят в ключ намеренно: при быстром скролле пороги 50% и 100%
 * пересекаются в одну миллисекунду, и без props эти два разных события
 * склеились бы в одно.
 */
function dedupKey(
  visitorId: string,
  sessionId: string,
  type: string,
  ts: string,
  guideId?: number,
  mediaId?: number,
  props?: Record<string, unknown>,
) {
  const propsPart = props && Object.keys(props).length ? JSON.stringify(props, Object.keys(props).sort()) : '';
  return crypto
    .createHash('sha256')
    .update(`${visitorId}|${sessionId}|${type}|${ts}|${guideId ?? ''}|${mediaId ?? ''}|${propsPart}`)
    .digest('hex')
    .slice(0, 32);
}

export async function collectRoutes(app: FastifyInstance) {
  /**
   * Приём событий (PLAN §8.2). Content-Type тут text/plain — так браузер
   * не делает preflight OPTIONS и экономит round-trip; тело всё равно JSON.
   */
  app.post(
    '/collect',
    {
      bodyLimit: 32 * 1024,
      config: {
        // Лимит по посетителю, а не по IP: за одним офисным NAT сидит вся команда.
        // visitorId берём из query, а не из тела: лимитер срабатывает на onRequest,
        // когда тело ещё не разобрано.
        rateLimit: {
          max: 600,
          timeWindow: '1 hour',
          keyGenerator: (req) => {
            const v = (req.query as { v?: string } | undefined)?.v;
            return typeof v === 'string' && v ? `visitor:${v}` : req.ip;
          },
        },
      },
    },
    async (req, reply) => {
      // text/plain приходит потоком из-за общего парсера — собираем строку
      const raw = typeof req.body === 'string' ? req.body : await readBody(req.body);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: 'Ожидается JSON' });
      }

      const parsed = batchSchema.safeParse(parsedJson);
      if (!parsed.success) return reply.code(400).send({ error: 'Некорректный батч событий' });

      const { v: visitorId, s: sessionId, referrer, events } = parsed.data;
      const user = await tryAuth(req);

      // Страна — бесплатно из заголовка Cloudflare. IP НЕ сохраняем (§8.2).
      const country = (req.headers['cf-ipcountry'] as string | undefined)?.slice(0, 2) ?? null;
      const device = deviceOf(req.headers['user-agent']);

      const rows: Prisma.EventCreateManyInput[] = events.map((e) => ({
        ts: new Date(e.ts),
        type: e.t as EventType,
        visitorId,
        sessionId,
        userId: user?.id ?? null,
        guideId: e.guideId ?? null,
        mediaId: e.mediaId ?? null,
        path: e.path.slice(0, 300),
        referrer: referrer?.slice(0, 500) ?? null,
        country,
        device,
        props: (e.props ?? {}) as Prisma.InputJsonValue,
        dedupKey: dedupKey(visitorId, sessionId, e.t, e.ts, e.guideId, e.mediaId, e.props),
      }));

      const result = await prisma.event.createMany({ data: rows, skipDuplicates: true });

      // Побочные эффекты считаем только для реально записанных событий,
      // иначе повторная доставка beacon'а удвоит активное время
      if (result.count > 0 && user) {
        await applySideEffects(events, user.id);
      }

      // 204: клиенту от нас ничего не нужно, а пустой ответ дешевле
      return reply.code(204).send();
    },
  );
}

async function readBody(body: unknown): Promise<string> {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof (body as { on?: unknown }).on === 'function') {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  return typeof body === 'string' ? body : JSON.stringify(body ?? {});
}

/** Личный прогресс обновляем сразу: он нужен читателю на экране «мой прогресс». */
async function applySideEffects(
  events: z.infer<typeof batchSchema>['events'],
  userId: number,
): Promise<void> {
  const activeByGuide = new Map<number, number>();
  const readGuides = new Set<number>();
  const openedGuides = new Set<number>();

  for (const e of events) {
    if (!e.guideId) continue;
    if (e.t === 'GUIDE_HEARTBEAT') {
      const sec = Number((e.props as { sec?: number } | undefined)?.sec ?? 15);
      activeByGuide.set(e.guideId, (activeByGuide.get(e.guideId) ?? 0) + sec);
    }
    if (e.t === 'GUIDE_READ') readGuides.add(e.guideId);
    if (e.t === 'GUIDE_OPEN') openedGuides.add(e.guideId);
  }

  const touched = new Set([...activeByGuide.keys(), ...readGuides, ...openedGuides]);
  for (const guideId of touched) {
    const addSec = activeByGuide.get(guideId) ?? 0;
    const nowRead = readGuides.has(guideId);
    try {
      await prisma.userGuideProgress.upsert({
        where: { userId_guideId: { userId, guideId } },
        create: {
          userId,
          guideId,
          activeSec: addSec,
          readAt: nowRead ? new Date() : null,
        },
        update: {
          lastOpenedAt: new Date(),
          activeSec: { increment: addSec },
        },
      });
      // readAt проставляем только один раз: первая дата дочитывания важнее последней
      if (nowRead) {
        await prisma.userGuideProgress.updateMany({
          where: { userId, guideId, readAt: null },
          data: { readAt: new Date() },
        });
      }
    } catch {
      // Гайд могли удалить между отправкой и приёмом — событие уже записано,
      // прогресс не критичен
    }
  }
}

export { env };
