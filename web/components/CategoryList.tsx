'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GuideCard, GuideLevel } from '@/lib/types';
import { LEVEL_LABEL } from '@/lib/types';
import { EmptyState, GuideCardView } from './Shell';

/**
 * Карточки категории с фильтрами.
 *
 * Фильтрация на клиенте намеренно: чтение `searchParams` в серверном компоненте
 * делает страницу динамической, и она перестаёт жить в ISR-кэше — Next.js
 * падает с DYNAMIC_SERVER_USAGE. Здесь страница остаётся статической,
 * а фильтр срабатывает мгновенно, без похода на сервер.
 *
 * Начальное состояние берётся из адреса, чтобы ссылки вида /c/facebook?tag=bm
 * с других страниц продолжали работать.
 */
export function CategoryList({ items, categorySlug }: { items: GuideCard[]; categorySlug: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const [tag, setTag] = useState<string | null>(params.get('tag'));
  const [level, setLevel] = useState<string | null>(params.get('level'));

  const tags = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of items) for (const t of g.tags) map.set(t.slug, t.title);
    return [...map.entries()];
  }, [items]);

  const shown = useMemo(
    () =>
      items.filter(
        (g) => (!tag || g.tags.some((t) => t.slug === tag)) && (!level || g.level === level),
      ),
    [items, tag, level],
  );

  /** Держим фильтр в адресе, но без перезагрузки страницы. */
  function apply(next: { tag?: string | null; level?: string | null }) {
    const nextTag = next.tag !== undefined ? next.tag : tag;
    const nextLevel = next.level !== undefined ? next.level : level;
    setTag(nextTag);
    setLevel(nextLevel);

    const qs = new URLSearchParams();
    if (nextTag) qs.set('tag', nextTag);
    if (nextLevel) qs.set('level', nextLevel);
    const search = qs.toString();
    router.replace(`/c/${categorySlug}${search ? `?${search}` : ''}`, { scroll: false });
  }

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Chip active={!tag && !level} onClick={() => apply({ tag: null, level: null })}>
          Все
        </Chip>
        {(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as GuideLevel[]).map((l) => (
          <Chip key={l} active={level === l} onClick={() => apply({ level: level === l ? null : l })}>
            {LEVEL_LABEL[l]}
          </Chip>
        ))}
        {tags.map(([slug, title]) => (
          <Chip key={slug} active={tag === slug} onClick={() => apply({ tag: tag === slug ? null : slug })}>
            #{title}
          </Chip>
        ))}
      </div>

      <div className="mt-6">
        {shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((g) => (
              <GuideCardView key={g.id} guide={g} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={items.length ? 'Под фильтр ничего не подошло' : 'В этом разделе пока пусто'}
            hint={items.length ? 'Снимите фильтр, чтобы увидеть остальные' : 'Гайды появятся, когда их опубликуют'}
          />
        )}
      </div>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-sm transition-colors ${
        active ? 'border-brand-400 bg-brand-500/15 text-brand-300' : 'border-ink-800 text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
