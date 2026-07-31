import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import {
  clearSessionCookies,
  currentUser,
  hashToken,
  issueSession,
  publicUser,
  requireAuth,
  revokeSession,
  rotateSession,
  verifyTelegramInitData,
  verifyTelegramLoginWidget,
} from '../auth.js';
import { audit } from '../audit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripAt(u: string) {
  return u.replace(/^@+/, '').trim();
}

export async function authRoutes(app: FastifyInstance) {
  // ===== Вход по логину и паролю =====
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({ login: z.string().min(1), password: z.string().min(1) })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Укажите логин и пароль' });

      const login = body.data.login.trim().toLowerCase();
      // Пускаем и по логину, и по email, и по telegram-username — людям так привычнее
      const user = await prisma.user.findFirst({
        where: {
          OR: [{ login }, { email: login }, { telegramUsername: stripAt(body.data.login) }],
        },
      });

      // Сравниваем всегда, даже если пользователя нет — чтобы по времени ответа
      // нельзя было понять, существует логин или нет
      const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
      const ok = await bcrypt.compare(body.data.password, hash);
      if (!user || !user.passwordHash || !ok) {
        return reply.code(401).send({ error: 'Неверный логин или пароль' });
      }
      if (!user.isActive) return reply.code(403).send({ error: 'Аккаунт отключён' });

      await issueSession(reply, user, 'web', req.headers['user-agent']);
      await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      return { user: publicUser(user) };
    },
  );

  // ===== Вход через Telegram =====
  // Принимает либо initData (Mini App), либо payload от Login Widget (сайт).
  // НАПИСАНО, НО ВЖИВУЮ НЕ ПРОВЕРЯЛОСЬ — нет бота (см. PROGRESS.md).
  app.post(
    '/auth/telegram',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({
          initData: z.string().min(1).optional(),
          tgAuthPayload: z.record(z.any()).optional(),
        })
        .safeParse(req.body);
      if (!body.success || (!body.data.initData && !body.data.tgAuthPayload)) {
        return reply.code(400).send({ error: 'Нужен initData или tgAuthPayload' });
      }
      if (!env.telegram.botToken) {
        return reply.code(503).send({ error: 'Вход через Telegram не настроен на этом сервере' });
      }

      let tgId: number | undefined;
      let tgUsername: string | undefined;
      let tgName: string | undefined;

      if (body.data.initData) {
        const verified = verifyTelegramInitData(body.data.initData, env.telegram.botToken);
        if (!verified?.user) return reply.code(401).send({ error: 'Подпись initData не сошлась' });
        tgId = verified.user.id;
        tgUsername = verified.user.username;
        tgName = [verified.user.first_name, verified.user.last_name].filter(Boolean).join(' ');
      } else {
        const verified = verifyTelegramLoginWidget(body.data.tgAuthPayload!, env.telegram.botToken);
        if (!verified) return reply.code(401).send({ error: 'Подпись Telegram не сошлась' });
        tgId = verified.id;
        tgUsername = verified.username;
        tgName = [verified.first_name, verified.last_name].filter(Boolean).join(' ');
      }

      const telegramId = BigInt(tgId!);
      let user = await prisma.user.findUnique({ where: { telegramId } });

      // Админ мог завести человека заранее по username — привязываем telegramId
      if (!user && tgUsername) {
        const byUsername = await prisma.user.findUnique({ where: { telegramUsername: tgUsername } });
        if (byUsername) {
          user = await prisma.user.update({ where: { id: byUsername.id }, data: { telegramId } });
        }
      }

      // Нового человека заводим с ролью NONE — доступ выдаёт админ (§4, enum Role)
      if (!user) {
        user = await prisma.user.create({
          data: {
            telegramId,
            telegramUsername: tgUsername ?? null,
            name: tgName || tgUsername || `tg${tgId}`,
            role: 'NONE',
          },
        });
        await audit(null, 'user.self_register', 'User', user.id, { via: 'telegram' });
      } else if (tgUsername && user.telegramUsername !== tgUsername) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { telegramUsername: tgUsername },
        });
      }

      if (!user.isActive) return reply.code(403).send({ error: 'Аккаунт отключён' });

      await issueSession(reply, user, 'tg', req.headers['user-agent']);
      await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      return { user: publicUser(user) };
    },
  );

  // ===== Вход по одноразовой ссылке из бота (magic link, TTL 5 мин) =====
  app.post(
    '/auth/login-link',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ token: z.string().min(10) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Некорректная ссылка' });

      const link = await prisma.loginLink.findUnique({
        where: { tokenHash: hashToken(body.data.token) },
        include: { user: true },
      });
      if (!link || link.usedAt || link.expiresAt < new Date()) {
        return reply.code(401).send({ error: 'Ссылка недействительна или устарела' });
      }
      if (!link.user.isActive) return reply.code(403).send({ error: 'Аккаунт отключён' });

      await prisma.loginLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
      await issueSession(reply, link.user, 'tg', req.headers['user-agent']);
      return { user: publicUser(link.user) };
    },
  );

  // ===== Активация инвайт-кода =====
  app.post(
    '/auth/redeem-invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({
          code: z.string().min(4),
          name: z.string().min(1, 'Укажите имя'),
          login: z
            .string()
            .min(3, 'Логин минимум 3 символа')
            .regex(/^[a-zA-Z0-9._-]+$/, 'Логин: латиница, цифры, . _ -'),
          password: z.string().min(8, 'Пароль минимум 8 символов'),
          email: z.string().regex(EMAIL_RE, 'Некорректный email').optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
      }

      const invite = await prisma.inviteCode.findUnique({ where: { code: body.data.code.trim() } });
      if (!invite || invite.usedById || invite.expiresAt < new Date()) {
        return reply.code(400).send({ error: 'Код недействителен или уже использован' });
      }

      const passwordHash = await bcrypt.hash(body.data.password, env.bcryptCost);
      try {
        const user = await prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              name: body.data.name.trim(),
              login: body.data.login.trim().toLowerCase(),
              email: body.data.email?.trim().toLowerCase() ?? null,
              passwordHash,
              role: invite.role,
              teamRole: invite.teamRole,
            },
          });
          // updateMany с проверкой usedById — гонка двух активаций одного кода
          // не создаст двух пользователей с одной ролью
          const claimed = await tx.inviteCode.updateMany({
            where: { id: invite.id, usedById: null },
            data: { usedById: created.id, usedAt: new Date() },
          });
          if (claimed.count === 0) throw new Error('INVITE_RACE');
          return created;
        });

        await audit(null, 'user.redeem_invite', 'User', user.id, { code: invite.code });
        await issueSession(reply, user, 'invite', req.headers['user-agent']);
        return { user: publicUser(user) };
      } catch (e: any) {
        if (e?.message === 'INVITE_RACE') {
          return reply.code(409).send({ error: 'Код только что использовали' });
        }
        if (e?.code === 'P2002') {
          const target = (e.meta?.target as string[] | undefined) ?? [];
          if (target.includes('login')) return reply.code(409).send({ error: 'Такой логин уже занят' });
          if (target.includes('email')) return reply.code(409).send({ error: 'Этот email уже используется' });
          return reply.code(409).send({ error: 'Такой пользователь уже есть' });
        }
        throw e;
      }
    },
  );

  // ===== Ротация refresh-токена =====
  app.post('/auth/refresh', async (req, reply) => {
    const result = await rotateSession(req, reply);
    if (!result) {
      clearSessionCookies(reply);
      return reply.code(401).send({ error: 'Сессия истекла' });
    }
    return { user: publicUser(result.user) };
  });

  // ===== Выход =====
  app.post('/auth/logout', async (req, reply) => {
    await revokeSession(req, reply);
    return { ok: true };
  });

  // ===== Текущий пользователь =====
  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req);
    // lastSeenAt обновляем не чаще раза в 5 минут — иначе это запись в БД на каждый запрос
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 5 * 60_000) {
      await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    }
    return publicUser(user);
  });

  // ===== Смена своего пароля =====
  app.post('/auth/change-password', { preHandler: requireAuth }, async (req, reply) => {
    const body = z
      .object({ oldPassword: z.string().optional(), newPassword: z.string().min(8, 'Минимум 8 символов') })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
    }
    const user = currentUser(req);
    if (user.passwordHash) {
      const ok = await bcrypt.compare(body.data.oldPassword ?? '', user.passwordHash);
      if (!ok) return reply.code(400).send({ error: 'Текущий пароль неверен' });
    }
    const passwordHash = await bcrypt.hash(body.data.newPassword, env.bcryptCost);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Все прочие сессии отзываем: смена пароля должна выкидывать чужие устройства
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await issueSession(reply, user, 'web', req.headers['user-agent']);
    await audit(req, 'user.change_password', 'User', user.id);
    return { ok: true };
  });

  // ===== Выдача одноразовой ссылки входа (используется ботом) =====
  // Возвращает готовый URL. В console-режиме бот печатает его в лог сервера.
  app.post('/auth/issue-login-link', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req);
    return { url: await createLoginLink(user.id) };
  });
}

/** Создаёт одноразовую ссылку входа со сроком жизни 5 минут. */
export async function createLoginLink(userId: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.loginLink.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return `${env.publicWebUrl}/login?token=${raw}`;
}
