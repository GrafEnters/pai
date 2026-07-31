import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errText, type Me, type Role, type TeamRole } from '../api';
import { useAuth } from '../auth';

const ROLES: Role[] = ['NONE', 'VIEWER', 'EDITOR', 'ADMIN'];
const TEAM_ROLES: TeamRole[] = ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'];

const ROLE_LABEL: Record<Role, string> = {
  NONE: 'Без доступа',
  VIEWER: 'Читатель',
  EDITOR: 'Редактор',
  ADMIN: 'Администратор',
};

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  BUYER: 'Байер',
  FARMER: 'Фармер',
  TECH: 'Тех',
  MEDIABUYER: 'Медиабайер',
  MANAGER: 'Менеджер',
  OTHER: 'Другое',
};

export function Users() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: async () => (await api.get<Me[]>('/admin/users', { params: { q: search || undefined } })).data,
  });

  const patch = useMutation({
    mutationFn: async ({ id, ...body }: { id: number } & Partial<Me>) =>
      (await api.patch(`/admin/users/${id}`, body)).data,
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-white">Пользователи</h1>
        <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Отмена' : 'Добавить'}
        </button>
      </div>

      <input
        className="input mb-4 max-w-sm"
        placeholder="Поиск по имени, логину, email, telegram…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {showCreate && <CreateUserForm onDone={() => setShowCreate(false)} />}

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="table-th">Имя</th>
              <th className="table-th">Логин</th>
              <th className="table-th">Telegram</th>
              <th className="table-th">Доступ</th>
              <th className="table-th">Роль в команде</th>
              <th className="table-th">Активен</th>
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
            {users.map((u) => (
              <tr key={u.id} className={u.isActive ? '' : 'opacity-50'}>
                <td className="table-td">
                  {u.name}
                  {u.id === me?.id && <span className="ml-2 text-xs text-ink-500">(вы)</span>}
                </td>
                <td className="table-td text-ink-400">{u.login ?? '—'}</td>
                <td className="table-td text-ink-400">{u.telegramUsername ? '@' + u.telegramUsername : '—'}</td>
                <td className="table-td">
                  <select
                    className="input py-1"
                    value={u.role}
                    onChange={(e) => patch.mutate({ id: u.id, role: e.target.value as Role })}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="table-td">
                  <select
                    className="input py-1"
                    value={u.teamRole}
                    onChange={(e) => patch.mutate({ id: u.id, teamRole: e.target.value as TeamRole })}
                  >
                    {TEAM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {TEAM_ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="table-td">
                  <button
                    className={u.isActive ? 'btn-ghost' : 'btn-primary'}
                    onClick={() => patch.mutate({ id: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? 'Отключить' : 'Включить'}
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td className="table-td text-ink-500" colSpan={6}>
                  Никого не нашлось
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    login: '',
    password: '',
    email: '',
    telegramUsername: '',
    role: 'VIEWER' as Role,
    teamRole: 'OTHER' as TeamRole,
  });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post('/admin/users', {
          ...form,
          email: form.email || undefined,
          telegramUsername: form.telegramUsername || undefined,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      onDone();
    },
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="card mb-4 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Имя</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Логин</label>
          <input className="input" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </div>
        <div>
          <label className="label">Пароль (минимум 8)</label>
          <input
            className="input"
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Email (необязательно)</label>
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Telegram (без @)</label>
          <input
            className="input"
            value={form.telegramUsername}
            onChange={(e) => setForm({ ...form, telegramUsername: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Доступ</label>
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">В команде</label>
            <select
              className="input"
              value={form.teamRole}
              onChange={(e) => setForm({ ...form, teamRole: e.target.value as TeamRole })}
            >
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {TEAM_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="mt-4 flex gap-2">
        <button
          className="btn-primary"
          disabled={create.isPending || !form.name || form.login.length < 3 || form.password.length < 8}
          onClick={() => create.mutate()}
        >
          Создать
        </button>
        <button className="btn-ghost" onClick={onDone}>
          Отмена
        </button>
      </div>
    </div>
  );
}
