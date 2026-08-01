import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { backendDir, repoRoot, resolveDataPath } from './paths.js';

/**
 * Читаем два файла: свой и общий корневой.
 *
 * В репозитории источник истины — корневой `.env`, а `start.cmd` копирует его
 * в `backend/.env` при запуске. Если править корневой файл после этого,
 * скрипты вроде `npm run drive:auth` брали бы устаревшую копию и жаловались
 * на «не заданы переменные», хотя они заданы.
 *
 * dotenv не перезаписывает уже установленные значения, поэтому порядок задаёт
 * приоритет: настоящее окружение (Amvera) → backend/.env → корневой .env.
 */
function loadEnvFile(file: string): void {
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(fs.readFileSync(file));
  } catch {
    return; // файла нет — это нормально, на проде значения приходят из окружения
  }

  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];
    // Настоящее окружение сильнее любых файлов. А пустое значение из одного
    // файла не должно перебивать непустое из другого: в .env.example половина
    // ключей объявлена пустыми, и без этой оговорки они затирали бы реальные.
    if (current === undefined || (current === '' && value !== '')) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(backendDir, '.env'));
loadEnvFile(path.join(repoRoot, '.env'));

/** Пустая строка в .env означает «не задано». */
const optionalStr = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === '' ? undefined : v))
  .optional();

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : /^(1|true|yes|on)$/i.test(v.trim())));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number(v)))
    .pipe(z.number().finite());

const DEFAULT_JWT_SECRET = 'dev-insecure-secret-change-me-please-32-chars-min';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),
  BACKEND_PORT: num(3001),
  // Amvera и большинство PaaS задают порт через PORT — принимаем и его
  PORT: optionalStr,
  HOST: z.string().default('0.0.0.0'),

  JWT_SECRET: z.string().default(DEFAULT_JWT_SECRET),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: num(30),
  COOKIE_DOMAIN: optionalStr,
  COOKIE_SECURE: bool(false),
  BCRYPT_COST: num(12),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),

  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  PUBLIC_ADMIN_URL: z.string().default('http://localhost:5173'),
  WEB_INTERNAL_URL: z.string().default('http://localhost:3000'),
  REVALIDATE_SECRET: z.string().default('dev-revalidate-secret'),

  ADMIN_LOGIN: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('admin12345'),
  ADMIN_NAME: z.string().default('Администратор'),
  ADMIN_EMAIL: optionalStr,
  ADMIN_TELEGRAM_USERNAME: optionalStr,

  STORAGE_PROVIDER: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_LOCAL_PUBLIC_URL: z.string().default('http://localhost:3001/media'),
  R2_ACCOUNT_ID: optionalStr,
  R2_ACCESS_KEY_ID: optionalStr,
  R2_SECRET_ACCESS_KEY: optionalStr,
  R2_BUCKET: z.string().default('pai-media'),
  R2_ENDPOINT: optionalStr,
  R2_PUBLIC_URL: optionalStr,

  MEDIA_IMAGE_MAX_MB: num(25),
  MEDIA_VIDEO_MAX_MB: num(2048),
  FFMPEG_PATH: optionalStr,
  FFPROBE_PATH: optionalStr,

  TELEGRAM_PROVIDER: z.enum(['console', 'telegram']).default('console'),
  TELEGRAM_BOT_TOKEN: optionalStr,
  TELEGRAM_BOT_USERNAME: optionalStr,
  TELEGRAM_ALERT_CHAT_ID: optionalStr,

  CDN_PROVIDER: z.enum(['noop', 'cloudflare']).default('noop'),
  CLOUDFLARE_ZONE_ID: optionalStr,
  CLOUDFLARE_API_TOKEN: optionalStr,

  BACKUP_PROVIDER: z.enum(['local-drive', 'google-drive']).default('local-drive'),
  BACKUP_LOCAL_DIR: z.string().default('./backups'),
  BACKUP_ROOT_FOLDER_NAME: z.string().default('PAI Backups'),
  BACKUP_CONTENT_CRON: z.string().default('0 * * * *'),
  BACKUP_MEDIA_CRON: z.string().default('30 * * * *'),
  BACKUP_DB_CRON: z.string().default('0 4 * * *'),
  BACKUP_VERIFY_CRON: z.string().default('0 5 * * 0'),
  BACKUP_KEEP_DAILY: num(7),
  BACKUP_KEEP_WEEKLY: num(4),
  BACKUP_KEEP_MONTHLY: num(6),
  BACKUP_TOMBSTONE_DAYS: num(30),
  BACKUP_STALE_ALERT_HOURS: num(6),
  PGDUMP_DOCKER_CONTAINER: optionalStr,

  GOOGLE_OAUTH_CLIENT_ID: optionalStr,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalStr,
  GOOGLE_REFRESH_TOKEN: optionalStr,
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default('http://localhost:53682/oauth2callback'),

  ANALYTICS_READ_SCROLL_PCT: num(70),
  ANALYTICS_READ_TIME_RATIO: num(0.4),
  ANALYTICS_RAW_RETENTION_DAYS: num(180),
  ANALYTICS_ROLLUP_CRON: z.string().default('*/15 * * * *'),
  ANALYTICS_ROLLUP_FULL_CRON: z.string().default('0 3 * * *'),
});

/**
 * Значения обрезаются перед разбором.
 *
 * Переменные на хостингах задают через веб-форму, и при копировании в них
 * легко попадает пробел или табуляция. Для путей это тихая катастрофа:
 * значение вроде "	/data/storage" перестаёт быть абсолютным, превращается
 * в /app/<таб>/data/storage и уезжает мимо постоянного диска — всё работает
 * ровно до первой пересборки.
 */
const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
);

const parsed = schema.safeParse(rawEnv);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Некорректные переменные окружения:\n${issues}`);
}
const e = parsed.data;

if (e.NODE_ENV === 'production' && e.JWT_SECRET === DEFAULT_JWT_SECRET) {
  throw new Error(
    'JWT_SECRET равен небезопасному значению по умолчанию. Сгенерируйте свой:\n' +
      `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
  );
}

function normalizeUsername(u?: string) {
  return u ? u.replace(/^@+/, '').trim() : undefined;
}

export const env = {
  nodeEnv: e.NODE_ENV,
  isProd: e.NODE_ENV === 'production',
  logLevel: e.LOG_LEVEL,

  databaseUrl: e.DATABASE_URL,
  port: e.PORT ? Number(e.PORT) : e.BACKEND_PORT,
  host: e.HOST,

  jwtSecret: e.JWT_SECRET,
  accessTtl: e.JWT_ACCESS_TTL,
  refreshTtlDays: e.JWT_REFRESH_TTL_DAYS,
  cookieDomain: e.COOKIE_DOMAIN,
  cookieSecure: e.COOKIE_SECURE,
  bcryptCost: e.BCRYPT_COST,
  corsOrigins: e.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  publicWebUrl: e.PUBLIC_WEB_URL.replace(/\/+$/, ''),
  publicAdminUrl: e.PUBLIC_ADMIN_URL.replace(/\/+$/, ''),
  webInternalUrl: e.WEB_INTERNAL_URL.replace(/\/+$/, ''),
  revalidateSecret: e.REVALIDATE_SECRET,

  admin: {
    login: e.ADMIN_LOGIN,
    password: e.ADMIN_PASSWORD,
    name: e.ADMIN_NAME,
    email: e.ADMIN_EMAIL,
    telegramUsername: normalizeUsername(e.ADMIN_TELEGRAM_USERNAME),
  },

  storage: {
    provider: e.STORAGE_PROVIDER,
    localDir: resolveDataPath(e.STORAGE_LOCAL_DIR),
    localPublicUrl: e.STORAGE_LOCAL_PUBLIC_URL.replace(/\/+$/, ''),
    r2: {
      accountId: e.R2_ACCOUNT_ID,
      accessKeyId: e.R2_ACCESS_KEY_ID,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY,
      bucket: e.R2_BUCKET,
      endpoint: e.R2_ENDPOINT ?? (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined),
      publicUrl: e.R2_PUBLIC_URL?.replace(/\/+$/, ''),
    },
  },

  media: {
    imageMaxBytes: e.MEDIA_IMAGE_MAX_MB * 1024 * 1024,
    videoMaxBytes: e.MEDIA_VIDEO_MAX_MB * 1024 * 1024,
    ffmpegPath: e.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: e.FFPROBE_PATH ?? 'ffprobe',
  },

  telegram: {
    provider: e.TELEGRAM_PROVIDER,
    botToken: e.TELEGRAM_BOT_TOKEN ?? '',
    botUsername: normalizeUsername(e.TELEGRAM_BOT_USERNAME) ?? '',
    alertChatId: e.TELEGRAM_ALERT_CHAT_ID,
  },

  cdn: {
    provider: e.CDN_PROVIDER,
    zoneId: e.CLOUDFLARE_ZONE_ID,
    apiToken: e.CLOUDFLARE_API_TOKEN,
  },

  backup: {
    provider: e.BACKUP_PROVIDER,
    localDir: resolveDataPath(e.BACKUP_LOCAL_DIR),
    rootFolderName: e.BACKUP_ROOT_FOLDER_NAME,
    contentCron: e.BACKUP_CONTENT_CRON,
    mediaCron: e.BACKUP_MEDIA_CRON,
    dbCron: e.BACKUP_DB_CRON,
    verifyCron: e.BACKUP_VERIFY_CRON,
    keepDaily: e.BACKUP_KEEP_DAILY,
    keepWeekly: e.BACKUP_KEEP_WEEKLY,
    keepMonthly: e.BACKUP_KEEP_MONTHLY,
    tombstoneDays: e.BACKUP_TOMBSTONE_DAYS,
    staleAlertHours: e.BACKUP_STALE_ALERT_HOURS,
    pgDumpDockerContainer: e.PGDUMP_DOCKER_CONTAINER,
  },

  google: {
    clientId: e.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: e.GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: e.GOOGLE_REFRESH_TOKEN,
    redirectUri: e.GOOGLE_OAUTH_REDIRECT_URI,
  },

  analytics: {
    readScrollPct: e.ANALYTICS_READ_SCROLL_PCT,
    readTimeRatio: e.ANALYTICS_READ_TIME_RATIO,
    rawRetentionDays: e.ANALYTICS_RAW_RETENTION_DAYS,
    rollupCron: e.ANALYTICS_ROLLUP_CRON,
    rollupFullCron: e.ANALYTICS_ROLLUP_FULL_CRON,
  },
};

export type Env = typeof env;
