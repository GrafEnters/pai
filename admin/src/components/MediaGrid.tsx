import { FileText, Film, ImageOff } from 'lucide-react';
import type { Media } from '../api';
import { humanDuration, humanSize } from '../lib/upload';

/** Превью одного файла: картинка, постер видео или иконка. */
export function MediaThumb({ media, className = '' }: { media: Media; className?: string }) {
  if (media.type === 'IMAGE' && media.status === 'READY') {
    const src = smallestVariant(media) ?? media.url;
    return (
      <img
        src={src}
        alt={media.alt ?? media.originalName}
        loading="lazy"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  if (media.type === 'VIDEO' && media.posterUrl) {
    return (
      <div className={`relative h-full w-full ${className}`}>
        <img src={media.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        <Film size={24} className="absolute inset-0 m-auto text-white drop-shadow" />
      </div>
    );
  }
  const Icon = media.type === 'VIDEO' ? Film : media.type === 'FILE' ? FileText : ImageOff;
  return (
    <div className={`flex h-full w-full items-center justify-center bg-ink-800 ${className}`}>
      <Icon size={24} className="text-ink-500" />
    </div>
  );
}

/** Самый узкий вариант из готового srcset — превью не должно тянуть 1920px. */
function smallestVariant(media: Media): string | null {
  const srcset = media.srcset?.webp ?? media.srcset?.avif;
  if (!srcset) return null;
  return srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? null;
}

const STATUS_LABEL: Record<Media['status'], string> = {
  PENDING: 'ожидает',
  UPLOADING: 'загружается',
  PROCESSING: 'обрабатывается',
  READY: '',
  FAILED: 'ошибка',
};

export function MediaCard({
  media,
  selected,
  onClick,
}: {
  media: Media;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group overflow-hidden rounded-lg border text-left transition-colors ${
        selected ? 'border-brand-400 ring-1 ring-brand-400' : 'border-ink-800 hover:border-ink-600'
      }`}
    >
      <div className="aspect-video bg-ink-950">
        <MediaThumb media={media} />
      </div>
      <div className="p-2">
        <div className="truncate text-xs text-ink-300" title={media.originalName}>
          {media.originalName}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-500">
          <span>{humanSize(media.sizeBytes)}</span>
          {media.width && (
            <span>
              {media.width}×{media.height}
            </span>
          )}
          {media.durationSec && <span>{humanDuration(media.durationSec)}</span>}
          {STATUS_LABEL[media.status] && (
            <span className={media.status === 'FAILED' ? 'text-red-400' : 'text-amber-400'}>
              {STATUS_LABEL[media.status]}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
