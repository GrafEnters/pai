import { prisma } from './db.js';

export const SETTING_KEYS = {
  googleRefreshToken: 'google.refresh_token',
  googleRootFolderId: 'google.root_folder_id',
  readScrollPct: 'analytics.read_scroll_pct',
  readTimeRatio: 'analytics.read_time_ratio',
  backupLastSuccessAt: 'backup.last_success_at',
  /** Пускать ли читать гайды без входа. По умолчанию — нет, сайт закрытый. */
  publicAccess: 'access.public',
} as const;

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
  if (key === SETTING_KEYS.publicAccess) publicAccessCache = null;
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

/**
 * Открыт ли публичный доступ.
 *
 * Значение спрашивают на каждый запрос — и гейт контента здесь, и middleware
 * сайта через `/api/access`. Ради одного булева ходить в базу столько раз
 * незачем, поэтому держим его в памяти процесса. Правка из админки идёт через
 * `setSetting` и сбрасывает кэш сразу, TTL — просто страховка.
 */
let publicAccessCache: { value: boolean; at: number } | null = null;
const PUBLIC_ACCESS_TTL_MS = 30_000;

export async function isPublicAccessOpen(): Promise<boolean> {
  if (publicAccessCache && Date.now() - publicAccessCache.at < PUBLIC_ACCESS_TTL_MS) {
    return publicAccessCache.value;
  }
  const value = (await getSetting<boolean>(SETTING_KEYS.publicAccess)) === true;
  publicAccessCache = { value, at: Date.now() };
  return value;
}
