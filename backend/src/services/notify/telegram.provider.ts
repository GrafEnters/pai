import { env } from '../../env.js';
import type { Notifier } from './index.js';

/**
 * Боевая реализация через Bot API. НЕ ПРОВЕРЯЛАСЬ ВЖИВУЮ — нет бота.
 * Включается переменной TELEGRAM_PROVIDER=telegram при заполненном
 * TELEGRAM_BOT_TOKEN (см. SETUP.md).
 */
async function send(chatId: string | bigint, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.telegram.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 300)}`);
  }
}

export const telegramNotifier: Notifier = {
  name: 'telegram',

  async alert(text: string) {
    if (!env.telegram.alertChatId) {
      console.warn('[notify] TELEGRAM_ALERT_CHAT_ID не задан — алерт напечатан в лог:\n' + text);
      return;
    }
    await send(env.telegram.alertChatId, text);
  },

  async toUser(telegramId: bigint, text: string) {
    await send(telegramId, text);
  },
};
