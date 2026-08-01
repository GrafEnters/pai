'use client';

import { useEffect, useState } from 'react';
import type { Heading } from '@/lib/types';

/**
 * Оглавление гайда: разделы (h2) → подразделы (h3) → вложенные (h4).
 *
 * С сервера приходит плоский список заголовков — дерево собираем здесь,
 * чтобы не менять контракт API ради представления.
 */
interface TocNode {
  heading: Heading;
  children: TocNode[];
}

function buildTree(items: Heading[]): TocNode[] {
  const roots: TocNode[] = [];
  // Стек последних узлов каждого уровня: [h2, h3]
  const stack: TocNode[] = [];

  for (const heading of items) {
    const node: TocNode = { heading, children: [] };
    // Схлопываем стек до уровня выше текущего
    while (stack.length && stack[stack.length - 1]!.heading.level >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    // Заголовок без родителя (гайд начался с h3) не теряем — поднимаем в корень
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/** Якорь раздела, в котором сейчас находится читатель. */
function useActiveAnchor(anchors: string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  // Массив пересоздаётся на каждый рендер, поэтому зависимость — строка:
  // иначе эффект переподписывался бы бесконечно
  const key = anchors.join('|');

  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const update = () => {
      timer = null;
      // Активен последний заголовок, который уже ушёл под шапку
      let current = list[0] ?? null;
      for (const anchor of list) {
        const el = document.getElementById(anchor);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= 96) current = anchor;
        else break;
      }
      // Особый случай для низа страницы не нужен: у статьи есть запас
      // прокрутки, поэтому любой раздел, включая последний, доходит до верха.
      setActive(current);
    };

    // Троттлинг таймером, а не requestAnimationFrame: rAF не вызывается,
    // когда вкладка не отрисовывается, и подсветка молча замирает.
    // 100 мс — незаметно глазу, а пересчёт стоит доли миллисекунды.
    const onScroll = () => {
      if (timer) return;
      timer = setTimeout(update, 100);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  return active;
}

/** Якоря всех предков активного узла — чтобы подсветить ветку целиком. */
function ancestorsOf(nodes: TocNode[], target: string | null): string[] {
  if (!target) return [];

  const walk = (list: TocNode[], chain: string[]): string[] | null => {
    for (const node of list) {
      if (node.heading.anchor === target) return chain;
      const found = walk(node.children, [...chain, node.heading.anchor]);
      if (found) return found;
    }
    return null;
  };

  return walk(nodes, []) ?? [];
}

export function Toc({
  items,
  className = '',
  onNavigate,
}: {
  items: Heading[];
  className?: string;
  /** Вызывается после клика — на мобильных этим закрывается выпадашка. */
  onNavigate?: () => void;
}) {
  const tree = buildTree(items);
  const anchors = items.map((i) => i.anchor);
  const active = useActiveAnchor(anchors);
  const branch = new Set(ancestorsOf(tree, active));

  if (!items.length) return null;

  return (
    <nav className={`text-sm ${className}`} aria-label="Содержание гайда">
      <TocList nodes={tree} active={active} branch={branch} depth={0} onNavigate={onNavigate} />
    </nav>
  );
}

function TocList({
  nodes,
  active,
  branch,
  depth,
  onNavigate,
}: {
  nodes: TocNode[];
  active: string | null;
  branch: Set<string>;
  depth: number;
  onNavigate?: () => void;
}) {
  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'mt-0.5 space-y-0.5 border-l border-ink-800'}>
      {nodes.map((node) => {
        const isActive = node.heading.anchor === active;
        const inBranch = branch.has(node.heading.anchor);
        return (
          <li key={node.heading.anchor}>
            <a
              href={`#${node.heading.anchor}`}
              onClick={onNavigate}
              aria-current={isActive ? 'location' : undefined}
              className={[
                'block border-l-2 py-1 pr-2 transition-colors',
                depth === 0 ? 'pl-3' : depth === 1 ? 'pl-4' : 'pl-6',
                depth === 0 ? 'font-medium' : '',
                isActive
                  ? 'border-brand-400 text-brand-300'
                  : inBranch
                    ? 'border-ink-700 text-ink-300 hover:text-brand-300'
                    : 'border-transparent text-ink-500 hover:border-ink-700 hover:text-ink-200',
              ].join(' ')}
            >
              {node.heading.text}
            </a>
            {node.children.length > 0 && (
              <TocList
                nodes={node.children}
                active={active}
                branch={branch}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Свёрнутое оглавление для узких экранов — над текстом гайда. */
export function TocMobile({ items }: { items: Heading[] }) {
  const [open, setOpen] = useState(false);
  if (items.length < 2) return null;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-6 rounded-lg border border-ink-800 bg-ink-900/50 p-3 lg:hidden"
    >
      <summary className="cursor-pointer select-none text-sm font-medium text-ink-300">
        Содержание · {items.length}
      </summary>
      <Toc items={items} className="mt-2" onNavigate={() => setOpen(false)} />
    </details>
  );
}
