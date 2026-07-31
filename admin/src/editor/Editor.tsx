import { useCallback, useEffect, useRef, useState } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor as TipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react';
import { CUSTOM_EXTENSIONS, primeMediaCache } from './nodes';
import { INSERT_ITEMS, type InsertItem } from './insertItems';
import { uploadFile } from '../lib/upload';
import type { Media } from '../api';

const lowlight = createLowlight(common);

export interface EditorHandle {
  editor: TipTapEditor | null;
}

interface Props {
  initialContent: unknown;
  onChange: (doc: unknown) => void;
  onPickMedia: (kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'GALLERY') => Promise<Media | Media[] | null>;
  onPickGuide: () => Promise<number | null>;
  editable?: boolean;
}

export function Editor({ initialContent, onChange, onPickMedia, onPickGuide, editable = true }: Props) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [slash, setSlash] = useState<{ x: number; y: number; query: string } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;

  /** Вставка скриншота из буфера — главная фича по скорости наполнения (§4.1). */
  const uploadAndInsert = useCallback(
    async (editor: TipTapEditor, file: File) => {
      setUploading(file.name);
      try {
        const { media } = await uploadFile(file, {
          onStage: (s) =>
            setUploading(`${file.name} — ${s === 'hashing' ? 'хеш' : s === 'uploading' ? 'загрузка' : 'обработка'}`),
        });
        primeMediaCache(media);
        const type = media.type === 'VIDEO' ? 'video' : media.type === 'FILE' ? 'fileAttachment' : 'image';
        editor.chain().focus().insertContent({ type, attrs: { mediaId: media.id } }).run();
      } catch (e) {
        setUploading(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
        setTimeout(() => setUploading(null), 4000);
        return;
      }
      setUploading(null);
    },
    [],
  );

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ codeBlock: false, heading: { levels: [2, 3, 4] } }),
      Placeholder.configure({
        placeholder: 'Пишите текст. «/» — меню блоков, Ctrl+V — вставка скриншота.',
      }),
      CharacterCount,
      Typography,
      Highlight,
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
      ...CUSTOM_EXTENSIONS,
    ],
    content: (initialContent as never) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'pai-editor focus:outline-none min-h-[50vh]',
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        const media = files.filter((f) => /^(image|video)\//.test(f.type));
        if (!media.length) return false;
        event.preventDefault();
        const ed = (view as unknown as { __editor?: TipTapEditor }).__editor;
        void (async () => {
          for (const file of media) await uploadAndInsert(ed ?? editorRef.current!, file);
        })();
        return true;
      },
      handleDrop(_view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        void (async () => {
          for (const file of files) await uploadAndInsert(editorRef.current!, file);
        })();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getJSON());
      updateSlashState(ed);
    },
    onSelectionUpdate: ({ editor: ed }) => updateSlashState(ed),
  });

  const editorRef = useRef<TipTapEditor | null>(null);
  editorRef.current = editor;

  /**
   * Слэш-меню без внешней зависимости: если текущий абзац начинается с «/»
   * и больше в нём ничего нет, показываем список блоков у курсора.
   */
  function updateSlashState(ed: TipTapEditor) {
    const { $from, empty } = ed.state.selection;
    if (!empty || $from.parent.type.name !== 'paragraph') return setSlash(null);

    const text = $from.parent.textContent;
    if (!text.startsWith('/') || text.includes(' ')) return setSlash(null);

    try {
      const coords = ed.view.coordsAtPos($from.pos);
      setSlash({ x: coords.left, y: coords.bottom + 4, query: text.slice(1).toLowerCase() });
    } catch {
      setSlash(null);
    }
  }

  const runInsert = useCallback(
    async (item: InsertItem) => {
      const ed = editorRef.current;
      if (!ed) return;

      // Убираем набранное «/запрос» перед вставкой блока
      const { $from } = ed.state.selection;
      const start = $from.start();
      const end = $from.pos;
      if (ed.state.doc.textBetween(start, end).startsWith('/')) {
        ed.chain().focus().deleteRange({ from: start, to: end }).run();
      }
      setSlash(null);

      await item.run(ed, { onPickMedia, onPickGuide });
    },
    [onPickGuide, onPickMedia],
  );

  // Стрелки и Enter внутри слэш-меню
  const [slashIndex, setSlashIndex] = useState(0);
  const filtered = slash
    ? INSERT_ITEMS.filter(
        (i) => !slash.query || i.title.toLowerCase().includes(slash.query) || i.keywords.includes(slash.query),
      )
    : [];

  useEffect(() => setSlashIndex(0), [slash?.query]);

  useEffect(() => {
    if (!slash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setSlash(null);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[slashIndex]) {
        e.preventDefault();
        void runInsert(filtered[slashIndex]!);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [slash, filtered, slashIndex, runInsert]);

  if (!editor) return <div className="p-6 text-ink-500">Редактор загружается…</div>;

  return (
    <div className="relative">
      <Toolbar editor={editor} onInsert={runInsert} />

      {uploading && (
        <div className="sticky top-0 z-20 mb-2 rounded-lg bg-brand-500/15 px-3 py-1.5 text-xs text-brand-200">
          {uploading}
        </div>
      )}

      <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
        <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-xl">
          <Mark editor={editor} name="bold" Icon={Bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <Mark editor={editor} name="italic" Icon={Italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Mark editor={editor} name="strike" Icon={Strikethrough} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <Mark editor={editor} name="code" Icon={Code} onClick={() => editor.chain().focus().toggleCode().run()} />
          <Mark editor={editor} name="highlight" Icon={Highlighter} onClick={() => editor.chain().focus().toggleHighlight().run()} />
          <button
            type="button"
            className="rounded p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-200"
            title="Ссылка"
            onClick={() => {
              const prev = editor.getAttributes('link').href as string | undefined;
              const href = window.prompt('Адрес ссылки', prev ?? 'https://');
              if (href === null) return;
              if (href === '') editor.chain().focus().unsetLink().run();
              else editor.chain().focus().setLink({ href }).run();
            }}
          >
            <LinkIcon size={14} />
          </button>
        </div>
      </BubbleMenu>

      {slash && filtered.length > 0 && (
        <div
          className="fixed z-50 max-h-72 w-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl"
          style={{ left: slash.x, top: slash.y }}
        >
          {filtered.map((item, i) => (
            <button
              key={item.title}
              type="button"
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => void runInsert(item)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                i === slashIndex ? 'bg-brand-500/20 text-brand-200' : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              <item.Icon size={15} />
              <span className="flex-1">{item.title}</span>
              <span className="text-[10px] text-ink-600">{item.hint}</span>
            </button>
          ))}
        </div>
      )}

      <EditorContent editor={editor} />

      <div className="mt-4 border-t border-ink-800 pt-2 text-xs text-ink-600">
        {editor.storage.characterCount.words()} слов · {editor.storage.characterCount.characters()} символов
      </div>
    </div>
  );
}

function Mark({
  editor,
  name,
  Icon,
  onClick,
}: {
  editor: TipTapEditor;
  name: string;
  Icon: typeof Bold;
  onClick: () => void;
}) {
  const active = editor.isActive(name);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded p-1.5 ${active ? 'bg-brand-500/25 text-brand-200' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200'}`}
    >
      <Icon size={14} />
    </button>
  );
}

function Toolbar({ editor, onInsert }: { editor: TipTapEditor; onInsert: (item: InsertItem) => void }) {
  const [menu, setMenu] = useState(false);

  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-1 border-b border-ink-800 bg-ink-950/95 py-2 backdrop-blur">
      {[2, 3, 4].map((level) => (
        <button
          key={level}
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: level as 2 | 3 | 4 }).run()}
          className={`rounded px-2 py-1 text-xs font-semibold ${
            editor.isActive('heading', { level }) ? 'bg-brand-500/25 text-brand-200' : 'text-ink-400 hover:bg-ink-800'
          }`}
        >
          H{level}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-ink-800" />
      <Mark editor={editor} name="bulletList" Icon={List} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Mark
        editor={editor}
        name="orderedList"
        Icon={ListOrdered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Mark
        editor={editor}
        name="blockquote"
        Icon={Quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <span className="mx-1 h-4 w-px bg-ink-800" />

      <div className="relative">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setMenu((v) => !v)}>
          + Вставить блок
        </button>
        {menu && (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl">
            {INSERT_ITEMS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => {
                  setMenu(false);
                  onInsert(item);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-ink-300 hover:bg-ink-800"
              >
                <item.Icon size={15} />
                <span className="flex-1">{item.title}</span>
                <span className="text-[10px] text-ink-600">{item.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="ml-auto text-[11px] text-ink-600">Ctrl+V — вставить скриншот</span>
    </div>
  );
}
