/**
 * Получение refresh-токена Google Drive: npm run drive:auth
 *
 * Поднимает localhost-callback, открывает браузер, вы логинитесь ВЫДЕЛЕННЫМ
 * аккаунтом и подтверждаете доступ. Токен печатается в консоль и сохраняется
 * в настройки (Setting), откуда его читает бэкап.
 *
 * НЕ ЗАПУСКАЛОСЬ ВЖИВУЮ — нет Google-аккаунта. См. SETUP.md, там же три ловушки,
 * из-за каждой из которых бэкап отваливается молча.
 */
import http from 'node:http';
import { exec } from 'node:child_process';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { SETTING_KEYS, setSetting } from '../settings.js';
import { DRIVE_SCOPE, buildAuthUrl } from '../services/backup/drive-auth.js';

const { clientId, clientSecret, redirectUri } = env.google;

if (!clientId || !clientSecret) {
  console.error(
    'Не заданы GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.\n' +
      'Возьмите их в console.cloud.google.com → APIs & Services → Credentials →\n' +
      'Create Credentials → OAuth client ID → тип «Desktop app». Подробности в SETUP.md.',
  );
  process.exit(1);
}

const url = new URL(redirectUri);
const port = Number(url.port || 53682);
const authUrl = buildAuthUrl(clientId, redirectUri);

console.log('\n═══ Авторизация Google Drive ═══\n');
console.log('Проверьте перед началом (иначе бэкап отвалится молча):');
console.log('  1. OAuth-приложение в статусе «In production», а не «Testing»');
console.log(`  2. Scope ровно один: ${DRIVE_SCOPE}`);
console.log('  3. Запрос идёт с access_type=offline и prompt=consent — это уже в ссылке ниже\n');
console.log('Откройте в браузере (должно открыться само):\n');
console.log(authUrl + '\n');

const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
exec(`${opener} "${authUrl}"`, () => {});

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
  if (requestUrl.pathname !== url.pathname) {
    res.writeHead(404).end('Not found');
    return;
  }

  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');

  if (error || !code) {
    res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>Не получилось</h1><p>${error ?? 'Google не вернул код'}</p>`);
    console.error(`\nОшибка авторизации: ${error ?? 'нет кода'}`);
    server.close();
    await prisma.$disconnect();
    process.exit(1);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string; error?: string };

    if (!tokenRes.ok || tokens.error) {
      throw new Error(tokens.error ?? `HTTP ${tokenRes.status}`);
    }

    if (!tokens.refresh_token) {
      // Ровно та ловушка №3 из §9.0: без prompt=consent Google молча отдаёт
      // только access-токен, и это не видно из ответа
      throw new Error(
        'Google вернул access-токен, но НЕ вернул refresh_token.\n' +
          'Так бывает при повторной авторизации без prompt=consent, либо если доступ уже выдан.\n' +
          'Отзовите доступ в «Аккаунт Google → Безопасность → Сторонние приложения» и повторите.',
      );
    }

    await setSetting(SETTING_KEYS.googleRefreshToken, tokens.refresh_token);

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<h1>Готово</h1><p>Refresh-токен получен и сохранён. Можно закрыть вкладку.</p>');

    console.log('\n✅ Refresh-токен получен и сохранён в настройках приложения.\n');
    console.log('Продублируйте его в .env, чтобы пережить пересоздание базы:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('Проверьте, что всё работает:  npm run backup -- --kind=DB\n');

    server.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>Ошибка</h1><pre>${String(e)}</pre>`);
    console.error(`\n${String(e)}`);
    server.close();
    await prisma.$disconnect();
    process.exit(1);
  }
});

server.listen(port, () => console.log(`Жду ответ Google на http://localhost:${port}${url.pathname} …\n`));
