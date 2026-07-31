import type { Media } from '@prisma/client';
import { storage } from './storage/index.js';
import type { ImageVariant } from './images.js';

export interface MediaView {
  id: number;
  type: Media['type'];
  status: Media['status'];
  key: string;
  originalName: string;
  mime: string;
  sizeBytes: string;
  sha256: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  blurhash: string | null;
  variants: unknown;
  posterKey: string | null;
  alt: string | null;
  title: string | null;
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
  url: string;
  posterUrl: string | null;
  /** Готовый srcset по форматам — чтобы фронт не собирал URL'ы руками. */
  srcset: { avif: string | null; webp: string | null };
}

/** Media → то, что уходит на фронт: с готовыми публичными URL. */
export function serializeMedia(m: Media): MediaView {
  const variants = (m.variants ?? []) as unknown as ImageVariant[];
  return {
    id: m.id,
    type: m.type,
    status: m.status,
    key: m.key,
    originalName: m.originalName,
    mime: m.mime,
    sizeBytes: m.sizeBytes.toString(),
    sha256: m.sha256,
    width: m.width,
    height: m.height,
    durationSec: m.durationSec,
    blurhash: m.blurhash,
    variants,
    posterKey: m.posterKey,
    alt: m.alt,
    title: m.title,
    error: m.error,
    createdAt: m.createdAt,
    processedAt: m.processedAt,
    url: storage.publicUrl(m.key),
    posterUrl: m.posterKey ? storage.publicUrl(m.posterKey) : null,
    srcset: {
      avif: buildSrcset(variants, 'avif'),
      webp: buildSrcset(variants, 'webp'),
    },
  };
}

export function buildSrcset(variants: ImageVariant[], fmt: 'avif' | 'webp'): string | null {
  const list = variants.filter((v) => v?.fmt === fmt).sort((a, b) => a.w - b.w);
  if (!list.length) return null;
  return list.map((v) => `${storage.publicUrl(v.key)} ${v.w}w`).join(', ');
}
