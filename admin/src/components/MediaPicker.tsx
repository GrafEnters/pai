import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { api, errText, type Media, type MediaType, type Paged } from '../api';
import { uploadFile } from '../lib/upload';
import { MediaCard } from './MediaGrid';

export type PickerKind = 'IMAGE' | 'VIDEO' | 'FILE' | 'GALLERY';

interface Props {
  kind: PickerKind;
  onPick: (media: Media | Media[] | null) => void;
}

const TITLE: Record<PickerKind, string> = {
  IMAGE: 'Выберите картинку',
  VIDEO: 'Выберите видео',
  FILE: 'Выберите файл',
  GALLERY: 'Выберите картинки для галереи',
};

const ACCEPT: Record<PickerKind, string> = {
  IMAGE: 'image/*',
  VIDEO: 'video/*',
  FILE: '',
  GALLERY: 'image/*',
};

/** Модалка выбора медиа: библиотека + загрузка прямо отсюда. */
export function MediaPicker({ kind, onPick }: Props) {
  const qc = useQueryClient();
  const multiple = kind === 'GALLERY';
  const filterType: MediaType = kind === 'GALLERY' ? 'IMAGE' : kind;

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Media[]>([]);
  const [status, setStatus] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['media-picker', filterType, search],
    queryFn: async () =>
      (
        await api.get<Paged<Media>>('/admin/media', {
          params: { type: filterType, q: search || undefined, limit: 60 },
        })
      ).data,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onPick(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onPick]);

  async function handleUpload(files: FileList) {
    const uploaded: Media[] = [];
    for (const file of Array.from(files)) {
      setStatus(`${file.name}: загрузка…`);
      try {
        const { media } = await uploadFile(file, {
          onStage: (s) => setStatus(`${file.name}: ${s === 'hashing' ? 'хеш' : s === 'uploading' ? 'загрузка' : 'обработка'}`),
        });
        uploaded.push(media);
      } catch (e) {
        setStatus(`${file.name}: ${errText(e)}`);
        return;
      }
    }
    setStatus('');
    void qc.invalidateQueries({ queryKey: ['media-picker'] });
    void qc.invalidateQueries({ queryKey: ['media'] });
    if (!multiple && uploaded[0]) onPick(uploaded[0]);
    else setSelected((s) => [...s, ...uploaded]);
  }

  function toggle(media: Media) {
    if (!multiple) return onPick(media);
    setSelected((s) => (s.some((m) => m.id === media.id) ? s.filter((m) => m.id !== media.id) : [...s, media]));
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={() => onPick(null)}>
      <div className="card flex max-h-[85vh] w-full max-w-4xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium text-white">{TITLE[kind]}</h2>
          <button className="btn-ghost px-2" onClick={() => onPick(null)}>
            <X size={16} />
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <input
            className="input max-w-xs"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <button className="btn-ghost" onClick={() => fileInput.current?.click()}>
            <Upload size={15} />
            Загрузить новое
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple={multiple}
            accept={ACCEPT[kind] || undefined}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleUpload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {status && <div className="mb-2 text-xs text-brand-300">{status}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-ink-500">Загрузка…</div>
          ) : data && data.items.length === 0 ? (
            <div className="py-10 text-center text-ink-500">Ничего нет — загрузите файл</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {data?.items.map((m) => (
                <MediaCard key={m.id} media={m} selected={selected.some((s) => s.id === m.id)} onClick={() => toggle(m)} />
              ))}
            </div>
          )}
        </div>

        {multiple && (
          <div className="mt-3 flex items-center gap-3 border-t border-ink-800 pt-3">
            <span className="text-sm text-ink-500">Выбрано: {selected.length}</span>
            <button className="btn-primary ml-auto" disabled={!selected.length} onClick={() => onPick(selected)}>
              Вставить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Модалка выбора гайда — для ноды guideRef и поля «связанные». */
export function GuidePicker({ onPick, excludeId }: { onPick: (id: number | null) => void; excludeId?: number }) {
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['guide-picker', search],
    queryFn: async () =>
      (await api.get<Paged<{ id: number; title: string; slug: string; status: string }>>('/admin/guides', {
        params: { q: search || undefined, limit: 40 },
      })).data,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onPick(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onPick]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={() => onPick(null)}>
      <div className="card flex max-h-[70vh] w-full max-w-lg flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-medium text-white">Выберите гайд</h2>
        <input
          className="input mb-3"
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {data?.items
            .filter((g) => g.id !== excludeId)
            .map((g) => (
              <button
                key={g.id}
                onClick={() => onPick(g.id)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-300 hover:bg-ink-800"
              >
                <span className="flex-1">{g.title}</span>
                <span className="text-xs text-ink-600">{g.status}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
