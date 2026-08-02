import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { currentUser, requireRole } from '../../auth.js';
import { audit } from '../../audit.js';

const ROLES = ['VIEWER', 'EDITOR', 'ADMIN'] as const;
const TEAM_ROLES = ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'] as const;

/** Код без похожих друг на друга символов — его диктуют голосом и пересылают в чат. */
function generateCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

export async function adminInviteRoutes(app: FastifyInstance) {
  const onlyAdmin = { preHandler: requireRole('ADMIN') };

  app.get('/admin/invites', onlyAdmin, async () => {
    const invites = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const userIds = [
      ...new Set(invites.flatMap((i) => [i.createdById, i.usedById].filter(Boolean) as number[])),
    ];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.name]));

    return invites.map((i) => ({
      ...i,
      createdByName: byId.get(i.createdById) ?? null,
      usedByName: i.usedById ? (byId.get(i.usedById) ?? null) : null,
      isExpired: i.expiresAt < new Date(),
      url: `${env.publicWebUrl}/invite?code=${i.code}`,
    }));
  });

  app.post('/admin/invites', onlyAdmin, async (req, reply) => {
    const body = z
      .object({
        role: z.enum(ROLES).default('VIEWER'),
        teamRole: z.enum(TEAM_ROLES).default('OTHER'),
        note: z.string().max(200).optional(),
        expiresInDays: z.coerce.number().int().min(1).max(90).default(14),
        count: z.coerce.number().int().min(1).max(50).default(1),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные' });

    const me = currentUser(req);
    const expiresAt = new Date(Date.now() + body.data.expiresInDays * 86400_000);
    const created = [];
    for (let i = 0; i < body.data.count; i++) {
      created.push(
        await prisma.inviteCode.create({
          data: {
            code: generateCode(),
            role: body.data.role,
            teamRole: body.data.teamRole,
            note: body.data.note ?? null,
            createdById: me.id,
            expiresAt,
          },
        }),
      );
    }
    await audit(req, 'invite.create', 'InviteCode', created.map((c) => c.id).join(','), {
      role: body.data.role,
      count: created.length,
    });
    return created.map((c) => ({ ...c, url: `${env.publicWebUrl}/invite?code=${c.code}` }));
  });

  // Ссылка многоразовая, поэтому «удалить» значит прежде всего «закрыть вход»:
  // пока она жива, по ней заходят. По той, где уже кто-то прошёл, оставляем
  // запись — иначе из админки пропадёт, откуда взялись эти люди
  app.delete('/admin/invites/:id', onlyAdmin, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const invite = await prisma.inviteCode.findUnique({ where: { id } });
    if (!invite) return reply.code(404).send({ error: 'Ссылка не найдена' });

    if (invite.usedCount > 0) {
      await prisma.inviteCode.update({ where: { id }, data: { expiresAt: new Date() } });
      await audit(req, 'invite.revoke', 'InviteCode', id, { code: invite.code, usedCount: invite.usedCount });
      return { ok: true, revoked: true };
    }

    await prisma.inviteCode.delete({ where: { id } });
    await audit(req, 'invite.delete', 'InviteCode', id, { code: invite.code });
    return { ok: true, revoked: false };
  });
}
