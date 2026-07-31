import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // .../backend/src или .../backend/dist

/** Папка backend/ */
export const backendDir = path.resolve(here, '..');

/**
 * Корень репозитория. В Docker backend лежит в /app и корня репозитория нет —
 * поэтому в контейнере все пути к данным задаются абсолютными env-переменными
 * (STORAGE_LOCAL_DIR=/data/storage и т.д.), и эта константа не используется.
 */
export const repoRoot = path.resolve(backendDir, '..');

/** Относительный путь считаем от корня репозитория, абсолютный — как есть. */
export function resolveDataPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}
