import sharp from 'sharp';
import { encode as encodeBlurhash } from 'blurhash';
import { storage } from './storage/index.js';

/** Ширины вариантов (PLAN §3.3). Больше оригинала не апскейлим. */
export const VARIANT_WIDTHS = [320, 640, 960, 1280, 1920];

export interface ImageVariant {
  w: number;
  fmt: 'avif' | 'webp';
  key: string;
  size: number;
}

export interface ProcessedImage {
  width: number;
  height: number;
  blurhash: string | null;
  variants: ImageVariant[];
}

/**
 * Картинка → 5 ширин × 2 формата + blurhash.
 *
 * Метаданные (EXIF) вырезаются: в скриншотах из FB попадаются геометки и имена
 * устройств — это вопрос безопасности, а не размера файла. sharp по умолчанию
 * не переносит метаданные в результат, поэтому достаточно не звать withMetadata().
 */
export async function processImage(originalKey: string, sha256: string): Promise<ProcessedImage> {
  const input = await storage.getBuffer(originalKey);

  // rotate() без аргументов = автоповорот по EXIF Orientation. Делать это надо
  // до любых resize, иначе портретные скриншоты лягут набок.
  const base = sharp(input, { failOn: 'none' }).rotate();
  const meta = await base.metadata();

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('Не удалось прочитать размеры изображения');

  const prefix = `img/${sha256.slice(0, 8)}`;
  const widths = VARIANT_WIDTHS.filter((w) => w <= width);
  // Совсем маленькая картинка: делаем один вариант в её собственном размере
  if (widths.length === 0) widths.push(width);

  const variants: ImageVariant[] = [];
  for (const w of widths) {
    const resized = sharp(input, { failOn: 'none' }).rotate().resize({ width: w, withoutEnlargement: true });

    const avif = await resized.clone().avif({ quality: 50, effort: 4 }).toBuffer();
    const avifKey = `${prefix}/${w}.avif`;
    await storage.put(avifKey, avif, 'image/avif');
    variants.push({ w, fmt: 'avif', key: avifKey, size: avif.length });

    const webp = await resized.clone().webp({ quality: 78 }).toBuffer();
    const webpKey = `${prefix}/${w}.webp`;
    await storage.put(webpKey, webp, 'image/webp');
    variants.push({ w, fmt: 'webp', key: webpKey, size: webp.length });
  }

  return { width, height, blurhash: await makeBlurhash(input), variants };
}

/** Подложка-заглушка, чтобы при загрузке не прыгала вёрстка (CLS). */
async function makeBlurhash(input: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    // blurhash — украшение, из-за него нельзя ронять обработку картинки
    return null;
  }
}

/** Самый большой вариант нужного формата — на него ставим src в <picture>. */
export function pickLargest(variants: ImageVariant[], fmt: 'avif' | 'webp'): ImageVariant | undefined {
  return variants.filter((v) => v.fmt === fmt).sort((a, b) => b.w - a.w)[0];
}
