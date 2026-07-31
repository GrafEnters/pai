'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';

export function LoginForm({ botUsername }: { botUsername: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
  const magicToken = params.get('token');

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tgBoxRef = useRef<HTMLDivElement>(null);

  // Вход по одноразовой ссылке из бота: /login?token=...
  useEffect(() => {
    if (!magicToken) return;
    setBusy(true);
    fetch(`${API_PUBLIC}/api/auth/login-link`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: magicToken }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Ссылка недействительна');
        router.replace(next);
        router.refresh();
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [magicToken, next, router]);

  // Telegram Login Widget. НАПИСАНО, НО ВЖИВУЮ НЕ ПРОВЕРЯЛОСЬ — нет бота.
  // Без NEXT_PUBLIC_TELEGRAM_BOT_USERNAME блок просто не появляется.
  useEffect(() => {
    if (!botUsername || !tgBoxRef.current) return;

    (window as unknown as { onTelegramAuth?: (u: unknown) => void }).onTelegramAuth = async (tgUser) => {
      setError('');
      setBusy(true);
      try {
        const r = await fetch(`${API_PUBLIC}/api/auth/telegram`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tgAuthPayload: tgUser }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Не удалось войти');
        router.replace(next);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось войти');
      } finally {
        setBusy(false);
      }
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    tgBoxRef.current.appendChild(script);

    return () => {
      if (tgBoxRef.current) tgBoxRef.current.innerHTML = '';
    };
  }, [botUsername, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch(`${API_PUBLIC}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Не удалось войти');
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-ink-800 bg-ink-900 p-6">
      <h1 className="text-xl font-semibold text-white">PAI Guides</h1>
      <p className="mt-1 text-sm text-ink-500">База знаний команды</p>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="login" className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
            Логин
          </label>
          <input
            id="login"
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-400"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500">
            Пароль
          </label>
          <input
            id="password"
            type="password"
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <button
        type="submit"
        disabled={busy || !login || !password}
        className="mt-6 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-400 disabled:opacity-50"
      >
        {busy ? 'Вхожу…' : 'Войти'}
      </button>

      {botUsername && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-ink-600">
            <span className="h-px flex-1 bg-ink-800" />
            или
            <span className="h-px flex-1 bg-ink-800" />
          </div>
          <div ref={tgBoxRef} className="flex justify-center" />
        </>
      )}

      <p className="mt-6 text-center text-xs text-ink-600">
        Нет доступа? Попросите администратора выдать инвайт-код.
      </p>
    </form>
  );
}
