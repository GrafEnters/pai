import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Lock } from 'lucide-react';
import { api, errText } from '../api';

/** Ключ настройки в БД. Должен совпадать с SETTING_KEYS.publicAccess на backend. */
const PUBLIC_ACCESS = 'access.public';

export function Settings() {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/admin/settings')).data,
  });

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => (await api.put('/admin/settings', patch)).data,
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e) => setError(errText(e)),
  });

  if (isLoading || !data) return <div className="p-8 text-ink-500">Загрузка…</div>;

  const open = data[PUBLIC_ACCESS] === true;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-white">Настройки</h1>

      <div className="card max-w-2xl p-4">
        <div className="flex flex-wrap items-start gap-3">
          {open ? (
            <Globe size={18} className="mt-0.5 shrink-0 text-amber-300" />
          ) : (
            <Lock size={18} className="mt-0.5 shrink-0 text-brand-300" />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-medium text-white">Публичный доступ без регистрации</div>
            <p className="mt-1 text-sm text-ink-500">
              {open
                ? 'Сейчас открыт: гайды читает любой, кто знает адрес сайта, — без входа и приглашения.'
                : 'Сейчас закрыт: сайт пускает только тех, кто вошёл. Гостя разворачивает на страницу входа.'}
            </p>
          </div>

          <Toggle
            checked={open}
            disabled={save.isPending}
            label="Публичный доступ без регистрации"
            onChange={(v) => save.mutate({ [PUBLIC_ACCESS]: v })}
          />
        </div>

        <ul className="mt-4 space-y-1 border-t border-ink-800 pt-3 text-xs text-ink-600">
          <li>Открытым становится только чтение гайдов, разделов и поиска.</li>
          <li>Личное — прогресс, «полезно?», обязательные гайды — по-прежнему требует входа.</li>
          <li>Админка не открывается никогда: она за отдельной проверкой роли.</li>
          <li>Переключение доходит до сайта за десять секунд — столько живёт кэш ответа.</li>
          <li>Индексацию поисковиками это не включает: заголовок noindex стоит отдельно.</li>
        </ul>
      </div>

      {error && <div className="mt-3 max-w-2xl rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-500' : 'bg-ink-700'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
