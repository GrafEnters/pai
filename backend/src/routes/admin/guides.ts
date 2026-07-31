import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { currentUser, requireRole } from '../../auth.js';
import { audit } from '../../audit.js';
import { asDoc, EMPTY_DOC } from '../../content/schema.js';
import { deriveContent, syncGuideMedia, syncGuideRelations, uniqueSlug } from '../../services/guides.js';
import { serializeMedia } from '../../services/mediaView.js';
import { invalidateGuide } from '../../services/cdn.js';

const STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED'] as const;
const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
const TEAM_ROLES = ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'] as const;

/** Гайд открыт другим редактором менее 5 минут назад — предупреждаем (§4.2). */
const LOCK_TTL_MS = 5 * 60_000;

const listSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  status: true,
  level: true,
  version: true,
  categoryId: true,
  isPinned: true,
  sortOrder: true,
  reviewAt: true,
  publishedAt: true,
  updatedAt: true,
  readingTimeSec: true,
  category: { select: { id: true, title: true, slug: true } },
  author: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, slug: true, title: true } } } },
} as const;

function flattenTags<T extends { tags: { tag: { id: number; slug: string; title: string } }[] }>(g: T) {
  return { ...g, tags: g.tags.map((t) => t.tag) };
}

export async function adminGuideRoutes(app: FastifyInstance) {
  const editor = { preHandler: requireRole('EDITOR') };

  // ===== Список =====
  app.get('/admin/guides', editor, async (req) => {
    const q = z
      .object({
        status: z.enum(STATUSES).optional(),
        categoryId: z.coerce.number().int().optional(),
        q: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);

    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { summary: { contains: s, mode: 'insensitive' } },
        { plainText: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.guide.findMany({
        where,
        select: listSelect,
        orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.guide.count({ where }),
    ]);

    return { items: items.map(flattenTags), total, page: q.page, limit: q.limit };
  });

  // ===== Новый черновик =====
  app.post('/admin/guides', editor, async (req, reply) => {
    const body = z
      .object({ title: z.string().min(1).max(300), categoryId: z.coerce.number().int().positive() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Нужны заголовок и категория' });

    const category = await prisma.category.findUnique({ where: { id: body.data.categoryId } });
    if (!category) return reply.code(400).send({ error: 'Категория не найдена' });

    const guide = await prisma.guide.create({
      data: {
        title: body.data.title.trim(),
        slug: await uniqueSlug(body.data.title),
        categoryId: body.data.categoryId,
        content: EMPTY_DOC as never,
        contentDraft: EMPTY_DOC as never,
        authorId: currentUser(req).id,
        status: 'DRAFT',
      },
      select: listSelect,
    });

    await audit(req, 'guide.create', 'Guide', guide.id, { title: guide.title });
    return flattenTags(guide);
  });

  // ===== Один гайд =====
  app.get('/admin/guides/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const guide = await prisma.guide.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, title: true, slug: true } },
        author: { select: { id: true, name: true } },
        tags: { select: { tag: true } },
        cover: true,
        related: { select: { to: { select: { id: true, title: true, slug: true } } } },
      },
    });
    if (!guide) return reply.code(404).send({ error: 'Гайд не найден' });

    const lockedBy =
      guide.lockedById && guide.lockedAt && Date.now() - guide.lockedAt.getTime() < LOCK_TTL_MS
        ? await prisma.user.findUnique({ where: { id: guide.lockedById }, select: { id: true, name: true } })
        : null;

    return {
      ...guide,
      tags: guide.tags.map((t) => t.tag),
      cover: guide.cover ? serializeMedia(guide.cover) : null,
      related: guide.related.map((r) => r.to),
      // Себе самому блокировка не мешает
      lockedBy: lockedBy && lockedBy.id !== currentUser(req).id ? lockedBy : null,
    };
  });

  // ===== Автосохранение и метаданные =====
  app.patch('/admin/guides/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(300).optional(),
        summary: z.string().max(1000).nullable().optional(),
        contentDraft: z.any().optional(),
        categoryId: z.coerce.number().int().positive().optional(),
        level: z.enum(LEVELS).optional(),
        coverId: z.coerce.number().int().positive().nullable().optional(),
        tagIds: z.array(z.coerce.number().int().positive()).optional(),
        requiredForRoles: z.array(z.enum(TEAM_ROLES)).optional(),
        reviewAt: z.string().datetime().nullable().optional(),
        isPinned: z.boolean().optional(),
        slug: z.string().min(1).max(120).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
    }

    const existing = await prisma.guide.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Гайд не найден' });

    const me = currentUser(req);
    const data: any = { updatedById: me.id };
    const d = body.data;
    if (d.title !== undefined) data.title = d.title.trim();
    if (d.summary !== undefined) data.summary = d.summary;
    if (d.contentDraft !== undefined) data.contentDraft = asDoc(d.contentDraft);
    if (d.categoryId !== undefined) data.categoryId = d.categoryId;
    if (d.level !== undefined) data.level = d.level;
    if (d.coverId !== undefined) data.coverId = d.coverId;
    if (d.requiredForRoles !== undefined) data.requiredForRoles = d.requiredForRoles;
    if (d.reviewAt !== undefined) data.reviewAt = d.reviewAt ? new Date(d.reviewAt) : null;
    if (d.isPinned !== undefined) data.isPinned = d.isPinned;
    if (d.slug !== undefined) data.slug = await uniqueSlug(d.slug, id);

    // Правка продлевает мягкую блокировку — пока человек печатает, гайд «занят»
    data.lockedById = me.id;
    data.lockedAt = new Date();

    const guide = await prisma.guide.update({ where: { id }, data, select: listSelect });

    if (d.tagIds) {
      await prisma.guideTag.deleteMany({ where: { guideId: id } });
      if (d.tagIds.length) {
        await prisma.guideTag.createMany({
          data: d.tagIds.map((tagId) => ({ guideId: id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    // Автосейв контента в аудит не пишем — иначе журнал утонет в шуме каждые 5 секунд
    const meaningful = { ...d } as Record<string, unknown>;
    delete meaningful.contentDraft;
    if (Object.keys(meaningful).length) {
      await audit(req, 'guide.update', 'Guide', id, meaningful);
    }

    return { ...flattenTags(guide), savedAt: new Date().toISOString() };
  });

  // ===== Публикация =====
  app.post('/admin/guides/:id/publish', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({ changeNote: z.string().max(500).optional() }).safeParse(req.body ?? {});

    const guide = await prisma.guide.findUnique({ where: { id }, include: { category: true } });
    if (!guide) return reply.code(404).send({ error: 'Гайд не найден' });

    const doc = asDoc(guide.contentDraft ?? guide.content);
    const derived = await deriveContent(doc);
    const me = currentUser(req);
    const nextVersion = guide.version + 1;

    const updated = await prisma.$transaction(async (tx) => {
      const g = await tx.guide.update({
        where: { id },
        data: {
          content: doc as never,
          contentDraft: doc as never,
          html: derived.html,
          plainText: derived.plainText,
          readingTimeSec: derived.readingTimeSec,
          version: nextVersion,
          status: 'PUBLISHED',
          publishedAt: guide.publishedAt ?? new Date(),
          updatedById: me.id,
        },
        select: listSelect,
      });

      // Снимок каждой публикации — как TicketVersion в polina-crm
      await tx.guideVersion.create({
        data: {
          guideId: id,
          version: nextVersion,
          title: g.title,
          content: doc as never,
          changedById: me.id,
          changeNote: body.success ? (body.data.changeNote ?? null) : null,
        },
      });

      return g;
    });

    await syncGuideMedia(id, derived.mediaIds);
    await syncGuideRelations(id, doc);
    await invalidateGuide(updated.slug, guide.category.slug);
    await audit(req, 'guide.publish', 'Guide', id, {
      version: nextVersion,
      changeNote: body.success ? body.data.changeNote : undefined,
    });

    return flattenTags(updated);
  });

  // ===== Смена статуса =====
  for (const [action, status] of [
    ['unpublish', 'DRAFT'],
    ['archive', 'ARCHIVED'],
    ['review', 'IN_REVIEW'],
  ] as const) {
    app.post(`/admin/guides/:id/${action}`, editor, async (req, reply) => {
      const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
      const guide = await prisma.guide.findUnique({ where: { id }, include: { category: true } });
      if (!guide) return reply.code(404).send({ error: 'Гайд не найден' });

      const updated = await prisma.guide.update({
        where: { id },
        data: { status, updatedById: currentUser(req).id },
        select: listSelect,
      });
      await invalidateGuide(updated.slug, guide.category.slug);
      await audit(req, `guide.${action}`, 'Guide', id, { status });
      return flattenTags(updated);
    });
  }

  // ===== Дублирование =====
  app.post('/admin/guides/:id/duplicate', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const src = await prisma.guide.findUnique({ where: { id }, include: { tags: true } });
    if (!src) return reply.code(404).send({ error: 'Гайд не найден' });

    const title = `${src.title} (копия)`;
    const copy = await prisma.guide.create({
      data: {
        title,
        slug: await uniqueSlug(title),
        summary: src.summary,
        categoryId: src.categoryId,
        level: src.level,
        coverId: src.coverId,
        content: (src.contentDraft ?? src.content) as never,
        contentDraft: (src.contentDraft ?? src.content) as never,
        requiredForRoles: src.requiredForRoles,
        authorId: currentUser(req).id,
        status: 'DRAFT',
      },
      select: listSelect,
    });
    if (src.tags.length) {
      await prisma.guideTag.createMany({
        data: src.tags.map((t) => ({ guideId: copy.id, tagId: t.tagId })),
        skipDuplicates: true,
      });
    }
    await audit(req, 'guide.duplicate', 'Guide', copy.id, { from: id });
    return flattenTags(copy);
  });

  // ===== Удаление =====
  app.delete('/admin/guides/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const guide = await prisma.guide.findUnique({ where: { id }, include: { category: true } });
    if (!guide) return reply.code(404).send({ error: 'Гайд не найден' });
    if (guide.status === 'PUBLISHED') {
      return reply.code(409).send({ error: 'Сначала снимите гайд с публикации' });
    }
    await prisma.guide.delete({ where: { id } });
    await invalidateGuide(guide.slug, guide.category.slug);
    await audit(req, 'guide.delete', 'Guide', id, { title: guide.title });
    return { ok: true };
  });

  // ===== Версии =====
  app.get('/admin/guides/:id/versions', editor, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return prisma.guideVersion.findMany({
      where: { guideId: id },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        title: true,
        changeNote: true,
        createdAt: true,
        changedBy: { select: { id: true, name: true } },
      },
    });
  });

  app.get('/admin/guides/:id/versions/:v', editor, async (req, reply) => {
    const p = z
      .object({ id: z.coerce.number().int().positive(), v: z.coerce.number().int().positive() })
      .parse(req.params);
    const version = await prisma.guideVersion.findUnique({
      where: { guideId_version: { guideId: p.id, version: p.v } },
      include: { changedBy: { select: { id: true, name: true } } },
    });
    if (!version) return reply.code(404).send({ error: 'Версия не найдена' });

    const { toPlainText } = await import('../../content/render.js');
    return { ...version, plainText: toPlainText(asDoc(version.content)) };
  });

  app.post('/admin/guides/:id/revert/:v', editor, async (req, reply) => {
    const p = z
      .object({ id: z.coerce.number().int().positive(), v: z.coerce.number().int().positive() })
      .parse(req.params);
    const version = await prisma.guideVersion.findUnique({
      where: { guideId_version: { guideId: p.id, version: p.v } },
    });
    if (!version) return reply.code(404).send({ error: 'Версия не найдена' });

    // Откат кладём в черновик, а не в опубликованное: редактор увидит, что получилось,
    // и опубликует сам — публикация из отката вслепую слишком легко ломает живой гайд
    const guide = await prisma.guide.update({
      where: { id: p.id },
      data: { contentDraft: version.content as never, updatedById: currentUser(req).id },
      select: listSelect,
    });
    await audit(req, 'guide.revert', 'Guide', p.id, { toVersion: p.v });
    return flattenTags(guide);
  });

  // ===== Мягкая блокировка =====
  app.post('/admin/guides/:id/lock', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const guide = await prisma.guide.findUnique({ where: { id } });
    if (!guide) return reply.code(404).send({ error: 'Гайд не найден' });

    const me = currentUser(req);
    const heldByOther =
      guide.lockedById &&
      guide.lockedById !== me.id &&
      guide.lockedAt &&
      Date.now() - guide.lockedAt.getTime() < LOCK_TTL_MS;

    if (heldByOther) {
      const holder = await prisma.user.findUnique({
        where: { id: guide.lockedById! },
        select: { id: true, name: true },
      });
      return { acquired: false, lockedBy: holder };
    }

    await prisma.guide.update({ where: { id }, data: { lockedById: me.id, lockedAt: new Date() } });
    return { acquired: true, lockedBy: null };
  });

  // ===== Порядок внутри категории =====
  app.post('/admin/guides/reorder', editor, async (req, reply) => {
    const body = z
      .object({ items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).max(500) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    await prisma.$transaction(
      body.data.items.map((i) => prisma.guide.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })),
    );
    await audit(req, 'guide.reorder', 'Guide', null, { count: body.data.items.length });
    return { ok: true };
  });
}
