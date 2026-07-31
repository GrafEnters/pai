import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '../env.js';
import { storage } from './storage/index.js';

const exec = promisify(execFile);

/**
 * Где взять ffmpeg. Порядок: явный путь из .env → бинарник в PATH →
 * пакет ffmpeg-static, если он поставился.
 *
 * ffmpeg-static лежит в optionalDependencies: на чистой машине он ставится сам
 * и видео обрабатывается «из коробки», но если скачать бинарник не удалось
 * (нет сети, экзотическая платформа), npm install не падает, а система
 * продолжает работать без постеров — см. DECISIONS §7.
 */
async function resolveBinaries(): Promise<{ ffmpeg: string; ffprobe: string } | null> {
  const candidates: Array<{ ffmpeg: string; ffprobe: string }> = [];

  if (env.media.ffmpegPath !== 'ffmpeg' || env.media.ffprobePath !== 'ffprobe') {
    candidates.push({ ffmpeg: env.media.ffmpegPath, ffprobe: env.media.ffprobePath });
  }
  candidates.push({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' });

  try {
    const [ffmpegStatic, ffprobeStatic] = await Promise.all([
      import('ffmpeg-static').then((m) => (m.default ?? m) as unknown as string),
      import('ffprobe-static').then((m) => ((m.default ?? m) as { path: string }).path),
    ]);
    if (ffmpegStatic && ffprobeStatic) candidates.push({ ffmpeg: ffmpegStatic, ffprobe: ffprobeStatic });
  } catch {
    // пакета нет — это допустимо
  }

  for (const candidate of candidates) {
    try {
      await exec(candidate.ffmpeg, ['-version'], { timeout: 15_000 });
      return candidate;
    } catch {
      /* пробуем следующий */
    }
  }
  return null;
}

let binaries: { ffmpeg: string; ffprobe: string } | null = null;

export interface VideoProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

export interface ProcessedVideo extends VideoProbe {
  posterKey: string | null;
  variants: Array<{ height: number; key: string; bitrate?: number }>;
  /** Пояснение, если что-то пропустили (нет ffmpeg) — показывается в админке. */
  note: string | null;
}

let resolved = false;

/** Есть ли ffmpeg. Ищем один раз за процесс: спавн процесса не бесплатный. */
export async function hasFfmpeg(): Promise<boolean> {
  if (!resolved) {
    binaries = await resolveBinaries();
    resolved = true;
  }
  return binaries !== null;
}

async function probe(file: string): Promise<VideoProbe> {
  const empty: VideoProbe = { durationSec: null, width: null, height: null, bitrate: null };
  try {
    const { stdout } = await exec(
      binaries!.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const v = data.streams?.find((s) => s.codec_type === 'video');
    return {
      durationSec: data.format?.duration ? Number(data.format.duration) : null,
      width: v?.width ?? null,
      height: v?.height ?? null,
      bitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
    };
  } catch {
    return empty;
  }
}

/**
 * Видео v1 (PLAN §3.4): валидация, ffprobe, постер на 10% длительности.
 * Структура variants — массив рендишнов с самого начала, поэтому лестница
 * качеств этапа 7 добавится без миграции БД.
 *
 * Без ffmpeg видео всё равно загружается и играет — пропускаются только постер
 * и метаданные (DECISIONS §7). Это не заглушка: файл доступен и работоспособен.
 */
export async function processVideo(originalKey: string, sha256: string): Promise<ProcessedVideo> {
  const fallback: ProcessedVideo = {
    durationSec: null,
    width: null,
    height: null,
    bitrate: null,
    posterKey: null,
    variants: [{ height: 0, key: originalKey }],
    note: null,
  };

  if (!(await hasFfmpeg())) {
    return {
      ...fallback,
      note: 'ffmpeg не найден: видео сохранено как есть, без постера и метаданных. Поставьте ffmpeg в PATH или задайте FFMPEG_PATH.',
    };
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pai-video-'));
  const localFile = path.join(tmpDir, 'input' + path.extname(originalKey));

  try {
    await fs.writeFile(localFile, await storage.getBuffer(originalKey));

    const info = await probe(localFile);

    let posterKey: string | null = null;
    if (info.durationSec && info.durationSec > 0) {
      const at = Math.max(0.1, info.durationSec * 0.1);
      const posterFile = path.join(tmpDir, 'poster.jpg');
      try {
        await exec(
          binaries!.ffmpeg,
          ['-y', '-ss', at.toFixed(2), '-i', localFile, '-frames:v', '1', '-q:v', '3', posterFile],
          { timeout: 120_000 },
        );
        posterKey = `video/${sha256.slice(0, 8)}/poster.jpg`;
        await storage.put(posterKey, await fs.readFile(posterFile), 'image/jpeg');
      } catch {
        posterKey = null; // постер — не повод считать видео сломанным
      }
    }

    const variant: { height: number; key: string; bitrate?: number } = {
      height: info.height ?? 0,
      key: originalKey,
    };
    if (info.bitrate) variant.bitrate = info.bitrate;

    return { ...info, posterKey, variants: [variant], note: null };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
