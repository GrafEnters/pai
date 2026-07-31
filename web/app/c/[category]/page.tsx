import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getMe, publicFetch } from '@/lib/api';
import type { CategoryNode, GuideCard, GuideLevel } from '@/lib/types';
import { LEVEL_LABEL } from '@/lib/types';
import { EmptyState, GuideCardView, Header } from '@/components/Shell';
import { PageViewTracker } from '@/components/PageViewTracker';

export const revalidate = 3600;

export async function generateStaticParams() {
  try {
    const categories = await publicFetch<CategoryNode[]>('/categories', 3600);
    return flatten(categories).map((c) => ({ category: c.slug }));
  } catch {
    return [];
  }
}

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category } = await params;
  const categories = await publicFetch<CategoryNode[]>('/categories', 3600, ['categories']);
  const found = flatten(categories).find((c) => c.slug === category);
  return { title: found ? `${found.title} — PAI Guides` : 'Раздел', robots: { index: false, follow: false } };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ tag?: string; level?: string }>;
}) {
  const { category } = await params;
  const { tag, level } = await searchParams;

  const categories = await publicFetch<CategoryNode[]>('/categories', 3600, ['categories']);
  const current = flatten(categories).find((c) => c.slug === category);
  if (!current) notFound();

  const query = new URLSearchParams({ category, limit: '48' });
  if (tag) query.set('tag', tag);
  if (level) query.set('level', level);

  const [{ items }, me] = await Promise.all([
    publicFetch<{ items: GuideCard[]; total: number }>(`/guides?${query}`, 600, ['guides']),
    getMe(),
  ]);

  // Теги для фильтра собираем из выдачи: отдельный запрос ради этого не нужен
  const allTags = new Map<string, string>();
  for (const g of items) for (const t of g.tags) allTags.set(t.slug, t.title);

  return (
    <>
      <Header me={me} categories={categories} />
      <PageViewTracker />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <nav aria-label="Хлебные крошки" className="flex items-center gap-1.5 text-sm text-ink-600">
          <Link href="/" className="hover:text-ink-400">
            Главная
          </Link>
          <span>/</span>
          <span className="text-ink-400">{current.title}</span>
        </nav>

        <h1 className="mt-3 text-2xl font-semibold text-white" style={current.color ? { color: current.color } : undefined}>
          {current.title}
        </h1>
        {current.description && <p className="mt-1 text-ink-500">{current.description}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <FilterLink href={`/c/${category}`} active={!tag && !level}>
            Все
          </FilterLink>
          {(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as GuideLevel[]).map((l) => (
            <FilterLink key={l} href={`/c/${category}?level=${l}`} active={level === l}>
              {LEVEL_LABEL[l]}
            </FilterLink>
          ))}
          {[...allTags.entries()].map(([slug, title]) => (
            <FilterLink key={slug} href={`/c/${category}?tag=${slug}`} active={tag === slug}>
              #{title}
            </FilterLink>
          ))}
        </div>

        <div className="mt-6">
          {items.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((g) => (
                <GuideCardView key={g.id} guide={g} />
              ))}
            </div>
          ) : (
            <EmptyState title="В этом разделе пока пусто" hint="Гайды появятся, когда их опубликуют" />
          )}
        </div>
      </main>
    </>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-2.5 py-1 text-sm transition-colors ${
        active ? 'border-brand-400 bg-brand-500/15 text-brand-300' : 'border-ink-800 text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </Link>
  );
}
