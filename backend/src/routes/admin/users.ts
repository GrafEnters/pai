import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { currentUser, publicUser, requireRole } from '../../auth.js';
import { audit, diffOf } from '../../audit.js';

const ROLES = ['NONE', 'VIEWER', 'EDITOR', 'ADMIN'] as const;
const TEAM_ROLES = ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'] as const;

export async function adminUserRoutes(app: FastifyInstance) {
  const onlyAdmin = { preHandler: requireRole('ADMIN') };

  // ===== Список =====
  app.get('/admin/users', onlyAdmin, async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        role: z.enum(ROLES).optional(),
        teamRole: z.enum(TEAM_ROLES).optional(),
        active: z.enum(['1', '0']).optional(),
      })
      .parse(req.query);

    const where: any = {};
    if (q.role) where.role = q.role;
    if (q.teamRole) where.teamRole = q.teamRole;
    if (q.active) where.isActive = q.active === '1';
    if (q.q?.trim()) {
      const s = q.q.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { login: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { telegramUsername: { contains: s, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { role: 'desc' }, { name: 'asc' }],
    });
    return users.map(publicUser);
  });

  // ===== Создание вручную (без инвайта) =====
  app.post('/admin/users', onlyAdmin, async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        login: z.string().min(3).regex(/^[a-zA-Z0-9._-]+$/, 'Логин: латиница, цифры, . _ -'),
        password: z.string().min(8, 'Пароль минимум 8 символов'),
        email: z.string().email().optional(),
        telegramUsername: z.string().optional(),
        role: z.enum(ROLES).default('VIEWER'),
        teamRole: z.enum(TEAM_ROLES).default('OTHER'),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
    }

    try {
      const user = await prisma.user.create({
        data: {
          name: body.data.name.trim(),
          login: body.data.login.trim().toLowerCase(),
          email: body.data.email?.trim().toLowerCase() ?? null,
          telegramUsername: body.data.telegramUsername?.replace(/^@+/, '').trim() || null,
          passwordHash: await bcrypt.hash(body.data.password, env.bcryptCost),
          role: body.data.role,
          teamRole: body.data.teamRole,
        },
      });
      await audit(req, 'user.create', 'User', user.id, {
        login: user.login,
        role: user.role,
      });
      return publicUser(user);
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const t = (e.meta?.target as string[] | undefined) ?? [];
        if (t.includes('login')) return reply.code(409).send({ error: 'Такой логин уже занят' });
        if (t.includes('email')) return reply.code(409).send({ error: 'Этот email уже используется' });
        if (t.includes('telegramUsername'))
          return reply.code(409).send({ error: 'Этот Telegram уже привязан' });
        return reply.code(409).send({ error: 'Такой пользователь уже есть' });
      }
      throw e;
    }
  });

  // ===== Изменение роли / деактивация =====
  app.patch('/admin/users/:id', onlyAdmin, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        role: z.enum(ROLES).optional(),
        teamRole: z.enum(TEAM_ROLES).optional(),
        isActive: z.boolean().optional(),
        email: z.string().email().nullable().optional(),
        telegramUsername: z.string().nullable().optional(),
        password: z.string().min(8).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'Некорректные данные' });
    }

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'Пользователь не найден' });

    const me = currentUser(req);
    // Защита от «отстрелить себе ногу»: последний активный ADMIN не может
    // разжаловать сам себя или выключиться — иначе в систему больше не войти
    const losingAdmin =
      target.role === 'ADMIN' &&
      ((body.data.role !== undefined && body.data.role !== 'ADMIN') || body.data.isActive === false);
    if (losingAdmin) {
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: id } },
      });
      if (otherAdmins === 0) {
        return reply.code(400).send({ error: 'Это последний активный администратор' });
      }
      if (target.id === me.id) {
        return reply.code(400).send({ error: 'Нельзя снять роль администратора с себя' });
      }
    }

    const data: any = {};
    if (body.data.name !== undefined) data.name = body.data.name.trim();
    if (body.data.role !== undefined) data.role = body.data.role;
    if (body.data.teamRole !== undefined) data.teamRole = body.data.teamRole;
    if (body.data.isActive !== undefined) data.isActive = body.data.isActive;
    if (body.data.email !== undefined) data.email = body.data.email?.trim().toLowerCase() ?? null;
    if (body.data.telegramUsername !== undefined) {
      data.telegramUsername = body.data.telegramUsername?.replace(/^@+/, '').trim() || null;
    }
    if (body.data.password) data.passwordHash = await bcrypt.hash(body.data.password, env.bcryptCost);

    try {
      const updated = await prisma.user.update({ where: { id }, data });

      // Деактивация или понижение роли — рубим живые сессии сразу (§7.1)
      if (data.isActive === false || (data.role && data.role !== target.role)) {
        await prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await audit(req, 'user.update', 'User', id, diffOf(target as unknown as Record<string, unknown>, data));
      return publicUser(updated);
    } catch (e: any) {
      if (e?.code === 'P2002') return reply.code(409).send({ error: 'Логин, email или Telegram уже заняты' });
      throw e;
    }
  });

  // ===== Активные сессии пользователя =====
  app.get('/admin/users/:id/sessions', onlyAdmin, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return prisma.refreshToken.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.delete('/admin/users/:id/sessions', onlyAdmin, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const res = await prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(req, 'user.revoke_sessions', 'User', id, { count: res.count });
    return { revoked: res.count };
  });
}
