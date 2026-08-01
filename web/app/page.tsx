import Link from 'next/link';
import { getMe, publicFetch, serverFetch } from '@/lib/api';
import type { CategoryNode, GuideCard } from '@/lib/types';
import { TEAM_ROLE_LABEL } from '@/lib/types';
import { EmptyState, GuideCardView, Header } from '@/components/Shell';
import { PageViewTracker } from '@/components/PageViewTracker';

// Персональный блок делает страницу динамической, но карточки внутри приходят
// из ISR-кэша — тяжёлая часть всё равно не пересобирается на каждый запрос.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const me = await getMe();

  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [categories, pinned, fresh, required] = await Promise.all([
    publicFetch<CategoryNode[]>('/categories', 3600, ['categories']),
    publicFetch<{ items: GuideCard[] }>('/guides?pinned=1&limit=6', 600, ['guides']),
    publicFetch<{ items: GuideCard[] }>(`/guides?since=${weekAgo}&limit=6`, 600, ['guides']),
    me ? serverFetch<GuideCard[]>('/guides/required/mine').catch(() => []) : Promise.resolve([]),
  ]);

  const notRead = required.filter((g) => !g.readAt);

  return (
    <>
      <Header categories={categories} />
      <PageViewTracker />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-white">
          {me ? `Привет, ${me.name.split(' ')[0]}` : 'База знаний'}
        </h1>
        {me && (
          <p className="mt-1 text-sm text-ink-500">
            Ваша роль в команде: {TEAM_ROLE_LABEL[me.teamRole]}
          </p>
        )}

        {required.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold text-white">Обязательно к прочтению</h2>
              <span className={`text-sm ${notRead.length ? 'text-amber-400' : 'text-green-400'}`}>
                {required.length - notRead.length} из {required.length}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {required.map((g) => (
                <GuideCardView key={g.id} guide={g} showStatus />
              ))}
            </div>
          </section>
        )}

        {pinned.items.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold text-white">Закреплённое</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pinned.items.map((g) => (
                <GuideCardView key={g.id} guide={g} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-white">Новое за неделю</h2>
          {fresh.items.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fresh.items.map((g) => (
                <GuideCardView key={g.id} guide={g} />
              ))}
            </div>
          ) : (
            <EmptyState title="За неделю новых гайдов не появилось" />
          )}
        </section>

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-white">Разделы</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="rounded-xl border border-ink-800 bg-ink-900 p-4 transition-colors hover:border-brand-400/60"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-ink-100" style={c.color ? { color: c.color } : undefined}>
                    {c.title}
                  </span>
                  <span className="text-sm text-ink-600">{c.guideCount}</span>
                </div>
                {c.description && <p className="mt-1 text-sm text-ink-500">{c.description}</p>}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
