import crypto from 'node:crypto';
import { prisma } from '../../db.js';
import { storage } from '../storage/index.js';
import { asDoc, collectMediaIds } from '../../content/schema.js';
import { backupTransport } from './transport.js';
import { MANIFEST_LATEST, SCHEMA_VERSION, type Manifest } from './index.js';
import { restoreDatabase } from './db-dump.js';

export interface RestoreOptions {
  /** Дата прогона (YYYY-MM-DD) или ничего — тогда берём последний. */
  date?: string;
  /**
   * check — только проверить целостность, ничего не менять (по умолчанию);
   * media — восстановить недостающие медиафайлы;
   * full  — развернуть БД из дампа И восстановить медиа (РАЗРУШИТЕЛЬНО).
   */
  target: 'check' | 'media' | 'full';
}

export interface RestoreReport {
  manifest: { runId: number; finishedAt: string; transport: string; schemaVersion: string };
  objects: { total: number; verified: number; mismatched: string[]; missing: string[] };
  media: { restored: number; alreadyPresent: number; failed: string[] };
  db: { restored: boolean; format?: string; method?: string; tables?: { table: string; rows: number }[] };
  integrity: { guides: number; brokenMediaRefs: string[]; missingInStorage: string[] };
  counts: Manifest['counts'] | null;
  elapsedSec: number;
}

/** Список доступных прогонов — `npm run restore -- --list`. */
export async function listManifests(): Promise<Array<{ key: string; runId?: number; finishedAt?: string }>> {
  const objects = await backupTransport.list('manifests');
  const out: Array<{ key: string; runId?: number; finishedAt?: string }> = [];

  for (const object of objects) {
    if (!object.key.endsWith('.json')) continue;
    try {
      const manifest = JSON.parse((await backupTransport.get(object.key, object.fileId)).toString('utf8')) as Manifest;
      out.push({ key: object.key, runId: manifest.runId, finishedAt: manifest.finishedAt });
    } catch {
      out.push({ key: object.key });
    }
  }
  return out.sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? '')).reverse();
}

async function loadManifest(date?: string): Promise<Manifest> {
  if (!date) {
    const buf = await backupTransport.get(MANIFEST_LATEST);
    return JSON.parse(buf.toString('utf8')) as Manifest;
  }
  const objects = await backupTransport.list(`manifests/${date}`);
  const latest = objects.filter((o) => o.key.endsWith('.json')).sort((a, b) => a.key.localeCompare(b.key)).pop();
  if (!latest) throw new Error(`За ${date} манифестов нет. Посмотрите список: npm run restore -- --list`);
  return JSON.parse((await backupTransport.get(latest.key, latest.fileId)).toString('utf8')) as Manifest;
}

/**
 * Восстановление (PLAN §9.5). Ценность бэкапа — не в загрузке файлов,
 * а в проверенной процедуре восстановления, поэтому по умолчанию режим `check`:
 * его можно запускать хоть каждый день, ничего не ломая.
 */
export async function restore(opts: RestoreOptions, log: (m: string) => void = console.log): Promise<RestoreReport> {
  const startedAt = Date.now();
  const manifest = await loadManifest(opts.date);

  log(`[restore] манифест прогона #${manifest.runId} от ${manifest.finishedAt} (${manifest.transport})`);
  log(`[restore] в бэкапе: гайдов ${manifest.counts.guides}, медиа ${manifest.counts.media}, событий ${manifest.counts.events}`);

  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    log(
      `[restore] ВНИМАНИЕ: версия схемы в бэкапе (${manifest.schemaVersion}) ` +
        `не совпадает с текущей (${SCHEMA_VERSION}). Восстановление может потребовать миграции.`,
    );
  }

  // ===== 1. Проверка хешей =====
  const mismatched: string[] = [];
  const missing: string[] = [];
  let verified = 0;

  for (const entry of manifest.objects) {
    try {
      const content = await backupTransport.get(entry.key, entry.fileId);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      if (hash === entry.sha256) verified++;
      else mismatched.push(entry.key);
    } catch {
      missing.push(entry.key);
    }
  }
  log(`[restore] объектов: ${manifest.objects.length}, целых ${verified}, битых ${mismatched.length}, нет ${missing.length}`);

  const report: RestoreReport = {
    manifest: {
      runId: manifest.runId,
      finishedAt: manifest.finishedAt,
      transport: manifest.transport,
      schemaVersion: manifest.schemaVersion,
    },
    objects: { total: manifest.objects.length, verified, mismatched, missing },
    media: { restored: 0, alreadyPresent: 0, failed: [] },
    db: { restored: false },
    integrity: { guides: 0, brokenMediaRefs: [], missingInStorage: [] },
    counts: manifest.counts,
    elapsedSec: 0,
  };

  // ===== 2. База данных =====
  if (opts.target === 'full') {
    if (!manifest.db) throw new Error('В этом прогоне нет дампа БД — восстановить нечего');
    log(`[restore] разворачиваю БД из ${manifest.db.key} (${manifest.db.format})`);
    const dumpEntry = manifest.objects.find((o) => o.key === manifest.db!.key);
    const dump = await backupTransport.get(manifest.db.key, dumpEntry?.fileId);
    const result = await restoreDatabase(dump, log);
    report.db = { restored: true, format: result.format, method: result.method, tables: result.tables };
  }

  // ===== 3. Медиа обратно в хранилище =====
  if (opts.target === 'media' || opts.target === 'full') {
    for (const entry of manifest.objects) {
      if (!entry.key.startsWith('media/')) continue;
      const storageKey = entry.key.slice('media/'.length);
      try {
        if (await storage.exists(storageKey)) {
          report.media.alreadyPresent++;
          continue;
        }
        const content = await backupTransport.get(entry.key, entry.fileId);
        await storage.put(storageKey, content, 'application/octet-stream');
        report.media.restored++;
      } catch (e) {
        report.media.failed.push(`${storageKey}: ${String(e)}`);
      }
    }
    log(`[restore] медиа: восстановлено ${report.media.restored}, уже было ${report.media.alreadyPresent}, ошибок ${report.media.failed.length}`);
  }

  // ===== 4. Проверка целостности =====
  // У каждого опубликованного гайда все mediaId должны резолвиться,
  // а все ключи — присутствовать в хранилище (§9.5, п.4)
  const guides = await prisma.guide.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, slug: true, content: true },
  });
  report.integrity.guides = guides.length;

  const allMediaIds = new Set<number>();
  for (const guide of guides) for (const id of collectMediaIds(asDoc(guide.content))) allMediaIds.add(id);

  const knownMedia = await prisma.media.findMany({
    where: { id: { in: [...allMediaIds] } },
    select: { id: true, key: true, posterKey: true, variants: true },
  });
  const knownIds = new Set(knownMedia.map((m) => m.id));

  for (const guide of guides) {
    for (const id of collectMediaIds(asDoc(guide.content))) {
      if (!knownIds.has(id)) report.integrity.brokenMediaRefs.push(`${guide.slug} → mediaId ${id}`);
    }
  }

  for (const media of knownMedia) {
    const keys = [media.key, media.posterKey, ...((media.variants ?? []) as { key?: string }[]).map((v) => v?.key)];
    for (const key of keys) {
      if (!key) continue;
      if (!(await storage.exists(key))) report.integrity.missingInStorage.push(key);
    }
  }

  report.elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  log('');
  log('═══ Отчёт о восстановлении ═══');
  log(`Прогон:            #${manifest.runId} от ${manifest.finishedAt}`);
  log(`Объектов проверено: ${report.objects.total} (целых ${verified})`);
  if (mismatched.length) log(`БИТЫЕ:              ${mismatched.slice(0, 10).join(', ')}`);
  if (missing.length) log(`ОТСУТСТВУЮТ:        ${missing.slice(0, 10).join(', ')}`);
  log(`Гайдов в системе:   ${report.integrity.guides}`);
  log(`Битых ссылок:       ${report.integrity.brokenMediaRefs.length}`);
  log(`Нет файлов:         ${report.integrity.missingInStorage.length}`);
  if (report.db.restored) log(`БД:                 восстановлена (${report.db.format}, ${report.db.method})`);
  if (opts.target !== 'check') log(`Медиа:              восстановлено ${report.media.restored}`);
  log(`Заняло:             ${report.elapsedSec} с`);
  log('═════════════════════════════');

  return report;
}
