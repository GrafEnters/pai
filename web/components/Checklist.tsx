'use client';

import { useEffect, useState } from 'react';
import { API_PUBLIC } from '@/lib/config';
import { track } from '@/lib/analytics';

interface Item {
  id: string;
  text: string;
}

/**
 * Интерактивный чеклист. Один из четырёх клиентских кусков на сайте (§3.1) —
 * остальное отдаётся готовым HTML с сервера.
 *
 * Состояние хранится и локально, и на сервере: локально — чтобы галочка вставала
 * мгновенно, на сервере — чтобы прогресс не потерялся при смене устройства.
 */
export function Checklist({ guideId, persistKey, items }: { guideId: number; persistKey: string; items: Item[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  const storageKey = `pai:checklist:${guideId}:${persistKey}`;

  useEffect(() => {
    // Сначала показываем локальное состояние — оно есть сразу
    try {
      const local = localStorage.getItem(storageKey);
      if (local) setChecked(JSON.parse(local) as Record<string, boolean>);
    } catch {
      /* повреждённый localStorage не должен ломать страницу */
    }

    // Затем подтягиваем серверное — оно авторитетнее
    fetch(`${API_PUBLIC}/api/guides/${guideId}/progress`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { checklistState?: Record<string, boolean> } | null) => {
        const state = data?.checklistState?.[persistKey] as Record<string, boolean> | undefined;
        if (state) setChecked(state);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [guideId, persistKey, storageKey]);

  function toggle(id: string) {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* приватный режим — переживём */
    }

    track('CHECKLIST_TOGGLE', { guideId, props: { persistKey, id, value: next[id] } });

    void fetch(`${API_PUBLIC}/api/guides/${guideId}/progress`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checklistState: { [persistKey]: next } as unknown as Record<string, boolean> }),
    }).catch(() => {});
  }

  const done = items.filter((i) => checked[i.id]).length;

  return (
    <div className="my-5 rounded-lg border border-ink-800 bg-ink-900/50 p-4">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-ink-600">
        <span>Чеклист</span>
        <span className={done === items.length ? 'text-green-400' : ''}>
          {done} из {items.length}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                checked={!!checked[item.id]}
                disabled={!loaded}
                onChange={() => toggle(item.id)}
              />
              <span className={checked[item.id] ? 'text-ink-500 line-through' : 'text-ink-200'}>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
