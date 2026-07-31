import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { api, type TeamRole } from '../api';
import { TEAM_ROLE_LABEL } from './Users';

type Tab = 'overview' | 'guides' | 'videos' | 'search' | 'stale' | 'users';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'guides', label: 'Гайды' },
  { id: 'videos', label: 'Видео' },
  { id: 'search', label: 'Поиск' },
  { id: 'stale', label: 'Мёртвое и протухшее' },
  { id: 'users', label: 'Люди' },
];

const RANGES = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
];

const CHART_AXIS = { stroke: '#64748b', fontSize: 11 };
const TOOLTIP_STYLE = {
  contentStyle: { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#cbd5e1' },
};

export function Stats() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - days * 86400_000).toISOString();

  const rollup = useMutation({
    mutationFn: async () => (await api.post('/admin/stats/rollup')).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['stats'] }),
  });

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Статистика</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-ink-800 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-md px-3 py-1 text-sm ${
                  days === r.days ? 'bg-brand-500/15 text-brand-300' : 'text-ink-400 hover:text-ink-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button className="btn-ghost" disabled={rollup.isPending} onClick={() => rollup.mutate()} title="Пересчитать агрегаты">
            <RefreshCw size={14} className={rollup.isPending ? 'animate-spin' : ''} />
            Пересчитать
          </button>
          <a className="btn-ghost" href={`${import.meta.env.VITE_API_URL}/api/admin/stats/export?format=xlsx&from=${from}`}>
            <Download size={14} />
            XLSX
          </a>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-ink-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t.id ? 'border-brand-400 text-brand-300' : 'border-transparent text-ink-400 hover:text-ink-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview from={from} />}
      {tab === 'guides' && <GuidesTab from={from} />}
      {tab === 'videos' && <VideosTab from={from} />}
      {tab === 'search' && <SearchTab from={from} />}
      {tab === 'stale' && <StaleTab />}
      {tab === 'users' && <UsersTab from={from} />}
    </div>
  );
}

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-ink-600">{hint}</div>}
    </div>
  );
}

function Overview({ from }: { from: string }) {
  const { data } = useQuery({
    queryKey: ['stats', 'overview', from],
    queryFn: async () => (await api.get('/admin/stats/overview', { params: { from } })).data,
  });
  if (!data) return <div className="text-ink-500">Загрузка…</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Card label="DAU" value={data.dau} hint="уникальных за сутки" />
        <Card label="WAU" value={data.wau} hint="за неделю" />
        <Card label="MAU" value={data.mau} hint="за месяц" />
        <Card label="Сессий" value={data.sessions} />
        <Card label="Гайдов" value={`${data.totals.published}/${data.totals.guides}`} hint="опубликовано / всего" />
        <Card label="Медиа" value={data.totals.media} />
        <Card label="Людей" value={data.totals.users} />
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">Открытия и уникальные посетители по дням</h2>
        {data.byDay.length ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="views" name="открытий" stroke="#8b5cf6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="visitors" name="уникальных" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">Топ-10 гайдов</h2>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-th">Гайд</th>
              <th className="table-th">Открытий</th>
              <th className="table-th">Дочитали</th>
            </tr>
          </thead>
          <tbody>
            {data.topGuides.map((g: { guideId: number; title: string; views: number; reads: number }) => (
              <tr key={g.guideId}>
                <td className="table-td">{g.title}</td>
                <td className="table-td">{g.views}</td>
                <td className="table-td text-ink-400">{g.reads}</td>
              </tr>
            ))}
            {!data.topGuides.length && (
              <tr>
                <td className="table-td text-ink-500" colSpan={3}>
                  Данных пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface GuideRow {
  guideId: number;
  title: string;
  category: string;
  views: number;
  uniqueVisitors: number;
  reads: number;
  readRate: number;
  avgActiveSec: number;
  scroll50: number;
  scroll100: number;
}

function GuidesTab({ from }: { from: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const { data = [] } = useQuery({
    queryKey: ['stats', 'guides', from],
    queryFn: async () => (await api.get<GuideRow[]>('/admin/stats/guides', { params: { from } })).data,
  });

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr>
              <th className="table-th">Гайд</th>
              <th className="table-th">Категория</th>
              <th className="table-th">Открытий</th>
              <th className="table-th">Уникальных</th>
              <th className="table-th">Дочитали</th>
              <th className="table-th">% дочитывания</th>
              <th className="table-th">Ср. время</th>
            </tr>
          </thead>
          <tbody>
            {data.map((g) => (
              <tr
                key={g.guideId}
                onClick={() => setSelected(selected === g.guideId ? null : g.guideId)}
                className="cursor-pointer hover:bg-ink-800/50"
              >
                <td className="table-td">{g.title}</td>
                <td className="table-td text-ink-500">{g.category}</td>
                <td className="table-td">{g.views}</td>
                <td className="table-td text-ink-400">{g.uniqueVisitors}</td>
                <td className="table-td">{g.reads}</td>
                <td className="table-td">
                  <span className={g.readRate >= 60 ? 'text-green-400' : g.readRate >= 30 ? 'text-amber-400' : 'text-ink-500'}>
                    {g.readRate}%
                  </span>
                </td>
                <td className="table-td text-ink-400">{g.avgActiveSec} с</td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td className="table-td text-ink-500" colSpan={7}>
                  Данных пока нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selected && <GuideDetail guideId={selected} from={from} />}
    </div>
  );
}

function GuideDetail({ guideId, from }: { guideId: number; from: string }) {
  const { data } = useQuery({
    queryKey: ['stats', 'guide', guideId, from],
    queryFn: async () => (await api.get(`/admin/stats/guides/${guideId}`, { params: { from } })).data,
  });
  if (!data) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">
          Профиль скролла — видно, на каком месте бросают
        </h2>
        {data.scrollProfile.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.scrollProfile}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="depth" unit="%" {...CHART_AXIS} />
              <YAxis {...CHART_AXIS} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="count" name="дошли" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty />
        )}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">
          Обратная связь · 👍 {data.helpful} · 👎 {data.notHelpful}
        </h2>
        <div className="max-h-52 space-y-2 overflow-y-auto">
          {data.feedback.map((f: { id: number; helpful: boolean; comment: string | null; user: { name: string } }) => (
            <div key={f.id} className="rounded-lg bg-ink-950 p-2 text-sm">
              <span className={f.helpful ? 'text-green-400' : 'text-red-400'}>{f.helpful ? '👍' : '👎'}</span>{' '}
              <span className="text-ink-400">{f.user.name}</span>
              {f.comment && <div className="mt-1 text-ink-300">{f.comment}</div>}
            </div>
          ))}
          {!data.feedback.length && <Empty />}
        </div>
      </div>
    </div>
  );
}

function VideosTab({ from }: { from: string }) {
  const { data } = useQuery({
    queryKey: ['stats', 'videos', from],
    queryFn: async () => (await api.get('/admin/stats/videos', { params: { from } })).data,
  });
  if (!data) return <div className="text-ink-500">Загрузка…</div>;

  return (
    <div className="space-y-5">
      {/* Две метрики, на которых основано решение такта 2 этапа 7 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Часов видео в библиотеке" value={data.library.hours} hint="триггер выбора HLS/Bunny" />
        <Card label="ГБ роздано за период" value={data.gbServed} hint="оценка по запускам" />
        <Card label="Видеофайлов" value={data.library.count} />
        <Card label="ГБ хранится" value={data.library.gbStored} />
      </div>

      <div className="card overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">Воронка досмотра</h2>
        <table className="w-full min-w-[700px]">
          <thead>
            <tr>
              <th className="table-th">Видео</th>
              <th className="table-th">Запусков</th>
              <th className="table-th">25%</th>
              <th className="table-th">50%</th>
              <th className="table-th">75%</th>
              <th className="table-th">95%</th>
              <th className="table-th">Досмотрели</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map(
              (v: {
                mediaId: number;
                originalName: string;
                plays: number;
                funnel: { p25: number; p50: number; p75: number; p95: number };
                completes: number;
              }) => (
                <tr key={v.mediaId}>
                  <td className="table-td">{v.originalName}</td>
                  <td className="table-td">{v.plays}</td>
                  <td className="table-td text-ink-400">{v.funnel.p25}</td>
                  <td className="table-td text-ink-400">{v.funnel.p50}</td>
                  <td className="table-td text-ink-400">{v.funnel.p75}</td>
                  <td className="table-td text-ink-400">{v.funnel.p95}</td>
                  <td className="table-td text-green-400">{v.completes}</td>
                </tr>
              ),
            )}
            {!data.items.length && (
              <tr>
                <td className="table-td text-ink-500" colSpan={7}>
                  Видео ещё не смотрели
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SearchTab({ from }: { from: string }) {
  const { data } = useQuery({
    queryKey: ['stats', 'search', from],
    queryFn: async () => (await api.get('/admin/stats/search', { params: { from } })).data,
  });
  if (!data) return <div className="text-ink-500">Загрузка…</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4">
        <h2 className="mb-3 text-sm font-medium text-ink-300">Топ-запросы</h2>
        <QueryList items={data.top} showResults />
      </div>
      <div className="card p-4">
        <h2 className="mb-1 text-sm font-medium text-ink-300">Запросы без результатов</h2>
        <p className="mb-3 text-xs text-ink-600">Готовый список того, какие гайды писать следующими.</p>
        <QueryList items={data.empty} />
      </div>
    </div>
  );
}

function QueryList({
  items,
  showResults = false,
}: {
  items: { q: string; count: number; avgResults?: number }[];
  showResults?: boolean;
}) {
  if (!items.length) return <Empty />;
  return (
    <ul className="space-y-1">
      {items.map((r) => (
        <li key={r.q} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate text-ink-200">{r.q}</span>
          {showResults && <span className="text-xs text-ink-600">~{r.avgResults} рез.</span>}
          <span className="text-ink-500">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

function StaleTab() {
  const [days, setDays] = useState(60);
  const { data } = useQuery({
    queryKey: ['stats', 'stale', days],
    queryFn: async () => (await api.get('/admin/stats/stale', { params: { days } })).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-ink-400">
        Окно наблюдения:
        {[30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded px-2 py-1 ${days === d ? 'bg-brand-500/15 text-brand-300' : 'hover:text-ink-200'}`}
          >
            {d} дней
          </button>
        ))}
      </div>

      <div className="card p-4">
        <h2 className="mb-1 text-sm font-medium text-ink-300">Мёртвый контент</h2>
        <p className="mb-3 text-xs text-ink-600">
          Ни одного открытия за {days} дней — кандидаты на удаление или переработку.
        </p>
        <List items={data?.dead ?? []} empty="Все гайды читают — мёртвого контента нет" />
      </div>

      <div className="card p-4">
        <h2 className="mb-1 text-sm font-medium text-ink-300">Протухшее</h2>
        <p className="mb-3 text-xs text-ink-600">
          Истёк срок проверки актуальности. Для методичек по FB это критично: правила площадки меняются постоянно.
        </p>
        <List
          items={(data?.expired ?? []).map((g: { id: number; title: string; slug: string; reviewAt: string }) => ({
            ...g,
            note: `проверить с ${new Date(g.reviewAt).toLocaleDateString('ru')}`,
          }))}
          empty="Всё актуально"
        />
      </div>
    </div>
  );
}

function List({
  items,
  empty,
}: {
  items: { id: number; title: string; slug: string; views?: number; note?: string }[];
  empty: string;
}) {
  if (!items.length) return <div className="text-sm text-ink-600">{empty}</div>;
  return (
    <ul className="space-y-1">
      {items.map((g) => (
        <li key={g.id} className="flex items-center gap-2 text-sm">
          <a href={`/guides/${g.id}`} className="flex-1 truncate text-ink-200 hover:text-brand-300">
            {g.title}
          </a>
          <span className="text-xs text-ink-600">{g.note ?? `${g.views ?? 0} открытий`}</span>
        </li>
      ))}
    </ul>
  );
}

function UsersTab({ from }: { from: string }) {
  const { data = [] } = useQuery({
    queryKey: ['stats', 'users', from],
    queryFn: async () =>
      (
        await api.get<
          Array<{
            id: number;
            name: string;
            teamRole: TeamRole;
            opened: number;
            read: number;
            activeMin: number;
            requiredTotal: number;
            requiredRead: number;
            lastSeenAt: string | null;
          }>
        >('/admin/stats/users', { params: { from } })
      ).data,
  });

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead>
          <tr>
            <th className="table-th">Человек</th>
            <th className="table-th">Роль</th>
            <th className="table-th">Открыл</th>
            <th className="table-th">Дочитал</th>
            <th className="table-th">Время</th>
            <th className="table-th">Покрытие обязательных</th>
            <th className="table-th">Был</th>
          </tr>
        </thead>
        <tbody>
          {data.map((u) => {
            const pct = u.requiredTotal ? Math.round((u.requiredRead / u.requiredTotal) * 100) : null;
            return (
              <tr key={u.id}>
                <td className="table-td">{u.name}</td>
                <td className="table-td text-ink-500">{TEAM_ROLE_LABEL[u.teamRole]}</td>
                <td className="table-td">{u.opened}</td>
                <td className="table-td">{u.read}</td>
                <td className="table-td text-ink-400">{u.activeMin} мин</td>
                <td className="table-td">
                  {pct === null ? (
                    <span className="text-ink-600">—</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded bg-ink-800">
                        <div className={pct === 100 ? 'h-full bg-green-500' : 'h-full bg-amber-500'} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={pct === 100 ? 'text-green-400' : 'text-amber-400'}>
                        {u.requiredRead}/{u.requiredTotal}
                      </span>
                    </div>
                  )}
                </td>
                <td className="table-td text-ink-500">
                  {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString('ru') : 'никогда'}
                </td>
              </tr>
            );
          })}
          {!data.length && (
            <tr>
              <td className="table-td text-ink-500" colSpan={7}>
                Данных пока нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Empty() {
  return <div className="py-6 text-center text-sm text-ink-600">Данных пока нет</div>;
}

// Cell импортируется ради типизации Recharts при будущих раскрасках столбцов
void Cell;
