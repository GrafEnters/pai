import Link from 'next/link';
import { getMe, publicFetch, serverFetch } from '@/lib/api';
import type { CategoryNode, SearchHit } from '@/lib/types';
import { readingTimeLabel } from '@/lib/types';
import { EmptyState, Header } from '@/components/Shell';

export const metadata = { title: 'Поиск — PAI Guides', robots: { index: false, follow: false } };
// Поиск персонален по определению — каждый запрос свежий
export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const query = q.trim();

  const [categories, me] = await Promise.all([
    publicFetch<CategoryNode[]>('/categories', 3600, ['categories']),
    getMe(),
  ]);

  let hits: SearchHit[] = [];
  let suggestions: { slug: string; title: string }[] = [];

  if (query.length >= 2) {
    // Через serverFetch, а не publicFetch: запрос пишется в SearchQuery
    // вместе с userId — это сигнал «каких гайдов не хватает» (§5.4)
    const result = await serverFetch<{ items: SearchHit[] }>(`/search?q=${encodeURIComponent(query)}`).catch(() => ({
      items: [],
    }));
    hits = result.items;
    if (!hits.length) {
      suggestions = await serverFetch<{ slug: string; title: string }[]>(
        `/search/suggest?q=${encodeURIComponent(query)}`,
      ).catch(() => []);
    }
  }

  return (
    <>
      <Header me={me} categories={categories} />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-white">
          {query ? `Поиск: ${query}` : 'Поиск по базе знаний'}
        </h1>

        {query.length < 2 ? (
          <p className="mt-3 text-ink-500">Введите хотя бы два символа в поле поиска сверху.</p>
        ) : hits.length ? (
          <>
            <p className="mt-2 text-sm text-ink-600">Найдено: {hits.length}</p>
            <div className="mt-5 space-y-4">
              {hits.map((h) => (
                <Link
                  key={h.id}
                  href={`/g/${h.slug}`}
                  className="block rounded-xl border border-ink-800 bg-ink-900 p-4 transition-colors hover:border-brand-400/60"
                >
                  <div className="text-xs text-ink-600">
                    {h.categoryTitle} · {readingTimeLabel(h.readingTimeSec)}
                  </div>
                  <div className="mt-0.5 font-medium text-ink-100">{h.title}</div>
                  {h.summary && <div className="mt-1 text-sm text-ink-500">{h.summary}</div>}
                  {/* ts_headline возвращает готовые <em> вокруг совпадений */}
                  <div
                    className="mt-2 text-sm leading-relaxed text-ink-400 [&_em]:bg-amber-400/20 [&_em]:not-italic [&_em]:text-amber-200"
                    dangerouslySetInnerHTML={{ __html: sanitizeHeadline(h.headline) }}
                  />
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-5">
            <EmptyState
              title="Ничего не нашлось"
              hint="Попробуйте другие слова — а мы запомнили этот запрос и добавим такой гайд"
            />
            {suggestions.length > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-sm text-ink-500">Возможно, вы искали:</div>
                <ul className="space-y-1">
                  {suggestions.map((s) => (
                    <li key={s.slug}>
                      <Link href={`/g/${s.slug}`} className="text-brand-300 hover:underline">
                        {s.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * ts_headline вставляет в текст только <em>…</em>, но текст гайда произвольный —
 * поэтому экранируем всё и возвращаем разрешённый тег обратно.
 */
function sanitizeHeadline(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;em&gt;/g, '<em>')
    .replace(/&lt;\/em&gt;/g, '</em>');
}
