import type { Heading } from '@/lib/types';

/** Оглавление. Полностью серверное — это обычные якорные ссылки, JS не нужен. */
export function Toc({ items, className = '' }: { items: Heading[]; className?: string }) {
  return (
    <nav className={`space-y-1 text-sm ${className}`} aria-label="Содержание гайда">
      {items.map((h) => (
        <a
          key={h.anchor}
          href={`#${h.anchor}`}
          className="block truncate text-ink-500 transition-colors hover:text-brand-300"
          style={{ paddingLeft: `${(h.level - 2) * 12}px` }}
          title={h.text}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );
}
