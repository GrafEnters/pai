'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';

/**
 * Переход по пригласительной ссылке. Ничего не спрашиваем и ничего не просим
 * нажать: человек открыл ссылку — значит уже согласился войти.
 *
 * Почему активация идёт из браузера, а не редиректом на бэкенд: ссылку
 * пересылают в мессенджерах, а те дёргают её сами, чтобы собрать превью. Будь
 * это обычный GET, каждое превью заводило бы аккаунт. Скрипты превью не
 * исполняют, поэтому запрос отсюда делает только живой человек.
 */
export function InviteRedeem() {
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get('code')?.trim() ?? '';

  const [error, setError] = useState('');
  // В строгом режиме React прогоняет эффект дважды, а второй заход завёл бы
  // второй аккаунт: сессия из первого ответа к тому моменту ещё не вернулась
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!code) {
      setError('В ссылке нет кода приглашения. Попросите отправить её целиком.');
      return;
    }

    void (async () => {
      try {
        const r = await fetch(`${API_PUBLIC}/api/auth/redeem-invite`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!r.ok) {
          const message = (await r.json().catch(() => ({}))).error;
          throw new Error(message ?? 'Не удалось войти по ссылке');
        }
        router.replace('/');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось войти по ссылке');
      }
    })();
  }, [code, router]);

  if (error) {
    return (
      <div className="w-full max-w-sm rounded-xl border border-ink-800 bg-ink-900 p-6 text-center">
        <h1 className="text-xl font-semibold text-white">Ссылка не сработала</h1>
        <p className="mt-2 text-sm text-ink-400">{error}</p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-lg border border-ink-700 px-4 py-2 text-sm text-ink-200 transition-colors hover:border-brand-400 hover:text-white"
        >
          Войти с логином и паролем
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-ink-800 bg-ink-900 p-6 text-center">
      <h1 className="text-xl font-semibold text-white">Открываем доступ…</h1>
      <p className="mt-2 text-sm text-ink-500">Секунду, готовим ваш аккаунт.</p>
    </div>
  );
}
