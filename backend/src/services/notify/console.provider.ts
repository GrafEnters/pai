import type { Notifier } from './index.js';

/**
 * Локальная реализация: всё, что ушло бы в Telegram, печатается в лог сервера.
 * Это не заглушка «ничего не делаем» — сообщение реально видно оператору,
 * просто в другом канале.
 */
export const consoleNotifier: Notifier = {
  name: 'console',

  async alert(text: string) {
    console.log(`\n${box('TELEGRAM · АЛЕРТ', text)}\n`);
  },

  async toUser(telegramId: bigint, text: string) {
    console.log(`\n${box(`TELEGRAM · пользователю ${telegramId}`, text)}\n`);
  },
};

function box(title: string, body: string): string {
  const lines = body.split('\n');
  const width = Math.min(100, Math.max(title.length, ...lines.map((l) => l.length)) + 2);
  const top = `┌─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 3))}┐`;
  const bottom = `└${'─'.repeat(width + 1)}┘`;
  return [top, ...lines.map((l) => `│ ${l}`), bottom].join('\n');
}
