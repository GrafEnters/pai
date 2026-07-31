'use client';

import { useEffect, useState } from 'react';
import { API_PUBLIC } from '@/lib/config';
import { track } from '@/lib/analytics';

/** «Полезно?» под гайдом (PLAN §5.1). Ответ сохраняется и виден при возврате. */
export function Feedback({ guideId }: { guideId: number }) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`${API_PUBLIC}/api/guides/${guideId}/feedback/mine`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { helpful: boolean | null } | null) => d && setHelpful(d.helpful))
      .catch(() => {});
  }, [guideId]);

  async function send(value: boolean, withComment = false) {
    setHelpful(value);
    track('FEEDBACK', { guideId, props: { helpful: value } });
    await fetch(`${API_PUBLIC}/api/guides/${guideId}/feedback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ helpful: value, comment: withComment ? comment : undefined }),
    }).catch(() => {});
    if (withComment) setSent(true);
  }

  return (
    <section className="mt-10 rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-300">Гайд оказался полезным?</span>
        <button
          onClick={() => void send(true)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            helpful === true ? 'border-green-500/60 bg-green-500/15 text-green-300' : 'border-ink-700 text-ink-400 hover:text-ink-200'
          }`}
        >
          👍 Да
        </button>
        <button
          onClick={() => void send(false)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            helpful === false ? 'border-red-500/60 bg-red-500/15 text-red-300' : 'border-ink-700 text-ink-400 hover:text-ink-200'
          }`}
        >
          👎 Нет
        </button>
      </div>

      {helpful === false && !sent && (
        <div className="mt-3">
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-brand-400"
            placeholder="Чего не хватило? Это попадёт в список того, что нужно дописать."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button
            onClick={() => void send(false, true)}
            disabled={!comment.trim()}
            className="mt-2 rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-400 disabled:opacity-50"
          >
            Отправить
          </button>
        </div>
      )}

      {sent && <div className="mt-2 text-sm text-green-400">Спасибо, передали автору.</div>}
    </section>
  );
}
