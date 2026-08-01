/**
 * Разворачивание цепочки причин ошибки.
 *
 * Зачем отдельный модуль: сетевые сбои в Node приходят как безликое
 * `TypeError: fetch failed`, а настоящая причина — DNS, таймаут соединения,
 * обрыв TLS — лежит во вложенном `cause`. `String(e)` её теряет, и в логе
 * остаётся строка, по которой невозможно понять, что чинить.
 */

/** «TypeError: fetch failed ← ConnectTimeoutError [UND_ERR_CONNECT_TIMEOUT www.googleapis.com:443]» */
export function describeError(e: unknown, maxDepth = 5): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = e;

  for (let depth = 0; current != null && depth < maxDepth; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    parts.push(oneLine(current));

    // undici при нескольких попытках соединения складывает ошибки в AggregateError:
    // причина там в errors, а не в cause
    if (current instanceof AggregateError && current.errors.length) {
      current = current.errors[0];
      continue;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return parts.join(' ← ');
}

function oneLine(e: unknown): string {
  if (!(e instanceof Error)) return String(e);

  const err = e as Error & { code?: unknown; hostname?: unknown; address?: unknown; port?: unknown };
  const head = e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message || String(e);

  const details: string[] = [];
  if (typeof err.code === 'string' && !head.includes(err.code)) details.push(err.code);
  const host = typeof err.hostname === 'string' ? err.hostname : typeof err.address === 'string' ? err.address : null;
  if (host) details.push(typeof err.port === 'number' ? `${host}:${err.port}` : host);

  return details.length ? `${head} [${details.join(' ')}]` : head;
}
