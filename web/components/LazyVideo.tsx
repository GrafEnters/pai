'use client';

import { useEffect, useRef, useState } from 'react';
import type { MediaRef } from '@/lib/types';
import { API_PUBLIC } from '@/lib/config';
import { track } from '@/lib/analytics';

/**
 * Видео с ленивой инициализацией (PLAN §5.2): до клика на странице только
 * постер-картинка и кнопка. Ни одного байта видео и ни одного слушателя,
 * пока ролик не запустили.
 *
 * Позиция просмотра запоминается локально и на сервере (§7.3).
 */
export function LazyVideo({ media, guideId, startAt = 0 }: { media: MediaRef; guideId: number; startAt?: number }) {
  const [started, setStarted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sent = useRef(new Set<number>());
  const lastTime = useRef(0);
  const storageKey = `pai:video:${media.id}`;

  useEffect(() => {
    if (!started) return;
    const video = videoRef.current;
    if (!video) return;

    // Продолжаем с того места, где остановились
    let resume = startAt;
    try {
      const saved = Number(localStorage.getItem(storageKey) ?? 0);
      if (saved > 5 && (!media.durationSec || saved < media.durationSec - 10)) resume = saved;
    } catch {
      /* приватный режим */
    }
    if (resume > 0) video.currentTime = resume;

    const onPlay = () => track('VIDEO_PLAY', { guideId, mediaId: media.id });

    const onTimeUpdate = () => {
      const duration = video.duration || media.durationSec || 0;
      if (!duration) return;
      const pct = Math.round((video.currentTime / duration) * 100);

      for (const threshold of [25, 50, 75, 95]) {
        if (pct >= threshold && !sent.current.has(threshold)) {
          sent.current.add(threshold);
          track('VIDEO_PROGRESS', { guideId, mediaId: media.id, props: { pct: threshold } });
        }
      }

      // Перемотку отличаем от обычного хода времени по скачку больше 2 секунд
      if (Math.abs(video.currentTime - lastTime.current) > 2) {
        track('VIDEO_SEEK', { guideId, mediaId: media.id, props: { to: Math.round(video.currentTime) } });
      }
      lastTime.current = video.currentTime;

      try {
        localStorage.setItem(storageKey, String(Math.floor(video.currentTime)));
      } catch {
        /* пропускаем */
      }
    };

    const onEnded = () => {
      track('VIDEO_COMPLETE', { guideId, mediaId: media.id });
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* пропускаем */
      }
      void fetch(`${API_PUBLIC}/api/guides/${guideId}/progress`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ videoPositions: { [media.id]: 0 } }),
      }).catch(() => {});
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    void video.play().catch(() => {});

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
    };
  }, [started, guideId, media.id, media.durationSec, startAt, storageKey]);

  const duration = media.durationSec
    ? `${Math.floor(media.durationSec / 60)}:${String(Math.round(media.durationSec % 60)).padStart(2, '0')}`
    : null;

  if (!started) {
    return (
      <button
        type="button"
        onClick={() => setStarted(true)}
        className="group relative my-6 block w-full overflow-hidden rounded-lg border border-ink-800 bg-ink-950"
        aria-label="Воспроизвести видео"
      >
        {media.posterUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={media.posterUrl}
            alt=""
            width={media.width ?? undefined}
            height={media.height ?? undefined}
            loading="lazy"
            className="h-auto w-full"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-ink-600">Видео</div>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-2xl text-white transition-transform group-hover:scale-110">
            ▶
          </span>
        </span>
        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {duration}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="my-6 overflow-hidden rounded-lg border border-ink-800 bg-black">
      <video
        ref={videoRef}
        src={media.url}
        poster={media.posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        className="h-auto w-full"
      />
      <div className="flex items-center gap-2 border-t border-ink-800 bg-ink-950 px-3 py-1.5 text-xs text-ink-500">
        <span>Скорость:</span>
        {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
          <button
            key={rate}
            type="button"
            onClick={() => videoRef.current && (videoRef.current.playbackRate = rate)}
            className="rounded px-1.5 py-0.5 hover:bg-ink-800 hover:text-ink-200"
          >
            {rate}×
          </button>
        ))}
      </div>
    </div>
  );
}
