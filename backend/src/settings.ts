import { prisma } from './db.js';

/**
 * key/value настройки в БД. Источник истины для того, что может меняться
 * в рантайме без передеплоя — например, google.refresh_token (§9.0: `.env`
 * задаёт только начальное значение, дальше истина в БД).
 */
export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Значение из БД, а если его нет — из .env. */
export async function settingOr<T>(key: string, fallback: T): Promise<T> {
  const v = await getSetting<T>(key);
  return v === undefined || v === null ? fallback : v;
}

export const SETTING_KEYS = {
  googleRefreshToken: 'google.refresh_token',
  googleRootFolderId: 'google.root_folder_id',
  readScrollPct: 'analytics.read_scroll_pct',
  readTimeRatio: 'analytics.read_time_ratio',
  backupLastSuccessAt: 'backup.last_success_at',
} as const;
