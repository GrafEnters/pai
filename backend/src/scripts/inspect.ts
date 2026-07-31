/** Служебный скрипт для быстрой проверки состояния гайда: npx tsx src/scripts/inspect.ts <id> */
import { prisma } from '../db.js';

const id = Number(process.argv[2] ?? 1);
const g = await prisma.guide.findUnique({ where: { id }, include: { media: true, versions: true } });

if (!g) {
  console.log(`Гайд ${id} не найден`);
} else {
  console.log('статус:', g.status, '| версия:', g.version, '| время чтения:', g.readingTimeSec, 'сек');
  console.log('slug:', g.slug);
  console.log('связано медиа:', JSON.stringify(g.media.map((m) => m.mediaId)));
  console.log('версий:', g.versions.length);
  console.log('--- plainText (первые 300) ---');
  console.log((g.plainText ?? '').slice(0, 300));
  console.log('--- html (первые 700) ---');
  console.log((g.html ?? '').slice(0, 700));
}

await prisma.$disconnect();
process.exit(0);
