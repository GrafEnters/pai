import {
  CALLOUT_LABEL,
  type CalloutVariant,
  type ChecklistItem,
  type DocNode,
  type TipTapDoc,
  collectHeadings,
  nodeText,
  slugifyAnchor,
  walkDoc,
} from './schema.js';

/** Что backend знает о медиа при рендере. Заполняется из БД перед вызовом. */
export interface MediaRef {
  id: number;
  type: 'IMAGE' | 'VIDEO' | 'FILE';
  url: string;
  posterUrl: string | null;
  srcset: { avif: string | null; webp: string | null };
  alt: string | null;
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: string;
}

export interface GuideRef {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
}

export interface RenderContext {
  media: Map<number, MediaRef>;
  guides: Map<number, GuideRef>;
}

export const emptyContext = (): RenderContext => ({ media: new Map(), guides: new Map() });

// ============================ Плоский текст ============================

/**
 * Текст без разметки — для полнотекстового поиска и подсчёта времени чтения.
 * Блочные ноды разделяются переводом строки, иначе последнее слово абзаца
 * склеится с первым словом следующего и оба выпадут из поиска.
 */
export function toPlainText(doc: TipTapDoc): string {
  const parts: string[] = [];
  renderPlain(doc.content ?? [], parts);
  return parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderPlain(nodes: DocNode[], out: string[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(node.text ?? '');
        break;
      case 'hardBreak':
        out.push('\n');
        break;
      case 'image':
      case 'gallery':
      case 'video':
      case 'fileAttachment':
        // Подписи и alt — тоже текст гайда, он должен находиться поиском
        out.push(String(node.attrs?.caption ?? node.attrs?.alt ?? ''));
        break;
      case 'checklist':
        for (const item of asChecklistItems(node)) out.push(item.text);
        break;
      case 'callout':
        if (node.attrs?.title) out.push(String(node.attrs.title));
        renderPlain(node.content ?? [], out);
        break;
      case 'details':
        if (node.attrs?.summary) out.push(String(node.attrs.summary));
        renderPlain(node.content ?? [], out);
        break;
      case 'step':
        if (node.attrs?.title) out.push(String(node.attrs.title));
        renderPlain(node.content ?? [], out);
        break;
      default:
        if (node.content) {
          const inner: string[] = [];
          renderPlain(node.content, inner);
          out.push(inner.join(isInlineContainer(node.type) ? '' : '\n'));
        }
    }
  }
}

function isInlineContainer(type: string): boolean {
  return ['paragraph', 'heading', 'tableCell', 'tableHeader', 'listItem'].includes(type);
}

function asChecklistItems(node: DocNode): ChecklistItem[] {
  const raw = node.attrs?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((i, idx) =>
      typeof i === 'string'
        ? { id: String(idx), text: i }
        : { id: String((i as ChecklistItem)?.id ?? idx), text: String((i as ChecklistItem)?.text ?? '') },
    )
    .filter((i) => i.text);
}

// ============================ Время чтения ============================

/**
 * 200 слов в минуту — средний темп для технического текста на русском.
 * Картинки добавляют по 3 секунды (на скриншот надо посмотреть),
 * видео — свою полную длительность: гайд не считается прочитанным,
 * если человек проскроллил мимо десятиминутного ролика.
 */
export function calcReadingTimeSec(doc: TipTapDoc, ctx: RenderContext): number {
  const words = toPlainText(doc).split(/\s+/).filter(Boolean).length;
  let sec = Math.round((words / 200) * 60);

  walkDoc(doc, (node) => {
    if (node.type === 'image') sec += 3;
    if (node.type === 'gallery') sec += 3 * (Array.isArray(node.attrs?.mediaIds) ? node.attrs.mediaIds.length : 0);
    if (node.type === 'video') {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      sec += Math.round(media?.durationSec ?? 60);
    }
  });

  return Math.max(30, sec);
}

// ============================ HTML ============================

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML-кэш гайда. Используется для превью в админке, экспорта и поиска.
 * На публичном сайте контент рендерится своим React-маппером (PLAN §4.1),
 * поэтому здесь не гонимся за srcset и lazy-loading — важна верность структуры.
 */
export function toHtml(doc: TipTapDoc, ctx: RenderContext): string {
  const usedAnchors = new Map<string, number>();
  return renderNodes(doc.content ?? [], ctx, usedAnchors);
}

function renderNodes(nodes: DocNode[], ctx: RenderContext, anchors: Map<string, number>): string {
  return nodes.map((n) => renderNode(n, ctx, anchors)).join('');
}

function renderNode(node: DocNode, ctx: RenderContext, anchors: Map<string, number>): string {
  const kids = () => renderNodes(node.content ?? [], ctx, anchors);

  switch (node.type) {
    case 'text':
      return applyMarks(escapeHtml(node.text ?? ''), node);
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
      return `<p>${kids()}</p>`;
    case 'heading': {
      const level = Math.min(4, Math.max(2, Number(node.attrs?.level ?? 2)));
      let anchor = slugifyAnchor(nodeText(node));
      const seen = anchors.get(anchor) ?? 0;
      anchors.set(anchor, seen + 1);
      if (seen > 0) anchor = `${anchor}-${seen + 1}`;
      return `<h${level} id="${anchor}">${kids()}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${kids()}</ul>`;
    case 'orderedList':
      return `<ol>${kids()}</ol>`;
    case 'listItem':
      return `<li>${kids()}</li>`;
    case 'blockquote':
      return `<blockquote>${kids()}</blockquote>`;
    case 'horizontalRule':
      return '<hr>';
    case 'codeBlock': {
      const lang = node.attrs?.language ? ` class="language-${escapeHtml(String(node.attrs.language))}"` : '';
      return `<pre><code${lang}>${escapeHtml(nodeText(node))}</code></pre>`;
    }
    case 'table':
      return `<table>${kids()}</table>`;
    case 'tableRow':
      return `<tr>${kids()}</tr>`;
    case 'tableHeader':
      return `<th>${kids()}</th>`;
    case 'tableCell':
      return `<td>${kids()}</td>`;

    case 'image': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      if (!media) return '';
      const alt = escapeHtml(String(node.attrs?.alt ?? media.alt ?? ''));
      const dims = media.width && media.height ? ` width="${media.width}" height="${media.height}"` : '';
      const img = `<img src="${escapeHtml(media.url)}" alt="${alt}"${dims} loading="lazy">`;
      const caption = node.attrs?.caption
        ? `<figcaption>${escapeHtml(String(node.attrs.caption))}</figcaption>`
        : '';
      return `<figure>${img}${caption}</figure>`;
    }

    case 'gallery': {
      const ids = Array.isArray(node.attrs?.mediaIds) ? (node.attrs.mediaIds as number[]) : [];
      const items = ids
        .map((id) => ctx.media.get(id))
        .filter(Boolean)
        .map(
          (m) =>
            `<figure><img src="${escapeHtml(m!.url)}" alt="${escapeHtml(m!.alt ?? '')}" loading="lazy"></figure>`,
        )
        .join('');
      return items ? `<div class="gallery">${items}</div>` : '';
    }

    case 'video': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      if (!media) return '';
      const poster = media.posterUrl ? ` poster="${escapeHtml(media.posterUrl)}"` : '';
      return `<video src="${escapeHtml(media.url)}"${poster} controls preload="none"></video>`;
    }

    case 'fileAttachment': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      if (!media) return '';
      return `<p><a href="${escapeHtml(media.url)}" download>${escapeHtml(media.originalName)}</a></p>`;
    }

    case 'callout': {
      const variant = (node.attrs?.variant ?? 'info') as CalloutVariant;
      const title = escapeHtml(String(node.attrs?.title ?? CALLOUT_LABEL[variant] ?? ''));
      return `<aside class="callout callout-${escapeHtml(variant)}"><strong>${title}</strong>${kids()}</aside>`;
    }

    case 'steps':
      return `<ol class="steps">${kids()}</ol>`;

    case 'step': {
      const title = node.attrs?.title ? `<strong>${escapeHtml(String(node.attrs.title))}</strong>` : '';
      return `<li class="step">${title}${kids()}</li>`;
    }

    case 'checklist': {
      const items = asChecklistItems(node)
        .map((i) => `<li><label><input type="checkbox" disabled> ${escapeHtml(i.text)}</label></li>`)
        .join('');
      return `<ul class="checklist">${items}</ul>`;
    }

    case 'details': {
      const summary = escapeHtml(String(node.attrs?.summary ?? 'Подробнее'));
      return `<details><summary>${summary}</summary>${kids()}</details>`;
    }

    case 'guideRef': {
      const guide = ctx.guides.get(Number(node.attrs?.guideId));
      if (!guide) return '';
      return `<p class="guide-ref"><a href="/g/${escapeHtml(guide.slug)}">${escapeHtml(guide.title)}</a></p>`;
    }

    default:
      return node.content ? kids() : '';
  }
}

function applyMarks(html: string, node: DocNode): string {
  let out = html;
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = `<strong>${out}</strong>`;
        break;
      case 'italic':
        out = `<em>${out}</em>`;
        break;
      case 'strike':
        out = `<s>${out}</s>`;
        break;
      case 'code':
        out = `<code>${out}</code>`;
        break;
      case 'highlight':
        out = `<mark>${out}</mark>`;
        break;
      case 'link': {
        const href = escapeHtml(String(mark.attrs?.href ?? '#'));
        const external = /^https?:\/\//i.test(href);
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        out = `<a href="${href}"${rel}>${out}</a>`;
        break;
      }
    }
  }
  return out;
}

// ============================ Markdown ============================

/**
 * Markdown-версия гайда. Нужна бэкапу (§9.2): при полном отказе платформы гайды
 * должны читаться глазами прямо в файле, без нашего кода.
 */
export function toMarkdown(doc: TipTapDoc, ctx: RenderContext): string {
  return renderMdNodes(doc.content ?? [], ctx, 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderMdNodes(nodes: DocNode[], ctx: RenderContext, depth: number): string[] {
  return nodes.map((n) => renderMd(n, ctx, depth)).filter((s) => s !== '');
}

function renderMd(node: DocNode, ctx: RenderContext, depth: number): string {
  const inline = () => (node.content ?? []).map((n) => renderMdInline(n, ctx)).join('');

  switch (node.type) {
    case 'paragraph':
      return inline();
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(node.attrs?.level ?? 2)))} ${inline()}`;
    case 'bulletList':
      return (node.content ?? [])
        .map((li) => `${'  '.repeat(depth)}- ${renderMdNodes(li.content ?? [], ctx, depth + 1).join('\n\n')}`)
        .join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map(
          (li, i) => `${'  '.repeat(depth)}${i + 1}. ${renderMdNodes(li.content ?? [], ctx, depth + 1).join('\n\n')}`,
        )
        .join('\n');
    case 'blockquote':
      return renderMdNodes(node.content ?? [], ctx, depth)
        .join('\n\n')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'codeBlock':
      return `\`\`\`${node.attrs?.language ?? ''}\n${nodeText(node)}\n\`\`\``;

    case 'table': {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) => (cell.content ?? []).map((n) => renderMdInline(n, ctx)).join('').replace(/\|/g, '\\|')),
      );
      if (!rows.length) return '';
      const header = rows[0]!;
      const sep = header.map(() => '---');
      return [header, sep, ...rows.slice(1)].map((r) => `| ${r.join(' | ')} |`).join('\n');
    }

    case 'image': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      if (!media) return '';
      const alt = String(node.attrs?.alt ?? media.alt ?? media.originalName);
      const caption = node.attrs?.caption ? `\n\n*${node.attrs.caption}*` : '';
      return `![${alt}](${media.url})${caption}`;
    }

    case 'gallery': {
      const ids = Array.isArray(node.attrs?.mediaIds) ? (node.attrs.mediaIds as number[]) : [];
      return ids
        .map((id) => ctx.media.get(id))
        .filter(Boolean)
        .map((m) => `![${m!.alt ?? m!.originalName}](${m!.url})`)
        .join('\n\n');
    }

    case 'video': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      return media ? `🎬 [Видео: ${media.originalName}](${media.url})` : '';
    }

    case 'fileAttachment': {
      const media = ctx.media.get(Number(node.attrs?.mediaId));
      return media ? `📎 [${media.originalName}](${media.url})` : '';
    }

    case 'callout': {
      const variant = (node.attrs?.variant ?? 'info') as CalloutVariant;
      const icon = { info: 'ℹ️', warn: '⚠️', danger: '🛑', success: '✅' }[variant] ?? 'ℹ️';
      const title = String(node.attrs?.title ?? CALLOUT_LABEL[variant] ?? '');
      const body = renderMdNodes(node.content ?? [], ctx, depth).join('\n\n');
      return [`> ${icon} **${title}**`, ...body.split('\n').map((l) => `> ${l}`)].join('\n');
    }

    case 'steps':
      return (node.content ?? [])
        .map((step, i) => {
          const title = step.attrs?.title ? `**${step.attrs.title}**\n\n` : '';
          return `${i + 1}. ${title}${renderMdNodes(step.content ?? [], ctx, depth + 1).join('\n\n')}`;
        })
        .join('\n\n');

    case 'checklist':
      return asChecklistItems(node)
        .map((i) => `- [ ] ${i.text}`)
        .join('\n');

    case 'details': {
      const summary = String(node.attrs?.summary ?? 'Подробнее');
      return `**${summary}**\n\n${renderMdNodes(node.content ?? [], ctx, depth).join('\n\n')}`;
    }

    case 'guideRef': {
      const guide = ctx.guides.get(Number(node.attrs?.guideId));
      return guide ? `👉 [${guide.title}](/g/${guide.slug})` : '';
    }

    default:
      return node.content ? renderMdNodes(node.content, ctx, depth).join('\n\n') : '';
  }
}

function renderMdInline(node: DocNode, ctx: RenderContext): string {
  if (node.type === 'hardBreak') return '  \n';
  if (node.type !== 'text') return renderMd(node, ctx, 0);

  let out = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        out = `**${out}**`;
        break;
      case 'italic':
        out = `*${out}*`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = `\`${out}\``;
        break;
      case 'highlight':
        out = `==${out}==`;
        break;
      case 'link':
        out = `[${out}](${mark.attrs?.href ?? '#'})`;
        break;
    }
  }
  return out;
}

export { collectHeadings };
