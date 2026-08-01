'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';

interface Me {
  name: string;
}

/**
 * Имя пользователя в шапке.
 *
 * Клиентский компонент намеренно: страницы гайда и категории отдаются из
 * ISR-кэша готовым HTML, и любое чтение cookie на сервере сделало бы их
 * динамическими — Next.js прямо падает с «Page changed from static to dynamic».
 * Персонализация здесь стоит одного запроса после гидрации и не мешает кэшу.
 */
export function CurrentUser() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;

    const load = async (allowRefresh: boolean): Promise<void> => {
      const res = await fetch(`${API_PUBLIC}/api/auth/me`, { credentials: 'include' }).catch(() => null);

      if (res?.ok) {
        const data = (await res.json()) as Me;
        if (alive) {
          setMe(data);
          setChecked(true);
        }
        return;
      }

      // Access живёт 15 минут, refresh — 30 дней. Один раз пробуем обновить пару
      // и повторяем; страница при этом уже отрисована из кэша.
      if (res?.status === 401 && allowRefresh) {
        const refreshed = await fetch(`${API_PUBLIC}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => null);
        if (refreshed?.ok) {
          await load(false);
          router.refresh();
          return;
        }
      }

      if (alive) setChecked(true);
    };

    void load(true);
    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <Link
      href="/me"
      className="hidden max-w-[10rem] truncate text-sm text-ink-400 hover:text-ink-200 sm:block"
      // Пока имя не приехало, место под него уже занято — вёрстка не прыгает
      style={{ minWidth: checked && !me ? undefined : '4rem' }}
    >
      {me?.name ?? (checked ? 'Профиль' : '')}
    </Link>
  );
}
