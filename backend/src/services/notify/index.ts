import { env } from '../../env.js';
import { consoleNotifier } from './console.provider.js';
import { telegramNotifier } from './telegram.provider.js';

export interface Notifier {
  /** Сообщение администраторам (алерты, сводки). */
  alert(text: string): Promise<void>;
  /** Личное сообщение пользователю по его telegramId. */
  toUser(telegramId: bigint, text: string): Promise<void>;
  readonly name: string;
}

/**
 * Уведомления за адаптером. По умолчанию — вывод в лог сервера: система
 * полностью работоспособна без Telegram-бота.
 */
export const notifier: Notifier =
  env.telegram.provider === 'telegram' && env.telegram.botToken ? telegramNotifier : consoleNotifier;

/** Не даём падению уведомления уронить бизнес-операцию. */
export async function safeAlert(text: string): Promise<void> {
  try {
    await notifier.alert(text);
  } catch (e) {
    console.error('[notify] не удалось отправить алерт:', e);
  }
}
