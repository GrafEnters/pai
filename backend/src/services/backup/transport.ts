import { env } from '../../env.js';
import { localDriveTransport } from './local-drive.provider.js';
import { googleDriveTransport } from './google-drive.provider.js';

export interface RemoteObject {
  key: string;
  fileId: string;
  size: number;
  md5?: string | null;
}

/**
 * Транспорт бэкапа. Вся логика инкрементальности, манифестов, ретеншена
 * и восстановления живёт НАД этим интерфейсом и одинакова для обеих реализаций —
 * отличается только способ положить и забрать байты (DECISIONS §0).
 */
export interface BackupTransport {
  readonly name: string;
  /** Кладёт объект. `sha256` уходит в метаданные, чтобы позже сверить содержимое. */
  put(
    key: string,
    content: Buffer,
    mime: string,
    meta: { sha256: string; existingFileId?: string | null },
  ): Promise<{ fileId: string; md5: string | null }>;
  get(key: string, fileId?: string | null): Promise<Buffer>;
  exists(key: string, fileId?: string | null): Promise<boolean>;
  delete(fileId: string, key?: string): Promise<void>;
  list(prefix: string): Promise<RemoteObject[]>;
  /** Свободное место, если хранилище о нём сообщает. */
  quota(): Promise<{ total: number; used: number } | null>;
}

export type TransportName = 'local-drive' | 'google-drive';

/** Основное хранилище копий — то, куда бэкап идёт по расписанию. */
export const backupTransport: BackupTransport =
  env.backup.provider === 'google-drive' ? googleDriveTransport : localDriveTransport;

export function getTransport(name?: TransportName): BackupTransport {
  if (name === 'google-drive') return googleDriveTransport;
  if (name === 'local-drive') return localDriveTransport;
  return backupTransport;
}

/**
 * Настроен ли Google Drive как дополнительная копия.
 *
 * Токен читаем «сначала БД, потом .env»: после `npm run drive:auth` он лежит
 * в настройках, и требовать дублировать его в переменные окружения незачем.
 */
export async function isGoogleDriveConfigured(): Promise<{ ok: boolean; reason?: string }> {
  if (!env.google.clientId || !env.google.clientSecret) {
    return { ok: false, reason: 'Не заданы GOOGLE_OAUTH_CLIENT_ID и GOOGLE_OAUTH_CLIENT_SECRET' };
  }
  const { currentRefreshToken } = await import('./drive-auth.js');
  const token = await currentRefreshToken();
  if (!token) return { ok: false, reason: 'Нет refresh-токена — получите его командой npm run drive:auth' };
  return { ok: true };
}
