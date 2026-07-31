import bcrypt from 'bcryptjs';
import { prisma } from './db.js';
import { env } from './env.js';
import { applySqlPatches } from './sqlPatches.js';

/**
 * Первый администратор + базовые категории.
 * Идемпотентен: повторный запуск ничего не ломает и не перетирает.
 * Паттерн — ensureDefaultTicketTypes из polina-crm.
 */

const DEFAULT_CATEGORIES = [
  { slug: 'onboarding', title: 'Онбординг', icon: 'GraduationCap', color: '#8b5cf6', sortOrder: 10,
    description: 'С чего начать новичку' },
  { slug: 'facebook', title: 'Facebook', icon: 'Facebook', color: '#3b82f6', sortOrder: 20,
    description: 'Запуск, антибан, кабинеты, БМ' },
  { slug: 'tiktok', title: 'TikTok', icon: 'Music2', color: '#ec4899', sortOrder: 30,
    description: 'Креативы, кабинеты, модерация' },
  { slug: 'proxy', title: 'Прокси', icon: 'Network', color: '#22c55e', sortOrder: 40,
    description: 'Выбор, настройка, диагностика' },
  { slug: 'payments', title: 'Платёжки', icon: 'CreditCard', color: '#f59e0b', sortOrder: 50,
    description: 'Карты, кошельки, пополнения' },
];

export async function seed(log: (msg: string) => void = console.log) {
  await applySqlPatches(log);

  // ===== Первый администратор =====
  const login = env.admin.login.trim().toLowerCase();
  let admin = await prisma.user.findFirst({
    where: { OR: [{ login }, ...(env.admin.telegramUsername ? [{ telegramUsername: env.admin.telegramUsername }] : [])] },
  });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        login,
        name: env.admin.name,
        email: env.admin.email ?? null,
        telegramUsername: env.admin.telegramUsername ?? null,
        passwordHash: await bcrypt.hash(env.admin.password, env.bcryptCost),
        role: 'ADMIN',
        teamRole: 'MANAGER',
      },
    });
    log(`[seed] создан администратор: ${login} (пароль из ADMIN_PASSWORD)`);
  } else if (admin.role !== 'ADMIN' || !admin.isActive) {
    // Восстанавливаем доступ, если роль случайно сняли — иначе в систему не войти
    admin = await prisma.user.update({
      where: { id: admin.id },
      data: { role: 'ADMIN', isActive: true },
    });
    log(`[seed] администратору ${login} возвращена роль ADMIN`);
  } else {
    log(`[seed] администратор ${login} уже есть`);
  }

  // ===== Базовые категории =====
  let created = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findUnique({ where: { slug: c.slug } });
    if (!existing) {
      await prisma.category.create({ data: c });
      created++;
    }
  }
  log(created ? `[seed] создано категорий: ${created}` : '[seed] категории уже на месте');

  return admin;
}

// Запуск как отдельный скрипт: npm run seed
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('/seed.');
if (isDirectRun) {
  seed()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('[seed] ошибка:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
