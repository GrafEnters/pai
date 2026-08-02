'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';
import type { Me } from '@/lib/api';

const field =
  'w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-400';
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500';

/**
 * Логин и пароль для тех, кто пришёл по пригласительной ссылке.
 *
 * По ссылке ничего не спрашивали, поэтому аккаунт безымянный и войти в него
 * можно только текущей сессией. Она живёт тридцать дней — торопиться некуда,
 * но с другого устройства без логина уже не зайти, и об этом стоит сказать
 * прямо здесь, а не когда доступ понадобится.
 */
export function AccountSetup({ me }: { me: Me }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: me.name, login: me.login ?? '', password: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const profile = await fetch(`${API_PUBLIC}/api/auth/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), login: form.login.trim() }),
      });
      if (!profile.ok) {
        throw new Error((await profile.json().catch(() => ({}))).error ?? 'Не удалось сохранить логин');
      }

      // Пароль — отдельным запросом: он отзывает чужие сессии и выдаёт новую,
      // и смешивать это с правкой профиля не стоит
      const password = await fetch(`${API_PUBLIC}/api/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newPassword: form.password }),
      });
      if (!password.ok) {
        throw new Error((await password.json().catch(() => ({}))).error ?? 'Не удалось задать пароль');
      }

      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="mt-8 rounded-xl border border-green-900 bg-green-950/30 p-4">
        <p className="text-sm text-green-300">
          Готово. Теперь можно входить с логином <span className="font-semibold">{form.login.trim()}</span> с любого
          устройства.
        </p>
      </section>
    );
  }

  const valid = form.name.trim().length > 0 && form.login.trim().length >= 3 && form.password.length >= 8;

  return (
    <section className="mt-8 rounded-xl border border-amber-900 bg-amber-950/20 p-5">
      <h2 className="text-lg font-semibold text-white">Заведите логин и пароль</h2>
      <p className="mt-1 text-sm text-ink-400">
        Вы вошли по пригласительной ссылке. Чтобы заходить с другого устройства и не потерять доступ, задайте логин
        с паролем — это займёт полминуты.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelCls} htmlFor="acc-name">
            Как вас зовут
          </label>
          <input
            id="acc-name"
            className={field}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Иван Петров"
            autoComplete="name"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="acc-login">
            Логин
          </label>
          <input
            id="acc-login"
            className={field}
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            placeholder="ivan"
            autoComplete="username"
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="acc-password">
            Пароль
          </label>
          <input
            id="acc-password"
            type="password"
            className={field}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="минимум 8 символов"
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-sm text-red-400 sm:col-span-3">{error}</p>}

        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </section>
  );
}
