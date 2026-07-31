'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_PUBLIC } from '@/lib/config';

const field =
  'w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-400';
const labelCls = 'mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500';

export function InviteForm() {
  const router = useRouter();
  const params = useSearchParams();

  const [form, setForm] = useState({
    code: params.get('code') ?? '',
    name: '',
    login: '',
    password: '',
    email: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await fetch(`${API_PUBLIC}/api/auth/redeem-invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim(),
          name: form.name.trim(),
          login: form.login.trim(),
          password: form.password,
          email: form.email.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Не удалось активировать код');
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось активировать код');
    } finally {
      setBusy(false);
    }
  }

  const valid =
    form.code.trim().length >= 4 && form.name.trim() && form.login.trim().length >= 3 && form.password.length >= 8;

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-ink-800 bg-ink-900 p-6">
      <h1 className="text-xl font-semibold text-white">Активация доступа</h1>
      <p className="mt-1 text-sm text-ink-500">Введите код приглашения и придумайте логин с паролем.</p>

      <div className="mt-6 space-y-4">
        <div>
          <label className={labelCls} htmlFor="code">
            Код приглашения
          </label>
          <input
            id="code"
            className={field + ' font-mono'}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="name">
            Как вас зовут
          </label>
          <input id="name" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={labelCls} htmlFor="login">
            Логин (латиница)
          </label>
          <input
            id="login"
            className={field}
            autoComplete="username"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="password">
            Пароль (минимум 8 символов)
          </label>
          <input
            id="password"
            type="password"
            className={field}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">
            Email (необязательно)
          </label>
          <input id="email" className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>

      {error && <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <button
        type="submit"
        disabled={busy || !valid}
        className="mt-6 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-400 disabled:opacity-50"
      >
        {busy ? 'Активирую…' : 'Активировать'}
      </button>
    </form>
  );
}
