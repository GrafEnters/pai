'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';

/**
 * Access-токен живёт 15 минут, refresh — 30 дней. Middleware пропускает на
 * страницу, если есть живой refresh, — но серверный рендер в этот момент видит
 * протухший access и считает человека гостем.
 *
 * Этот компонент замыкает цепочку: один раз обновляет пару токенов и
 * перерисовывает страницу. Рендерится только когда сервер не смог опознать
 * пользователя, поэтому в обычной ситуации не выполняется вовсе.
 */
export function SessionRefresher() {
  const router = useRouter();
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;

    fetch(`${API_PUBLIC}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((r) => {
        if (r.ok) router.refresh();
        // Если refresh мёртв — не редиректим сами: страница уже отрисована,
        // а на защищённые действия ответит 401 и уведёт на /login
      })
      .catch(() => {});
  }, [router]);

  return null;
}
