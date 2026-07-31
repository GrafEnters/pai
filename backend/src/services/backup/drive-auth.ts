import { OAuth2Client } from 'google-auth-library';
import { env } from '../../env.js';
import { SETTING_KEYS, getSetting, setSetting } from '../../settings.js';
import { safeAlert } from '../notify/index.js';

/**
 * OAuth обычного Google-аккаунта (PLAN §9.0). НЕ ПРОВЕРЯЛОСЬ ВЖИВУЮ — нет аккаунта.
 *
 * Три вещи, без которых бэкап тихо умрёт (подробности в SETUP.md):
 *   1. приложение в статусе In production — иначе refresh-токен живёт 7 дней;
 *   2. scope только drive.file;
 *   3. авторизация с access_type=offline И prompt=consent.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let client: OAuth2Client | null = null;

/** Токен читаем так: сначала БД, потом .env — .env только начальное значение (§9.0). */
export async function currentRefreshToken(): Promise<string | undefined> {
  const fromDb = await getSetting<string>(SETTING_KEYS.googleRefreshToken);
  return fromDb || env.google.refreshToken;
}

export async function getDriveClient(): Promise<OAuth2Client> {
  if (client) return client;

  const { clientId, clientSecret, redirectUri } = env.google;
  if (!clientId || !clientSecret) {
    throw new Error(
      'BACKUP_PROVIDER=google-drive, но не заданы GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (см. SETUP.md)',
    );
  }
  const refreshToken = await currentRefreshToken();
  if (!refreshToken) {
    throw new Error('Нет GOOGLE_REFRESH_TOKEN. Получите его командой: npm run drive:auth');
  }

  const oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
  oauth.setCredentials({ refresh_token: refreshToken });

  // Google изредка ротирует сам refresh-токен. Если это произошло и мы его не сохранили,
  // следующий рестарт процесса пойдёт со старым и получит invalid_grant (§9.0).
  oauth.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      void setSetting(SETTING_KEYS.googleRefreshToken, tokens.refresh_token).then(() =>
        console.log('[drive] Google выдал новый refresh-токен, сохранён в настройках'),
      );
    }
  });

  client = oauth;
  return oauth;
}

/** Сбрасываем клиент, чтобы следующий вызов перечитал токен (после переавторизации). */
export function resetDriveClient(): void {
  client = null;
}

export async function driveAccessToken(): Promise<string> {
  const oauth = await getDriveClient();
  try {
    const { token } = await oauth.getAccessToken();
    if (!token) throw new Error('Google не вернул access-токен');
    return token;
  } catch (e) {
    await handleAuthError(e);
    throw e;
  }
}

/**
 * Отзыв доступа обрабатываем громко: молчаливая деградация здесь — худший
 * из возможных исходов (§9.0). Бэкап, который встал месяц назад и никто
 * не заметил, — это отсутствие бэкапа.
 */
export async function handleAuthError(e: unknown): Promise<boolean> {
  const message = String((e as { message?: string })?.message ?? e);
  const isInvalidGrant = message.includes('invalid_grant') || message.includes('invalid_request');
  if (!isInvalidGrant) return false;

  resetDriveClient();
  await safeAlert(
    '🛑 Google отозвал доступ к Диску — БЭКАПЫ СТОЯТ.\n\n' +
      'Нужна переавторизация: npm run drive:auth на любой машине, затем новый токен ' +
      'в настройки или в .env и рестарт.\n\n' +
      'Частые причины: смена пароля аккаунта, ручной отзыв в «Аккаунт Google → Безопасность → ' +
      'Сторонние приложения», удаление OAuth-клиента, или приложение осталось в статусе ' +
      'Testing (тогда токен живёт 7 дней).',
  );
  return true;
}

/** Ссылка для получения кода авторизации — используется скриптом drive:auth. */
export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    // Без обоих параметров Google не вернёт refresh-токен при повторной авторизации,
    // и это не видно из ответа (§9.0, ловушка 3)
    access_type: 'offline',
    prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}
