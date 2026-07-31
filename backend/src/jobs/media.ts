import { prisma } from '../db.js';
import { processImage } from '../services/images.js';
import { processVideo } from '../services/video.js';
import { registerJob } from './index.js';

export const MEDIA_PROCESS = 'media.process';

export interface MediaProcessJob {
  mediaId: number;
}

/**
 * Обработка загруженного файла: картинка → варианты + blurhash,
 * видео → метаданные + постер. Файлы остальных типов просто помечаются READY.
 */
export async function processMedia({ mediaId }: MediaProcessJob): Promise<void> {
  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) return;
  if (media.status === 'READY') return; // повторная доставка задачи — не переделываем

  await prisma.media.update({ where: { id: mediaId }, data: { status: 'PROCESSING', error: null } });

  try {
    if (media.type === 'IMAGE') {
      const result = await processImage(media.key, media.sha256);
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          status: 'READY',
          width: result.width,
          height: result.height,
          blurhash: result.blurhash,
          variants: result.variants as never,
          processedAt: new Date(),
        },
      });
    } else if (media.type === 'VIDEO') {
      const result = await processVideo(media.key, media.sha256);
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          status: 'READY',
          width: result.width,
          height: result.height,
          durationSec: result.durationSec,
          posterKey: result.posterKey,
          variants: result.variants as never,
          error: result.note,
          processedAt: new Date(),
        },
      });
    } else {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: 'READY', processedAt: new Date() },
      });
    }
  } catch (e) {
    await prisma.media.update({
      where: { id: mediaId },
      data: { status: 'FAILED', error: String(e).slice(0, 500) },
    });
    throw e;
  }
}

export async function registerMediaJobs(): Promise<void> {
  await registerJob<MediaProcessJob>(MEDIA_PROCESS, processMedia);
}
