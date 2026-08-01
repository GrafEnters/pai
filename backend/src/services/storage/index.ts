import type { Readable } from 'node:stream';
import { env } from '../../env.js';
import { localStorage } from './local.provider.js';
import { r2Storage } from './r2.provider.js';

export interface StorageObject {
  key: string;
  size: number;
  etag?: string;
}

/**
 * Абстракция объектного хранилища (PLAN §3.1). Тот же приём, что с провайдером
 * оплат в tg-shop-miniapp: меняется реализация, не вызовы.
 */
export interface StorageProvider {
  readonly name: string;
  /** Ссылка для прямой загрузки браузером, минуя backend. */
  presignPut(key: string, mime: string, size: number): Promise<{ url: string; headers: Record<string, string> }>;
  put(key: string, body: Buffer | Readable, mime: string): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Прочитать целиком — для обработки картинок и бэкапа. */
  getBuffer(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
  list(prefix: string): AsyncIterable<StorageObject>;
}

export const storage: StorageProvider = env.storage.provider === 'r2' ? r2Storage : localStorage;

/** Расширение файла по MIME — ключи в бакете строим сами, имени от клиента не доверяем. */
export function extForMime(mime: string, fallbackName = ''): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'text/plain': 'txt',
    'text/csv': 'csv',
  };
  if (map[mime]) return map[mime]!;
  const fromName = fallbackName.split('.').pop();
  return fromName && /^[a-z0-9]{1,5}$/i.test(fromName) ? fromName.toLowerCase() : 'bin';
}
