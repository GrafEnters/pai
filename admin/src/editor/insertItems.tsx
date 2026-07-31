import type { Editor } from '@tiptap/react';
import {
  AlertTriangle,
  BookMarked,
  ChevronRight,
  Code2,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  ListChecks,
  ListOrdered,
  Minus,
  Table as TableIcon,
} from 'lucide-react';
import type { Media } from '../api';
import { primeMediaCache } from './nodes';

export interface InsertDeps {
  onPickMedia: (kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'GALLERY') => Promise<Media | Media[] | null>;
  onPickGuide: () => Promise<number | null>;
}

export interface InsertItem {
  title: string;
  hint: string;
  keywords: string;
  Icon: typeof ImageIcon;
  run: (editor: Editor, deps: InsertDeps) => Promise<void> | void;
}

/** Меню вставки блоков — общее для тулбара и слэш-команды. */
export const INSERT_ITEMS: InsertItem[] = [
  {
    title: 'Картинка',
    hint: 'из библиотеки',
    keywords: 'image картинка скриншот img',
    Icon: ImageIcon,
    run: async (editor, deps) => {
      const media = (await deps.onPickMedia('IMAGE')) as Media | null;
      if (!media) return;
      primeMediaCache(media);
      editor.chain().focus().insertContent({ type: 'image', attrs: { mediaId: media.id } }).run();
    },
  },
  {
    title: 'Галерея',
    hint: 'сетка скриншотов',
    keywords: 'gallery галерея сетка',
    Icon: Images,
    run: async (editor, deps) => {
      const media = (await deps.onPickMedia('GALLERY')) as Media[] | null;
      if (!media?.length) return;
      media.forEach(primeMediaCache);
      editor
        .chain()
        .focus()
        .insertContent({ type: 'gallery', attrs: { mediaIds: media.map((m) => m.id), layout: 'grid' } })
        .run();
    },
  },
  {
    title: 'Видео',
    hint: 'из библиотеки',
    keywords: 'video видео ролик',
    Icon: Film,
    run: async (editor, deps) => {
      const media = (await deps.onPickMedia('VIDEO')) as Media | null;
      if (!media) return;
      primeMediaCache(media);
      editor.chain().focus().insertContent({ type: 'video', attrs: { mediaId: media.id } }).run();
    },
  },
  {
    title: 'Файл',
    hint: 'вложение',
    keywords: 'file файл вложение шаблон',
    Icon: FileText,
    run: async (editor, deps) => {
      const media = (await deps.onPickMedia('FILE')) as Media | null;
      if (!media) return;
      primeMediaCache(media);
      editor.chain().focus().insertContent({ type: 'fileAttachment', attrs: { mediaId: media.id } }).run();
    },
  },
  {
    title: 'Предупреждение',
    hint: 'callout',
    keywords: 'callout внимание опасно заметка',
    Icon: AlertTriangle,
    run: (editor) =>
      void editor
        .chain()
        .focus()
        .insertContent({
          type: 'callout',
          attrs: { variant: 'warn' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    title: 'Пошаговая инструкция',
    hint: 'steps',
    keywords: 'steps шаги инструкция',
    Icon: ListOrdered,
    run: (editor) =>
      void editor
        .chain()
        .focus()
        .insertContent({
          type: 'steps',
          content: [
            { type: 'step', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
            { type: 'step', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
          ],
        })
        .run(),
  },
  {
    title: 'Чеклист',
    hint: 'с сохранением прогресса',
    keywords: 'checklist чеклист список задач',
    Icon: ListChecks,
    run: (editor) =>
      void editor
        .chain()
        .focus()
        .insertContent({
          type: 'checklist',
          attrs: {
            items: [{ id: Math.random().toString(36).slice(2, 9), text: '' }],
            persistKey: Math.random().toString(36).slice(2, 9),
          },
        })
        .run(),
  },
  {
    title: 'Сворачиваемый блок',
    hint: 'details',
    keywords: 'details спойлер подробнее',
    Icon: ChevronRight,
    run: (editor) =>
      void editor
        .chain()
        .focus()
        .insertContent({ type: 'details', attrs: { summary: '' }, content: [{ type: 'paragraph' }] })
        .run(),
  },
  {
    title: 'Ссылка на гайд',
    hint: 'карточка',
    keywords: 'guide гайд ссылка связанный',
    Icon: BookMarked,
    run: async (editor, deps) => {
      const guideId = await deps.onPickGuide();
      if (!guideId) return;
      editor.chain().focus().insertContent({ type: 'guideRef', attrs: { guideId } }).run();
    },
  },
  {
    title: 'Блок кода',
    hint: 'с подсветкой',
    keywords: 'code код',
    Icon: Code2,
    run: (editor) => void editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    title: 'Таблица',
    hint: '3×3',
    keywords: 'table таблица',
    Icon: TableIcon,
    run: (editor) => void editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: 'Разделитель',
    hint: '',
    keywords: 'hr разделитель линия',
    Icon: Minus,
    run: (editor) => void editor.chain().focus().setHorizontalRule().run(),
  },
];
