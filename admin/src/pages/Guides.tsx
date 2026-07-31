import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pin, Plus } from 'lucide-react';
import { api, errText, type Category, type GuideListItem, type GuideStatus, type Paged } from '../api';

const STATUS_LABEL: Record<GuideStatus, string> = {
  DRAFT: 'Черновик',
  IN_REVIEW: 'На проверке',
  PUBLISHED: 'Опубликован',
  ARCHIVED: 'В архиве',
};

const STATUS_CLS: Record<GuideStatus, string> = {
  DRAFT: 'bg-ink-700 text-ink-300',
  IN_REVIEW: 'bg-amber-500/15 text-amber-300',
  PUBLISHED: 'bg-green-500/15 text-green-300',
  ARCHIVED: 'bg-ink-800 text-ink-500',
};

export function Guides() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<GuideStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['guides', status, search, page],
    queryFn: async () =>
      (
        await api.get<Paged<GuideListItem>>('/admin/guides', {
          params: { status: status || undefined, q: search || undefined, page, limit: 30 },
        })
      ).data,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/admin/categories')).data,
  });

  const duplicate = useMutation({
    mutationFn: async (id: number) => (await api.post<GuideListItem>(`/admin/guides/${id}/duplicate`)).data,
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: ['guides'] });
      navigate(`/guides/${g.id}`);
    },
    onError: (e) => setError(errText(e)),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-white">Гайды</h1>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={16} />
          Новый гайд
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-ink-800 p-0.5">
          {([['', 'Все'], ...Object.entries(STATUS_LABEL)] as [GuideStatus | '', string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                setStatus(v);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-sm ${
                status === v ? 'bg-brand-500/15 text-brand-300' : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="input max-w-xs"
          placeholder="Поиск по названию и тексту…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {showNew && <NewGuideForm categories={categories} onClose={() => setShowNew(false)} />}
      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="table-th">Название</th>
              <th className="table-th">Категория</th>
              <th className="table-th">Статус</th>
              <th className="table-th">Версия</th>
              <th className="table-th">Изменён</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="table-td text-ink-500" colSpan={6}>
                  Загрузка…
                </td>
              </tr>
            )}
            {data?.items.map((g) => (
              <tr key={g.id}>
                <td className="table-td">
                  <Link to={`/guides/${g.id}`} className="flex items-center gap-2 text-ink-100 hover:text-brand-300">
                    {g.isPinned && <Pin size={13} className="text-brand-400" />}
                    {g.title}
                  </Link>
                  {g.summary && <div className="mt-0.5 line-clamp-1 text-xs text-ink-600">{g.summary}</div>}
                </td>
                <td className="table-td text-ink-400">{g.category?.title ?? '—'}</td>
                <td className="table-td">
                  <span className={`badge ${STATUS_CLS[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                </td>
                <td className="table-td text-ink-500">v{g.version}</td>
                <td className="table-td whitespace-nowrap text-ink-500">
                  {new Date(g.updatedAt).toLocaleDateString('ru')}
                </td>
                <td className="table-td">
                  <button
                    className="btn-ghost px-2"
                    title="Дублировать"
                    onClick={() => duplicate.mutate(g.id)}
                  >
                    <Copy size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td className="table-td text-ink-500" colSpan={6}>
                  Гайдов пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
    </div>
  );
}

function NewGuideForm({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>(categories[0]?.id ?? '');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => (await api.post<GuideListItem>('/admin/guides', { title, categoryId })).data,
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: ['guides'] });
      navigate(`/guides/${g.id}`);
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="card mb-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Запуск первой кампании"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Категория</label>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      <div className="mt-4 flex gap-2">
        <button className="btn-primary" disabled={!title.trim() || !categoryId || create.isPending} onClick={() => create.mutate()}>
          Создать и открыть
        </button>
        <button className="btn-ghost" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>
  );
}
