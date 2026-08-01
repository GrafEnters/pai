import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Play, ShieldCheck } from 'lucide-react';
import { api, errText } from '../api';
import { humanSize } from '../lib/upload';

type BackupKind = 'DB' | 'CONTENT' | 'MEDIA' | 'FULL';
type BackupStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PARTIAL';

interface BackupRun {
  id: number;
  kind: BackupKind;
  status: BackupStatus;
  startedAt: string;
  finishedAt: string | null;
  filesUploaded: number;
  filesSkipped: number;
  bytesUploaded: string;
  manifestKey: string | null;
  error: string | null;
  log: string | null;
}

interface BackupState {
  transport: string;
  paths: { storage: string; backups: string };
  hoursSinceLastSuccess: number | null;
  stale: boolean;
  staleThresholdHours: number;
  objects: number;
  bytes: string;
  quota: { total: number; used: number } | null;
  runs: BackupRun[];
}

interface VerifyReport {
  manifest: { runId: number; finishedAt: string };
  objects: { total: number; verified: number; mismatched: string[]; missing: string[] };
  integrity: { guides: number; brokenMediaRefs: string[]; missingInStorage: string[] };
  elapsedSec: number;
}

const KIND_LABEL: Record<BackupKind, string> = {
  DB: 'База данных',
  CONTENT: 'Контент',
  MEDIA: 'Медиа',
  FULL: 'Полный',
};

const STATUS_CLS: Record<BackupStatus, string> = {
  RUNNING: 'bg-sky-500/15 text-sky-300',
  SUCCESS: 'bg-green-500/15 text-green-300',
  PARTIAL: 'bg-amber-500/15 text-amber-300',
  FAILED: 'bg-red-500/15 text-red-300',
};

export function Backups() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [openLog, setOpenLog] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => (await api.get<BackupState>('/admin/backups')).data,
    // Прогон идёт в фоне — подтягиваем состояние, пока страница открыта
    refetchInterval: 10_000,
  });

  const run = useMutation({
    mutationFn: async (kind: BackupKind) => (await api.post('/admin/backups/run', { kind })).data,
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const verify = useMutation({
    mutationFn: async () => (await api.post<VerifyReport>('/admin/backups/verify', {})).data,
    onSuccess: (r) => {
      setReport(r);
      setError('');
    },
    onError: (e) => setError(errText(e)),
  });

  const restoreMedia = useMutation({
    mutationFn: async () => (await api.post('/admin/backups/restore-media', {})).data,
    onSuccess: () => setError(''),
    onError: (e) => setError(errText(e)),
  });

  if (isLoading || !data) return <div className="p-8 text-ink-500">Загрузка…</div>;

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-white">Бэкапы</h1>

      {data.stale && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {data.hoursSinceLastSuccess === null
                ? 'Успешных бэкапов ещё не было'
                : `Последний успешный бэкап был ${Math.round(data.hoursSinceLastSuccess)} ч назад`}
            </div>
            <div className="mt-0.5 text-amber-300/80">
              Порог тревоги — {data.staleThresholdHours} ч. Запустите прогон кнопкой ниже и проверьте логи.
            </div>
          </div>
        </div>
      )}

      {/* Пути после разбора переменных. Лишний пробел или таб в значении
          переменной делает путь относительным, и файлы уезжают мимо
          постоянного диска — здесь это видно сразу. */}
      <div className="card mb-4 p-3 text-sm">
        <div className="mb-1 text-xs uppercase tracking-wide text-ink-600">Куда пишутся файлы</div>
        <PathRow label="Медиа" path={data.paths.storage} />
        <PathRow label="Бэкапы" path={data.paths.backups} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Транспорт" value={data.transport} />
        <Stat
          label="Последний успешный"
          value={data.hoursSinceLastSuccess === null ? 'никогда' : `${Math.round(data.hoursSinceLastSuccess)} ч назад`}
          accent={data.stale ? 'text-amber-400' : 'text-green-400'}
        />
        <Stat label="Объектов в бэкапе" value={String(data.objects)} />
        <Stat label="Объём" value={humanSize(data.bytes)} />
      </div>

      {data.quota && (
        <div className="mb-4 rounded-lg border border-ink-800 p-3">
          <div className="mb-1 flex justify-between text-xs text-ink-500">
            <span>Место на аккаунте</span>
            <span>
              {humanSize(data.quota.used)} из {humanSize(data.quota.total)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-ink-800">
            <div
              className={`h-full ${data.quota.used / data.quota.total > 0.85 ? 'bg-red-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.min(100, (data.quota.used / data.quota.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {(['FULL', 'DB', 'CONTENT', 'MEDIA'] as BackupKind[]).map((kind) => (
          <button key={kind} className="btn-ghost" disabled={run.isPending} onClick={() => run.mutate(kind)}>
            <Play size={14} />
            {KIND_LABEL[kind]}
          </button>
        ))}
        <button className="btn-primary ml-auto" disabled={verify.isPending} onClick={() => verify.mutate()}>
          <ShieldCheck size={15} />
          {verify.isPending ? 'Проверяю…' : 'Проверить целостность'}
        </button>
        <button className="btn-ghost" disabled={restoreMedia.isPending} onClick={() => restoreMedia.mutate()}>
          Вернуть недостающие медиафайлы
        </button>
      </div>

      <p className="mb-4 text-xs text-ink-600">
        Полное восстановление базы сознательно не выведено в интерфейс: операция разрушительная.
        В консоли: <code className="rounded bg-ink-800 px-1">npm run restore -- --latest --target=full --yes</code>
      </p>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      {report && (
        <div className="card mb-4 p-4">
          <div className="mb-2 flex items-center gap-2 font-medium text-white">
            {report.objects.mismatched.length + report.objects.missing.length + report.integrity.brokenMediaRefs.length ===
            0 ? (
              <>
                <CheckCircle2 size={18} className="text-green-400" />
                Бэкап целый
              </>
            ) : (
              <>
                <AlertTriangle size={18} className="text-amber-400" />
                Есть замечания
              </>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <Row label="Прогон" value={`#${report.manifest.runId}`} />
            <Row label="Объектов" value={`${report.objects.verified} из ${report.objects.total}`} />
            <Row label="Битых" value={String(report.objects.mismatched.length)} />
            <Row label="Отсутствуют" value={String(report.objects.missing.length)} />
            <Row label="Гайдов" value={String(report.integrity.guides)} />
            <Row label="Битых ссылок" value={String(report.integrity.brokenMediaRefs.length)} />
            <Row label="Нет файлов" value={String(report.integrity.missingInStorage.length)} />
            <Row label="Заняло" value={`${report.elapsedSec} с`} />
          </dl>
          {report.objects.mismatched.length > 0 && (
            <pre className="mt-2 overflow-x-auto rounded bg-ink-950 p-2 text-xs text-red-300">
              {report.objects.mismatched.slice(0, 20).join('\n')}
            </pre>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr>
              <th className="table-th">#</th>
              <th className="table-th">Вид</th>
              <th className="table-th">Статус</th>
              <th className="table-th">Начат</th>
              <th className="table-th">Загружено</th>
              <th className="table-th">Пропущено</th>
              <th className="table-th">Объём</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {data.runs.map((r) => (
              <>
                <tr key={r.id}>
                  <td className="table-td text-ink-500">{r.id}</td>
                  <td className="table-td">{KIND_LABEL[r.kind]}</td>
                  <td className="table-td">
                    <span className={`badge ${STATUS_CLS[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="table-td whitespace-nowrap text-ink-500">
                    {new Date(r.startedAt).toLocaleString('ru')}
                  </td>
                  <td className="table-td">{r.filesUploaded}</td>
                  <td className="table-td text-ink-500">{r.filesSkipped}</td>
                  <td className="table-td">{humanSize(r.bytesUploaded)}</td>
                  <td className="table-td">
                    {(r.log || r.error) && (
                      <button
                        className="btn-ghost px-2 text-xs"
                        onClick={() => setOpenLog(openLog === r.id ? null : r.id)}
                      >
                        Лог
                      </button>
                    )}
                  </td>
                </tr>
                {openLog === r.id && (
                  <tr key={`${r.id}-log`}>
                    <td className="table-td" colSpan={8}>
                      {r.error && <div className="mb-2 text-sm text-red-300">{r.error}</div>}
                      <pre className="max-h-64 overflow-auto rounded bg-ink-950 p-2 text-xs text-ink-400">
                        {r.log ?? '—'}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {data.runs.length === 0 && (
              <tr>
                <td className="table-td text-ink-500" colSpan={8}>
                  Прогонов ещё не было
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Путь с предупреждением, если он не абсолютный: почти всегда это опечатка. */
function PathRow({ label, path }: { label: string; path: string }) {
  const absolute = path.startsWith('/') || /^[A-Za-z]:[\/]/.test(path);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-16 shrink-0 text-ink-500">{label}</span>
      <code className={`break-all ${absolute ? 'text-ink-200' : 'text-amber-300'}`}>{JSON.stringify(path)}</code>
      {!absolute && (
        <span className="text-xs text-amber-400">
          путь не абсолютный — проверьте переменную на лишние пробелы
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="card p-3">
      <div className={`text-lg font-semibold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
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
