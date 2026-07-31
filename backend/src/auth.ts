import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, TeamRole, User } from '@prisma/client';
import { prisma } from './db.js';
import { env } from './env.js';

export const ACCESS_COOKIE = 'pai_at';
export const REFRESH_COOKIE = 'pai_rt';

export interface TokenPayload {
  uid: number;
  role: Role;
  teamRole: TeamRole;
  source: 'web' | 'tg' | 'invite';
}

/** Иерархия ролей: ADMIN может всё, что EDITOR, и так далее. */
const ROLE_ORDER: Record<Role, number> = { NONE: 0, VIEWER: 1, EDITOR: 2, ADMIN: 3 };

export function roleAtLeast(actual: Role, required: Role): boolean {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Актуальный пользователь из БД. Заполняется в requireAuth / tryAuth. */
    currentUser?: User;
  }
}

// ============================ Telegram ============================

/** Валидация Telegram WebApp initData по HMAC-SHA256.
 *  https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *  Перенесено из polina-crm/backend/src/auth.ts.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): null | {
  user?: { id: number; username?: string; first_name?: string; last_name?: string };
  authDate: number;
} {
  if (!botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  const authDate = Number(params.get('auth_date') ?? '0');
  let user: any;
  if (userJson) {
    try {
      user = JSON.parse(userJson);
    } catch {
      return null;
    }
  }
  return { user, authDate };
}

/** Валидация payload от Telegram Login Widget (сайт, не Mini App).
 *  Алгоритм ДРУГОЙ: секрет — это SHA256(botToken), а не HMAC('WebAppData').
 *  https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLoginWidget(
  payload: Record<string, unknown>,
  botToken: string,
): null | { id: number; username?: string; first_name?: string; last_name?: string; authDate: number } {
  if (!botToken) return null;
  const { hash, ...rest } = payload as Record<string, string>;
  if (!hash) return null;

  const dataCheckString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;

  const authDate = Number(rest.auth_date ?? '0');
  // Виджет отдаёт подпись без срока жизни — ограничиваем сами: 1 час
  if (!authDate || Date.now() / 1000 - authDate > 3600) return null;

  return {
    id: Number(rest.id),
    username: rest.username,
    first_name: rest.first_name,
    last_name: rest.last_name,
    authDate,
  };
}

// ============================ Токены ============================

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    domain: env.cookieDomain,
    maxAge: maxAgeSec,
  };
}

/** Выдаёт пару access+refresh, кладёт обе в httpOnly-cookie и возвращает access-токен. */
export async function issueSession(
  reply: FastifyReply,
  user: User,
  source: TokenPayload['source'],
  userAgent?: string,
): Promise<string> {
  const payload: TokenPayload = {
    uid: user.id,
    role: user.role,
    teamRole: user.teamRole,
    source,
  };
  const accessToken = await reply.jwtSign(payload, { expiresIn: env.accessTtl });

  const refreshRaw = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 86400_000);
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshRaw),
      userAgent: userAgent?.slice(0, 300),
      expiresAt,
    },
  });

  reply.setCookie(ACCESS_COOKIE, accessToken, cookieOptions(15 * 60));
  reply.setCookie(REFRESH_COOKIE, refreshRaw, cookieOptions(env.refreshTtlDays * 86400));
  return accessToken;
}

/** Ротация: старый refresh отзывается, выдаётся новая пара. */
export async function rotateSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ user: User } | null> {
  const raw = req.cookies[REFRESH_COOKIE];
  if (!raw) return null;

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) return null;
  if (!record.user.isActive) return null;

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  await issueSession(reply, record.user, 'web', req.headers['user-agent']);
  return { user: record.user };
}

export async function revokeSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = req.cookies[REFRESH_COOKIE];
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  clearSessionCookies(reply);
}

export function clearSessionCookies(reply: FastifyReply) {
  const opts = { path: '/', domain: env.cookieDomain };
  reply.clearCookie(ACCESS_COOKIE, opts);
  reply.clearCookie(REFRESH_COOKIE, opts);
}

// ============================ preHandler'ы ============================

/**
 * Загружает пользователя из БД на каждом запросе. Дороже, чем верить payload'у,
 * но даёт мгновенный эффект от деактивации и смены роли (§7.1: «уволился —
 * доступ закрыт мгновенно»), а не через 15 минут жизни access-токена.
 */
async function loadUser(req: FastifyRequest): Promise<User | null> {
  const payload = req.user as TokenPayload | undefined;
  if (!payload?.uid) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.isActive) return null;
  req.currentUser = user;
  return user;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Не авторизован' });
  }
  const user = await loadUser(req);
  if (!user) return reply.code(401).send({ error: 'Аккаунт отключён' });
}

/** Требует роль не ниже указанной (ADMIN проходит везде, где нужен EDITOR). */
export function requireRole(minRole: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Не авторизован' });
    }
    const user = await loadUser(req);
    if (!user) return reply.code(401).send({ error: 'Аккаунт отключён' });
    if (!roleAtLeast(user.role, minRole)) {
      return reply.code(403).send({ error: 'Недостаточно прав' });
    }
  };
}

/** Извлекает пользователя, не выбрасывая ошибок (для эндпоинтов со смешанной авторизацией). */
export async function tryAuth(req: FastifyRequest): Promise<User | null> {
  try {
    await req.jwtVerify();
  } catch {
    return null;
  }
  return loadUser(req);
}

export function currentUser(req: FastifyRequest): User {
  if (!req.currentUser) throw new Error('currentUser вызван без requireAuth');
  return req.currentUser;
}

/** То, что отдаём наружу. Хеш пароля и внутренние поля не светим. */
export function publicUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    teamRole: u.teamRole,
    email: u.email,
    telegramUsername: u.telegramUsername,
    telegramId: u.telegramId ? u.telegramId.toString() : null,
    isActive: u.isActive,
    lastSeenAt: u.lastSeenAt,
    createdAt: u.createdAt,
  };
}

export { env };
