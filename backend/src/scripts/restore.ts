/**
 * Восстановление из бэкапа.
 *
 *   npm run restore -- --list                       список доступных прогонов
 *   npm run restore -- --latest --target=check      проверить целостность (ничего не меняет)
 *   npm run restore -- --date=2026-07-30 --target=media   вернуть недостающие медиафайлы
 *   npm run restore -- --latest --target=full --yes  РАЗВЕРНУТЬ БД И МЕДИА (разрушительно)
 */
import { prisma } from '../db.js';
import { listManifests, restore } from '../services/backup/restore.js';

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

if (has('--list')) {
  const manifests = await listManifests();
  if (!manifests.length) {
    console.log('Бэкапов не найдено. Сделайте первый: npm run backup');
  } else {
    console.log('Доступные прогоны:\n');
    for (const m of manifests) {
      console.log(`  #${m.runId ?? '?'}  ${m.finishedAt ?? '—'}  ${m.key}`);
    }
    console.log('\nВосстановить:  npm run restore -- --date=<ГГГГ-ММ-ДД> --target=check');
  }
  await prisma.$disconnect();
  process.exit(0);
}

const target = (value('target') ?? 'check') as 'check' | 'media' | 'full';
if (!['check', 'media', 'full'].includes(target)) {
  console.error(`Неизвестный target: ${target}. Допустимо: check, media, full`);
  process.exit(1);
}

// Полное восстановление стирает текущую БД — требуем явного подтверждения
if (target === 'full' && !has('--yes')) {
  console.error(
    'target=full удалит все данные в текущей базе и заменит их данными из бэкапа.\n' +
      'Если это то, что нужно, добавьте флаг --yes.',
  );
  process.exit(1);
}

const date = value('date');
const report = await restore({ date, target });

await prisma.$disconnect();

const failed =
  report.objects.mismatched.length > 0 || report.objects.missing.length > 0 || report.media.failed.length > 0;
process.exit(failed ? 1 : 0);
