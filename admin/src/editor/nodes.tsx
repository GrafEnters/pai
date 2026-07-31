import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Film, Info, OctagonAlert, Plus, Trash2, X } from 'lucide-react';
import { api, type Media } from '../api';

/**
 * Кастомные ноды из PLAN §4.1. Каждая ссылается на Media по id, а не на URL —
 * при переезде бакета ничего не ломается.
 */

// ============================ Общее ============================

/** Медиа по id с кэшем на уровне модуля: одна картинка часто встречается дважды. */
const mediaCache = new Map<number, Media>();

export function useMedia(mediaId: number | null | undefined) {
  const [media, setMedia] = useState<Media | null>(() => (mediaId ? (mediaCache.get(mediaId) ?? null) : null));

  useEffect(() => {
    if (!mediaId) return setMedia(null);
    const cached = mediaCache.get(mediaId);
    if (cached) return setMedia(cached);
    let alive = true;
    api
      .get<Media>(`/admin/media/${mediaId}`)
      .then(({ data }) => {
        mediaCache.set(mediaId, data);
        if (alive) setMedia(data);
      })
      .catch(() => alive && setMedia(null));
    return () => {
      alive = false;
    };
  }, [mediaId]);

  return media;
}

export function primeMediaCache(media: Media) {
  mediaCache.set(media.id, media);
}

function Frame({
  selected,
  children,
  onDelete,
  label,
}: {
  selected: boolean;
  children: React.ReactNode;
  onDelete?: () => void;
  label?: string;
}) {
  return (
    <NodeViewWrapper
      className={`relative my-3 rounded-lg border transition-colors ${
        selected ? 'border-brand-400' : 'border-transparent hover:border-ink-700'
      }`}
    >
      {label && (
        <div className="absolute -top-2 left-2 rounded bg-ink-800 px-1.5 text-[10px] uppercase tracking-wide text-ink-400">
          {label}
        </div>
      )}
      {onDelete && (
        <button
          type="button"
          contentEditable={false}
          onClick={onDelete}
          className="absolute right-1 top-1 z-10 rounded bg-ink-900/80 p-1 text-ink-400 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
          title="Удалить блок"
        >
          <X size={14} />
        </button>
      )}
      {children}
    </NodeViewWrapper>
  );
}

// ============================ image ============================

function ImageView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const media = useMedia(node.attrs.mediaId as number);
  return (
    <Frame selected={selected} onDelete={deleteNode} label="картинка">
      <figure className="group m-0">
        {media ? (
          <img
            src={media.srcset.webp?.split(',')[0]?.trim().split(/\s+/)[0] ?? media.url}
            alt={(node.attrs.alt as string) ?? media.alt ?? ''}
            className="mx-auto max-h-96 rounded-lg"
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-lg bg-ink-800 text-sm text-ink-500">
            Картинка #{String(node.attrs.mediaId)} загружается…
          </div>
        )}
        <input
          contentEditable={false}
          className="mt-2 w-full bg-transparent text-center text-sm text-ink-400 outline-none placeholder:text-ink-600"
          placeholder="Подпись (необязательно)"
          value={(node.attrs.caption as string) ?? ''}
          onChange={(e) => updateAttributes({ caption: e.target.value })}
        />
      </figure>
    </Frame>
  );
}

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    mediaId: { default: null },
    alt: { default: null },
    caption: { default: null },
    width: { default: null },
    align: { default: 'center' },
  }),
  parseHTML: () => [{ tag: 'div[data-type="image"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image' })],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});

// ============================ video ============================

function VideoView({ node, selected, deleteNode }: NodeViewProps) {
  const media = useMedia(node.attrs.mediaId as number);
  return (
    <Frame selected={selected} onDelete={deleteNode} label="видео">
      <div className="group overflow-hidden rounded-lg bg-ink-950">
        {media ? (
          <video src={media.url} poster={media.posterUrl ?? undefined} controls className="max-h-96 w-full" />
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-ink-500">
            <Film size={18} className="mr-2" /> Видео #{String(node.attrs.mediaId)}
          </div>
        )}
      </div>
    </Frame>
  );
}

export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    mediaId: { default: null },
    poster: { default: null },
    autoplay: { default: false },
    loop: { default: false },
    startAt: { default: 0 },
  }),
  parseHTML: () => [{ tag: 'div[data-type="video"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'video' })],
  addNodeView: () => ReactNodeViewRenderer(VideoView),
});

// ============================ gallery ============================

function GalleryView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const ids = (node.attrs.mediaIds as number[]) ?? [];
  return (
    <Frame selected={selected} onDelete={deleteNode} label="галерея">
      <div className="group grid grid-cols-3 gap-2 p-2">
        {ids.map((id, i) => (
          <GalleryItem
            key={`${id}-${i}`}
            mediaId={id}
            onRemove={() => updateAttributes({ mediaIds: ids.filter((_, idx) => idx !== i) })}
          />
        ))}
        {ids.length === 0 && (
          <div className="col-span-3 py-6 text-center text-sm text-ink-500">
            Пустая галерея — добавьте скриншоты через меню вставки
          </div>
        )}
      </div>
    </Frame>
  );
}

function GalleryItem({ mediaId, onRemove }: { mediaId: number; onRemove: () => void }) {
  const media = useMedia(mediaId);
  return (
    <div className="relative aspect-video overflow-hidden rounded bg-ink-800">
      {media && (
        <img
          src={media.srcset.webp?.split(',')[0]?.trim().split(/\s+/)[0] ?? media.url}
          alt={media.alt ?? ''}
          className="h-full w-full object-cover"
        />
      )}
      <button
        type="button"
        contentEditable={false}
        onClick={onRemove}
        className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export const GalleryNode = Node.create({
  name: 'gallery',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ mediaIds: { default: [] }, layout: { default: 'grid' } }),
  parseHTML: () => [{ tag: 'div[data-type="gallery"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'gallery' })],
  addNodeView: () => ReactNodeViewRenderer(GalleryView),
});

// ============================ callout ============================

const CALLOUT_STYLE = {
  info: { cls: 'border-sky-500/40 bg-sky-500/10 text-sky-200', Icon: Info, label: 'Заметка' },
  warn: { cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200', Icon: AlertTriangle, label: 'Внимание' },
  danger: { cls: 'border-red-500/40 bg-red-500/10 text-red-200', Icon: OctagonAlert, label: 'Опасно' },
  success: { cls: 'border-green-500/40 bg-green-500/10 text-green-200', Icon: CheckCircle2, label: 'Хорошая практика' },
} as const;

export type CalloutVariant = keyof typeof CALLOUT_STYLE;

function CalloutView({ node, updateAttributes, selected }: NodeViewProps) {
  const variant = ((node.attrs.variant as CalloutVariant) ?? 'info') in CALLOUT_STYLE
    ? (node.attrs.variant as CalloutVariant)
    : 'info';
  const { cls, Icon, label } = CALLOUT_STYLE[variant];

  return (
    <NodeViewWrapper className={`my-3 rounded-lg border p-3 ${cls} ${selected ? 'ring-1 ring-brand-400' : ''}`}>
      <div className="mb-1 flex items-center gap-2" contentEditable={false}>
        <Icon size={16} />
        <input
          className="flex-1 bg-transparent text-sm font-semibold outline-none"
          value={(node.attrs.title as string) ?? ''}
          placeholder={label}
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
        <select
          className="rounded bg-ink-900/60 px-1 py-0.5 text-xs text-ink-300 outline-none"
          value={variant}
          onChange={(e) => updateAttributes({ variant: e.target.value })}
        >
          {(Object.keys(CALLOUT_STYLE) as CalloutVariant[]).map((v) => (
            <option key={v} value={v}>
              {CALLOUT_STYLE[v].label}
            </option>
          ))}
        </select>
      </div>
      <NodeViewContent className="prose-invert text-sm" />
    </NodeViewWrapper>
  );
}

export const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ variant: { default: 'info' }, title: { default: null } }),
  parseHTML: () => [{ tag: 'aside[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'aside',
    mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(CalloutView),
});

// ============================ steps / step ============================

function StepsView() {
  return (
    <NodeViewWrapper className="my-3 space-y-2 border-l-2 border-brand-500/40 pl-4">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

function StepView({ node, updateAttributes, getPos, editor }: NodeViewProps) {
  // Номер шага — позиция среди соседей: пересчитывается сам при вставке в середину
  let index = 1;
  try {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos != null) {
      const $pos = editor.state.doc.resolve(pos);
      index = $pos.index() + 1;
    }
  } catch {
    index = 1;
  }

  return (
    <NodeViewWrapper className="relative rounded-lg bg-ink-900/60 p-3">
      <div className="mb-1 flex items-center gap-2" contentEditable={false}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
          {index}
        </span>
        <input
          className="flex-1 bg-transparent text-sm font-medium text-ink-200 outline-none placeholder:text-ink-600"
          value={(node.attrs.title as string) ?? ''}
          placeholder="Название шага"
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
      </div>
      <NodeViewContent className="text-sm" />
    </NodeViewWrapper>
  );
}

export const StepsNode = Node.create({
  name: 'steps',
  group: 'block',
  content: 'step+',
  parseHTML: () => [{ tag: 'ol[data-type="steps"]' }],
  renderHTML: ({ HTMLAttributes }) => ['ol', mergeAttributes(HTMLAttributes, { 'data-type': 'steps' }), 0],
  addNodeView: () => ReactNodeViewRenderer(StepsView),
});

export const StepNode = Node.create({
  name: 'step',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ title: { default: null } }),
  parseHTML: () => [{ tag: 'li[data-type="step"]' }],
  renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes, { 'data-type': 'step' }), 0],
  addNodeView: () => ReactNodeViewRenderer(StepView),
});

// ============================ checklist ============================

interface ChecklistItem {
  id: string;
  text: string;
}

function ChecklistView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const items = ((node.attrs.items as ChecklistItem[]) ?? []).map((i, idx) =>
    typeof i === 'string' ? { id: String(idx), text: i } : i,
  );

  const set = (next: ChecklistItem[]) => updateAttributes({ items: next });

  return (
    <Frame selected={selected} onDelete={deleteNode} label="чеклист">
      <div className="group space-y-1 rounded-lg bg-ink-900/60 p-3" contentEditable={false}>
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2">
            <input type="checkbox" disabled className="accent-brand-500" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-600"
              value={item.text}
              placeholder="Пункт чеклиста"
              onChange={(e) => set(items.map((x, idx) => (idx === i ? { ...x, text: e.target.value } : x)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const next = [...items];
                  next.splice(i + 1, 0, { id: rid(), text: '' });
                  set(next);
                }
              }}
            />
            <button type="button" onClick={() => set(items.filter((_, idx) => idx !== i))} className="text-ink-600 hover:text-red-300">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => set([...items, { id: rid(), text: '' }])}
          className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-300"
        >
          <Plus size={12} /> добавить пункт
        </button>
      </div>
    </Frame>
  );
}

function rid() {
  return Math.random().toString(36).slice(2, 9);
}

export const ChecklistNode = Node.create({
  name: 'checklist',
  group: 'block',
  atom: true,
  addAttributes: () => ({ items: { default: [] }, persistKey: { default: null } }),
  parseHTML: () => [{ tag: 'ul[data-type="checklist"]' }],
  renderHTML: ({ HTMLAttributes }) => ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'checklist' })],
  addNodeView: () => ReactNodeViewRenderer(ChecklistView),
});

// ============================ details ============================

function DetailsView({ node, updateAttributes, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`my-3 rounded-lg border border-ink-700 p-3 ${selected ? 'ring-1 ring-brand-400' : ''}`}
    >
      <input
        contentEditable={false}
        className="mb-2 w-full bg-transparent text-sm font-medium text-ink-200 outline-none placeholder:text-ink-600"
        value={(node.attrs.summary as string) ?? ''}
        placeholder="Заголовок сворачиваемого блока"
        onChange={(e) => updateAttributes({ summary: e.target.value })}
      />
      <NodeViewContent className="text-sm" />
    </NodeViewWrapper>
  );
}

export const DetailsNode = Node.create({
  name: 'details',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes: () => ({ summary: { default: null } }),
  parseHTML: () => [{ tag: 'details' }],
  renderHTML: ({ HTMLAttributes }) => ['details', mergeAttributes(HTMLAttributes), 0],
  addNodeView: () => ReactNodeViewRenderer(DetailsView),
});

// ============================ guideRef ============================

function GuideRefView({ node, selected, deleteNode }: NodeViewProps) {
  const [guide, setGuide] = useState<{ title: string; summary: string | null } | null>(null);
  const guideId = node.attrs.guideId as number;

  useEffect(() => {
    if (!guideId) return;
    let alive = true;
    api
      .get(`/admin/guides/${guideId}`)
      .then(({ data }) => alive && setGuide({ title: data.title, summary: data.summary }))
      .catch(() => alive && setGuide(null));
    return () => {
      alive = false;
    };
  }, [guideId]);

  return (
    <Frame selected={selected} onDelete={deleteNode} label="ссылка на гайд">
      <div className="group rounded-lg border border-ink-700 bg-ink-900 p-3">
        <div className="text-sm font-medium text-brand-300">{guide?.title ?? `Гайд #${guideId}`}</div>
        {guide?.summary && <div className="mt-0.5 text-xs text-ink-500">{guide.summary}</div>}
      </div>
    </Frame>
  );
}

export const GuideRefNode = Node.create({
  name: 'guideRef',
  group: 'block',
  atom: true,
  addAttributes: () => ({ guideId: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-type="guide-ref"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'guide-ref' })],
  addNodeView: () => ReactNodeViewRenderer(GuideRefView),
});

// ============================ fileAttachment ============================

function FileAttachmentView({ node, selected, deleteNode }: NodeViewProps) {
  const media = useMedia(node.attrs.mediaId as number);
  return (
    <Frame selected={selected} onDelete={deleteNode} label="файл">
      <div className="group flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 p-3 text-sm">
        <FileText size={16} className="text-ink-400" />
        <span className="text-ink-200">{media?.originalName ?? `Файл #${String(node.attrs.mediaId)}`}</span>
      </div>
    </Frame>
  );
}

export const FileAttachmentNode = Node.create({
  name: 'fileAttachment',
  group: 'block',
  atom: true,
  addAttributes: () => ({ mediaId: { default: null } }),
  parseHTML: () => [{ tag: 'div[data-type="file"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'file' })],
  addNodeView: () => ReactNodeViewRenderer(FileAttachmentView),
});

export const CUSTOM_EXTENSIONS = [
  ImageNode,
  VideoNode,
  GalleryNode,
  CalloutNode,
  StepsNode,
  StepNode,
  ChecklistNode,
  DetailsNode,
  GuideRefNode,
  FileAttachmentNode,
];
