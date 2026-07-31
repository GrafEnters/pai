/**
 * Ручной прогон бэкапа.
 *   npm run backup                  — полный
 *   npm run backup -- --kind=DB     — только дамп БД
 *   npm run backup -- --kind=CONTENT
 *   npm run backup -- --kind=MEDIA
 */
import type { BackupKind } from '@prisma/client';
import { prisma } from '../db.js';
import { runBackup } from '../services/backup/index.js';

const arg = process.argv.find((a) => a.startsWith('--kind='));
const kind = (arg?.split('=')[1]?.toUpperCase() ?? 'FULL') as BackupKind;

if (!['DB', 'CONTENT', 'MEDIA', 'FULL'].includes(kind)) {
  console.error(`Неизвестный вид бэкапа: ${kind}. Допустимо: DB, CONTENT, MEDIA, FULL`);
  process.exit(1);
}

const result = await runBackup(kind);
await prisma.$disconnect();
process.exit(result.status === 'FAILED' ? 1 : 0);
