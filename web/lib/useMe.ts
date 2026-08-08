'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_PUBLIC } from './config';

export interface MeBrief {
  name: string;
}

interface Loaded {
  me: MeBrief | null;
  /** Пара токенов только что провернулась — серверные компоненты стоит перерисовать */
  refreshed: boolean;
}

async function fetchMe(allowRefresh: boolean): Promise<Loaded> {
  const res = await fetch(`${API_PUBLIC}/api/auth/me`, { credentials: 'include' }).catch(() => null);
  if (res?.ok) return { me: (await res.json()) as MeBrief, refreshed: false };

  // Access живёт 15 минут, refresh — 30 дней. Один раз пробуем обновить пару
  // и повторяем; страница при этом уже отрисована из кэша.
  if (res?.status === 401 && allowRefresh) {
    const refreshed = await fetch(`${API_PUBLIC}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => null);
    if (refreshed?.ok) return { ...(await fetchMe(false)), refreshed: true };
  }

  return { me: null, refreshed: false };
}

/**
 * Один запрос на страницу, а не по одному на компонент: шапка и блок «полезно?»
 * оба спрашивают, кто читает, и без этого дублировали бы и сам /auth/me, и —
 * что хуже — ротацию refresh-токена, которая параллельного вызова не любит.
 * Обещание живёт до своего разрешения: следующая страница спросит заново.
 */
let pending: Promise<Loaded> | null = null;

function loadMe(): Promise<Loaded> {
  if (!pending) {
    pending = fetchMe(true).finally(() => {
      // Сбрасываем чуть позже, чтобы «хвост» компонентов успел переиспользовать результат
      setTimeout(() => {
        pending = null;
      }, 0);
    });
  }
  return pending;
}

/**
 * Текущий пользователь — уже в браузере.
 *
 * Клиентский хук намеренно: страницы гайда и категории отдаются из ISR-кэша
 * готовым HTML, и любое чтение cookie на сервере сделало бы их динамическими —
 * Next.js прямо падает с «Page changed from static to dynamic».
 *
 * `checked` отличает «ещё не знаем» от «точно гость»: при открытом публичном
 * доступе гость — обычное дело, и мигать интерфейсом для него не нужно.
 */
export function useMe(): { me: MeBrief | null; checked: boolean } {
  const router = useRouter();
  const [me, setMe] = useState<MeBrief | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMe().then((r) => {
      if (!alive) return;
      setMe(r.me);
      setChecked(true);
      if (r.refreshed) router.refresh();
    });
    return () => {
      alive = false;
    };
  }, [router]);

  return { me, checked };
}
