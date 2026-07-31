import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, History, Lock, Send } from 'lucide-react';
import DiffMatchPatch from 'diff-match-patch';
import {
  api,
  errText,
  type Category,
  type GuideFull,
  type GuideLevel,
  type Media,
  type Tag,
  type TeamRole,
} from '../api';
import { Editor } from '../editor/Editor';
import { GuidePicker, MediaPicker, type PickerKind } from '../components/MediaPicker';
import { TEAM_ROLE_LABEL } from './Users';

const LEVEL_LABEL: Record<GuideLevel, string> = {
  BEGINNER: 'Новичок',
  INTERMEDIATE: 'Средний',
  ADVANCED: 'Продвинутый',
};

const AUTOSAVE_MS = 5000;

export function GuideEditor() {
  const { id } = useParams<{ id: string }>();
  const guideId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<{ kind: PickerKind; resolve: (m: Media | Media[] | null) => void } | null>(null);
  const [guidePicker, setGuidePicker] = useState<{ resolve: (id: number | null) => void } | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: guide, isLoading } = useQuery({
    queryKey: ['guide', guideId],
    queryFn: async () => (await api.get<GuideFull>(`/admin/guides/${guideId}`)).data,
    enabled: Number.isFinite(guideId),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/admin/categories')).data,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => (await api.get<Tag[]>('/admin/tags')).data,
  });

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.patch(`/admin/guides/${guideId}`, body)).data,
    onSuccess: () => {
      setSavedAt(new Date());
      setError('');
      dirty.current = false;
    },
    onError: (e) => setError(errText(e)),
  });

  const publish = useMutation({
    mutationFn: async (changeNote: string) =>
      (await api.post(`/admin/guides/${guideId}/publish`, { changeNote: changeNote || undefined })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guide', guideId] });
      void qc.invalidateQueries({ queryKey: ['guides'] });
      setError('');
    },
    onError: (e) => setError(errText(e)),
  });

  const statusAction = useMutation({
    mutationFn: async (action: 'unpublish' | 'archive' | 'review') =>
      (await api.post(`/admin/guides/${guideId}/${action}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guide', guideId] }),
    onError: (e) => setError(errText(e)),
  });

  // Мягкая блокировка: продлеваем, пока страница открыта
  useEffect(() => {
    if (!Number.isFinite(guideId)) return;
    const ping = () => void api.post(`/admin/guides/${guideId}/lock`).catch(() => {});
    ping();
    const t = setInterval(ping, 60_000);
    return () => clearInterval(t);
  }, [guideId]);

  /** Автосейв каждые 5 секунд после последней правки (§4.2). */
  const onChange = useCallback(
    (doc: unknown) => {
      setDraft(doc);
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => patch.mutate({ contentDraft: doc }), AUTOSAVE_MS);
    },
    [patch],
  );

  // Сохраняем на уход со страницы — иначе последние правки теряются
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const pickMedia = useCallback(
    (kind: PickerKind) => new Promise<Media | Media[] | null>((resolve) => setPicker({ kind, resolve })),
    [],
  );
  const pickGuide = useCallback(() => new Promise<number | null>((resolve) => setGuidePicker({ resolve })), []);

  if (isLoading || !guide) return <div className="p-8 text-ink-500">Загрузка…</div>;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-ink-800 px-6 py-3">
        <Link to="/guides" className="btn-ghost px-2">
          <ArrowLeft size={16} />
        </Link>
        <input
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-white outline-none"
          defaultValue={guide.title}
          onBlur={(e) => e.target.value !== guide.title && patch.mutate({ title: e.target.value })}
        />

        <span className="whitespace-nowrap text-xs text-ink-500">
          {patch.isPending ? 'Сохраняю…' : savedAt ? `Сохранено ${savedAt.toLocaleTimeString('ru').slice(0, 5)}` : ''}
        </span>

        <button className="btn-ghost" onClick={() => setShowVersions(true)}>
          <History size={15} />
          v{guide.version}
        </button>

        <a
          className="btn-ghost"
          href={`${import.meta.env.VITE_WEB_URL ?? 'http://localhost:3000'}/g/${guide.slug}?preview=1`}
          target="_blank"
          rel="noreferrer"
        >
          <Eye size={15} />
          Предпросмотр
        </a>

        {guide.status === 'PUBLISHED' ? (
          <button className="btn-ghost" onClick={() => statusAction.mutate('unpublish')}>
            Снять с публикации
          </button>
        ) : (
          <button className="btn-ghost" onClick={() => statusAction.mutate('archive')}>
            В архив
          </button>
        )}

        <button
          className="btn-primary"
          disabled={publish.isPending}
          onClick={() => {
            const note = window.prompt('Что изменилось? (попадёт в историю версий)', '');
            if (note === null) return;
            // Дожимаем несохранённый черновик перед публикацией
            if (draft) patch.mutate({ contentDraft: draft });
            publish.mutate(note);
          }}
        >
          <Send size={15} />
          Опубликовать
        </button>
      </header>

      {guide.lockedBy && (
        <div className="flex items-center gap-2 bg-amber-500/10 px-6 py-2 text-sm text-amber-300">
          <Lock size={14} />
          Гайд открыт другим редактором: {guide.lockedBy.name}. Правьте осторожно — правки могут перезаписать друг друга.
        </div>
      )}

      {error && <div className="bg-red-500/10 px-6 py-2 text-sm text-red-300">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-4">
          <Editor
            initialContent={guide.contentDraft ?? guide.content}
            onChange={onChange}
            onPickMedia={pickMedia}
            onPickGuide={pickGuide}
          />
        </div>

        <Sidebar guide={guide} categories={categories} tags={tags} onPatch={(b) => patch.mutate(b)} onPickCover={pickMedia} />
      </div>

      {picker && (
        <MediaPicker
          kind={picker.kind}
          onPick={(m) => {
            picker.resolve(m);
            setPicker(null);
          }}
        />
      )}
      {guidePicker && (
        <GuidePicker
          excludeId={guideId}
          onPick={(gid) => {
            guidePicker.resolve(gid);
            setGuidePicker(null);
          }}
        />
      )}
      {showVersions && (
        <VersionsModal guideId={guideId} onClose={() => setShowVersions(false)} onReverted={() => navigate(0)} />
      )}
    </div>
  );
}

function Sidebar({
  guide,
  categories,
  tags,
  onPatch,
  onPickCover,
}: {
  guide: GuideFull;
  categories: Category[];
  tags: Tag[];
  onPatch: (body: Record<string, unknown>) => void;
  onPickCover: (kind: PickerKind) => Promise<Media | Media[] | null>;
}) {
  const selectedTagIds = new Set((guide.tags ?? []).map((t) => t.id));

  return (
    <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-l border-ink-800 p-4">
      <div>
        <label className="label">Краткое описание</label>
        <textarea
          className="input h-20 resize-none"
          defaultValue={guide.summary ?? ''}
          placeholder="Одна-две строки для карточки"
          onBlur={(e) => onPatch({ summary: e.target.value || null })}
        />
      </div>

      <div>
        <label className="label">Категория</label>
        <select className="input" defaultValue={guide.categoryId} onChange={(e) => onPatch({ categoryId: Number(e.target.value) })}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Уровень</label>
        <select className="input" defaultValue={guide.level} onChange={(e) => onPatch({ level: e.target.value })}>
          {(Object.keys(LEVEL_LABEL) as GuideLevel[]).map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label">Теги</label>
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => {
            const on = selectedTagIds.has(t.id);
            return (
              <button
                key={t.id}
                className={`badge ${on ? 'bg-brand-500/20 text-brand-300' : 'bg-ink-800 text-ink-400'}`}
                onClick={() => {
                  const next = on
                    ? [...selectedTagIds].filter((x) => x !== t.id)
                    : [...selectedTagIds, t.id];
                  onPatch({ tagIds: next });
                }}
              >
                {t.title}
              </button>
            );
          })}
          {tags.length === 0 && <span className="text-xs text-ink-600">Теги создаются в разделе «Структура»</span>}
        </div>
      </div>

      <div>
        <label className="label">Обложка</label>
        {guide.cover ? (
          <div className="relative">
            <img src={guide.cover.url} alt="" className="w-full rounded-lg" />
            <button className="btn-ghost mt-1 w-full text-xs" onClick={() => onPatch({ coverId: null })}>
              Убрать
            </button>
          </div>
        ) : (
          <button
            className="btn-ghost w-full text-xs"
            onClick={async () => {
              const m = (await onPickCover('IMAGE')) as Media | null;
              if (m) onPatch({ coverId: m.id });
            }}
          >
            Выбрать обложку
          </button>
        )}
      </div>

      <div>
        <label className="label">Обязателен для ролей</label>
        <div className="space-y-1">
          {(Object.keys(TEAM_ROLE_LABEL) as TeamRole[]).map((r) => {
            const on = (guide.requiredForRoles ?? []).includes(r);
            return (
              <label key={r} className="flex items-center gap-2 text-sm text-ink-300">
                <input
                  type="checkbox"
                  className="accent-brand-500"
                  checked={on}
                  onChange={() => {
                    const next = on
                      ? (guide.requiredForRoles ?? []).filter((x) => x !== r)
                      : [...(guide.requiredForRoles ?? []), r];
                    onPatch({ requiredForRoles: next });
                  }}
                />
                {TEAM_ROLE_LABEL[r]}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="label">Проверить актуальность</label>
        <div className="flex gap-1">
          {[30, 90, 180].map((days) => (
            <button
              key={days}
              className="btn-ghost flex-1 px-1 text-xs"
              onClick={() => onPatch({ reviewAt: new Date(Date.now() + days * 86400_000).toISOString() })}
            >
              {days} дн
            </button>
          ))}
        </div>
        <div className="mt-1 text-xs text-ink-600">
          {guide.reviewAt ? `Напомнить ${new Date(guide.reviewAt).toLocaleDateString('ru')}` : 'Не задано'}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-300">
        <input
          type="checkbox"
          className="accent-brand-500"
          defaultChecked={guide.isPinned}
          onChange={(e) => onPatch({ isPinned: e.target.checked })}
        />
        Закрепить на главной
      </label>

      <div className="border-t border-ink-800 pt-3 text-xs text-ink-600">
        <div>Адрес: /g/{guide.slug}</div>
        <div>Время чтения: ~{Math.round((guide.readingTimeSec ?? 0) / 60)} мин</div>
        <div>Автор: {guide.author?.name ?? '—'}</div>
      </div>
    </aside>
  );
}

interface VersionRow {
  id: number;
  version: number;
  title: string;
  changeNote: string | null;
  createdAt: string;
  changedBy: { id: number; name: string };
}

function VersionsModal({
  guideId,
  onClose,
  onReverted,
}: {
  guideId: number;
  onClose: () => void;
  onReverted: () => void;
}) {
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null);

  const { data: versions = [] } = useQuery({
    queryKey: ['guide-versions', guideId],
    queryFn: async () => (await api.get<VersionRow[]>(`/admin/guides/${guideId}/versions`)).data,
  });

  const revert = useMutation({
    mutationFn: async (v: number) => (await api.post(`/admin/guides/${guideId}/revert/${v}`)).data,
    onSuccess: onReverted,
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="card flex max-h-[80vh] w-full max-w-3xl flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-medium text-white">История версий</h2>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-th">Версия</th>
                <th className="table-th">Когда</th>
                <th className="table-th">Кто</th>
                <th className="table-th">Что изменилось</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v, i) => (
                <tr key={v.id}>
                  <td className="table-td">v{v.version}</td>
                  <td className="table-td whitespace-nowrap text-ink-500">
                    {new Date(v.createdAt).toLocaleString('ru')}
                  </td>
                  <td className="table-td text-ink-400">{v.changedBy.name}</td>
                  <td className="table-td text-ink-400">{v.changeNote ?? '—'}</td>
                  <td className="table-td">
                    <div className="flex gap-1">
                      {versions[i + 1] && (
                        <button
                          className="btn-ghost px-2 text-xs"
                          onClick={() => setCompare({ a: versions[i + 1]!.version, b: v.version })}
                        >
                          Сравнить
                        </button>
                      )}
                      <button className="btn-ghost px-2 text-xs" onClick={() => revert.mutate(v.version)}>
                        Откатить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr>
                  <td className="table-td text-ink-500" colSpan={5}>
                    Гайд ещё ни разу не публиковался
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {compare && <DiffView guideId={guideId} a={compare.a} b={compare.b} onClose={() => setCompare(null)} />}
      </div>
    </div>
  );
}

function DiffView({ guideId, a, b, onClose }: { guideId: number; a: number; b: number; onClose: () => void }) {
  const { data: verA } = useQuery({
    queryKey: ['guide-version', guideId, a],
    queryFn: async () => (await api.get<{ plainText: string }>(`/admin/guides/${guideId}/versions/${a}`)).data,
  });
  const { data: verB } = useQuery({
    queryKey: ['guide-version', guideId, b],
    queryFn: async () => (await api.get<{ plainText: string }>(`/admin/guides/${guideId}/versions/${b}`)).data,
  });

  if (!verA || !verB) return <div className="mt-3 text-sm text-ink-500">Готовлю сравнение…</div>;

  // Сравниваем по плоскому тексту: структурный diff TipTap-документа
  // нечитаем человеком, а «что изменилось в тексте» — ровно то, что нужно
  const dmp = new DiffMatchPatch();
  const diffs = dmp.diff_main(verA.plainText, verB.plainText);
  dmp.diff_cleanupSemantic(diffs);

  return (
    <div className="mt-3 border-t border-ink-800 pt-3">
      <div className="mb-2 flex items-center justify-between text-sm text-ink-400">
        <span>
          Сравнение v{a} → v{b}
        </span>
        <button className="btn-ghost px-2 text-xs" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-3 text-sm leading-relaxed">
        {diffs.map(([op, text], i) => (
          <span
            key={i}
            className={op === 1 ? 'bg-green-500/20 text-green-200' : op === -1 ? 'bg-red-500/20 text-red-200 line-through' : 'text-ink-400'}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
