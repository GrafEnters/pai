import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface AuditRow {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  diff: unknown;
  ip: string | null;
  ts: string;
}

export function Audit() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', action, entity, page],
    queryFn: async () =>
      (
        await api.get<{ items: AuditRow[]; total: number; page: number; limit: number }>('/admin/audit', {
          params: { action: action || undefined, entity: entity || undefined, page, limit: 50 },
        })
      ).data,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-white">Аудит-лог</h1>

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Действие, например guide.publish"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        />
        <input
          className="input max-w-xs"
          placeholder="Сущность: User, Guide, Media…"
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="table-th">Когда</th>
              <th className="table-th">Кто</th>
              <th className="table-th">Действие</th>
              <th className="table-th">Объект</th>
              <th className="table-th">Что изменилось</th>
              <th className="table-th">IP</th>
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
            {data?.items.map((r) => (
              <tr key={r.id}>
                <td className="table-td whitespace-nowrap text-ink-400">
                  {new Date(r.ts).toLocaleString('ru')}
                </td>
                <td className="table-td">{r.userName ?? (r.userId ? `#${r.userId}` : 'система')}</td>
                <td className="table-td font-mono text-xs text-brand-300">{r.action}</td>
                <td className="table-td text-ink-400">
                  {r.entity}
                  {r.entityId ? ` #${r.entityId}` : ''}
                </td>
                <td className="table-td max-w-md">
                  {r.diff ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs text-ink-400">
                      {JSON.stringify(r.diff)}
                    </pre>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="table-td text-ink-500">{r.ip ?? '—'}</td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr>
                <td className="table-td text-ink-500" colSpan={6}>
                  Записей нет
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
