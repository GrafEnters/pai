import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { env } from '../env.js';
import { storage } from './storage/index.js';

const exec = promisify(execFile);

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

let ffmpegChecked: boolean | null = null;

/** Есть ли ffmpeg. Проверяем один раз за процесс: спавн процесса не бесплатный. */
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    await exec(env.media.ffmpegPath, ['-version'], { timeout: 10_000 });
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

async function probe(file: string): Promise<VideoProbe> {
  const empty: VideoProbe = { durationSec: null, width: null, height: null, bitrate: null };
  try {
    const { stdout } = await exec(
      env.media.ffprobePath,
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
      note: 'ffmpeg не найден: видео сохранено как есть, без постера и метаданных. Установите ffmpeg или задайте FFMPEG_PATH.',
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
          env.media.ffmpegPath,
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
