import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../env.js';
import type { StorageObject, StorageProvider } from './index.js';

/**
 * Cloudflare R2 через S3-совместимый API.
 * НАПИСАНО, НО ВЖИВУЮ НЕ ЗАПУСКАЛОСЬ — нет аккаунта R2 (см. PROGRESS.md).
 * Тот же код подходит для MinIO и Backblaze B2: отличается только R2_ENDPOINT.
 *
 * Включается переменной STORAGE_PROVIDER=r2 (см. SETUP.md).
 */

let cached: S3Client | null = null;

function client(): S3Client {
  if (cached) return cached;
  const { accessKeyId, secretAccessKey, endpoint } = env.storage.r2;
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      'STORAGE_PROVIDER=r2, но не заданы R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT (или R2_ACCOUNT_ID)',
    );
  }
  cached = new S3Client({
    // R2 игнорирует регион, но SDK требует его указать
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cached;
}

const BUCKET = () => env.storage.r2.bucket;

export const r2Storage: StorageProvider = {
  name: 'r2',

  async presignPut(key, mime, size) {
    const cmd = new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      ContentType: mime,
      ContentLength: size,
      // Имена содержат content-hash ⇒ объект неизменяем, кэшируем навсегда
      CacheControl: 'public, max-age=31536000, immutable',
    });
    const url = await getSignedUrl(client(), cmd, { expiresIn: 15 * 60 });
    return {
      url,
      // Заголовки должны в точности совпасть с подписанными, иначе R2 вернёт 403
      headers: { 'content-type': mime },
    };
  },

  async put(key, body, mime) {
    await client().send(
      new PutObjectCommand({
        Bucket: BUCKET(),
        Key: key,
        Body: body as never,
        ContentType: mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  },

  async get(key) {
    const res = await client().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    return res.Body as Readable;
  },

  async getBuffer(key) {
    const res = await client().send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },

  async exists(key) {
    try {
      await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
      return true;
    } catch {
      return false;
    }
  },

  async delete(key) {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
  },

  publicUrl(key) {
    const base = env.storage.r2.publicUrl;
    if (!base) throw new Error('Не задан R2_PUBLIC_URL — некуда ссылаться на медиа');
    return `${base}/${key.replace(/^\/+/, '')}`;
  },

  async *list(prefix) {
    let token: string | undefined;
    do {
      const res = await client().send(
        new ListObjectsV2Command({
          Bucket: BUCKET(),
          Prefix: prefix || undefined,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue;
        const item: StorageObject = { key: o.Key, size: Number(o.Size ?? 0) };
        if (o.ETag) item.etag = o.ETag.replace(/"/g, '');
        yield item;
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  },
};
