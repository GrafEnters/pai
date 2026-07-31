import { Bot } from 'grammy';
import { prisma } from './db.js';
import { env } from './env.js';
import { createLoginLink } from './routes/auth.js';
import { audit } from './audit.js';

/**
 * Telegram-бот: регистрация по /start и одноразовая ссылка входа по /login.
 * НАПИСАНО, НО ВЖИВУЮ НЕ ПРОВЕРЯЛОСЬ — нет бота (см. PROGRESS.md).
 *
 * Без TELEGRAM_BOT_TOKEN бот просто не запускается: система остаётся полностью
 * рабочей, вход идёт по логину и паролю.
 */
export async function startBot(log: (msg: string) => void = console.log): Promise<Bot | null> {
  if (env.telegram.provider !== 'telegram' || !env.telegram.botToken) {
    log('[bot] Telegram отключён (TELEGRAM_PROVIDER=console) — вход по логину и паролю');
    return null;
  }

  const bot = new Bot(env.telegram.botToken);

  bot.command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const telegramId = BigInt(from.id);

    let user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user && from.username) {
      const byUsername = await prisma.user.findUnique({ where: { telegramUsername: from.username } });
      if (byUsername) {
        user = await prisma.user.update({ where: { id: byUsername.id }, data: { telegramId } });
      }
    }

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId,
          telegramUsername: from.username ?? null,
          name: [from.first_name, from.last_name].filter(Boolean).join(' ') || `tg${from.id}`,
          role: 'NONE',
        },
      });
      await audit(null, 'user.self_register', 'User', user.id, { via: 'bot' });
      await ctx.reply(
        'Привет! Вы зарегистрированы в базе знаний.\n\n' +
          'Доступ выдаёт администратор — напишите ему, что зарегистрировались. ' +
          'Как только доступ появится, команда /login пришлёт ссылку для входа.',
      );
      return;
    }

    if (user.role === 'NONE') {
      await ctx.reply('Вы уже зарегистрированы, но доступ ещё не выдан. Напишите администратору.');
      return;
    }
    await ctx.reply('С возвращением! Команда /login пришлёт ссылку для входа.');
  });

  bot.command('login', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(from.id) } });
    if (!user) return ctx.reply('Сначала отправьте /start.');
    if (!user.isActive) return ctx.reply('Аккаунт отключён. Обратитесь к администратору.');
    if (user.role === 'NONE') return ctx.reply('Доступ ещё не выдан. Напишите администратору.');

    const url = await createLoginLink(user.id);
    await ctx.reply(`Ссылка для входа (действует 5 минут):\n${url}`, {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command('help', (ctx) =>
    ctx.reply('/start — регистрация\n/login — ссылка для входа на сайт'),
  );

  bot.catch((err) => console.error('[bot] ошибка:', err));

  // start() не await'им: он держит long polling до остановки процесса
  void bot.start({
    onStart: (info) => log(`[bot] запущен как @${info.username}`),
  });

  return bot;
}
