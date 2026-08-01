import Link from 'next/link';
import type { CategoryNode, GuideCard } from '@/lib/types';
import { LEVEL_LABEL, readingTimeLabel } from '@/lib/types';
import { SearchBox } from './SearchBox';
import { LogoutButton } from './LogoutButton';
import { CurrentUser } from './CurrentUser';

/**
 * Шапка — серверный компонент без обращения к cookie: иначе страницы гайда
 * и категории перестали бы быть статическими. Имя пользователя подгружает
 * <CurrentUser /> уже в браузере.
 */
export function Header({ categories }: { categories: CategoryNode[] }) {
  return (
    <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="shrink-0 font-semibold text-white">
          PAI Guides
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto md:flex">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-400 transition-colors hover:bg-ink-900 hover:text-ink-200"
            >
              {c.title}
              <span className="ml-1.5 text-xs text-ink-600">{c.guideCount}</span>
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SearchBox />
          <CurrentUser />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

export function GuideCardView({ guide, showStatus = false }: { guide: GuideCard; showStatus?: boolean }) {
  const cover = guide.cover;
  return (
    <Link
      href={`/g/${guide.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900 transition-colors hover:border-brand-400/60"
    >
      {cover && (
        <div className="aspect-video overflow-hidden bg-ink-950">
          <picture>
            {cover.srcset.avif && <source type="image/avif" srcSet={cover.srcset.avif} sizes="(max-width: 768px) 100vw, 360px" />}
            {cover.srcset.webp && <source type="image/webp" srcSet={cover.srcset.webp} sizes="(max-width: 768px) 100vw, 360px" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cover.url}
              alt=""
              width={cover.width ?? undefined}
              height={cover.height ?? undefined}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </picture>
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <span style={guide.category.color ? { color: guide.category.color } : undefined}>{guide.category.title}</span>
          <span>·</span>
          <span>{readingTimeLabel(guide.readingTimeSec)}</span>
          {showStatus && (
            <span className={`ml-auto ${guide.readAt ? 'text-green-400' : 'text-amber-400'}`}>
              {guide.readAt ? 'прочитано' : guide.lastOpenedAt ? 'начато' : 'не открыт'}
            </span>
          )}
        </div>
        <h3 className="mt-1.5 font-medium text-ink-100 group-hover:text-brand-300">{guide.title}</h3>
        {guide.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-500">{guide.summary}</p>}
        <div className="mt-auto flex flex-wrap gap-1 pt-3">
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-400">{LEVEL_LABEL[guide.level]}</span>
          {guide.tags.slice(0, 3).map((t) => (
            <span key={t.id} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-500">
              {t.title}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-800 p-10 text-center">
      <div className="text-ink-400">{title}</div>
      {hint && <div className="mt-1 text-sm text-ink-600">{hint}</div>}
    </div>
  );
}
