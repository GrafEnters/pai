import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireAuth, roleAtLeast, tryAuth } from '../auth.js';
import { asDoc, collectHeadings } from '../content/schema.js';
import { buildRenderContext } from '../services/guides.js';
import { serializeMedia } from '../services/mediaView.js';
import { isPublicAccessOpen } from '../settings.js';

/**
 * Публичный контент читают двое: авторизованный человек и сам сервис `web`,
 * который заранее генерирует HTML страниц (ISR). У второго cookie нет и быть
 * не может — поэтому он приходит с внутренним токеном.
 *
 * Это безопасно ровно потому, что `web` сам никого не пускает: его middleware
 * проверяет подпись JWT до отдачи страницы (PLAN §5.3 и §6.4).
 *
 * Третий случай — включённый в админке публичный доступ: тогда гайды читает кто
 * угодно без входа. Личное (прогресс, фидбек, «обязательное для роли») сюда не
 * попадает — те роуты как были под `requireAuth`, так и остаются.
 */
async function requireReaderOrInternal(req: FastifyRequest, reply: FastifyReply) {
  const internal = req.headers['x-internal-token'];
  if (typeof internal === 'string' && internal && internal === env.revalidateSecret) return;

  if (await isPublicAccessOpen()) return;

  const user = await tryAuth(req);
  if (!user) return reply.code(401).send({ error: 'Не авторизован' });
  if (!roleAtLeast(user.role, 'VIEWER')) {
    return reply.code(403).send({ error: 'Доступ ещё не выдан администратором' });
  }
}

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  level: true,
  readingTimeSec: true,
  isPinned: true,
  sortOrder: true,
  publishedAt: true,
  updatedAt: true,
  requiredForRoles: true,
  categoryId: true,
  category: { select: { id: true, slug: true, title: true, icon: true, color: true } },
  cover: true,
  tags: { select: { tag: { select: { id: true, slug: true, title: true } } } },
} as const;

type CardRow = {
  cover: Parameters<typeof serializeMedia>[0] | null;
  tags: { tag: { id: number; slug: string; title: string } }[];
};

function toCard<T extends CardRow>(g: T) {
  return { ...g, cover: g.cover ? serializeMedia(g.cover) : null, tags: g.tags.map((t) => t.tag) };
}

export async function publicRoutes(app: FastifyInstance) {
  const reader = { preHandler: requireReaderOrInternal };

  // ===== Режим доступа =====
  //
  // Отвечает без авторизации намеренно: это единственный способ для middleware
  // сайта узнать, пускать ли гостя, — у гостя ни куки, ни внутреннего токена
  // нет. Наружу уходит один булев флаг, ничего чувствительного.
  app.get('/access', async () => ({ open: await isPublicAccessOpen() }));

  // ===== Дерево категорий со счётчиками =====
  app.get('/categories', reader, async () => {
    const [categories, counts] = await Promise.all([
      prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
      prisma.guide.groupBy({ by: ['categoryId'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.categoryId, c._count._all]));

    const nodes = categories.map((c) => ({ ...c, guideCount: countBy.get(c.id) ?? 0, children: [] as unknown[] }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots: typeof nodes = [];
    for (const node of nodes) {
      const parent = node.parentId ? byId.get(node.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  });

  // ===== Карточки гайдов =====
  app.get('/guides', reader, async (req) => {
    const q = z
      .object({
        category: z.string().optional(),
        tag: z.string().optional(),
        level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
        pinned: z.enum(['1']).optional(),
        since: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(24),
      })
      .parse(req.query);

    const where: any = { status: 'PUBLISHED' };
    if (q.category) where.category = { slug: q.category };
    if (q.tag) where.tags = { some: { tag: { slug: q.tag } } };
    if (q.level) where.level = q.level;
    if (q.pinned) where.isPinned = true;
    if (q.since) where.publishedAt = { gte: new Date(q.since) };

    const [items, total] = await Promise.all([
      prisma.guide.findMany({
        where,
        select: cardSelect,
        orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }, { publishedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.guide.count({ where }),
    ]);

    return { items: items.map(toCard), total, page: q.page, limit: q.limit };
  });

  // ===== Полный гайд =====
  app.get('/guides/:slug', reader, async (req, reply) => {
    const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);

    const guide = await prisma.guide.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, slug: true, title: true, icon: true, color: true } },
        author: { select: { id: true, name: true } },
        tags: { select: { tag: true } },
        cover: true,
        related: { select: { to: { select: cardSelect } } },
      },
    });
    if (!guide || guide.status !== 'PUBLISHED') {
      return reply.code(404).send({ error: 'Гайд не найден' });
    }

    const doc = asDoc(guide.content);
    const ctx = await buildRenderContext(doc);

    // Клиенту отдаём документ и справочник медиа отдельно: рендерер на сайте
    // собирает <picture srcset> сам, ему нужны варианты, а не готовый HTML
    return {
      id: guide.id,
      slug: guide.slug,
      title: guide.title,
      summary: guide.summary,
      level: guide.level,
      readingTimeSec: guide.readingTimeSec,
      version: guide.version,
      publishedAt: guide.publishedAt,
      updatedAt: guide.updatedAt,
      requiredForRoles: guide.requiredForRoles,
      category: guide.category,
      author: guide.author,
      tags: guide.tags.map((t) => t.tag),
      cover: guide.cover ? serializeMedia(guide.cover) : null,
      content: doc,
      media: Object.fromEntries(ctx.media),
      guideRefs: Object.fromEntries(ctx.guides),
      toc: collectHeadings(doc),
      related: guide.related.map((r) => toCard(r.to)),
    };
  });

  // ===== Обязательные для моей роли =====
  app.get('/guides/required/mine', { preHandler: requireAuth }, async (req) => {
    const user = req.currentUser!;
    const guides = await prisma.guide.findMany({
      where: { status: 'PUBLISHED', requiredForRoles: { has: user.teamRole } },
      select: cardSelect,
      orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'asc' }],
    });

    const progress = await prisma.userGuideProgress.findMany({
      where: { userId: user.id, guideId: { in: guides.map((g) => g.id) } },
      select: { guideId: true, readAt: true, lastOpenedAt: true },
    });
    const byGuide = new Map(progress.map((p) => [p.guideId, p]));

    return guides.map((g) => ({
      ...toCard(g),
      readAt: byGuide.get(g.id)?.readAt ?? null,
      lastOpenedAt: byGuide.get(g.id)?.lastOpenedAt ?? null,
    }));
  });

  // ===== Мой прогресс =====
  app.get('/me/progress', { preHandler: requireAuth }, async (req) => {
    const user = req.currentUser!;
    const rows = await prisma.userGuideProgress.findMany({
      where: { userId: user.id },
      orderBy: { lastOpenedAt: 'desc' },
      take: 200,
      include: { guide: { select: cardSelect } },
    });
    return rows
      .filter((r) => r.guide)
      .map((r) => ({
        guide: toCard(r.guide),
        firstOpenedAt: r.firstOpenedAt,
        lastOpenedAt: r.lastOpenedAt,
        readAt: r.readAt,
        activeSec: r.activeSec,
        checklistState: r.checklistState,
      }));
  });

  // ===== Прогресс по конкретному гайду (чеклисты, позиция видео) =====
  app.get('/guides/:id/progress', { preHandler: requireAuth }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const user = req.currentUser!;
    const row = await prisma.userGuideProgress.findUnique({
      where: { userId_guideId: { userId: user.id, guideId: id } },
    });
    return {
      checklistState: row?.checklistState ?? {},
      videoPositions: row?.videoPositions ?? {},
      readAt: row?.readAt ?? null,
      activeSec: row?.activeSec ?? 0,
    };
  });

  app.put('/guides/:id/progress', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({
        checklistState: z.record(z.boolean()).optional(),
        videoPositions: z.record(z.number()).optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const user = req.currentUser!;
    const data: any = { lastOpenedAt: new Date() };
    if (body.data.checklistState) data.checklistState = body.data.checklistState;
    if (body.data.videoPositions) data.videoPositions = body.data.videoPositions;

    const row = await prisma.userGuideProgress.upsert({
      where: { userId_guideId: { userId: user.id, guideId: id } },
      create: { userId: user.id, guideId: id, ...data },
      update: data,
    });
    return { checklistState: row.checklistState, videoPositions: row.videoPositions };
  });

  // ===== Полезно / не полезно =====
  app.post('/guides/:id/feedback', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({ helpful: z.boolean(), comment: z.string().max(1000).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const user = req.currentUser!;
    const row = await prisma.guideFeedback.upsert({
      where: { guideId_userId: { guideId: id, userId: user.id } },
      create: { guideId: id, userId: user.id, helpful: body.data.helpful, comment: body.data.comment ?? null },
      update: { helpful: body.data.helpful, comment: body.data.comment ?? null, ts: new Date() },
    });
    return { helpful: row.helpful };
  });

  app.get('/guides/:id/feedback/mine', { preHandler: requireAuth }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const row = await prisma.guideFeedback.findUnique({
      where: { guideId_userId: { guideId: id, userId: req.currentUser!.id } },
    });
    return { helpful: row?.helpful ?? null, comment: row?.comment ?? null };
  });

  // ===== Поиск =====
  app.get('/search', reader, async (req) => {
    const q = z
      .object({ q: z.string().default(''), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);

    const query = q.q.trim();
    if (query.length < 2) return { items: [], total: 0, q: query };

    // websearch_to_tsquery понимает кавычки и «-слово», и не падает на кривом вводе,
    // в отличие от to_tsquery
    const rows = await prisma.$queryRaw<
      Array<{
        id: number;
        slug: string;
        title: string;
        summary: string | null;
        readingTimeSec: number;
        categoryTitle: string;
        categorySlug: string;
        rank: number;
        headline: string;
      }>
    >`
      SELECT g.id,
             g.slug,
             g.title,
             g.summary,
             g."readingTimeSec",
             c.title AS "categoryTitle",
             c.slug  AS "categorySlug",
             ts_rank(g.tsv, websearch_to_tsquery('russian', ${query})) AS rank,
             ts_headline('russian', coalesce(g."plainText", ''),
                         websearch_to_tsquery('russian', ${query}),
                         'MaxWords=30, MinWords=10, StartSel=<em>, StopSel=</em>, MaxFragments=2, FragmentDelimiter= … ')
               AS headline
      FROM "Guide" g
      JOIN "Category" c ON c.id = g."categoryId"
      WHERE g.status = 'PUBLISHED'
        AND g.tsv @@ websearch_to_tsquery('russian', ${query})
      ORDER BY rank DESC, g."publishedAt" DESC
      LIMIT ${q.limit}
    `;

    // Каждый запрос — сигнал «каких гайдов не хватает» (§5.4).
    // Пишем в фоне: поиск не должен ждать запись статистики.
    const user = await tryAuth(req);
    void prisma.searchQuery
      .create({ data: { q: query.slice(0, 200), resultCount: rows.length, userId: user?.id ?? null } })
      .catch(() => {});

    return { items: rows, total: rows.length, q: query };
  });

  // ===== Подсказки при пустой выдаче: похожие названия через триграммы =====
  app.get('/search/suggest', reader, async (req) => {
    const q = z.object({ q: z.string().default('') }).parse(req.query);
    const query = q.q.trim();
    if (query.length < 3) return [];

    return prisma.$queryRaw<Array<{ slug: string; title: string }>>`
      SELECT slug, title
      FROM "Guide"
      WHERE status = 'PUBLISHED' AND similarity(title, ${query}) > 0.2
      ORDER BY similarity(title, ${query}) DESC
      LIMIT 5
    `;
  });
}
