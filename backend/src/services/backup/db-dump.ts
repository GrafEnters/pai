import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { prisma } from '../../db.js';
import { env } from '../../env.js';

const exec = promisify(execFile);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export type DumpFormat = 'pgdump' | 'ndjson';

export interface DbDump {
  format: DumpFormat;
  /** gzip-сжатое содержимое */
  content: Buffer;
  /** Чем сделали — попадает в манифест и в лог прогона */
  method: string;
}

/**
 * Порядок таблиц — от родителей к детям. При восстановлении идём в обратном
 * порядке для очистки и в прямом для вставки, иначе внешние ключи не дадут писать.
 */
export const TABLE_ORDER = [
  'User',
  'Category',
  'Tag',
  'Media',
  'Guide',
  'GuideVersion',
  'GuideTag',
  'GuideRelation',
  'GuideMedia',
  'InviteCode',
  'RefreshToken',
  'LoginLink',
  'Event',
  'DailyGuideStat',
  'DailyVideoStat',
  'SearchQuery',
  'GuideFeedback',
  'UserGuideProgress',
  'BackupRun',
  'BackupObject',
  'AuditLog',
  'Setting',
] as const;

type TableName = (typeof TABLE_ORDER)[number];

/** prisma.user, prisma.guideVersion и т.д. */
function delegate(table: TableName): {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>;
  createMany: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>;
  deleteMany: (args?: unknown) => Promise<{ count: number }>;
} {
  const key = table.charAt(0).toLowerCase() + table.slice(1);
  const d = (prisma as unknown as Record<string, unknown>)[key];
  if (!d) throw new Error(`Нет модели Prisma для таблицы ${table}`);
  return d as never;
}

/**
 * Дамп БД. Три стратегии по убыванию точности (DECISIONS §4):
 * pg_dump из PATH → pg_dump внутри docker-контейнера → логический дамп на Node.
 *
 * Третий вариант нужен, чтобы критерий «на чистой машине только Docker и Node»
 * выполнялся буквально: там pg_dump в PATH обычно нет.
 */
export async function dumpDatabase(log: (m: string) => void = console.log): Promise<DbDump> {
  const viaPath = await tryPgDump(['-Fc', '--no-owner', '--no-acl', env.databaseUrl], null);
  if (viaPath) {
    log('[backup] дамп через pg_dump из PATH');
    return { format: 'pgdump', content: await gzip(viaPath), method: 'pg_dump' };
  }

  const container = env.backup.pgDumpDockerContainer;
  if (container) {
    const url = dockerInternalUrl(env.databaseUrl);
    const viaDocker = await tryPgDump(['-Fc', '--no-owner', '--no-acl', url], container);
    if (viaDocker) {
      log(`[backup] дамп через docker exec ${container} pg_dump`);
      return { format: 'pgdump', content: await gzip(viaDocker), method: `docker:${container}` };
    }
  }

  log('[backup] pg_dump недоступен — логический дамп средствами Node (см. DECISIONS §4)');
  return { format: 'ndjson', content: await gzip(await logicalDump()), method: 'ndjson' };
}

async function tryPgDump(args: string[], container: string | null): Promise<Buffer | null> {
  try {
    const cmd = container ? 'docker' : 'pg_dump';
    const fullArgs = container ? ['exec', '-i', container, 'pg_dump', ...args] : args;
    const { stdout } = await exec(cmd, fullArgs, {
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024 * 1024,
      timeout: 30 * 60_000,
    });
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/** Внутри контейнера база доступна не по localhost, а по имени сервиса. */
function dockerInternalUrl(url: string): string {
  return url.replace('@localhost:', '@postgres:').replace('@127.0.0.1:', '@postgres:');
}

/** NDJSON: по строке на запись, первая строка — заголовок таблицы. */
async function logicalDump(): Promise<Buffer> {
  const lines: string[] = [
    JSON.stringify({ _meta: true, version: 1, createdAt: new Date().toISOString(), tables: TABLE_ORDER }),
  ];

  for (const table of TABLE_ORDER) {
    const rows = await delegate(table).findMany();
    lines.push(JSON.stringify({ _table: table, count: rows.length }));
    for (const row of rows) lines.push(JSON.stringify(row, jsonReplacer));
  }

  return Buffer.from(lines.join('\n'), 'utf8');
}

/** BigInt и Date в JSON сами не сериализуются — помечаем их, чтобы восстановить типы. */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  return value;
}

function reviveValue(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.__bigint === 'string') return BigInt(obj.__bigint);
    if (Array.isArray(value)) return value.map(reviveValue);
  }
  return value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function reviveRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && ISO_DATE.test(value)) out[key] = new Date(value);
    else out[key] = reviveValue(value);
  }
  return out;
}

export interface RestoreReport {
  format: DumpFormat;
  tables: { table: string; rows: number }[];
  method: string;
}

/**
 * Восстановление в текущую БД. Формат определяется автоматически: pg_dump -Fc
 * начинается с сигнатуры "PGDMP".
 *
 * ВНИМАНИЕ: операция разрушительная — существующие данные удаляются.
 */
export async function restoreDatabase(
  gzipped: Buffer,
  log: (m: string) => void = console.log,
): Promise<RestoreReport> {
  const raw = await gunzip(gzipped);
  const isPgDump = raw.subarray(0, 5).toString('latin1') === 'PGDMP';

  if (isPgDump) {
    const report = await restoreViaPgRestore(raw, log);
    if (report) return report;
    throw new Error(
      'Дамп сделан pg_dump, но pg_restore недоступен ни в PATH, ни в контейнере. ' +
        'Поставьте postgresql-client или задайте PGDUMP_DOCKER_CONTAINER.',
    );
  }

  return restoreFromNdjson(raw, log);
}

async function restoreViaPgRestore(raw: Buffer, log: (m: string) => void): Promise<RestoreReport | null> {
  const attempts: Array<{ cmd: string; args: string[]; method: string }> = [
    { cmd: 'pg_restore', args: ['--clean', '--if-exists', '--no-owner', '--no-acl', '-d', env.databaseUrl], method: 'pg_restore' },
  ];
  const container = env.backup.pgDumpDockerContainer;
  if (container) {
    attempts.push({
      cmd: 'docker',
      args: [
        'exec', '-i', container, 'pg_restore',
        '--clean', '--if-exists', '--no-owner', '--no-acl',
        '-d', dockerInternalUrl(env.databaseUrl),
      ],
      method: `docker:${container}`,
    });
  }

  for (const attempt of attempts) {
    try {
      const child = execFile(attempt.cmd, attempt.args, { maxBuffer: 1024 * 1024 * 64 });
      child.stdin?.end(raw);
      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`код ${code}`))));
        child.on('error', reject);
      });
      log(`[restore] восстановлено через ${attempt.method}`);
      return { format: 'pgdump', tables: [], method: attempt.method };
    } catch {
      /* пробуем следующий способ */
    }
  }
  return null;
}

async function restoreFromNdjson(raw: Buffer, log: (m: string) => void): Promise<RestoreReport> {
  const lines = raw.toString('utf8').split('\n').filter(Boolean);
  const byTable = new Map<string, Record<string, unknown>[]>();

  let current: string | null = null;
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed._meta) continue;
    if (typeof parsed._table === 'string') {
      current = parsed._table;
      byTable.set(current, []);
      continue;
    }
    if (current) byTable.get(current)!.push(parsed);
  }

  // Чистим в обратном порядке — сначала дети, потом родители
  for (const table of [...TABLE_ORDER].reverse()) {
    await delegate(table).deleteMany();
  }

  const report: RestoreReport['tables'] = [];
  for (const table of TABLE_ORDER) {
    const rows = (byTable.get(table) ?? []).map(reviveRow);
    if (!rows.length) {
      report.push({ table, rows: 0 });
      continue;
    }
    // Пачками по 500: одна транзакция на 2 млн событий не пройдёт
    for (let i = 0; i < rows.length; i += 500) {
      await delegate(table).createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
    }
    report.push({ table, rows: rows.length });
    log(`[restore] ${table}: ${rows.length}`);
  }

  await resetSequences(log);
  return { format: 'ndjson', tables: report, method: 'ndjson' };
}

/**
 * После вставки строк с явными id последовательности остаются на нуле,
 * и первый же INSERT упадёт на нарушении уникальности. Двигаем их вручную.
 */
async function resetSequences(log: (m: string) => void): Promise<void> {
  for (const table of TABLE_ORDER) {
    if (table === 'Setting' || table === 'RefreshToken' || table === 'LoginLink') continue; // id не числовой
    try {
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
      );
    } catch (e) {
      log(`[restore] не удалось сдвинуть последовательность ${table}: ${String(e)}`);
    }
  }
}
