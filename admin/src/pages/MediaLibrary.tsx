import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload, X } from 'lucide-react';
import { api, errText, type Media, type MediaType, type Paged } from '../api';
import { humanDuration, humanSize, uploadFile } from '../lib/upload';
import { MediaCard, MediaThumb } from '../components/MediaGrid';

const TYPE_TABS: { value: MediaType | ''; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'IMAGE', label: 'Картинки' },
  { value: 'VIDEO', label: 'Видео' },
  { value: 'FILE', label: 'Файлы' },
];

interface UploadState {
  name: string;
  pct: number;
  stage: 'hashing' | 'uploading' | 'processing';
  error?: string;
}

const STAGE_LABEL = {
  hashing: 'считаю хеш',
  uploading: 'загружаю',
  processing: 'обрабатываю',
} as const;

export function MediaLibrary() {
  const qc = useQueryClient();
  const [type, setType] = useState<MediaType | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Media | null>(null);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['media', type, search, page],
    queryFn: async () =>
      (
        await api.get<Paged<Media>>('/admin/media', {
          params: { type: type || undefined, q: search || undefined, page, limit: 48 },
        })
      ).data,
  });

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setError('');
      for (const file of Array.from(files)) {
        const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`;
        setUploads((u) => ({ ...u, [id]: { name: file.name, pct: 0, stage: 'hashing' } }));
        try {
          await uploadFile(file, {
            onProgress: (pct) => setUploads((u) => (u[id] ? { ...u, [id]: { ...u[id]!, pct } } : u)),
            onStage: (stage) => setUploads((u) => (u[id] ? { ...u, [id]: { ...u[id]!, stage } } : u)),
          });
          setUploads((u) => {
            const next = { ...u };
            delete next[id];
            return next;
          });
          void qc.invalidateQueries({ queryKey: ['media'] });
        } catch (e) {
          setUploads((u) => (u[id] ? { ...u, [id]: { ...u[id]!, error: errText(e) } } : u));
        }
      }
    },
    [qc],
  );

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/admin/media/${id}`)).data,
    onSuccess: () => {
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div
      className="p-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-white">Медиа-библиотека</h1>
        <button className="btn-primary" onClick={() => fileInput.current?.click()}>
          <Upload size={16} />
          Загрузить
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-ink-800 p-0.5">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => {
                setType(t.value);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                type === t.value ? 'bg-brand-500/15 text-brand-300' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="Поиск по имени и alt…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {dragging && (
        <div className="mb-4 rounded-xl border-2 border-dashed border-brand-400 p-8 text-center text-brand-300">
          Отпустите файлы, чтобы загрузить
        </div>
      )}

      {Object.entries(uploads).length > 0 && (
        <div className="card mb-4 divide-y divide-ink-800">
          {Object.entries(uploads).map(([id, u]) => (
            <div key={id} className="p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-ink-300">{u.name}</span>
                <span className={u.error ? 'text-red-400' : 'text-ink-500'}>
                  {u.error ?? `${STAGE_LABEL[u.stage]} ${u.pct}%`}
                </span>
              </div>
              {!u.error && (
                <div className="mt-2 h-1 overflow-hidden rounded bg-ink-800">
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${u.pct}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {isLoading ? (
        <div className="text-ink-500">Загрузка…</div>
      ) : data && data.items.length === 0 ? (
        <div className="card p-10 text-center text-ink-500">
          Пока пусто. Перетащите файлы сюда или нажмите «Загрузить».
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {data?.items.map((m) => (
            <MediaCard key={m.id} media={m} selected={selected?.id === m.id} onClick={() => setSelected(m)} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-2">
          <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </button>
          <span className="text-sm text-ink-500">
            {page} из {totalPages}
          </span>
          <button className="btn-ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Вперёд
          </button>
        </div>
      )}

      {selected && (
        <MediaDetails
          mediaId={selected.id}
          onClose={() => setSelected(null)}
          onDelete={() => remove.mutate(selected.id)}
        />
      )}
    </div>
  );
}

function MediaDetails({
  mediaId,
  onClose,
  onDelete,
}: {
  mediaId: number;
  onClose: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const { data: media } = useQuery({
    queryKey: ['media-item', mediaId],
    queryFn: async () => (await api.get<Media>(`/admin/media/${mediaId}`)).data,
  });
  const [alt, setAlt] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => (await api.patch(`/admin/media/${mediaId}`, { alt })).data,
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
  });

  if (!media) return null;
  const altValue = alt ?? media.alt ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="truncate text-lg font-medium text-white">{media.originalName}</h2>
          <button className="btn-ghost px-2" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="mb-4 max-h-80 overflow-hidden rounded-lg bg-ink-950">
          {media.type === 'VIDEO' ? (
            <video src={media.url} poster={media.posterUrl ?? undefined} controls className="max-h-80 w-full" />
          ) : (
            <div className="h-64">
              <MediaThumb media={media} className="object-contain" />
            </div>
          )}
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <Row label="Тип" value={media.type} />
          <Row label="Размер" value={humanSize(media.sizeBytes)} />
          {media.width && <Row label="Разрешение" value={`${media.width}×${media.height}`} />}
          {media.durationSec && <Row label="Длительность" value={humanDuration(media.durationSec)} />}
          <Row label="Вариантов" value={String(media.variants?.length ?? 0)} />
          <Row label="Статус" value={media.status} />
        </dl>

        {media.error && (
          <div className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{media.error}</div>
        )}

        <div className="mb-4">
          <label className="label">Alt-текст (что на картинке)</label>
          <input className="input" value={altValue} onChange={(e) => setAlt(e.target.value)} />
        </div>

        <div className="mb-4">
          <div className="label">Где используется</div>
          {media.usedIn?.length ? (
            <ul className="list-inside list-disc text-sm text-ink-300">
              {media.usedIn.map((g) => (
                <li key={g.id}>{g.title}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-ink-500">Нигде — файл можно удалить</div>
          )}
        </div>

        <div className="flex gap-2">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {saved ? 'Сохранено' : 'Сохранить'}
          </button>
          <a className="btn-ghost" href={media.url} target="_blank" rel="noreferrer">
            Открыть оригинал
          </a>
          <button className="btn-danger ml-auto" disabled={!!media.usedIn?.length} onClick={onDelete}>
            <Trash2 size={14} />
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className="text-ink-200">{value}</dd>
    </div>
  );
}
