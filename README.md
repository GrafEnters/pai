# PAI Guides — база знаний команды

Внутренняя платформа для гайдов: текст + скриншоты + видео, админка для наполнения,
статистика потребления контента, инкрементальный бэкап с проверенной процедурой восстановления.

Полное техническое задание — [PLAN.md](PLAN.md).
Что уже сделано и что осталось — [PROGRESS.md](PROGRESS.md).
Самостоятельно принятые решения — [DECISIONS.md](DECISIONS.md).
Что нужно сделать руками при выкатке на прод — [SETUP.md](SETUP.md).

---

## Быстрый старт

Нужны только **Docker** и **Node.js 20+**. Внешние аккаунты (Cloudflare, R2, Google, Telegram)
для локального запуска **не нужны**.

```
start.cmd
```

Скрипт: скопирует `.env.example` → `.env`, поднимет Postgres в Docker, поставит зависимости,
применит миграции, создаст первого админа и запустит три сервиса в отдельных окнах.

| Что | Адрес |
|---|---|
| Публичный сайт | http://localhost:3000 |
| Админка | http://localhost:5173 |
| API | http://localhost:3001/health |

Вход по умолчанию: **admin / admin12345** (меняется в `.env`).

Остановить базу: `stop.cmd`

---

## Что где живёт

```
pai/
├── backend/              Fastify + Prisma + воркеры (pg-boss)
│   ├── prisma/           схема БД и миграции
│   └── src/
│       ├── index.ts      регистрация плагинов и роутов
│       ├── env.ts        валидация переменных окружения через zod
│       ├── db.ts         PrismaClient
│       ├── auth.ts       requireAuth / requireRole / Telegram initData
│       ├── routes/       auth, guides, media, search, collect, admin/*
│       ├── services/     storage, images, video, backup, analytics, cdn, telegram
│       ├── jobs/         pg-boss: воркеры и расписания
│       ├── content/      tiptap: JSON → HTML / Markdown / plainText
│       └── scripts/      drive:auth, backup, restore
├── web/                  Next.js 15 — публичный сайт (SSG/ISR)
├── admin/                Vite + React — админка (редактор, медиа, статистика)
├── docker-compose.yml         прод-стек целиком
├── docker-compose.local.yml   только Postgres для локальной разработки
├── Caddyfile                  реверс-прокси и TLS на проде
├── .gitlab-ci.yml             деплой по SSH
├── storage/                   [локально] загруженные медиафайлы
└── backups/                   [локально] бэкапы
```

---

## Адаптеры внешних сервисов

Всё, что упирается во внешний сервис, спрятано за интерфейсом. По умолчанию везде
включена локальная реализация — система полностью работоспособна без единого аккаунта.

| Что | Переменная | По умолчанию | Прод |
|---|---|---|---|
| Хранилище медиа | `STORAGE_PROVIDER` | `local` — папка `./storage` | `r2` — Cloudflare R2 |
| Бэкап | `BACKUP_PROVIDER` | `local-drive` — папка `./backups` | `google-drive` |
| Уведомления | `TELEGRAM_PROVIDER` | `console` — в лог сервера | `telegram` — бот |
| Сброс кэша CDN | `CDN_PROVIDER` | `noop` — только лог | `cloudflare` |

Переключение — одна переменная в `.env`, код приложения не меняется.

---

## Про сборку публичного сайта

`next dev` пишет в `web/.next-dev`, а `next build` — в `web/.next`. Папки разведены
намеренно: при общей папке прод-сборка, запущенная во время работающего дев-сервера,
затирает его модульный граф, и страница падает с
`__webpack_modules__[moduleId] is not a function` — по тексту ошибки причину не угадать.
Docker собирает с `NODE_ENV=production` и получает привычный `.next`.

---

## Полезные команды

```bash
# backend
npm run dev                  # разработка с автоперезапуском
npm run build && npm start   # прод-сборка
npm run seed                 # первый админ + базовые категории
npm run seed:demo            # демо-контент (гайды, категории, события)
npm run backup -- --kind=FULL                # ручной бэкап
npm run restore -- --list                    # список доступных бэкапов
npm run restore -- --latest --target=check   # проверка целостности бэкапа
npm run drive:auth           # получить Google refresh-токен (нужен аккаунт)
npm test                     # vitest
```
