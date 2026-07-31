# PROGRESS.md — что сделано, что осталось

Порядок работ: **1 → 2 → 3 → 4 → 5 → 9.1 → 8**. Этапы 6, 7, 10–12 в эту сессию не входили.

Обозначения: ✅ сделано и проверено запуском · 🟡 написано, но вживую не проверялось
(нет внешнего доступа) · ⬜ не делалось.

---

## Сводка по этапам

| Этап | Статус |
|---|---|
| 1. Скелет репозитория и локальная разработка | ✅ |
| 2. Ядро: модель данных, auth, роли | ⬜ |
| 3. Медиа-подсистема | ⬜ |
| 4. Админка: редактор гайдов | ⬜ |
| 5. Публичный сайт | ⬜ |
| 9.1 Бэкап и восстановление | ⬜ |
| 8. Аналитика | ⬜ |

---

## Этап 1. Скелет репозитория — ✅

Сделано:

- Монорепо `backend/` + `web/` + `admin/` папками, без submodule'ов.
- `docker-compose.local.yml` — только Postgres 16-alpine с healthcheck, порт на loopback.
- `docker-compose.yml` — полный прод-стек (postgres, backend, web, admin, caddy),
  тома под `storage` и `backups`, ротация логов, healthcheck backend.
- `backend`: `package.json` (ESM, скрипты dev/build/start/prisma/seed/backup/restore),
  tsconfig strict, `env.ts` с валидацией через zod, `db.ts`, Fastify-скелет с `/health`,
  который реально проверяет соединение с БД.
- `web`: Next.js 15 App Router + Tailwind, `output: standalone`, заголовки `noindex`,
  `robots.txt` с `Disallow: /`.
- `admin`: Vite 5 + React 18 + TS + Tailwind + React Router 6 + TanStack Query,
  axios-клиент с интерсепторами (`src/api.ts`) и общим single-flight refresh.
- `Dockerfile` для всех трёх сервисов, `nginx.conf` для админки.
- `Caddyfile`, `.gitlab-ci.yml` (deploy + ручные backup-run / restore-drill / seed-demo).
- `start.cmd` / `stop.cmd`, `.claude/launch.json`.
- `.env.example` — все переменные с комментариями «что это и где взять».
- `README.md`, `DECISIONS.md`, этот файл.

Проверено запуском:

- `docker compose -f docker-compose.local.yml up -d --wait` → контейнер healthy.
- `npx prisma migrate dev` → миграция `init` создана и применена.
- `curl http://localhost:3001/health` → `{"ok":true,"db":true}`.
- `npx next build` (web) → успешно.
- `npm run build` (admin, включая `tsc --noEmit`) → успешно.

---

## Известные ограничения на текущий момент

- Экраны админки — каркас маршрутизации; наполняются на этапах 2–8.
- Публичный сайт — базовый layout; страницы гайдов на этапе 5.
