import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import type { DocNode, GuideFull, MediaRef } from '@/lib/types';
import { Checklist } from './Checklist';
import { LazyVideo } from './LazyVideo';

/**
 * Собственный маппер JSON → React (PLAN §4.1). Не generateHTML — потому что
 * именно здесь решается скорость: srcset, размеры под CLS, lazy/eager,
 * fetchpriority и ленивая инициализация плеера.
 */

interface Ctx {
  media: Record<string, MediaRef>;
  guideRefs: GuideFull['guideRefs'];
  guideId: number;
  /** Сколько визуальных блоков уже отрисовано: самый первый — вероятный LCP,
   *  его грузим сразу, остальные лениво. Картинки и видео считаются вместе:
   *  в видеогайде первым блоком идёт именно видео. */
  counter: { visuals: number };
  anchors: Map<string, number>;
}

export function GuideContent({ guide }: { guide: GuideFull }) {
  const ctx: Ctx = {
    media: guide.media,
    guideRefs: guide.guideRefs,
    guideId: guide.id,
    counter: { visuals: 0 },
    anchors: new Map(),
  };
  return <>{renderNodes(guide.content.content ?? [], ctx)}</>;
}

function renderNodes(nodes: DocNode[], ctx: Ctx): ReactNode {
  return nodes.map((node, i) => <Fragment key={i}>{renderNode(node, ctx)}</Fragment>);
}

function renderNode(node: DocNode, ctx: Ctx): ReactNode {
  const kids = () => renderNodes(node.content ?? [], ctx);

  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node);
    case 'hardBreak':
      return <br />;

    case 'paragraph':
      return <p className="my-4 leading-7">{kids()}</p>;

    case 'heading': {
      const level = Math.min(4, Math.max(2, Number(node.attrs?.level ?? 2)));
      const anchor = nextAnchor(nodeText(node), ctx);
      const cls =
        level === 2
          ? 'mt-10 mb-3 text-2xl font-semibold text-white'
          : level === 3
            ? 'mt-8 mb-2 text-xl font-semibold text-white'
            : 'mt-6 mb-2 text-lg font-semibold text-ink-100';
      const Tag = (`h${level}` as 'h2' | 'h3' | 'h4');
      return (
        <Tag id={anchor} className={`group ${cls}`}>
          {kids()}
          <a
            href={`#${anchor}`}
            aria-label="Ссылка на раздел"
            className="ml-2 text-ink-700 opacity-0 transition-opacity group-hover:opacity-100"
          >
            #
          </a>
        </Tag>
      );
    }

    case 'bulletList':
      return <ul className="my-4 list-disc space-y-1 pl-6">{kids()}</ul>;
    case 'orderedList':
      return <ol className="my-4 list-decimal space-y-1 pl-6">{kids()}</ol>;
    case 'listItem':
      return <li className="leading-7 [&>p]:my-1">{kids()}</li>;

    case 'blockquote':
      return <blockquote className="my-4 border-l-2 border-ink-700 pl-4 text-ink-400">{kids()}</blockquote>;

    case 'horizontalRule':
      return <hr className="my-8 border-ink-800" />;

    case 'codeBlock':
      return (
        <pre className="my-4 overflow-x-auto rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm">
          <code>{nodeText(node)}</code>
        </pre>
      );

    // Таблицы на мобильных скроллятся внутри себя, а не растягивают страницу
    case 'table':
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <tbody>{kids()}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr>{kids()}</tr>;
    case 'tableHeader':
      return <th className="border border-ink-700 bg-ink-800 px-3 py-2 text-left font-semibold">{kids()}</th>;
    case 'tableCell':
      return <td className="border border-ink-700 px-3 py-2 align-top">{kids()}</td>;

    case 'image':
      return <GuideImage node={node} ctx={ctx} />;

    case 'gallery': {
      const ids = Array.isArray(node.attrs?.mediaIds) ? (node.attrs.mediaIds as number[]) : [];
      const items = ids.map((id) => ctx.media[String(id)]).filter(Boolean) as MediaRef[];
      if (!items.length) return null;
      return (
        <div className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((m) => (
            <a key={m.id} href={m.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg">
              <Picture media={m} sizes="(max-width: 640px) 50vw, 33vw" lazy />
            </a>
          ))}
        </div>
      );
    }

    case 'video': {
      const media = ctx.media[String(node.attrs?.mediaId)];
      if (!media) return null;
      const first = ctx.counter.visuals++ === 0;
      return (
        <LazyVideo media={media} guideId={ctx.guideId} startAt={Number(node.attrs?.startAt ?? 0)} priority={first} />
      );
    }

    case 'fileAttachment': {
      const media = ctx.media[String(node.attrs?.mediaId)];
      if (!media) return null;
      const mb = Number(media.sizeBytes) / 1024 / 1024;
      return (
        <a
          href={media.url}
          download
          data-track="file-download"
          data-media-id={media.id}
          className="my-4 flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-900 p-3 text-sm transition-colors hover:border-ink-600"
        >
          <span className="text-lg">📎</span>
          <span className="flex-1 text-ink-200">{media.originalName}</span>
          <span className="text-xs text-ink-500">{mb < 1 ? `${Math.round(mb * 1024)} КБ` : `${mb.toFixed(1)} МБ`}</span>
        </a>
      );
    }

    case 'callout': {
      const variant = String(node.attrs?.variant ?? 'info');
      const style =
        {
          info: { box: 'border-sky-500/40 bg-sky-500/10', title: 'text-sky-200', icon: 'ℹ️' },
          warn: { box: 'border-amber-500/40 bg-amber-500/10', title: 'text-amber-200', icon: '⚠️' },
          danger: { box: 'border-red-500/40 bg-red-500/10', title: 'text-red-200', icon: '🛑' },
          success: { box: 'border-green-500/40 bg-green-500/10', title: 'text-green-200', icon: '✅' },
        }[variant] ?? { box: 'border-sky-500/40 bg-sky-500/10', title: 'text-sky-200', icon: 'ℹ️' };
      const title = String(node.attrs?.title ?? '');
      return (
        <aside className={`my-5 rounded-lg border p-4 ${style.box}`}>
          {title && (
            <div className={`mb-1 flex items-center gap-2 font-semibold ${style.title}`}>
              <span aria-hidden>{style.icon}</span>
              {title}
            </div>
          )}
          <div className="text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{kids()}</div>
        </aside>
      );
    }

    case 'steps':
      return <ol className="my-6 space-y-4">{kids()}</ol>;

    case 'step':
      return (
        <li className="rounded-lg border border-ink-800 bg-ink-900/50 p-4">
          {node.attrs?.title ? (
            <div className="mb-1 font-medium text-white">{String(node.attrs.title)}</div>
          ) : null}
          <div className="text-sm [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">{kids()}</div>
        </li>
      );

    case 'checklist': {
      const raw = Array.isArray(node.attrs?.items) ? node.attrs.items : [];
      const items = raw
        .map((i, idx) =>
          typeof i === 'string'
            ? { id: String(idx), text: i }
            : { id: String((i as { id?: string }).id ?? idx), text: String((i as { text?: string }).text ?? '') },
        )
        .filter((i) => i.text);
      if (!items.length) return null;
      return (
        <Checklist
          guideId={ctx.guideId}
          persistKey={String(node.attrs?.persistKey ?? 'default')}
          items={items}
        />
      );
    }

    case 'details':
      return (
        <details className="my-4 rounded-lg border border-ink-800 bg-ink-900/50 p-3">
          <summary className="cursor-pointer select-none font-medium text-ink-200">
            {String(node.attrs?.summary ?? 'Подробнее')}
          </summary>
          <div className="mt-2 text-sm">{kids()}</div>
        </details>
      );

    case 'guideRef': {
      const ref = ctx.guideRefs[String(node.attrs?.guideId)];
      if (!ref) return null;
      return (
        <Link
          href={`/g/${ref.slug}`}
          className="my-4 block rounded-lg border border-ink-800 bg-ink-900 p-4 transition-colors hover:border-brand-400"
        >
          <div className="text-xs uppercase tracking-wide text-ink-600">Смотрите также</div>
          <div className="mt-0.5 font-medium text-brand-300">{ref.title}</div>
          {ref.summary && <div className="mt-1 text-sm text-ink-500">{ref.summary}</div>}
        </Link>
      );
    }

    default:
      return node.content ? kids() : null;
  }
}

/** Картинка со всеми вариантами: <picture> + AVIF/WebP + размеры под CLS. */
function GuideImage({ node, ctx }: { node: DocNode; ctx: Ctx }) {
  const media = ctx.media[String(node.attrs?.mediaId)];
  if (!media) return null;

  const index = ctx.counter.visuals++;
  const caption = node.attrs?.caption ? String(node.attrs.caption) : null;
  const alt = String(node.attrs?.alt ?? media.alt ?? caption ?? '');

  return (
    <figure className="my-6">
      <a href={media.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-ink-800">
        <Picture media={media} alt={alt} sizes="(max-width: 768px) 100vw, 720px" lazy={index > 0} priority={index === 0} />
      </a>
      {caption && <figcaption className="mt-2 text-center text-sm text-ink-500">{caption}</figcaption>}
    </figure>
  );
}

function Picture({
  media,
  alt = '',
  sizes,
  lazy = true,
  priority = false,
}: {
  media: MediaRef;
  alt?: string;
  sizes: string;
  lazy?: boolean;
  priority?: boolean;
}) {
  const width = media.width ?? undefined;
  const height = media.height ?? undefined;
  return (
    <picture>
      {media.srcset.avif && <source type="image/avif" srcSet={media.srcset.avif} sizes={sizes} />}
      {media.srcset.webp && <source type="image/webp" srcSet={media.srcset.webp} sizes={sizes} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url}
        alt={alt || media.alt || ''}
        width={width}
        height={height}
        loading={lazy ? 'lazy' : 'eager'}
        decoding={priority ? 'sync' : 'async'}
        // fetchpriority помогает браузеру начать грузить LCP-картинку раньше
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className="h-auto w-full bg-ink-900"
      />
    </picture>
  );
}

function applyMarks(text: string, node: DocNode): ReactNode {
  let out: ReactNode = text;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = <strong className="font-semibold text-white">{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'code':
        out = <code className="rounded bg-ink-800 px-1 py-0.5 text-[0.9em] text-brand-300">{out}</code>;
        break;
      case 'highlight':
        out = <mark className="rounded bg-amber-400/25 px-0.5 text-ink-100">{out}</mark>;
        break;
      case 'link': {
        const href = String(mark.attrs?.href ?? '#');
        const external = /^https?:\/\//i.test(href);
        out = external ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-track="link-click"
            className="text-brand-300 underline underline-offset-2"
          >
            {out}
          </a>
        ) : (
          <Link href={href} className="text-brand-300 underline underline-offset-2">
            {out}
          </Link>
        );
        break;
      }
    }
  }
  return out;
}

function nodeText(node: DocNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

/** Якоря считаются так же, как на backend, — чтобы оглавление совпадало со страницей. */
function nextAnchor(text: string, ctx: Ctx): string {
  let anchor = slugifyAnchor(text);
  const seen = ctx.anchors.get(anchor) ?? 0;
  ctx.anchors.set(anchor, seen + 1);
  if (seen > 0) anchor = `${anchor}-${seen + 1}`;
  return anchor;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyAnchor(s: string): string {
  const base = s
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'section';
}
