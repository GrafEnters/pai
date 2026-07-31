import { prisma } from '../db.js';
import { env } from '../env.js';
import { registerJob, schedule } from './index.js';

export const ROLLUP_TODAY = 'analytics.rollup.today';
export const ROLLUP_DAY = 'analytics.rollup.day';
export const ANALYTICS_CLEANUP = 'analytics.cleanup';

/**
 * Роллапы (PLAN §8.3). Дашборд читает только агрегаты, а не сырые события —
 * иначе на втором году он начнёт открываться минутами.
 *
 * Всё считается одним SQL на день: гонять миллионы строк через Node незачем.
 */
export async function rollupDay(date: Date, log: (m: string) => void = console.log): Promise<void> {
  const day = date.toISOString().slice(0, 10);

  // ===== Гайды =====
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "DailyGuideStat" ("date", "guideId", views, "uniqueVisitors", reads, "avgActiveSec", scroll50, scroll100)
    SELECT
      $1::date,
      e."guideId",
      COUNT(*) FILTER (WHERE e.type = 'GUIDE_OPEN')                                   AS views,
      COUNT(DISTINCT e."visitorId") FILTER (WHERE e.type = 'GUIDE_OPEN')              AS unique_visitors,
      COUNT(*) FILTER (WHERE e.type = 'GUIDE_READ')                                   AS reads,
      COALESCE(
        SUM(COALESCE((e.props->>'sec')::int, 15)) FILTER (WHERE e.type = 'GUIDE_HEARTBEAT')
        / NULLIF(COUNT(DISTINCT e."visitorId") FILTER (WHERE e.type = 'GUIDE_OPEN'), 0),
      0)::int                                                                          AS avg_active_sec,
      COUNT(*) FILTER (WHERE e.type = 'GUIDE_SCROLL' AND (e.props->>'depth')::int >= 50)  AS scroll50,
      COUNT(*) FILTER (WHERE e.type = 'GUIDE_SCROLL' AND (e.props->>'depth')::int >= 100) AS scroll100
    FROM "Event" e
    WHERE e."guideId" IS NOT NULL
      AND e.ts >= $1::date AND e.ts < $1::date + INTERVAL '1 day'
    GROUP BY e."guideId"
    ON CONFLICT ("date", "guideId") DO UPDATE SET
      views = EXCLUDED.views,
      "uniqueVisitors" = EXCLUDED."uniqueVisitors",
      reads = EXCLUDED.reads,
      "avgActiveSec" = EXCLUDED."avgActiveSec",
      scroll50 = EXCLUDED.scroll50,
      scroll100 = EXCLUDED.scroll100
  `,
    day,
  );

  // ===== Видео =====
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "DailyVideoStat" ("date", "mediaId", plays, "uniqueViewers", p25, p50, p75, p95, completes, "avgWatchSec", "bytesServed")
    SELECT
      $1::date,
      e."mediaId",
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_PLAY')                                        AS plays,
      COUNT(DISTINCT e."visitorId") FILTER (WHERE e.type = 'VIDEO_PLAY')                   AS unique_viewers,
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_PROGRESS' AND (e.props->>'pct')::int = 25)    AS p25,
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_PROGRESS' AND (e.props->>'pct')::int = 50)    AS p50,
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_PROGRESS' AND (e.props->>'pct')::int = 75)    AS p75,
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_PROGRESS' AND (e.props->>'pct')::int = 95)    AS p95,
      COUNT(*) FILTER (WHERE e.type = 'VIDEO_COMPLETE')                                    AS completes,
      0                                                                                    AS avg_watch_sec,
      -- «ГБ роздано»: оценка по числу запусков × размер файла. Метрика обязательна
      -- по §7.2 — без неё выбор HLS/Bunny в такте 2 не на чем основывать
      COALESCE(COUNT(*) FILTER (WHERE e.type = 'VIDEO_PLAY') * MAX(m."sizeBytes"), 0)      AS bytes_served
    FROM "Event" e
    JOIN "Media" m ON m.id = e."mediaId"
    WHERE e."mediaId" IS NOT NULL
      AND e.ts >= $1::date AND e.ts < $1::date + INTERVAL '1 day'
    GROUP BY e."mediaId"
    ON CONFLICT ("date", "mediaId") DO UPDATE SET
      plays = EXCLUDED.plays,
      "uniqueViewers" = EXCLUDED."uniqueViewers",
      p25 = EXCLUDED.p25, p50 = EXCLUDED.p50, p75 = EXCLUDED.p75, p95 = EXCLUDED.p95,
      completes = EXCLUDED.completes,
      "bytesServed" = EXCLUDED."bytesServed"
  `,
    day,
  );

  log(`[analytics] роллап за ${day} готов`);
}

export async function registerAnalyticsJobs(log: (m: string) => void = console.log): Promise<void> {
  await registerJob(ROLLUP_TODAY, async () => {
    await rollupDay(new Date(), log);
  });

  // Полный пересчёт вчерашнего: события могут доехать с опозданием (§8.3)
  await registerJob(ROLLUP_DAY, async () => {
    await rollupDay(new Date(Date.now() - 86400_000), log);
  });

  // Сырые события старше срока удаляем, агрегаты остаются навсегда
  await registerJob(ANALYTICS_CLEANUP, async () => {
    const cutoff = new Date(Date.now() - env.analytics.rawRetentionDays * 86400_000);
    const { count } = await prisma.event.deleteMany({ where: { ts: { lt: cutoff } } });
    log(`[analytics] удалено сырых событий старше ${env.analytics.rawRetentionDays} дн.: ${count}`);
  });
}

export async function scheduleAnalyticsJobs(): Promise<void> {
  await schedule(ROLLUP_TODAY, env.analytics.rollupCron);
  await schedule(ROLLUP_DAY, env.analytics.rollupFullCron);
  await schedule(ANALYTICS_CLEANUP, '0 4 * * 1');
}
