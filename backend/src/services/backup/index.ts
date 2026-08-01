import crypto from 'node:crypto';
import type { BackupKind } from '@prisma/client';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { describeError } from '../../errors.js';
import { SETTING_KEYS, setSetting } from '../../settings.js';
import { storage } from '../storage/index.js';
import { safeAlert } from '../notify/index.js';
import { asDoc } from '../../content/schema.js';
import { buildRenderContext } from '../guides.js';
import { toMarkdown } from '../../content/render.js';
import {
  TransportUnreachableError,
  backupTransport,
  getTransport,
  type BackupTransport,
  type TransportName,
} from './transport.js';
import { dumpDatabase } from './db-dump.js';

export const MANIFEST_LATEST = 'manifest-latest.json';

export interface ManifestEntry {
  key: string;
  sha256: string;
  size: number;
  fileId: string;
}

export interface Manifest {
  version: 1;
  runId: number;
  kind: BackupKind;
  startedAt: string;
  finishedAt: string;
  transport: string;
  schemaVersion: string;
  db: { key: string; format: string; method: string; size: number } | null;
  counts: { guides: number; media: number; events: number; users: number };
  objects: ManifestEntry[];
}

/** Объект, который нужно положить в бэкап. */
interface Candidate {
  key: string;
  mime: string;
  /** Ленивое чтение: медиафайлы не тянем в память, пока не убедились, что они изменились */
  read: () => Promise<Buffer>;
  /** Уже известный sha256 (для медиа он есть в БД) — экономит чтение файла */
  knownSha?: string;
  knownSize?: number;
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface BackupResult {
  runId: number;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  uploaded: number;
  skipped: number;
  bytes: number;
  deleted: number;
  manifestKey: string | null;
  errors: string[];
}

/**
 * Инкрементальный прогон бэкапа (PLAN §9.3).
 *
 * 1. строим список объектов: контент из БД + все ключи бакета (+ дамп БД);
 * 2. для каждого считаем sha256 и сверяем с BackupObject;
 * 3. грузим только новые и изменённые, сверяем контрольную сумму после записи;
 * 4. пропавшие объекты помечаем, а не удаляем — чистим по ретеншену;
 * 5. пишем BackupRun и манифест.
 */
export async function runBackup(
  kind: BackupKind = 'FULL',
  log: (m: string) => void = console.log,
  transportName?: TransportName,
): Promise<BackupResult> {
  // Копий может быть несколько: локальная по расписанию и копия на Диске
  // по кнопке. У каждой свой учёт загруженного, поэтому имя хранилища
  // участвует и в BackupRun, и в ключе BackupObject.
  const transport: BackupTransport = getTransport(transportName);
  const tname = transport.name;
  const run = await prisma.backupRun.create({ data: { kind, status: 'RUNNING', transport: tname } });
  const errors: string[] = [];
  const logLines: string[] = [];
  const say = (m: string) => {
    log(m);
    logLines.push(m);
  };

  say(`[backup] прогон #${run.id}, вид ${kind}, хранилище ${tname}`);

  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  let deleted = 0;
  let manifestKey: string | null = null;
  const manifestObjects: ManifestEntry[] = [];

  try {
    await warnIfLowQuota(transport, say);

    const candidates: Candidate[] = [];
    if (kind === 'FULL' || kind === 'CONTENT') candidates.push(...(await contentCandidates()));
    if (kind === 'FULL' || kind === 'MEDIA') candidates.push(...(await mediaCandidates()));

    say(`[backup] объектов к проверке: ${candidates.length}`);

    for (const candidate of candidates) {
      try {
        const existing = await prisma.backupObject.findUnique({
          where: { transport_key: { transport: tname, key: candidate.key } },
        });

        // Для медиа sha256 уже лежит в БД — читать файл ради сверки незачем
        if (candidate.knownSha && existing && existing.sha256 === candidate.knownSha && !existing.deletedAt) {
          skipped++;
          manifestObjects.push({
            key: candidate.key,
            sha256: existing.sha256,
            size: Number(existing.sizeBytes),
            fileId: existing.driveFileId,
          });
          continue;
        }

        const content = await candidate.read();
        const hash = candidate.knownSha ?? sha256(content);

        if (existing && existing.sha256 === hash && !existing.deletedAt) {
          skipped++;
          manifestObjects.push({ key: candidate.key, sha256: hash, size: content.length, fileId: existing.driveFileId });
          continue;
        }

        const { fileId, md5 } = await transport.put(candidate.key, content, candidate.mime, {
          sha256: hash,
          existingFileId: existing?.driveFileId ?? null,
        });

        // Сверка контрольной суммы после загрузки — защита от «залилось битым» (§9.3, п.4)
        if (md5) {
          const localMd5 = crypto.createHash('md5').update(content).digest('hex');
          if (md5 !== localMd5) {
            throw new Error(`контрольная сумма не сошлась: ожидали ${localMd5}, хранилище вернуло ${md5}`);
          }
        }

        await prisma.backupObject.upsert({
          where: { transport_key: { transport: tname, key: candidate.key } },
          create: {
            transport: tname,
            key: candidate.key,
            sha256: hash,
            sizeBytes: BigInt(content.length),
            driveFileId: fileId,
            driveMd5: md5,
          },
          update: {
            sha256: hash,
            sizeBytes: BigInt(content.length),
            driveFileId: fileId,
            driveMd5: md5,
            syncedAt: new Date(),
            deletedAt: null,
          },
        });

        uploaded++;
        bytes += content.length;
        manifestObjects.push({ key: candidate.key, sha256: hash, size: content.length, fileId });
      } catch (e) {
        // Канал до хранилища лежит — дальше идти незачем. Каждый следующий
        // объект потратит те же попытки с тем же исходом, а объектов сотни:
        // прогон растянется на часы и всё равно закончится ничем
        if (e instanceof TransportUnreachableError) {
          throw new Error(
            `${tname}: связи нет, прогон прерван на объекте ${candidate.key} ` +
              `(проверено ${uploaded + skipped} из ${candidates.length}). ${describeError(e)}`,
            { cause: e },
          );
        }
        const message = `объект ${candidate.key}: ${describeError(e)}`;
        errors.push(message);
        say(`[backup] ОШИБКА ${message}`);
      }
    }

    // ===== Дамп БД =====
    let dbEntry: Manifest['db'] = null;
    if (kind === 'FULL' || kind === 'DB') {
      const dump = await dumpDatabase(say);
      const key = `db/${today()}/dump.${dump.format === 'pgdump' ? 'sql' : 'ndjson'}.gz`;
      const hash = sha256(dump.content);
      const { fileId, md5 } = await transport.put(key, dump.content, 'application/gzip', { sha256: hash });

      await prisma.backupObject.upsert({
        where: { transport_key: { transport: tname, key } },
        create: { transport: tname, key, sha256: hash, sizeBytes: BigInt(dump.content.length), driveFileId: fileId, driveMd5: md5 },
        update: { sha256: hash, sizeBytes: BigInt(dump.content.length), driveFileId: fileId, driveMd5: md5, syncedAt: new Date(), deletedAt: null },
      });

      uploaded++;
      bytes += dump.content.length;
      manifestObjects.push({ key, sha256: hash, size: dump.content.length, fileId });
      dbEntry = { key, format: dump.format, method: dump.method, size: dump.content.length };
      say(`[backup] дамп БД: ${key} (${(dump.content.length / 1024 / 1024).toFixed(1)} МБ, ${dump.method})`);
    }

    // ===== Пропавшие объекты =====
    if (kind === 'FULL') {
      deleted = await markMissing(tname, new Set(manifestObjects.map((o) => o.key)), say);
    }

    // ===== Ретеншен =====
    await applyRetention(transport, tname, say);

    // ===== Манифест =====
    const counts = await countEntities();
    const manifest: Manifest = {
      version: 1,
      runId: run.id,
      kind,
      startedAt: run.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      transport: tname,
      schemaVersion: SCHEMA_VERSION,
      db: dbEntry,
      counts,
      objects: manifestObjects,
    };
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    manifestKey = `manifests/${today()}/manifest-${run.id}.json`;

    await transport.put(manifestKey, manifestBuf, 'application/json', { sha256: sha256(manifestBuf) });
    // Указатель на последний успешный прогон (§9.2)
    await transport.put(MANIFEST_LATEST, manifestBuf, 'application/json', { sha256: sha256(manifestBuf) });

    const status = errors.length ? 'PARTIAL' : 'SUCCESS';
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        filesUploaded: uploaded,
        filesSkipped: skipped,
        bytesUploaded: BigInt(bytes),
        manifestKey,
        error: errors.length ? errors.slice(0, 5).join('\n') : null,
        log: logLines.join('\n').slice(0, 20000),
      },
    });
    if (status === 'SUCCESS') await setSetting(`${SETTING_KEYS.backupLastSuccessAt}.${tname}`, new Date().toISOString());

    say(
      `[backup] готово: загружено ${uploaded}, пропущено без изменений ${skipped}, ` +
        `${(bytes / 1024 / 1024).toFixed(1)} МБ, помечено удалёнными ${deleted}`,
    );

    if (errors.length) {
      await safeAlert(`⚠️ Бэкап #${run.id} прошёл частично: ${errors.length} ошибок.\n${errors.slice(0, 3).join('\n')}`);
    }

    return { runId: run.id, status, uploaded, skipped, bytes, deleted, manifestKey, errors };
  } catch (e) {
    const message = describeError(e);
    await prisma.backupRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        filesUploaded: uploaded,
        filesSkipped: skipped,
        bytesUploaded: BigInt(bytes),
        error: message.slice(0, 2000),
        log: logLines.join('\n').slice(0, 20000),
      },
    });
    await safeAlert(`🛑 Бэкап #${run.id} упал:\n${message.slice(0, 500)}`);
    say(`[backup] ПРОВАЛ: ${message}`);
    return { runId: run.id, status: 'FAILED', uploaded, skipped, bytes, deleted, manifestKey, errors: [message] };
  }
}

/** Версия схемы контента — при восстановлении проверяем совместимость. */
export const SCHEMA_VERSION = '1';

/**
 * Контент гайдов в четырёх файлах на гайд (§9.2). Двойной формат сознателен:
 * guide.json — для точного машинного восстановления, guide.md — чтобы при полном
 * отказе платформы гайды можно было прочитать глазами прямо в файле.
 */
async function contentCandidates(): Promise<Candidate[]> {
  const guides = await prisma.guide.findMany({
    include: {
      category: { select: { id: true, slug: true, title: true } },
      author: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { id: true, slug: true, title: true } } } },
      media: { select: { mediaId: true } },
    },
    orderBy: { id: 'asc' },
  });

  const out: Candidate[] = [];

  for (const guide of guides) {
    const dir = `content/${guide.slug}`;
    const doc = asDoc(guide.content);

    const meta = {
      id: guide.id,
      slug: guide.slug,
      title: guide.title,
      summary: guide.summary,
      status: guide.status,
      level: guide.level,
      version: guide.version,
      category: guide.category,
      author: guide.author,
      tags: guide.tags.map((t) => t.tag),
      requiredForRoles: guide.requiredForRoles,
      readingTimeSec: guide.readingTimeSec,
      reviewAt: guide.reviewAt,
      publishedAt: guide.publishedAt,
      createdAt: guide.createdAt,
      updatedAt: guide.updatedAt,
    };

    out.push({
      key: `${dir}/meta.json`,
      mime: 'application/json',
      read: async () => Buffer.from(JSON.stringify(meta, null, 2), 'utf8'),
    });
    out.push({
      key: `${dir}/guide.json`,
      mime: 'application/json',
      read: async () => Buffer.from(JSON.stringify(doc, null, 2), 'utf8'),
    });
    out.push({
      key: `${dir}/guide.md`,
      mime: 'text/markdown',
      read: async () => {
        const ctx = await buildRenderContext(doc);
        const md = `# ${guide.title}\n\n${guide.summary ? guide.summary + '\n\n' : ''}${toMarkdown(doc, ctx)}\n`;
        return Buffer.from(md, 'utf8');
      },
    });
    out.push({
      key: `${dir}/media.json`,
      mime: 'application/json',
      read: async () => Buffer.from(JSON.stringify(guide.media.map((m) => m.mediaId), null, 2), 'utf8'),
    });
  }

  const [categories, tags] = await Promise.all([
    prisma.category.findMany({ orderBy: { id: 'asc' } }),
    prisma.tag.findMany({ orderBy: { id: 'asc' } }),
  ]);

  out.push({
    key: 'content/_index.json',
    mime: 'application/json',
    read: async () =>
      Buffer.from(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            guides: guides.map((g) => ({ id: g.id, slug: g.slug, title: g.title, status: g.status })),
            categories,
            tags,
          },
          null,
          2,
        ),
        'utf8',
      ),
  });

  return out;
}

/** Зеркало бакета. sha256 берём из БД — он там уже есть, файл читать не нужно. */
async function mediaCandidates(): Promise<Candidate[]> {
  const media = await prisma.media.findMany({
    where: { status: 'READY' },
    select: { key: true, sha256: true, mime: true, sizeBytes: true, posterKey: true, variants: true },
  });

  const out: Candidate[] = [];
  const seen = new Set<string>();

  const add = (key: string, mime: string, knownSha?: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      key: `media/${key}`,
      mime,
      knownSha,
      read: async () => storage.getBuffer(key),
    });
  };

  for (const m of media) {
    add(m.key, m.mime, m.sha256);
    if (m.posterKey) add(m.posterKey, 'image/jpeg');
    for (const v of (m.variants ?? []) as { key?: string; fmt?: string }[]) {
      if (v?.key) add(v.key, v.fmt === 'avif' ? 'image/avif' : v.fmt === 'webp' ? 'image/webp' : 'application/octet-stream');
    }
  }

  return out;
}

/**
 * Объект пропал из системы — помечаем, но не удаляем сразу.
 * Защита от «админ случайно снёс гайд, а бэкап послушно повторил удаление» (§9.3, п.5).
 */
async function markMissing(
  transportName: string,
  presentKeys: Set<string>,
  say: (m: string) => void,
): Promise<number> {
  const known = await prisma.backupObject.findMany({
    where: { transport: transportName, deletedAt: null },
    select: { id: true, key: true },
  });
  const missing = known.filter((o) => !presentKeys.has(o.key) && !o.key.startsWith('db/') && !o.key.startsWith('manifests/'));
  if (!missing.length) return 0;

  await prisma.backupObject.updateMany({
    where: { id: { in: missing.map((o) => o.id) } },
    data: { deletedAt: new Date() },
  });
  say(`[backup] помечено удалёнными: ${missing.length} (будут вычищены через ${env.backup.tombstoneDays} дн.)`);
  return missing.length;
}

/**
 * Ретеншен: дампы БД по схеме 7 дней × 4 недели × 6 месяцев,
 * помеченные объекты — через BACKUP_TOMBSTONE_DAYS.
 */
async function applyRetention(
  transport: BackupTransport,
  transportName: string,
  say: (m: string) => void,
): Promise<void> {
  // --- дампы БД ---
  const dumps = await prisma.backupObject.findMany({
    where: { transport: transportName, key: { startsWith: 'db/' } },
    orderBy: { key: 'desc' },
  });

  const keep = new Set<string>();
  const daily: string[] = [];
  const weekly = new Map<string, string>();
  const monthly = new Map<string, string>();

  for (const dump of dumps) {
    const date = dump.key.split('/')[1] ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (daily.length < env.backup.keepDaily) daily.push(dump.key);

    const d = new Date(date);
    const week = `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`;
    if (!weekly.has(week) && weekly.size < env.backup.keepWeekly) weekly.set(week, dump.key);

    const month = date.slice(0, 7);
    if (!monthly.has(month) && monthly.size < env.backup.keepMonthly) monthly.set(month, dump.key);
  }

  for (const key of [...daily, ...weekly.values(), ...monthly.values()]) keep.add(key);

  const toDrop = dumps.filter((d) => !keep.has(d.key));
  for (const dump of toDrop) {
    try {
      await transport.delete(dump.driveFileId, dump.key);
      await prisma.backupObject.delete({ where: { id: dump.id } });
    } catch (e) {
      say(`[backup] не удалось удалить старый дамп ${dump.key}: ${String(e)}`);
    }
  }
  if (toDrop.length) say(`[backup] ретеншен дампов: удалено ${toDrop.length}, оставлено ${keep.size}`);

  // --- помеченные объекты ---
  const cutoff = new Date(Date.now() - env.backup.tombstoneDays * 86400_000);
  const expired = await prisma.backupObject.findMany({
    where: { transport: transportName, deletedAt: { lt: cutoff } },
  });
  for (const object of expired) {
    try {
      await transport.delete(object.driveFileId, object.key);
      await prisma.backupObject.delete({ where: { id: object.id } });
    } catch (e) {
      say(`[backup] не удалось вычистить ${object.key}: ${String(e)}`);
    }
  }
  if (expired.length) say(`[backup] вычищено просроченных удалённых объектов: ${expired.length}`);
}

async function countEntities() {
  const [guides, media, events, users] = await Promise.all([
    prisma.guide.count(),
    prisma.media.count(),
    prisma.event.count(),
    prisma.user.count(),
  ]);
  return { guides, media, events, users };
}

/** Алерт при остатке места меньше 15% (§9.6). */
async function warnIfLowQuota(transport: BackupTransport, say: (m: string) => void): Promise<void> {
  try {
    const quota = await transport.quota();
    if (!quota || !quota.total) return;
    const freeRatio = (quota.total - quota.used) / quota.total;
    say(`[backup] место: занято ${(quota.used / 1024 ** 3).toFixed(1)} ГБ из ${(quota.total / 1024 ** 3).toFixed(1)} ГБ`);
    if (freeRatio < 0.15) {
      await safeAlert(
        `⚠️ На аккаунте бэкапов осталось меньше 15% места ` +
          `(${((quota.total - quota.used) / 1024 ** 3).toFixed(1)} ГБ). Скоро бэкапы начнут падать.`,
      );
    }
  } catch (e) {
    // Это первый поход в хранилище за прогон. Если связи нет — сообщаем сразу
    // и не начинаем перебирать объекты: отказ будет тот же, только через часы
    if (e instanceof TransportUnreachableError) throw e;
    // Провайдер, который просто не умеет отвечать о квоте, — не ошибка
    say(`[backup] не удалось узнать свободное место: ${describeError(e)}`);
  }
}

/** Сколько часов прошло с последнего успешного бэкапа — для /health и баннера в админке. */
export async function hoursSinceLastSuccess(transportName?: string): Promise<number | null> {
  const last = await prisma.backupRun.findFirst({
    where: { status: 'SUCCESS', ...(transportName ? { transport: transportName } : {}) },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  if (!last?.finishedAt) return null;
  return (Date.now() - last.finishedAt.getTime()) / 3_600_000;
}

export { backupTransport };
