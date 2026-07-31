/**
 * Формат контента — документ TipTap (PLAN §4.1). Здесь только типы и справочник
 * кастомных нод: сам редактор живёт в админке, а backend должен уметь превращать
 * этот JSON в HTML, Markdown и плоский текст.
 */

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
}

export interface TipTapDoc {
  type: 'doc';
  content?: DocNode[];
}

export const EMPTY_DOC: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Кастомные ноды из §4.1 и их атрибуты — единый источник правды для фронта и бэка. */
export const CUSTOM_NODES = {
  image: ['mediaId', 'alt', 'caption', 'width', 'align'],
  video: ['mediaId', 'poster', 'autoplay', 'loop', 'startAt'],
  gallery: ['mediaIds', 'layout'],
  callout: ['variant', 'title'],
  steps: [],
  step: ['title'],
  checklist: ['items', 'persistKey'],
  guideRef: ['guideId'],
  details: ['summary'],
  fileAttachment: ['mediaId'],
} as const;

export type CalloutVariant = 'info' | 'warn' | 'danger' | 'success';

export const CALLOUT_LABEL: Record<CalloutVariant, string> = {
  info: 'Заметка',
  warn: 'Внимание',
  danger: 'Опасно',
  success: 'Хорошая практика',
};

export interface ChecklistItem {
  id: string;
  text: string;
}

/** Документ ли это вообще. Из БД приходит Json, доверять ему нельзя. */
export function isDoc(value: unknown): value is TipTapDoc {
  return !!value && typeof value === 'object' && (value as DocNode).type === 'doc';
}

export function asDoc(value: unknown): TipTapDoc {
  return isDoc(value) ? value : EMPTY_DOC;
}

/** Обход всех нод документа сверху вниз. */
export function walkDoc(doc: TipTapDoc, visit: (node: DocNode) => void): void {
  const stack: DocNode[] = [...(doc.content ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    visit(node);
    if (node.content) stack.push(...node.content);
  }
}

/** Все mediaId, на которые ссылается документ — для GuideMedia и бэкапа. */
export function collectMediaIds(doc: TipTapDoc): number[] {
  const ids = new Set<number>();
  walkDoc(doc, (node) => {
    const attrs = node.attrs ?? {};
    const single = attrs.mediaId;
    if (typeof single === 'number') ids.add(single);
    if (Array.isArray(attrs.mediaIds)) {
      for (const id of attrs.mediaIds) if (typeof id === 'number') ids.add(id);
    }
  });
  return [...ids];
}

/** Все guideId, на которые ссылается документ (нода guideRef). */
export function collectGuideRefs(doc: TipTapDoc): number[] {
  const ids = new Set<number>();
  walkDoc(doc, (node) => {
    if (node.type === 'guideRef' && typeof node.attrs?.guideId === 'number') {
      ids.add(node.attrs.guideId as number);
    }
  });
  return [...ids];
}

export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

/** Оглавление: заголовки 2–4 уровня с устойчивыми якорями. */
export function collectHeadings(doc: TipTapDoc): Heading[] {
  const out: Heading[] = [];
  const used = new Map<string, number>();

  for (const node of doc.content ?? []) {
    if (node.type !== 'heading') continue;
    const level = Number(node.attrs?.level ?? 2);
    if (level < 2 || level > 4) continue;
    const text = nodeText(node).trim();
    if (!text) continue;

    let anchor = slugifyAnchor(text);
    // Два одинаковых заголовка в одном гайде — обычное дело, якоря разводим суффиксом
    const seen = used.get(anchor) ?? 0;
    used.set(anchor, seen + 1);
    if (seen > 0) anchor = `${anchor}-${seen + 1}`;

    out.push({ level, text, anchor });
  }
  return out;
}

export function nodeText(node: DocNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join('');
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Кириллица → латиница: якоря и slug'и должны быть читаемы в URL. */
export function transliterate(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
}

export function slugifyAnchor(s: string): string {
  const base = transliterate(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'section';
}

/** slug гайда: транслит + приставка-номер при коллизии добавляется вызывающим кодом. */
export function slugify(s: string): string {
  const base = transliterate(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'guide';
}
