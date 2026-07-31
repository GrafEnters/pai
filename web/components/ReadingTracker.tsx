'use client';

import { useEffect } from 'react';
import { trackGuideReading } from '@/lib/analytics';

/** Активное время, глубина скролла и порог «прочитано» (PLAN §8.1). */
export function ReadingTracker({ guideId, readingTimeSec }: { guideId: number; readingTimeSec: number }) {
  useEffect(() => trackGuideReading(guideId, readingTimeSec), [guideId, readingTimeSec]);
  return <ReadingProgressBar />;
}

/** Полоска прогресса чтения сверху (§5.5). */
function ReadingProgressBar() {
  useEffect(() => {
    const bar = document.getElementById('pai-progress');
    if (!bar) return;
    const onScroll = () => {
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      const pct = total <= 0 ? 100 : Math.min(100, ((window.scrollY || doc.scrollTop) / total) * 100);
      bar.style.width = `${pct}%`;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed left-0 top-0 z-50 h-0.5 w-full bg-transparent">
      <div id="pai-progress" className="h-full bg-brand-500 transition-[width] duration-150" style={{ width: 0 }} />
    </div>
  );
}
