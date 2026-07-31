'use client';

import { API_PUBLIC } from './config';

/**
 * Клиентский сборщик событий (PLAN §8.1). Без зависимостей.
 *
 * Живёт здесь, а не в этапе 8, по простой причине: чеклист и видеоплеер этапа 5 —
 * это ровно те компоненты, которые шлют события, и без сборщика они были бы
 * написаны дважды. Приём событий и роллапы — этап 8.
 */

export type EventType =
  | 'PAGE_VIEW'
  | 'GUIDE_OPEN'
  | 'GUIDE_SCROLL'
  | 'GUIDE_HEARTBEAT'
  | 'GUIDE_READ'
  | 'VIDEO_PLAY'
  | 'VIDEO_PROGRESS'
  | 'VIDEO_COMPLETE'
  | 'VIDEO_SEEK'
  | 'SEARCH'
  | 'SEARCH_EMPTY'
  | 'LINK_CLICK'
  | 'FILE_DOWNLOAD'
  | 'FEEDBACK'
  | 'CHECKLIST_TOGGLE';

interface EventPayload {
  guideId?: number;
  mediaId?: number;
  props?: Record<string, unknown>;
}

interface QueuedEvent extends EventPayload {
  t: EventType;
  ts: string;
  path: string;
}

const VISITOR_KEY = 'pai:visitor';
const SESSION_KEY = 'pai:session';
const SESSION_TS_KEY = 'pai:session:ts';
const SESSION_TIMEOUT_MS = 30 * 60_000;
const FLUSH_EVERY_MS = 5000;
const FLUSH_AT = 10;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uuid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

/** Сессия обнуляется после 30 минут неактивности (§8.1). */
function sessionId(): string {
  try {
    const last = Number(sessionStorage.getItem(SESSION_TS_KEY) ?? 0);
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id || Date.now() - last > SESSION_TIMEOUT_MS) {
      id = uuid();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(Date.now()));
    return id;
  } catch {
    return 'nosession';
  }
}

export function track(type: EventType, payload: EventPayload = {}): void {
  if (typeof window === 'undefined') return;
  queue.push({
    t: type,
    ts: new Date().toISOString(),
    path: location.pathname,
    ...payload,
  });
  if (queue.length >= FLUSH_AT) flush();
  ensureTimer();
}

function ensureTimer() {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(flush, FLUSH_EVERY_MS);
}

export function flush(useBeacon = false): void {
  if (!queue.length) return;
  const batch = queue.slice(0, 50);
  queue = queue.slice(50);

  const body = JSON.stringify({
    v: visitorId(),
    s: sessionId(),
    referrer: document.referrer || undefined,
    events: batch,
  });

  // Content-Type: text/plain — так браузер не делает preflight OPTIONS (§8.1)
  // visitorId в query — по нему считается лимит запросов на сервере
  const url = `${API_PUBLIC}/api/collect?v=${encodeURIComponent(visitorId())}`;
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      return;
    }
    void fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* аналитика не должна ломать страницу */
  }
}

/**
 * Отслеживание чтения гайда: активное время, глубина скролла, порог «прочитано».
 * Возвращает функцию отписки.
 */
export function trackGuideReading(guideId: number, readingTimeSec: number, opts?: { scrollPct?: number; timeRatio?: number }) {
  if (typeof window === 'undefined') return () => {};

  const needScroll = opts?.scrollPct ?? 70;
  const needTime = (opts?.timeRatio ?? 0.4) * readingTimeSec;

  let activeSec = 0;
  let maxDepth = 0;
  let lastActivity = Date.now();
  let readSent = false;
  const sentDepths = new Set<number>();

  track('GUIDE_OPEN', { guideId });

  const markActivity = () => {
    lastActivity = Date.now();
  };
  for (const ev of ['scroll', 'mousemove', 'keydown', 'click', 'touchstart']) {
    window.addEventListener(ev, markActivity, { passive: true });
  }

  // Активное время: тик только если вкладка видима И была активность за минуту (§8.1)
  const heartbeat = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastActivity > 60_000) return;
    activeSec += 15;
    track('GUIDE_HEARTBEAT', { guideId, props: { sec: 15 } });
    maybeRead();
  }, 15_000);

  let scrollScheduled = false;
  const onScroll = () => {
    if (scrollScheduled) return;
    scrollScheduled = true;
    setTimeout(() => {
      scrollScheduled = false;
      const doc = document.documentElement;
      const total = doc.scrollHeight - window.innerHeight;
      const pct = total <= 0 ? 100 : Math.round(((window.scrollY || doc.scrollTop) / total) * 100);
      if (pct > maxDepth) maxDepth = Math.min(100, pct);

      for (const threshold of [25, 50, 75, 100]) {
        if (maxDepth >= threshold && !sentDepths.has(threshold)) {
          sentDepths.add(threshold);
          track('GUIDE_SCROLL', { guideId, props: { depth: threshold } });
        }
      }
      maybeRead();
    }, 250);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  function maybeRead() {
    if (readSent) return;
    if (maxDepth >= needScroll && activeSec >= needTime) {
      readSent = true;
      track('GUIDE_READ', { guideId, props: { activeSec, depth: maxDepth } });
    }
  }

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush(true);
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', () => flush(true));

  onScroll(); // короткая страница может целиком помещаться в экран

  return () => {
    clearInterval(heartbeat);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onHidden);
    for (const ev of ['scroll', 'mousemove', 'keydown', 'click', 'touchstart']) {
      window.removeEventListener(ev, markActivity);
    }
    flush(true);
  };
}
