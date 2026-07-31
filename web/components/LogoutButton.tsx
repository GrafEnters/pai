'use client';

import { API_PUBLIC } from '@/lib/config';

export function LogoutButton() {
  return (
    <button
      type="button"
      title="Выйти"
      onClick={async () => {
        await fetch(`${API_PUBLIC}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
        location.href = '/login';
      }}
      className="rounded-md px-2 py-1.5 text-sm text-ink-500 transition-colors hover:bg-ink-900 hover:text-ink-300"
    >
      Выйти
    </button>
  );
}
