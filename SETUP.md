# SETUP.md — что нужно сделать руками

Система полностью работает **без единого внешнего аккаунта**: хранилище — папка на диске,
бэкап — папка на диске, Telegram — вывод в консоль, CDN — заглушка с логом.
Этот документ нужен только для выкатки на прод.

Порядок важен: каждый следующий шаг опирается на предыдущий.

---

# ⚠️ ТРИ ЛОВУШКИ GOOGLE OAUTH

**Прочитайте это до того, как заводить Google-аккаунт.**
Каждая из трёх убивает бэкап **молча** — система продолжит работать, письма об ошибке
не будет, и вы узнаете об этом в тот день, когда бэкап понадобится.

> ## 1. Статус приложения — «In production», а не «Testing»
>
> **Где:** [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services →
> OAuth consent screen → кнопка **PUBLISH APP** → статус меняется на *In production*.
>
> **Что будет, если забыть:** в статусе *Testing* Google протухает refresh-токен
> **ровно через 7 дней**. Бэкапы отвалятся через неделю после запуска — когда все уже
> расслабились и перестали проверять.
>
> При переходе в Production Google покажет экран «приложение не проверено»:
> **«Дополнительно» → «Перейти на … (небезопасно)»**. Это нормально — приложение ваше
> и внутреннее, проверка Google нужна только для публичных приложений.

> ## 2. Scope — ровно один: `drive.file`. НЕ `drive`
>
> **Где:** OAuth consent screen → Scopes → Add or Remove Scopes →
> вписать вручную `https://www.googleapis.com/auth/drive.file`.
>
> **Что будет, если взять `drive`:** приложение попадёт в категорию *restricted scope*
> и потребует платной верификации Google (аудит безопасности, недели ожидания, деньги).
> Пока верификация не пройдена — приложение просто не работает.
>
> `drive.file` даёт доступ **только к файлам, которые приложение создало само**.
> Нам этого достаточно: всю структуру папок создаёт приложение. Побочный плюс —
> наш сервер физически не видит остальное содержимое Диска.
>
> **Следствие, о которое легко споткнуться:** папку `PAI Backups` **нельзя создать
> руками** в веб-интерфейсе Диска — приложению она не будет видна, и запись не пройдёт.
> Папку создаёт само приложение при первом прогоне, её `folderId` сохраняется в настройках.

> ## 3. Авторизация с `access_type=offline` **и** `prompt=consent`
>
> **Где:** это уже зашито в `npm run drive:auth` — но если будете делать руками
> или через другой инструмент, оба параметра обязательны.
>
> **Что будет, если забыть `prompt=consent`:** при **повторной** авторизации Google
> вернёт только access-токен, а refresh-токен — нет. И это **никак не видно из ответа**:
> запрос успешен, токен получен, всё выглядит правильно. Бэкап проработает час
> (пока жив access-токен) и встанет.
>
> Скрипт `drive:auth` проверяет это явно и ругается, если `refresh_token` не пришёл.
> Если так случилось — отзовите доступ в
> [Аккаунт Google → Безопасность → Сторонние приложения](https://myaccount.google.com/permissions)
> и повторите.

**Как убедиться, что всё три сделаны правильно:** через 8 дней после запуска бэкап
всё ещё зелёный. Раньше — не проверить никак, поэтому поставьте себе напоминание
на первый еженедельный обзор.

---

## Шаг 0. Домен и DNS — 15 минут

1. Определиться с доменом. В конфигах везде подставлен `pai.1sx.biz` как пример —
   если домен другой, поменяйте в трёх местах: `Caddyfile`, `.env` (`PUBLIC_WEB_URL`,
   `NEXT_PUBLIC_API_URL`, `VITE_API_URL`, `COOKIE_DOMAIN`), `.gitlab-ci.yml` (`DEPLOY_DIR`).
2. Поддомены: `pai` (сайт), `admin` (админка), `api` (API), `media` (медиа).

## Шаг 1. VPS — 30 минут

1. Завести сервер. Рекомендация плана — Hetzner CPX31 (4 vCPU / 8 ГБ / 160 ГБ, ~€14/мес),
   регион по географии команды: [console.hetzner.cloud](https://console.hetzner.cloud).
2. Поставить Docker: `curl -fsSL https://get.docker.com | sh`.
3. Закрыть всё лишнее: `ufw allow 22,80,443/tcp && ufw enable`, вход по ключу,
   `fail2ban` на SSH, автообновления безопасности.
4. Склонировать репозиторий в `/home/sonic/pai` (или поменяйте `DEPLOY_DIR` в CI).

## Шаг 2. Cloudflare — 40 минут

1. Завести аккаунт: [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up),
   добавить домен, **делегировать NS** у регистратора. Бесплатного плана достаточно.
2. A-записи всех четырёх поддоменов → IP сервера, **оранжевое облако** (proxied).
3. **Настройки зоны** (Speed / SSL): Brotli, HTTP/3 + 0-RTT, Early Hints,
   **Tiered Cache**, Always Use HTTPS, HSTS. Auto Minify — **выключить**
   (Next.js уже минифицирует, повторная минификация ломает разметку).
4. **Cache Rules** (Caching → Cache Rules):

   | Правило | Действие |
   |---|---|
   | `media.pai.1sx.biz/*` | Cache Everything, Edge TTL 1 год, Browser TTL 1 год |
   | `pai.1sx.biz/_next/static/*` | Cache Everything, 1 год |
   | `api.pai.1sx.biz/*` | Bypass Cache |
   | `admin.pai.1sx.biz/*` | Bypass Cache |

   Кэш HTML (`/g/*`, `/c/*`, `/`) включайте **только вместе с Worker'ом** из §6.4 плана —
   иначе edge начнёт отдавать гайды неавторизованным.
5. **Zero Trust → Access** на админку: Applications → Add → Self-hosted,
   домен `admin.pai.1sx.biz`, политика Allow по списку e-mail редакторов.
   Бесплатно до 50 мест, редакторов 2–5. На публичный сайт Access **не вешать** —
   почему, подробно в §6.4 плана.
6. **API-токен для сброса кэша**: My Profile → API Tokens → Create Token →
   шаблон **Zone.Cache Purge** → выбрать зону.
   Zone ID берётся на странице домена → Overview, правая колонка.

   ```
   CDN_PROVIDER=cloudflare
   CLOUDFLARE_ZONE_ID=<Zone ID со страницы Overview>
   CLOUDFLARE_API_TOKEN=<токен Zone.Cache Purge>
   ```

## Шаг 3. Cloudflare R2 — 20 минут

1. R2 → Create bucket, имя `pai-media`.
2. **Manage R2 API Tokens** → Create API token → права *Object Read & Write*.
   Скопировать Access Key ID и Secret Access Key — **Secret показывается один раз**.
3. Account ID виден в правой колонке дашборда R2.
4. Bucket → Settings → Public access → **Connect Domain** → `media.pai.1sx.biz`.
5. В `.env`:

   ```
   STORAGE_PROVIDER=r2
   R2_ACCOUNT_ID=<Account ID>
   R2_ACCESS_KEY_ID=<Access Key ID>
   R2_SECRET_ACCESS_KEY=<Secret Access Key>
   R2_BUCKET=pai-media
   R2_ENDPOINT=https://<Account ID>.r2.cloudflarestorage.com
   R2_PUBLIC_URL=https://media.pai.1sx.biz
   ```

6. Включить versioning в настройках бакета — второй контур защиты от случайного удаления.
7. После переключения блок `media.pai.1sx.biz` в `Caddyfile` больше не нужен:
   файлы отдаёт CDN напрямую из бакета.

> **Код R2 написан, но ни разу не запускался** — R2-аккаунта не было.
> После переключения обязательно проверьте загрузку картинки через админку
> и `curl -I` на её адрес: должен прийти AVIF с `cache-control: immutable`.

## Шаг 4. Google-аккаунт под бэкапы — 30 минут

**Сначала перечитайте блок с тремя ловушками в начале файла.**

1. Завести **выделенный** аккаунт, например `pai.backup@gmail.com`.
   Не личный чей-то: смена пароля или увольнение владельца убивают бэкапы.
   Включить 2FA, положить логин, пароль и резервные коды в командный менеджер паролей.
2. Под этим аккаунтом: [console.cloud.google.com](https://console.cloud.google.com) →
   создать проект (например `pai-backups`).
3. APIs & Services → Library → найти **Google Drive API** → Enable.
4. APIs & Services → **OAuth consent screen**:
   - User Type: External;
   - заполнить название приложения и контактный e-mail;
   - **Scopes** → добавить вручную `https://www.googleapis.com/auth/drive.file` — **ловушка 2**;
   - **PUBLISH APP** → статус *In production* — **ловушка 1**.
5. APIs & Services → Credentials → Create Credentials → **OAuth client ID** →
   тип **Desktop app**. Скопировать Client ID и Client Secret.
6. В `.env`:

   ```
   BACKUP_PROVIDER=google-drive
   GOOGLE_OAUTH_CLIENT_ID=<Client ID>
   GOOGLE_OAUTH_CLIENT_SECRET=<Client Secret>
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:53682/oauth2callback
   ```

7. Получить refresh-токен — на любой машине, где есть репозиторий:

   ```bash
   cd backend && npm run drive:auth
   ```

   Откроется браузер, залогиниться **выделенным** аккаунтом, подтвердить доступ.
   Токен напечатается в консоль и сохранится в настройках приложения — **ловушка 3**
   уже учтена в скрипте.
8. Продублировать токен в `.env` (чтобы пережить пересоздание базы):

   ```
   GOOGLE_REFRESH_TOKEN=<длинная строка из вывода скрипта>
   ```

9. **Проверить тем путём, которым пойдёт прод** — не через веб-интерфейс Диска:

   ```bash
   npm run backup -- --kind=DB
   npm run restore -- --list
   ```

10. Место: 15 ГБ бесплатно. Дампы БД и текст влезут, видео — нет.
    [Google One 2 ТБ](https://one.google.com) ≈ $10/мес. При остатке < 15%
    приложение само пришлёт алерт.

## Шаг 5. Telegram-бот — 10 минут

1. [@BotFather](https://t.me/BotFather) → `/newbot` → имя и username
   (например `pai_guides_bot`). Скопировать токен.
2. Написать боту `/start`, затем открыть
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и взять `chat.id` — туда пойдут алерты.
   Для группы: добавить бота в группу, написать там что-нибудь, `chat.id` будет отрицательным.
3. В `.env`:

   ```
   TELEGRAM_PROVIDER=telegram
   TELEGRAM_BOT_TOKEN=<токен от BotFather>
   TELEGRAM_BOT_USERNAME=pai_guides_bot
   TELEGRAM_ALERT_CHAT_ID=<chat.id>
   NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=pai_guides_bot
   ```

4. Для Telegram Login Widget на сайте: у BotFather → `/setdomain` → `pai.1sx.biz`.
   Без этого виджет откажется работать.

> **Вход через Telegram и бот написаны, но вживую не проверялись** — бота не было.
> Валидация подписи покрыта юнит-тестами на известных векторах, но первый настоящий
> вход стоит сделать самому и убедиться, что пользователь создался с ролью `NONE`.

## Шаг 6. GitLab CI — 15 минут

Settings → CI/CD → Variables:

| Переменная | Что это | Тип |
|---|---|---|
| `SSH_PRIVATE_KEY` | приватный ключ для входа на VPS | Variable, protected |
| `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan <IP сервера>` | Variable |
| `SSH_USER` | пользователь на VPS | Variable |
| `SSH_HOST` | IP или домен сервера | Variable |
| `ENV_FILE` | **весь файл `.env`** целиком | **File**, protected, masked |

Push в `main` разворачивает прод. Ручные джобы: `deploy-nocache`, `backup-run`,
`restore-drill`, `seed-demo`.

## Шаг 7. Секреты приложения — 5 минут

Сгенерировать и вписать в `.env`:

```bash
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → REVALIDATE_SECRET
```

И поменять продовые значения:

```
NODE_ENV=production
COOKIE_SECURE=true
COOKIE_DOMAIN=.pai.1sx.biz
ADMIN_PASSWORD=<нормальный пароль, не admin12345>
CORS_ORIGINS=https://pai.1sx.biz,https://admin.pai.1sx.biz
PUBLIC_WEB_URL=https://pai.1sx.biz
PUBLIC_ADMIN_URL=https://admin.pai.1sx.biz
VITE_API_URL=https://api.pai.1sx.biz
NEXT_PUBLIC_API_URL=https://api.pai.1sx.biz
WEB_INTERNAL_URL=http://web:3000
```

`JWT_SECRET` должен совпадать в backend и в `web`: middleware сайта проверяет
подпись куки. `.env` на сервере — `chmod 600`.

## Шаг 8. Первый запуск на проде

```bash
cd /home/sonic/pai
docker compose build
docker compose up -d
docker compose logs -f backend
```

Проверить по порядку:

- [ ] `https://api.pai.1sx.biz/health` → `{"ok":true,"db":true,"storage":true}`
- [ ] `https://admin.pai.1sx.biz` открывается, пускает по логину и паролю
- [ ] Загрузка картинки в медиа-библиотеку доходит до статуса READY
- [ ] `curl -I https://media.pai.1sx.biz/<ключ>` → AVIF с `cache-control: immutable`
- [ ] Публикация гайда → он виден на `https://pai.1sx.biz/g/<slug>`
- [ ] Без cookie сайт редиректит на `/login`
- [ ] `npm run backup` (внутри контейнера) → зелёный, файлы появились на Диске
- [ ] `npm run restore -- --latest --target=check` → битых объектов 0
- [ ] Алерт в Telegram приходит (проверить, погасив контейнер backend)

---

## Что делать, когда бэкап отвалился

Симптом: баннер в админке «последний успешный бэкап N часов назад» и/или
алерт в Telegram про отзыв доступа.

1. Админка → Бэкапы → открыть лог последнего прогона.
2. Если в логе `invalid_grant` — Google отозвал токен. Причины: смена пароля аккаунта,
   ручной отзыв в [Сторонних приложениях](https://myaccount.google.com/permissions),
   удаление OAuth-клиента, **или приложение осталось в статусе Testing** (ловушка 1).
3. Починка — 10 минут:

   ```bash
   cd backend && npm run drive:auth
   ```

   Новый токен сохранится в настройках. Продублировать в `.env`, перезапустить backend.
4. Нажать «Полный» в разделе Бэкапы — прогон догонит пропущенное инкрементально.

## Регулярные операции

| Когда | Что |
|---|---|
| Ежедневно | Убедиться, что бэкап зелёный (алерт приходит сам) |
| Еженедельно | Дашборд: мёртвый контент и пустые поисковые запросы → бэклог |
| Ежемесячно | Гайды с истёкшим `reviewAt`; обновления зависимостей |
| Ежеквартально | **Учебное восстановление** с секундомером; ревизия доступов (кто уволился); проверка, что доступ приложения к Диску на месте и 2FA-коды выделенного аккаунта лежат в менеджере паролей |

Учебное восстановление:

```bash
npm run restore -- --latest --target=check
```

Полное, на отдельной машине, с секундомером:

```bash
npm run restore -- --latest --target=full --yes
```

Фактическое время записать в `PROGRESS.md`. **Бэкап, который ни разу не разворачивали,
бэкапом не считается.**

---

## Сводка: что переключается одной переменной

| Что | Переменная | Локально | Прод |
|---|---|---|---|
| Хранилище медиа | `STORAGE_PROVIDER` | `local` | `r2` |
| Бэкап | `BACKUP_PROVIDER` | `local-drive` | `google-drive` |
| Уведомления | `TELEGRAM_PROVIDER` | `console` | `telegram` |
| Сброс кэша CDN | `CDN_PROVIDER` | `noop` | `cloudflare` |

Код приложения при переключении не меняется. Что именно не проверялось вживую
и на что обратить внимание после переключения — в `PROGRESS.md`.
