'use client';

import { useEffect } from 'react';
import { track, flush } from '@/lib/analytics';

/** Просмотр страницы. Отдельным компонентом, чтобы страницы оставались серверными. */
export function PageViewTracker() {
  useEffect(() => {
    track('PAGE_VIEW');
    return () => flush(true);
  }, []);
  return null;
}
