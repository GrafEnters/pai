import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2 } from 'lucide-react';
import { api, errText, type Role, type TeamRole } from '../api';
import { TEAM_ROLE_LABEL } from './Users';

interface Invite {
  id: number;
  code: string;
  role: Role;
  teamRole: TeamRole;
  note: string | null;
  usedById: number | null;
  usedByName: string | null;
  usedAt: string | null;
  /** Сколько человек зашло по ссылке — она многоразовая */
  usedCount: number;
  expiresAt: string;
  createdAt: string;
  createdByName: string | null;
  isExpired: boolean;
  url: string;
}

export function Invites() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    role: 'VIEWER' as Role,
    teamRole: 'OTHER' as TeamRole,
    note: '',
    expiresInDays: 14,
    count: 1,
  });
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['invites'],
    queryFn: async () => (await api.get<Invite[]>('/admin/invites')).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/admin/invites', { ...form, note: form.note || undefined })).data,
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/admin/invites/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invites'] }),
    onError: (e) => setError(errText(e)),
  });

  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-white">Пригласительные ссылки</h1>
      <p className="mb-4 mt-1 text-sm text-ink-500">
        Ссылку можно отправить хоть одному человеку, хоть всей команде: перешедший сразу попадает внутрь с указанным
        доступом, ничего не заполняя. Работает, пока не истёк срок.
      </p>

      <div className="card mb-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div>
            <label className="label">Доступ</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="VIEWER">Читатель</option>
              <option value="EDITOR">Редактор</option>
              <option value="ADMIN">Администратор</option>
            </select>
          </div>
          <div>
            <label className="label">В команде</label>
            <select
              className="input"
              value={form.teamRole}
              onChange={(e) => setForm({ ...form, teamRole: e.target.value as TeamRole })}
            >
              {(Object.keys(TEAM_ROLE_LABEL) as TeamRole[]).map((r) => (
                <option key={r} value={r}>
                  {TEAM_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Заметка</label>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          <div>
            <label className="label">Дней жизни</label>
            <input
              className="input"
              type="number"
              min={1}
              max={90}
              value={form.expiresInDays}
              onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="label">Сколько ссылок</label>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              value={form.count}
              onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
            />
          </div>
        </div>
        <button className="btn-primary mt-4" disabled={create.isPending} onClick={() => create.mutate()}>
          Сгенерировать
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="table-th">Ссылка</th>
              <th className="table-th">Доступ</th>
              <th className="table-th">В команде</th>
              <th className="table-th">Заметка</th>
              <th className="table-th">Переходов</th>
              <th className="table-th">Статус</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="table-td text-ink-500" colSpan={7}>
                  Загрузка…
                </td>
              </tr>
            )}
            {invites.map((i) => (
              <tr key={i.id} className={i.isExpired ? 'opacity-50' : ''}>
                <td className="table-td">
                  <a
                    href={i.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block max-w-[320px] truncate font-mono text-xs text-brand-300 underline decoration-brand-300/40 hover:text-brand-200"
                    title={i.url}
                  >
                    {i.url}
                  </a>
                </td>
                <td className="table-td text-ink-400">{i.role}</td>
                <td className="table-td text-ink-400">{TEAM_ROLE_LABEL[i.teamRole]}</td>
                <td className="table-td text-ink-400">{i.note ?? '—'}</td>
                <td className="table-td text-ink-400" title={i.usedByName ? `Первым зашёл ${i.usedByName}` : undefined}>
                  {i.usedCount || '—'}
                </td>
                <td className="table-td">
                  {i.isExpired ? (
                    <span className="badge bg-ink-700 text-ink-400">Закрыта</span>
                  ) : (
                    <span className="badge bg-brand-500/15 text-brand-300">
                      Работает до {new Date(i.expiresAt).toLocaleDateString('ru')}
                    </span>
                  )}
                </td>
                <td className="table-td">
                  <div className="flex gap-1">
                    <button className="btn-ghost px-2" title="Скопировать ссылку" onClick={() => void copy(i.url, String(i.id))}>
                      <Copy size={14} />
                      {copied === String(i.id) ? 'Скопировано' : ''}
                    </button>
                    {!i.isExpired && (
                      <button
                        className="btn-ghost px-2"
                        title={i.usedCount ? 'Закрыть вход по ссылке' : 'Удалить ссылку'}
                        onClick={() => remove.mutate(i.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && invites.length === 0 && (
              <tr>
                <td className="table-td text-ink-500" colSpan={7}>
                  Ссылок пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
