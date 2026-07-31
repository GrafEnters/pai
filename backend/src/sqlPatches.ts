import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db.js';
import { backendDir } from './paths.js';

/**
 * Идемпотентные SQL-патчи, которые Prisma выразить не может (генерируемые колонки,
 * GIN-индексы, расширения). Применяются при старте и в seed — см. DECISIONS.md §5.
 */
export async function applySqlPatches(log: (msg: string) => void = console.log): Promise<void> {
  const dir = path.join(backendDir, 'prisma', 'sql');
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return; // папки нет — патчей нет
  }

  for (const file of files) {
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    // Разбиваем на выражения: prisma.$executeRawUnsafe выполняет по одному
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter((s) => s && !s.split('\n').every((l) => l.trim().startsWith('--')));

    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
      } catch (e) {
        throw new Error(`SQL-патч ${file} упал на выражении:\n${stmt.slice(0, 200)}\n${String(e)}`);
      }
    }
    log(`[sql] патч ${file} применён`);
  }
}
