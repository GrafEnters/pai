import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../env.js';
import type { StorageObject, StorageProvider } from './index.js';

const ROOT = env.storage.localDir;

/** Ключ приходит снаружи — не даём вылезти за пределы папки хранилища. */
function safePath(key: string): string {
  const clean = key.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(ROOT, clean);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`Недопустимый ключ: ${key}`);
  }
  return full;
}

const UPLOAD_TTL_SEC = 15 * 60;

/**
 * Куда браузер отправит presigned PUT: либо origin абсолютного адреса медиа,
 * либо пустая строка — то есть путь от корня.
 *
 * Ровно два допустимых вида, и это не придирчивость. Относительный адрес
 * браузер достраивает от УЖЕ ОТКРЫТОЙ СТРАНИЦЫ, а открыта админка: PUT уходил
 * в `/admin/<...>/api/upload/local`, попадал в статику и получал 405. Разбирать
 * же путь из адреса медиа (раньше здесь снимался хвост `/media`) незачем:
 * от него нужен только origin, а `/api` висит в корне при любой раскладке.
 */
function uploadBase(): string {
  const raw = env.storage.localPublicUrl;
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

/** Подпись presigned-ссылки. Секрет тот же, что у JWT — отдельный заводить незачем. */
export function signUpload(key: string, mime: string, size: number, exp: number): string {
  return crypto
    .createHmac('sha256', env.jwtSecret)
    .update(`${key}|${mime}|${size}|${exp}`)
    .digest('hex');
}

export function verifyUploadSignature(
  key: string,
  mime: string,
  size: number,
  exp: number,
  sig: string,
): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = signUpload(key, mime, size, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Локальное хранилище — папка на диске. Не «заглушка на время разработки»,
 * а полноценный режим работы: presigned-ссылка тоже выдаётся, просто указывает
 * на сам backend. Клиентский путь загрузки от этого не отличается (DECISIONS §6).
 */
export const localStorage: StorageProvider = {
  name: 'local',

  async presignPut(key, mime, size) {
    const exp = Math.floor(Date.now() / 1000) + UPLOAD_TTL_SEC;
    const sig = signUpload(key, mime, size, exp);
    const qs = new URLSearchParams({ key, mime, size: String(size), exp: String(exp), sig });
    return {
      url: `${uploadBase()}/api/upload/local?${qs}`,
      headers: { 'content-type': mime },
    };
  },

  async put(key, body, _mime) {
    const full = safePath(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await fsp.writeFile(full, body);
    } else {
      await pipeline(body, fs.createWriteStream(full));
    }
  },

  async get(key) {
    return fs.createReadStream(safePath(key));
  },

  async getBuffer(key) {
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

  async delete(key) {
    try {
      await fsp.unlink(safePath(key));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  },

  publicUrl(key) {
    return `${env.storage.localPublicUrl}/${key.replace(/^\/+/, '')}`;
  },

  async *list(prefix) {
    const start = safePath(prefix || '.');
    yield* walk(start);
  },
};

async function* walk(dir: string): AsyncIterable<StorageObject> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // папки ещё нет — значит, объектов нет
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const stat = await fsp.stat(full);
      yield {
        key: path.relative(ROOT, full).replace(/\\/g, '/'),
        size: stat.size,
      };
    }
  }
}

export { ROOT as LOCAL_STORAGE_ROOT };
