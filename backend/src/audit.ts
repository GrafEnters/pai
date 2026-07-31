import type { FastifyRequest } from 'fastify';
import { prisma } from './db.js';
import type { TokenPayload } from './auth.js';

/**
 * Аудит-лог всех мутаций (§7.1). Никогда не бросает исключение: провал записи
 * в журнал не должен ронять само действие — иначе журнал становится точкой отказа.
 */
export async function audit(
  req: FastifyRequest | null,
  action: string,
  entity: string,
  entityId?: string | number | null,
  diff?: unknown,
): Promise<void> {
  try {
    const payload = req?.user as TokenPayload | undefined;
    await prisma.auditLog.create({
      data: {
        userId: req?.currentUser?.id ?? payload?.uid ?? null,
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        diff: (diff ?? undefined) as never,
        ip: req ? clientIp(req) : null,
      },
    });
  } catch (e) {
    req?.log?.warn({ err: e, action, entity }, 'не удалось записать AuditLog');
  }
}

/** IP клиента с учётом того, что на проде мы за Caddy и Cloudflare. */
export function clientIp(req: FastifyRequest): string | null {
  const h = req.headers;
  const cf = h['cf-connecting-ip'];
  if (typeof cf === 'string') return cf;
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]!.trim();
  return req.ip ?? null;
}

/** Только изменившиеся поля — чтобы в журнале было видно суть правки, а не весь объект. */
export function diffOf<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    const prev = before[k];
    const same = prev instanceof Date && v instanceof Date ? prev.getTime() === v.getTime() : prev === v;
    if (!same) changed[k] = { from: prev ?? null, to: v ?? null };
  }
  return Object.keys(changed).length ? changed : undefined;
}
