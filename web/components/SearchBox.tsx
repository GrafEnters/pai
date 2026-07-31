'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск…"
        aria-label="Поиск по базе знаний"
        className="w-28 rounded-lg border border-ink-800 bg-ink-900 px-3 py-1.5 text-sm outline-none transition-all focus:w-48 focus:border-brand-400 sm:w-40 sm:focus:w-64"
      />
    </form>
  );
}
