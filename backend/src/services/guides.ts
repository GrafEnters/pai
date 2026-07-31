import { prisma } from '../db.js';
import { serializeMedia } from './mediaView.js';
import { asDoc, collectGuideRefs, collectMediaIds, slugify, type TipTapDoc } from '../content/schema.js';
import {
  calcReadingTimeSec,
  emptyContext,
  toHtml,
  toMarkdown,
  toPlainText,
  type RenderContext,
} from '../content/render.js';

/** Собирает всё, на что ссылается документ, одним заходом в БД. */
export async function buildRenderContext(doc: TipTapDoc): Promise<RenderContext> {
  const ctx = emptyContext();

  const mediaIds = collectMediaIds(doc);
  if (mediaIds.length) {
    const media = await prisma.media.findMany({ where: { id: { in: mediaIds } } });
    for (const m of media) {
      const v = serializeMedia(m);
      ctx.media.set(m.id, {
        id: m.id,
        type: m.type,
        url: v.url,
        posterUrl: v.posterUrl,
        srcset: v.srcset,
        alt: m.alt,
        originalName: m.originalName,
        width: m.width,
        height: m.height,
        durationSec: m.durationSec,
        sizeBytes: m.sizeBytes.toString(),
      });
    }
  }

  const guideIds = collectGuideRefs(doc);
  if (guideIds.length) {
    const guides = await prisma.guide.findMany({
      where: { id: { in: guideIds } },
      select: { id: true, slug: true, title: true, summary: true },
    });
    for (const g of guides) ctx.guides.set(g.id, g);
  }

  return ctx;
}

export interface DerivedContent {
  html: string;
  plainText: string;
  markdown: string;
  readingTimeSec: number;
  mediaIds: number[];
}

/** Всё, что вычисляется из документа при публикации (PLAN §4.2). */
export async function deriveContent(doc: TipTapDoc): Promise<DerivedContent> {
  const ctx = await buildRenderContext(doc);
  return {
    html: toHtml(doc, ctx),
    plainText: toPlainText(doc),
    markdown: toMarkdown(doc, ctx),
    readingTimeSec: calcReadingTimeSec(doc, ctx),
    mediaIds: collectMediaIds(doc),
  };
}

/** Уникальный slug: к транслиту заголовка добавляем номер, если занято. */
export async function uniqueSlug(title: string, excludeId?: number): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.guide.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Пересобирает связь GuideMedia — на ней держатся бэкап и проверка «можно ли удалить файл». */
export async function syncGuideMedia(guideId: number, mediaIds: number[]): Promise<void> {
  const existing = await prisma.guideMedia.findMany({ where: { guideId }, select: { mediaId: true } });
  const have = new Set(existing.map((e) => e.mediaId));
  const want = new Set(mediaIds);

  const toAdd = [...want].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  if (toRemove.length) {
    await prisma.guideMedia.deleteMany({ where: { guideId, mediaId: { in: toRemove } } });
  }
  if (toAdd.length) {
    await prisma.guideMedia.createMany({
      data: toAdd.map((mediaId) => ({ guideId, mediaId })),
      skipDuplicates: true,
    });
  }
}

/** Пересобирает связи «связанные гайды» из нод guideRef. */
export async function syncGuideRelations(guideId: number, doc: TipTapDoc): Promise<void> {
  const wanted = collectGuideRefs(doc).filter((id) => id !== guideId);
  await prisma.guideRelation.deleteMany({ where: { fromId: guideId } });
  if (wanted.length) {
    const existing = await prisma.guide.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    await prisma.guideRelation.createMany({
      data: existing.map((g) => ({ fromId: guideId, toId: g.id })),
      skipDuplicates: true,
    });
  }
}

export { asDoc };
