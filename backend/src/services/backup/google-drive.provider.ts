import crypto from 'node:crypto';
import { env } from '../../env.js';
import { SETTING_KEYS, getSetting, setSetting } from '../../settings.js';
import { driveAccessToken, handleAuthError } from './drive-auth.js';
import type { BackupTransport, RemoteObject } from './transport.js';

/**
 * Google Drive API v3 через REST. НЕ ЗАПУСКАЛОСЬ ВЖИВУЮ — нет аккаунта.
 * Почему REST, а не пакет googleapis — DECISIONS §3.
 *
 * Ключевое ограничение scope `drive.file`: приложению видны только файлы,
 * которые оно само создало. Поэтому корневую папку создаёт приложение,
 * а её id хранится в настройках — папка, созданная руками в веб-интерфейсе,
 * приложению попросту не видна (§9.6).
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

const MAX_RETRIES = 5;
/** Обычный вызов API — секунды. Без явного срока зависшее соединение висит вечно. */
const API_TIMEOUT_MS = 60_000;
/** Передача самих байтов — мегабайты по узкому каналу, тут нужен запас. */
const TRANSFER_TIMEOUT_MS = 15 * 60_000;

/** Кэш «путь → folderId», чтобы не спрашивать Drive о каждой папке при каждом файле. */
const folderCache = new Map<string, string>();

/** Сбой на уровне сети, а не ответ сервера: до Drive не дошли вовсе. */
class DriveUnreachableError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'DriveUnreachableError';
  }
}

/**
 * fetch со сроком и с указанием хоста, до которого не достучались.
 *
 * undici сообщает обо всех сетевых сбоях одинаковым `TypeError: fetch failed`,
 * а настоящую причину прячет в `cause` — её разворачивает describeError выше
 * по стеку, здесь важно лишь не потерять сам cause и назвать адрес.
 */
async function netFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const host = new URL(url).host;
    throw new DriveUnreachableError(`нет связи с ${host} (срок ${Math.round(timeoutMs / 1000)} с)`, e);
  }
}

async function backoff(attempt: number): Promise<void> {
  const delay = Math.min(60_000, 2 ** attempt * 1000 + Math.floor(Math.random() * 500));
  await new Promise((r) => setTimeout(r, delay));
}

async function call(url: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await driveAccessToken();

    let res: Response;
    try {
      res = await netFetch(
        url,
        { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } },
        timeoutMs,
      );
    } catch (e) {
      // Сеть моргнула — повторяем на тех же условиях, что и 5xx. Раньше любой
      // единичный сбой соединения ронял весь прогон целиком.
      if (attempt < MAX_RETRIES) {
        await backoff(attempt);
        continue;
      }
      // cause берём исходный, чтобы в логе не задваивалась промежуточная обёртка
      const cause = e instanceof DriveUnreachableError ? e.cause : e;
      const reason = e instanceof Error ? e.message : String(e);
      throw new DriveUnreachableError(`Drive недоступен, попыток ${attempt + 1}: ${reason}`, cause);
    }

    if (res.ok) return res;

    const body = await res.text().catch(() => '');

    // Квота и лимиты API: экспоненциальный бэкофф (§9.6)
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimitExceeded|userRateLimit/.test(body));
    if ((rateLimited || res.status >= 500) && attempt < MAX_RETRIES) {
      await backoff(attempt);
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      await handleAuthError(new Error(body || `Drive ${res.status}`));
    }
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 400)}`);
  }
}

async function findChild(name: string, parentId: string, isFolder: boolean): Promise<string | null> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed = false',
    isFolder ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`,
  ].join(' and ');
  const res = await call(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

async function rootFolderId(): Promise<string> {
  const saved = await getSetting<string>(SETTING_KEYS.googleRootFolderId);
  if (saved) return saved;

  const res = await call(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: env.backup.rootFolderName, mimeType: FOLDER_MIME }),
  });
  const { id } = (await res.json()) as { id: string };
  await setSetting(SETTING_KEYS.googleRootFolderId, id);
  return id;
}

/** Создаёт (или находит) цепочку папок под ключом вида `media/img/ab12/file.avif`. */
async function ensureFolders(segments: string[]): Promise<string> {
  let parent = await rootFolderId();
  let cachePath = '';
  for (const segment of segments) {
    cachePath += `/${segment}`;
    const cached = folderCache.get(cachePath);
    if (cached) {
      parent = cached;
      continue;
    }
    let id = await findChild(segment, parent, true);
    if (!id) {
      const res = await call(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: segment, mimeType: FOLDER_MIME, parents: [parent] }),
      });
      id = ((await res.json()) as { id: string }).id;
    }
    folderCache.set(cachePath, id);
    parent = id;
  }
  return parent;
}

export const googleDriveTransport: BackupTransport = {
  name: 'google-drive',

  async put(key, content, mime, meta) {
    const segments = key.split('/');
    const name = segments.pop()!;
    const parentId = await ensureFolders(segments);

    const metadata = {
      name,
      ...(meta.existingFileId ? {} : { parents: [parentId] }),
      // Свой sha256 кладём рядом с файлом — на нём держится инкрементальность (§9.3)
      appProperties: { sha256: meta.sha256 },
    };

    const fileId = meta.existingFileId ?? (await findChild(name, parentId, false));
    const method = fileId ? 'PATCH' : 'POST';
    const base = fileId ? `${UPLOAD_API}/files/${fileId}` : `${UPLOAD_API}/files`;

    let uploaded: { id: string; md5Checksum?: string };

    if (content.length > RESUMABLE_THRESHOLD) {
      // Resumable upload для больших файлов (§9.3, п.3)
      const start = await call(`${base}?uploadType=resumable&fields=id,md5Checksum`, {
        method,
        headers: { 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
        body: JSON.stringify(metadata),
      });
      const location = start.headers.get('location');
      if (!location) throw new Error('Drive не вернул URL для resumable-загрузки');

      const put = await netFetch(
        location,
        {
          method: 'PUT',
          headers: { 'content-type': mime, 'content-length': String(content.length) },
          body: new Uint8Array(content),
        },
        TRANSFER_TIMEOUT_MS,
      );
      if (!put.ok) throw new Error(`Drive resumable ${put.status}: ${(await put.text()).slice(0, 300)}`);
      uploaded = (await put.json()) as typeof uploaded;
    } else {
      const boundary = `pai${crypto.randomBytes(12).toString('hex')}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
        Buffer.from(JSON.stringify(metadata)),
        Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
        content,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await call(`${base}?uploadType=multipart&fields=id,md5Checksum`, {
        method,
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(body),
      });
      uploaded = (await res.json()) as typeof uploaded;
    }

    return { fileId: uploaded.id, md5: uploaded.md5Checksum ?? null };
  },

  async get(key, fileId) {
    let id = fileId ?? null;
    if (!id) {
      const segments = key.split('/');
      const name = segments.pop()!;
      id = await findChild(name, await ensureFolders(segments), false);
    }
    if (!id) throw new Error(`В бэкапе нет объекта ${key}`);
    const res = await call(`${API}/files/${id}?alt=media`, {}, TRANSFER_TIMEOUT_MS);
    return Buffer.from(await res.arrayBuffer());
  },

  async exists(key, fileId) {
    try {
      if (fileId) {
        await call(`${API}/files/${fileId}?fields=id`);
        return true;
      }
      const segments = key.split('/');
      const name = segments.pop()!;
      return !!(await findChild(name, await ensureFolders(segments), false));
    } catch {
      return false;
    }
  },

  async delete(fileId) {
    // Именно files.delete, а не корзина: файлы в корзине 30 дней занимают квоту (§9.6)
    await call(`${API}/files/${fileId}`, { method: 'DELETE' });
  },

  async list(prefix) {
    const segments = prefix.split('/').filter(Boolean);
    const folderId = await ensureFolders(segments);
    const out: RemoteObject[] = [];
    let pageToken: string | undefined;

    do {
      const q = `'${folderId}' in parents and trashed = false`;
      const url =
        `${API}/files?q=${encodeURIComponent(q)}` +
        `&fields=nextPageToken,files(id,name,size,md5Checksum,mimeType)&pageSize=1000` +
        (pageToken ? `&pageToken=${pageToken}` : '');
      const res = await call(url);
      const data = (await res.json()) as {
        nextPageToken?: string;
        files?: { id: string; name: string; size?: string; md5Checksum?: string; mimeType: string }[];
      };
      for (const f of data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) continue;
        out.push({
          key: `${prefix}${prefix.endsWith('/') || !prefix ? '' : '/'}${f.name}`,
          fileId: f.id,
          size: Number(f.size ?? 0),
          md5: f.md5Checksum ?? null,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return out;
  },

  async quota() {
    const res = await call(`${API}/about?fields=storageQuota`);
    const data = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } };
    const total = Number(data.storageQuota?.limit ?? 0);
    const used = Number(data.storageQuota?.usage ?? 0);
    return total ? { total, used } : null;
  },
};
