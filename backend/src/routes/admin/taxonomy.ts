import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth.js';
import { audit } from '../../audit.js';
import { slugify } from '../../content/schema.js';
import { invalidateGuide, revalidateWeb } from '../../services/cdn.js';

async function uniqueSlugFor(
  table: 'category' | 'tag',
  title: string,
  explicit?: string,
  excludeId?: number,
): Promise<string> {
  const base = slugify(explicit || title);
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const found =
      table === 'category'
        ? await prisma.category.findUnique({ where: { slug: candidate }, select: { id: true } })
        : await prisma.tag.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!found || found.id === excludeId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function adminTaxonomyRoutes(app: FastifyInstance) {
  const editor = { preHandler: requireRole('EDITOR') };

  // ============ Категории ============

  app.get('/admin/categories', editor, async () => {
    const [categories, counts] = await Promise.all([
      prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
      prisma.guide.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return categories.map((c) => ({ ...c, guideCount: countBy.get(c.id) ?? 0 }));
  });

  app.post('/admin/categories', editor, async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1).max(120),
        slug: z.string().max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        icon: z.string().max(60).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        parentId: z.coerce.number().int().positive().nullable().optional(),
        sortOrder: z.coerce.number().int().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const category = await prisma.category.create({
      data: {
        ...body.data,
        title: body.data.title.trim(),
        slug: await uniqueSlugFor('category', body.data.title, body.data.slug),
      },
    });
    await audit(req, 'category.create', 'Category', category.id, { title: category.title });
    await revalidateWeb(['/']);
    return category;
  });

  app.patch('/admin/categories/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        slug: z.string().max(120).optional(),
        description: z.string().max(500).nullable().optional(),
        icon: z.string().max(60).nullable().optional(),
        color: z.string().max(20).nullable().optional(),
        parentId: z.coerce.number().int().positive().nullable().optional(),
        sortOrder: z.coerce.number().int().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const before = await prisma.category.findUnique({ where: { id } });
    if (!before) return reply.code(404).send({ error: 'Категория не найдена' });
    if (body.data.parentId === id) {
      return reply.code(400).send({ error: 'Категория не может быть родителем самой себе' });
    }

    const data: any = { ...body.data };
    if (body.data.slug) data.slug = await uniqueSlugFor('category', before.title, body.data.slug, id);

    const category = await prisma.category.update({ where: { id }, data });
    await audit(req, 'category.update', 'Category', id, body.data);
    // Переименование категории меняет её страницу и главную
    await revalidateWeb(['/', `/c/${before.slug}`, `/c/${category.slug}`]);
    return category;
  });

  app.delete('/admin/categories/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const [guides, children] = await Promise.all([
      prisma.guide.count({ where: { categoryId: id } }),
      prisma.category.count({ where: { parentId: id } }),
    ]);
    if (guides) return reply.code(409).send({ error: `В категории ${guides} гайд(ов) — сначала перенесите их` });
    if (children) return reply.code(409).send({ error: 'У категории есть подкатегории' });

    const category = await prisma.category.delete({ where: { id } });
    await audit(req, 'category.delete', 'Category', id, { title: category.title });
    await revalidateWeb(['/']);
    return { ok: true };
  });

  app.post('/admin/categories/reorder', editor, async (req, reply) => {
    const body = z
      .object({ items: z.array(z.object({ id: z.number().int(), sortOrder: z.number().int() })).max(200) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    await prisma.$transaction(
      body.data.items.map((i) => prisma.category.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } })),
    );
    await audit(req, 'category.reorder', 'Category', null, { count: body.data.items.length });
    await revalidateWeb(['/']);
    return { ok: true };
  });

  // ============ Теги ============

  app.get('/admin/tags', editor, async () => {
    const [tags, counts] = await Promise.all([
      prisma.tag.findMany({ orderBy: { title: 'asc' } }),
      prisma.guideTag.groupBy({ by: ['tagId'], _count: { _all: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.tagId, c._count._all]));
    return tags.map((t) => ({ ...t, guideCount: countBy.get(t.id) ?? 0 }));
  });

  app.post('/admin/tags', editor, async (req, reply) => {
    const body = z.object({ title: z.string().min(1).max(80), slug: z.string().max(80).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const tag = await prisma.tag.create({
      data: {
        title: body.data.title.trim(),
        slug: await uniqueSlugFor('tag', body.data.title, body.data.slug),
      },
    });
    await audit(req, 'tag.create', 'Tag', tag.id, { title: tag.title });
    return tag;
  });

  app.patch('/admin/tags/:id', editor, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z.object({ title: z.string().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const tag = await prisma.tag.update({ where: { id }, data: { title: body.data.title.trim() } });
    await audit(req, 'tag.update', 'Tag', id, body.data);
    return tag;
  });

  app.delete('/admin/tags/:id', editor, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const tag = await prisma.tag.findUnique({ where: { id } });
    // Тег удаляется вместе со связями: в отличие от категории, потери контента нет
    await prisma.tag.delete({ where: { id } });
    await audit(req, 'tag.delete', 'Tag', id, { title: tag?.title });
    return { ok: true };
  });

  void invalidateGuide;
}
