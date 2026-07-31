import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../env.js';
import type { BackupTransport, RemoteObject } from './transport.js';

/**
 * Локальное «зеркало Drive» — папка на диске.
 *
 * Это не заглушка: структура каталогов, метаданные с sha256, сверка md5 после
 * записи и удаление файлов — всё как у настоящего Drive. Отличается транспорт,
 * а не логика: тот же runBackup и тот же restore работают поверх обоих.
 */

const ROOT = path.join(env.backup.localDir, env.backup.rootFolderName);
/** Метаданные лежат рядом с файлом, как appProperties у Drive. */
const META_SUFFIX = '.meta.json';

function safePath(key: string): string {
  const clean = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(ROOT, clean);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`Недопустимый ключ бэкапа: ${key}`);
  }
  return full;
}

function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

export const localDriveTransport: BackupTransport = {
  name: 'local-drive',

  async put(key, content, _mime, meta) {
    const full = safePath(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
    await fsp.writeFile(
      full + META_SUFFIX,
      JSON.stringify({ sha256: meta.sha256, size: content.length, syncedAt: new Date().toISOString() }, null, 2),
    );

    // Сверяем то, что реально легло на диск, — защита от «записалось битым» (§9.3, п.4)
    const written = await fsp.readFile(full);
    return { fileId: key, md5: md5(written) };
  },

  async get(key) {
    return fsp.readFile(safePath(key));
  },

  async exists(key) {
    try {
      await fsp.access(safePath(key));
      return true;
    } catch {
      return false;
    }
  },

  async delete(fileId, key) {
    const target = safePath(key ?? fileId);
    // Удаляем сразу, а не в корзину — иначе файлы продолжают занимать место (§9.6)
    await fsp.rm(target, { force: true });
    await fsp.rm(target + META_SUFFIX, { force: true });
  },

  async list(prefix) {
    const start = safePath(prefix || '.');
    const out: RemoteObject[] = [];
    await walk(start, out);
    return out;
  },

  async quota() {
    // У обычной папки квоты нет — сообщаем об этом честно, вместо выдуманных цифр
    return null;
  },
};

async function walk(dir: string, out: RemoteObject[]): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) {
      const stat = await fsp.stat(full);
      const key = path.relative(ROOT, full).replace(/\\/g, '/');
      out.push({ key, fileId: key, size: stat.size });
    }
  }
}

export { ROOT as LOCAL_BACKUP_ROOT };
