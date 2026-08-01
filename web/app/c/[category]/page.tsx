import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { publicFetch } from '@/lib/api';
import type { CategoryNode, GuideCard } from '@/lib/types';
import { Header } from '@/components/Shell';
import { CategoryList } from '@/components/CategoryList';
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

/**
 * Страница категории статическая и живёт в ISR-кэше.
 *
 * Ни cookie, ни searchParams здесь не читаются — любое из двух сделало бы
 * страницу динамической. Фильтры по тегу и уровню работают на клиенте
 * (см. CategoryList), имя пользователя в шапке — тоже.
 */
export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;

  const categories = await publicFetch<CategoryNode[]>('/categories', 3600, ['categories']);
  const current = flatten(categories).find((c) => c.slug === category);
  if (!current) notFound();

  const { items } = await publicFetch<{ items: GuideCard[]; total: number }>(
    `/guides?category=${encodeURIComponent(category)}&limit=48`,
    600,
    ['guides'],
  );

  return (
    <>
      <Header categories={categories} />
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

        {/* useSearchParams требует Suspense внутри статической страницы */}
        <Suspense fallback={<div className="mt-6 text-ink-600">Загрузка…</div>}>
          <CategoryList items={items} categorySlug={category} />
        </Suspense>
      </main>
    </>
  );
}
