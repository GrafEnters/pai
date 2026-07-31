import { api, type Media } from '../api';

export interface UploadResult {
  media: Media;
  /** true, если такой файл уже был загружен и мы переиспользовали его. */
  deduplicated: boolean;
}

export interface UploadOptions {
  onProgress?: (pct: number) => void;
  onStage?: (stage: 'hashing' | 'uploading' | 'processing') => void;
  signal?: AbortSignal;
}

/**
 * sha256 файла. На нём строятся и дедупликация, и имя объекта в хранилище.
 *
 * Считаем через Web Crypto по всему файлу целиком: у SubtleCrypto нет потокового
 * API, а тащить в бандл свою реализацию SHA-256 ради редких больших видео
 * (скриншоты — это единицы мегабайт) не окупается. Для файлов в сотни мегабайт
 * шаг заметен по времени — поэтому о нём сообщаем через onStage.
 */
export async function sha256OfFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PUT файла по presigned-ссылке с прогрессом. fetch прогресс отдавать не умеет — отсюда XHR. */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Загрузка не прошла: HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Сеть оборвалась при загрузке'));
    xhr.onabort = () => reject(new Error('Загрузка отменена'));

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * Полный цикл: хеш → presign → прямая загрузка в хранилище → complete → ожидание
 * обработки. Путь одинаков и для локальной папки, и для R2 — отличается только
 * хост в presigned-ссылке.
 */
export async function uploadFile(file: File, opts: UploadOptions = {}): Promise<UploadResult> {
  opts.onStage?.('hashing');
  const sha256 = await sha256OfFile(file);

  const { data: presign } = await api.post<
    | { deduplicated: true; media: Media }
    | { deduplicated: false; mediaId: number; key: string; uploadUrl: string; headers: Record<string, string> }
  >('/admin/media/presign', {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    sha256,
  });

  if (presign.deduplicated) {
    opts.onProgress?.(100);
    return { media: presign.media, deduplicated: true };
  }

  opts.onStage?.('uploading');
  await putWithProgress(presign.uploadUrl, file, presign.headers, opts.onProgress, opts.signal);

  opts.onStage?.('processing');
  await api.post(`/admin/media/${presign.mediaId}/complete`);

  const media = await waitUntilReady(presign.mediaId, opts.signal);
  return { media, deduplicated: false };
}

/** Ждём, пока воркер обработает файл. Картинка — секунды, видео — дольше. */
async function waitUntilReady(mediaId: number, signal?: AbortSignal, timeoutMs = 10 * 60_000): Promise<Media> {
  const started = Date.now();
  let delay = 500;
  for (;;) {
    if (signal?.aborted) throw new Error('Отменено');
    const { data } = await api.get<Media>(`/admin/media/${mediaId}`);
    if (data.status === 'READY') return data;
    if (data.status === 'FAILED') throw new Error(data.error ?? 'Обработка файла не удалась');
    if (Date.now() - started > timeoutMs) throw new Error('Обработка слишком долго не завершается');
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 3000);
  }
}

export function humanSize(bytes: number | string): string {
  const n = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

export function humanDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
