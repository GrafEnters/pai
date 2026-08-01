import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireRole } from '../../auth.js';
import { audit } from '../../audit.js';
import { getAllSettings, setSetting } from '../../settings.js';
import { netcheck } from '../../services/netcheck.js';

/** Ключи настроек, которые можно менять из админки. Остальное — только через .env. */
const EDITABLE_SETTINGS = new Set([
  'analytics.read_scroll_pct',
  'analytics.read_time_ratio',
  'google.refresh_token',
  'google.root_folder_id',
]);

export async function adminSystemRoutes(app: FastifyInstance) {
  const onlyAdmin = { preHandler: requireRole('ADMIN') };

  // ===== Аудит-лог =====
  app.get('/admin/audit', onlyAdmin, async (req) => {
    const q = z
      .object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        action: z.string().optional(),
        userId: z.coerce.number().int().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);

    const where: any = {};
    if (q.entity) where.entity = q.entity;
    if (q.entityId) where.entityId = q.entityId;
    if (q.action) where.action = { contains: q.action };
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.ts = {};
      if (q.from) where.ts.gte = new Date(q.from);
      if (q.to) where.ts.lte = new Date(q.to);
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { ts: 'desc' },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean) as number[])];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u.name]));

    return {
      items: rows.map((r) => ({ ...r, userName: r.userId ? (byId.get(r.userId) ?? null) : null })),
      total,
      page: q.page,
      limit: q.limit,
    };
  });

  // ===== Настройки =====
  app.get('/admin/settings', onlyAdmin, async () => {
    const all = await getAllSettings();
    // Секреты наружу не отдаём — только признак, что значение задано
    if (all['google.refresh_token']) all['google.refresh_token'] = '***';
    return all;
  });

  app.put('/admin/settings', onlyAdmin, async (req, reply) => {
    const body = z.record(z.any()).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Ожидается объект ключ-значение' });

    const applied: string[] = [];
    for (const [key, value] of Object.entries(body.data)) {
      if (!EDITABLE_SETTINGS.has(key)) continue;
      if (value === '***') continue; // не затираем секрет замаскированным значением
      await setSetting(key, value);
      applied.push(key);
    }
    await audit(req, 'settings.update', 'Setting', null, { keys: applied });
    return { ok: true, applied };
  });

  // ===== Проверка исходящей связи =====
  //
  // Консоли у Amvera нет, выполнить curl изнутри контейнера негде — а бэкап
  // падает на сетевой ошибке, которую снаружи не воспроизвести: с локальной
  // машины те же адреса открываются. Поэтому проверка живёт здесь.
  app.get('/admin/system/netcheck', onlyAdmin, async (req) => {
    const report = await netcheck();
    // Дублируем в лог: результат нужен и в панели Amvera, рядом с ошибками прогона
    req.log.info(`[netcheck] Node ${report.runtime.node}, undici ${report.runtime.undici}`);
    req.log.info(`[netcheck] внешний адрес: ${report.egressIp ?? 'не определился'}`);
    for (const line of report.summary) req.log.info(`[netcheck] ${line}`);
    return report;
  });
}
