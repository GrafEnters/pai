import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth.js';
import { rollupDay } from '../../jobs/analytics.js';

const rangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

/** Уникальные посетители за окно — считаем по visitorId, а не по userId:
 *  DAU должен ловить и того, кто читает, не залогинившись повторно. */
async function distinctVisitors(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(DISTINCT "visitorId")::bigint AS count FROM "Event" WHERE ts >= ${from} AND ts <= ${to}
  `;
  return Number(rows[0]?.count ?? 0);
}

function range(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400_000);
  return { from, to, fromDay: from.toISOString().slice(0, 10), toDay: to.toISOString().slice(0, 10) };
}

export async function adminStatsRoutes(app: FastifyInstance) {
  const onlyAdmin = { preHandler: requireRole('ADMIN') };

  /** Пересчитать агрегаты за сегодня прямо сейчас — чтобы дашборд не ждал cron. */
  app.post('/admin/stats/rollup', onlyAdmin, async (req) => {
    await rollupDay(new Date(), (m) => req.log.info(m));
    await rollupDay(new Date(Date.now() - 86400_000), (m) => req.log.info(m));
    return { ok: true };
  });

  // ===== Обзор =====
  app.get('/admin/stats/overview', onlyAdmin, async (req) => {
    const { from, to } = range(rangeSchema.parse(req.query));

    const [dau, wau, mau, sessions, topGuides, byDay, totals] = await Promise.all([
      distinctVisitors(new Date(Date.now() - 86400_000), new Date()),
      distinctVisitors(new Date(Date.now() - 7 * 86400_000), new Date()),
      distinctVisitors(new Date(Date.now() - 30 * 86400_000), new Date()),
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "sessionId")::bigint AS count FROM "Event" WHERE ts >= ${from} AND ts <= ${to}
      `,
      prisma.$queryRaw<Array<{ guideId: number; title: string; slug: string; views: bigint; reads: bigint }>>`
        SELECT g.id AS "guideId", g.title, g.slug,
               COALESCE(SUM(s.views), 0)::bigint AS views,
               COALESCE(SUM(s.reads), 0)::bigint AS reads
        FROM "DailyGuideStat" s
        JOIN "Guide" g ON g.id = s."guideId"
        WHERE s."date" >= ${from} AND s."date" <= ${to}
        GROUP BY g.id, g.title, g.slug
        ORDER BY views DESC
        LIMIT 10
      `,
      prisma.$queryRaw<Array<{ day: Date; views: bigint; visitors: bigint }>>`
        SELECT "date" AS day,
               SUM(views)::bigint AS views,
               SUM("uniqueVisitors")::bigint AS visitors
        FROM "DailyGuideStat"
        WHERE "date" >= ${from} AND "date" <= ${to}
        GROUP BY "date"
        ORDER BY "date"
      `,
      prisma.$queryRaw<[{ guides: bigint; published: bigint; media: bigint; users: bigint }]>`
        SELECT
          (SELECT COUNT(*) FROM "Guide")::bigint AS guides,
          (SELECT COUNT(*) FROM "Guide" WHERE status = 'PUBLISHED')::bigint AS published,
          (SELECT COUNT(*) FROM "Media")::bigint AS media,
          (SELECT COUNT(*) FROM "User" WHERE "isActive")::bigint AS users
      `,
    ]);

    return {
      dau,
      wau,
      mau,
      sessions: Number(sessions[0]?.count ?? 0),
      topGuides: topGuides.map((g) => ({ ...g, views: Number(g.views), reads: Number(g.reads) })),
      byDay: byDay.map((d) => ({
        day: d.day.toISOString().slice(0, 10),
        views: Number(d.views),
        visitors: Number(d.visitors),
      })),
      totals: {
        guides: Number(totals[0]?.guides ?? 0),
        published: Number(totals[0]?.published ?? 0),
        media: Number(totals[0]?.media ?? 0),
        users: Number(totals[0]?.users ?? 0),
      },
    };
  });

  // ===== Таблица по гайдам =====
  app.get('/admin/stats/guides', onlyAdmin, async (req) => {
    const q = rangeSchema.extend({ sort: z.enum(['views', 'reads', 'readRate', 'time']).default('views') }).parse(req.query);
    const { from, to } = range(q);
    return guideStatRows(from, to, q.sort);
  });

  // ===== Детально по одному гайду =====
  app.get('/admin/stats/guides/:id', onlyAdmin, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { from, to } = range(rangeSchema.parse(req.query));

    const [daily, scrollProfile, feedback] = await Promise.all([
      prisma.dailyGuideStat.findMany({
        where: { guideId: id, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      }),
      // Профиль скролла: сразу видно, на каком месте люди бросают
      prisma.$queryRaw<Array<{ depth: number; count: bigint }>>`
        SELECT (props->>'depth')::int AS depth, COUNT(*)::bigint AS count
        FROM "Event"
        WHERE "guideId" = ${id} AND type = 'GUIDE_SCROLL' AND ts >= ${from} AND ts <= ${to}
        GROUP BY depth ORDER BY depth
      `,
      prisma.guideFeedback.findMany({
        where: { guideId: id },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { ts: 'desc' },
        take: 50,
      }),
    ]);

    return {
      daily: daily.map((d) => ({ ...d, date: d.date.toISOString().slice(0, 10) })),
      scrollProfile: scrollProfile.map((s) => ({ depth: s.depth, count: Number(s.count) })),
      feedback,
      helpful: feedback.filter((f) => f.helpful).length,
      notHelpful: feedback.filter((f) => !f.helpful).length,
    };
  });

  // ===== Видео: воронка и трафик =====
  app.get('/admin/stats/videos', onlyAdmin, async (req) => {
    const { from, to } = range(rangeSchema.parse(req.query));

    const rows = await prisma.$queryRaw<
      Array<{
        mediaId: number;
        originalName: string;
        durationSec: number | null;
        plays: bigint;
        p25: bigint;
        p50: bigint;
        p75: bigint;
        p95: bigint;
        completes: bigint;
        bytesServed: bigint;
      }>
    >`
      SELECT s."mediaId", m."originalName", m."durationSec",
             SUM(s.plays)::bigint AS plays,
             SUM(s.p25)::bigint AS p25, SUM(s.p50)::bigint AS p50,
             SUM(s.p75)::bigint AS p75, SUM(s.p95)::bigint AS p95,
             SUM(s.completes)::bigint AS completes,
             SUM(s."bytesServed")::bigint AS "bytesServed"
      FROM "DailyVideoStat" s
      JOIN "Media" m ON m.id = s."mediaId"
      WHERE s."date" >= ${from} AND s."date" <= ${to}
      GROUP BY s."mediaId", m."originalName", m."durationSec"
      ORDER BY plays DESC
    `;

    // Две метрики, без которых такт 2 этапа 7 не на чем основывать (§7.2)
    const library = await prisma.media.aggregate({
      where: { type: 'VIDEO', status: 'READY' },
      _sum: { durationSec: true, sizeBytes: true },
      _count: { _all: true },
    });

    return {
      items: rows.map((r) => ({
        mediaId: r.mediaId,
        originalName: r.originalName,
        durationSec: r.durationSec,
        plays: Number(r.plays),
        funnel: { p25: Number(r.p25), p50: Number(r.p50), p75: Number(r.p75), p95: Number(r.p95) },
        completes: Number(r.completes),
        bytesServed: Number(r.bytesServed),
      })),
      library: {
        count: library._count._all,
        hours: Math.round(((library._sum.durationSec ?? 0) / 3600) * 10) / 10,
        gbStored: Math.round((Number(library._sum.sizeBytes ?? 0) / 1024 ** 3) * 100) / 100,
      },
      gbServed:
        Math.round((rows.reduce((sum, r) => sum + Number(r.bytesServed), 0) / 1024 ** 3) * 100) / 100,
    };
  });

  // ===== Люди и покрытие обязательных =====
  app.get('/admin/stats/users', onlyAdmin, async (req) => {
    const { from, to } = range(rangeSchema.parse(req.query));

    const users = await prisma.user.findMany({
      where: { isActive: true, role: { not: 'NONE' } },
      select: { id: true, name: true, teamRole: true, createdAt: true, lastSeenAt: true },
      orderBy: { name: 'asc' },
    });

    const [progress, required, activity] = await Promise.all([
      prisma.userGuideProgress.findMany({
        select: { userId: true, guideId: true, readAt: true, activeSec: true },
      }),
      prisma.guide.findMany({
        where: { status: 'PUBLISHED', NOT: { requiredForRoles: { isEmpty: true } } },
        select: { id: true, requiredForRoles: true },
      }),
      prisma.$queryRaw<Array<{ userId: number; events: bigint }>>`
        SELECT "userId", COUNT(*)::bigint AS events
        FROM "Event"
        WHERE "userId" IS NOT NULL AND ts >= ${from} AND ts <= ${to}
        GROUP BY "userId"
      `,
    ]);

    const eventsByUser = new Map(activity.map((a) => [a.userId, Number(a.events)]));

    return users.map((u) => {
      const mine = progress.filter((p) => p.userId === u.id);
      const requiredForMe = required.filter((g) => g.requiredForRoles.includes(u.teamRole));
      const readRequired = requiredForMe.filter((g) => mine.some((p) => p.guideId === g.id && p.readAt));
      return {
        id: u.id,
        name: u.name,
        teamRole: u.teamRole,
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        opened: mine.length,
        read: mine.filter((p) => p.readAt).length,
        activeMin: Math.round(mine.reduce((s, p) => s + p.activeSec, 0) / 60),
        requiredTotal: requiredForMe.length,
        requiredRead: readRequired.length,
        events: eventsByUser.get(u.id) ?? 0,
      };
    });
  });

  // ===== Поиск: топ и запросы без результатов =====
  app.get('/admin/stats/search', onlyAdmin, async (req) => {
    const { from, to } = range(rangeSchema.parse(req.query));

    const [top, empty] = await Promise.all([
      prisma.$queryRaw<Array<{ q: string; count: bigint; avgResults: number }>>`
        SELECT lower(q) AS q, COUNT(*)::bigint AS count, AVG("resultCount")::float AS "avgResults"
        FROM "SearchQuery" WHERE ts >= ${from} AND ts <= ${to}
        GROUP BY lower(q) ORDER BY count DESC LIMIT 30
      `,
      prisma.$queryRaw<Array<{ q: string; count: bigint }>>`
        SELECT lower(q) AS q, COUNT(*)::bigint AS count
        FROM "SearchQuery" WHERE "resultCount" = 0 AND ts >= ${from} AND ts <= ${to}
        GROUP BY lower(q) ORDER BY count DESC LIMIT 30
      `,
    ]);

    return {
      top: top.map((r) => ({ q: r.q, count: Number(r.count), avgResults: Math.round(r.avgResults * 10) / 10 })),
      // Готовый список того, какие гайды писать следующими (§8.5)
      empty: empty.map((r) => ({ q: r.q, count: Number(r.count) })),
    };
  });

  // ===== Мёртвый и протухший контент =====
  app.get('/admin/stats/stale', onlyAdmin, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(7).max(365).default(60) }).parse(req.query);
    const since = new Date(Date.now() - q.days * 86400_000);

    const [dead, expired] = await Promise.all([
      prisma.$queryRaw<Array<{ id: number; title: string; slug: string; publishedAt: Date | null; views: bigint }>>`
        SELECT g.id, g.title, g.slug, g."publishedAt",
               COALESCE((SELECT SUM(views) FROM "DailyGuideStat" s WHERE s."guideId" = g.id AND s."date" >= ${since}), 0)::bigint AS views
        FROM "Guide" g
        WHERE g.status = 'PUBLISHED'
        ORDER BY views ASC, g."publishedAt" ASC
        LIMIT 50
      `,
      prisma.guide.findMany({
        where: { status: 'PUBLISHED', reviewAt: { lte: new Date() } },
        select: { id: true, title: true, slug: true, reviewAt: true, updatedAt: true },
        orderBy: { reviewAt: 'asc' },
      }),
    ]);

    return {
      windowDays: q.days,
      // «Понимать, что ненужно» — прямой ответ на требование заказчика (§8.5)
      dead: dead.filter((d) => Number(d.views) === 0).map((d) => ({ ...d, views: 0 })),
      lowTraffic: dead.filter((d) => Number(d.views) > 0).slice(0, 20).map((d) => ({ ...d, views: Number(d.views) })),
      expired,
    };
  });

  // ===== Выгрузка =====
  app.get('/admin/stats/export', onlyAdmin, async (req, reply) => {
    const q = rangeSchema.extend({ format: z.enum(['csv', 'xlsx']).default('xlsx') }).parse(req.query);
    const { from, to } = range(q);
    const rows = await guideStatRows(from, to, 'views');
    const filename = `stats-${new Date().toISOString().slice(0, 10)}.${q.format}`;

    if (q.format === 'csv') {
      const header = ['Гайд', 'Категория', 'Открытий', 'Уникальных', 'Дочитали', '% дочитывания', 'Ср. время, с', 'Скролл 50%', 'Скролл 100%'];
      // Заголовок тоже через экранирование: «Ср. время, с» содержит запятую
      const lines = [header.map(csvEscape).join(',')];
      for (const r of rows) {
        lines.push(
          [r.title, r.category, r.views, r.uniqueVisitors, r.reads, r.readRate, r.avgActiveSec, r.scroll50, r.scroll100]
            .map(csvEscape)
            .join(','),
        );
      }
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`);
      return '﻿' + lines.join('\n'); // BOM, иначе Excel ломает кириллицу
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Гайды');
    ws.columns = [
      { header: 'Гайд', key: 'title', width: 42 },
      { header: 'Категория', key: 'category', width: 18 },
      { header: 'Открытий', key: 'views', width: 11 },
      { header: 'Уникальных', key: 'uniqueVisitors', width: 12 },
      { header: 'Дочитали', key: 'reads', width: 11 },
      { header: '% дочитывания', key: 'readRate', width: 15 },
      { header: 'Ср. время, с', key: 'avgActiveSec', width: 14 },
      { header: 'Скролл 50%', key: 'scroll50', width: 12 },
      { header: 'Скролл 100%', key: 'scroll100', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(r);

    const totalRow = ws.addRow({
      title: 'Итого',
      views: rows.reduce((s, r) => s + r.views, 0),
      uniqueVisitors: rows.reduce((s, r) => s + r.uniqueVisitors, 0),
      reads: rows.reduce((s, r) => s + r.reads, 0),
    });
    totalRow.font = { bold: true };
    ws.getColumn('readRate').numFmt = '0.0"%"';

    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`);
    return Buffer.from(await wb.xlsx.writeBuffer());
  });
}

interface GuideStatRow {
  guideId: number;
  title: string;
  slug: string;
  category: string;
  views: number;
  uniqueVisitors: number;
  reads: number;
  readRate: number;
  avgActiveSec: number;
  scroll50: number;
  scroll100: number;
}

async function guideStatRows(from: Date, to: Date, sort: string): Promise<GuideStatRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      guideId: number;
      title: string;
      slug: string;
      category: string;
      views: bigint;
      uniqueVisitors: bigint;
      reads: bigint;
      avgActiveSec: number;
      scroll50: bigint;
      scroll100: bigint;
    }>
  >`
    SELECT g.id AS "guideId", g.title, g.slug, c.title AS category,
           COALESCE(SUM(s.views), 0)::bigint AS views,
           COALESCE(SUM(s."uniqueVisitors"), 0)::bigint AS "uniqueVisitors",
           COALESCE(SUM(s.reads), 0)::bigint AS reads,
           COALESCE(AVG(NULLIF(s."avgActiveSec", 0)), 0)::float AS "avgActiveSec",
           COALESCE(SUM(s.scroll50), 0)::bigint AS scroll50,
           COALESCE(SUM(s.scroll100), 0)::bigint AS scroll100
    FROM "Guide" g
    JOIN "Category" c ON c.id = g."categoryId"
    LEFT JOIN "DailyGuideStat" s ON s."guideId" = g.id AND s."date" >= ${from} AND s."date" <= ${to}
    WHERE g.status = 'PUBLISHED'
    GROUP BY g.id, g.title, g.slug, c.title
  `;

  const mapped = rows.map((r) => {
    const views = Number(r.views);
    const reads = Number(r.reads);
    return {
      guideId: r.guideId,
      title: r.title,
      slug: r.slug,
      category: r.category,
      views,
      uniqueVisitors: Number(r.uniqueVisitors),
      reads,
      readRate: views ? Math.round((reads / views) * 1000) / 10 : 0,
      avgActiveSec: Math.round(r.avgActiveSec),
      scroll50: Number(r.scroll50),
      scroll100: Number(r.scroll100),
    };
  });

  const compare: Record<string, (a: GuideStatRow, b: GuideStatRow) => number> = {
    views: (a, b) => b.views - a.views,
    reads: (a, b) => b.reads - a.reads,
    readRate: (a, b) => b.readRate - a.readRate,
    time: (a, b) => b.avgActiveSec - a.avgActiveSec,
  };
  return mapped.sort(compare[sort] ?? compare.views!);
}

function csvEscape(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
