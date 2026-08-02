# PAI Guides — база знаний команды. Поэтапный план создания системы

> Внутренняя платформа для гайдов арбитражной команды (FB / TT / прокси / платёжки):
> текст + скриншоты + видео, админка для наполнения, CDN для скорости в любой точке мира,
> периодический инкрементальный бэкап на Google Drive, полная аналитика потребления контента.

Документ написан под стек и привычки команды, снятые с `polina-crm`, `farm-shed`, `farm_please_shop`.

---

## 0. Оглавление

| # | Раздел |
|---|--------|
| 1 | [Цели, не-цели, допущения](#1-цели-не-цели-допущения) |
| 2 | [Архитектура целиком](#2-архитектура-целиком) |
| 3 | [Стек и почему именно он](#3-стек-и-почему-именно-он) |
| 4 | [Модель данных (полная Prisma-схема)](#4-модель-данных) |
| 5 | [API-контракт](#5-api-контракт) |
| 6 | [ЭТАПЫ 0–12 — пошаговая реализация](#6-этапы-реализации) |
| 7 | [Сквозные темы: безопасность, производительность, тесты](#7-сквозные-темы) |
| 8 | [Эксплуатация: деплой, мониторинг, runbook восстановления](#8-эксплуатация) |
| 9 | [Стоимость](#9-стоимость-владения) |
| 10 | [Риски и открытые вопросы](#10-риски-и-открытые-вопросы) |
| 11 | [Дорожная карта v2](#11-дорожная-карта-v2) |

---

## 1. Цели, не-цели, допущения

### 1.1 Что строим

Внутренний сайт-база знаний с закрытым доступом. Пять требований заказчика — и как каждое закрывается:

| Требование | Решение (кратко) | Этап |
|---|---|---|
| Гайды: текст + картинки + видео | Блочный документ (TipTap JSON) в Postgres, медиа в объектном хранилище, свой React-рендерер | 4, 5 |
| Не потерять контент при падении сервера | Инкрементальный синк в Google Drive (обычный аккаунт, OAuth refresh-токен) + pg_dump + проверенная процедура restore | 9 |
| Максимальная скорость по всему миру | Cloudflare CDN, статическая генерация HTML (ISR), immutable-кэш медиа, AVIF/WebP, HLS | 5, 6, 7 |
| Постепенное наполнение админом | Отдельная админка: WYSIWYG-редактор, медиа-библиотека, черновики, версии, публикация в один клик | 4 |
| Статистика по потреблению | Свой ingest событий + роллапы + дашборд: дочитывания, глубина скролла, воронка видео, мёртвый контент, поиск без результатов | 8 |

### 1.2 Не-цели (осознанно вне скоупа v1)

- Публичный доступ / SEO — сайт закрыт, `noindex`, доступ только по логину.
- Многоязычность интерфейса — только русский (как во всех проектах команды).
- Совместное редактирование в реальном времени (Google-Docs-стиль) — избыточно, есть блокировка + версии.
- Мобильное приложение — адаптивная вёрстка закрывает потребность.
- LMS/тесты/сертификация — вынесено в v2.

### 1.3 Допущения (подтвердить перед стартом — см. §10.2)

- Команда **до 50 человек** на сегодня, распределена: СНГ, Европа, ЮВА. Архитектура рассчитана на рост без переделки — см. §6.4, почему не берём Cloudflare Access на весь сайт, хотя формально проходим по лимиту.
- Объём: 100–500 гайдов, 2–10 ГБ картинок. **Объём видео заранее неизвестен** — этап 7 построен так, чтобы выбор способа раздачи делался по фактическим замерам, а не по догадке.
- Наполняют 1–3 человека (админ + редакторы), читают все.
- Есть свой VPS (по аналогии с `polina-crm` на `1sx.biz`) и GitLab с CI.
- Домены (по образцу Caddyfile из polina-crm):
  - `pai.1sx.biz` — публичный сайт
  - `admin.pai.1sx.biz` — админка
  - `api.pai.1sx.biz` — API
  - `media.pai.1sx.biz` — CDN-домен объектного хранилища

---

## 2. Архитектура целиком

```
                          ┌────────────────────────────────────┐
   Команда (весь мир)     │       Cloudflare (edge/CDN)        │
   ───────────────────►   │  TLS · WAF · кэш HTML · кэш медиа  │
                          │  Brotli · HTTP/3 · Tiered Cache    │
                          └────┬──────────────────────┬────────┘
                pai.1sx.biz    │                      │  media.pai.1sx.biz
                               ▼                      ▼
                  ┌────────────────────────┐   ┌────────────────────────┐
                  │  web — Next.js (SSG/ISR)│   │  R2 / S3 бакет         │
                  │  рендер гайдов без JS   │   │  img/  video/  hls/    │
                  │  middleware: auth-cookie│   │  content-hash имена    │
                  └───────────┬─────────────┘   └───────┬────────────────┘
                              │ api.pai.1sx.biz         │ запись (presigned PUT)
                              ▼                         │
 admin.pai.1sx.biz  ──►  ┌──────────────────────────────┴─────────────┐
   admin — Vite SPA      │      backend — Fastify + Prisma            │
   (редактор, статистика)│  auth · guides · media · collect · admin   │
                         └──┬───────────────┬──────────────┬──────────┘
                            │               │              │
                    ┌───────▼──────┐  ┌─────▼──────┐  ┌────▼──────────┐
                    │ PostgreSQL16 │  │  worker    │  │ Telegram bot  │
                    │ контент+     │  │  pg-boss   │  │ логин-ссылки, │
                    │ события      │  │  очередь   │  │ алерты        │
                    └──────────────┘  └─────┬──────┘  └───────────────┘
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
              ffmpeg-транскодинг    роллапы аналитики      backup-sync
              img-варианты (sharp)  (15 мин / ночь)             │
                                                                ▼
                                                   ┌────────────────────────┐
                                                   │  Google Drive (OAuth)  │
                                                   │  db/ content/ media/   │
                                                   │  manifest.json + хеши  │
                                                   └────────────────────────┘
```

### 2.1 Разделение на сервисы

Ровно паттерн `polina-crm` (backend + отдельные фронты) и `farm_please_shop` (публичная витрина + control-panel):

| Сервис | Назначение | Порт (dev) |
|---|---|---|
| `backend/` | REST API, БД, auth, ingest аналитики, воркеры (в том же процессе или отдельным контейнером) | 3001 |
| `web/` | Публичный сайт гайдов, Next.js, SSG/ISR | 3000 |
| `admin/` | Админка: редактор, медиа-библиотека, дашборд статистики | 5173 |
| `worker/` | (опция) Отдельный контейнер под ffmpeg и бэкапы, чтобы не душить API | — |

**Почему админка отдельная, а не раздел внутри Next.js:** так уже сделано в `farm_please_shop` (`tg-shop-control-panel`). Плюсы конкретно здесь: тяжёлый редактор и графики статистики не попадают в бандл публичного сайта (а скорость публичного сайта — требование №1); админку можно закрыть отдельным слоем доступа (IP allow-list / Cloudflare Access); деплоится и ломается независимо.

---

## 3. Стек и почему именно он

| Слой | Выбор | Обоснование |
|---|---|---|
| API | **Fastify 4 + TypeScript (ESM) + zod** | Как `polina-crm/backend`. Легче NestJS, ровно тот же стиль роутов `app.get('/x', { preHandler: requireRole('ADMIN') }, ...)`. |
| БД | **PostgreSQL 16 + Prisma 5** | Во всех трёх проектах. JSON-поля для гибкого контента (как `Ticket.data`), снимки версий (как `TicketVersion`). |
| Очередь/расписание | **pg-boss** | Работает поверх того же Postgres — **не тянем Redis**. Даёт retry, cron-расписания, dead-letter. Одним инструментом закрываем транскодинг, роллапы аналитики и бэкапы. |
| Публичный сайт | **Next.js 15 (App Router), SSG + ISR** ✅ решено | Единственный выход за пределы привычного Vite-SPA — обоснование в §3.1 |
| Админка | **Vite 5 + React 18 + TS + Tailwind + React Router 6 + TanStack Query + axios** | Один в один стек `polina-crm/crm`. |
| Редактор | **TipTap 2 (ProseMirror)** | Стандарт для React. Кастомные ноды под наши блоки (видео, callout, галерея, чеклист, код). Хранит чистый JSON — идеален для версионирования и экспорта. |
| Объектное хранилище | **Cloudflare R2** (S3 API) | Zero egress — критично для видео. Нативно раздаётся с Cloudflare CDN через custom domain. Fallback: MinIO на своём VPS или Backblaze B2. |
| CDN | **Cloudflare** | Бесплатный тариф закрывает 90%: кэш, Brotli, HTTP/3, Tiered Cache. Access (SSO) — только на админку, см. §6.4. |
| Доступ | Свой JWT (Telegram-вход) + **Worker на edge** для публичного сайта; **Cloudflare Access** — на админку | Разные поверхности, разные требования: 50+ читателей без потолка по местам vs. 3 редактора с максимально жёстким гейтом. §6.4 |
| Видео | Такт 1: нормализация в один рендишн → Такт 2: **HLS или Bunny** по замерам | Объём неизвестен, поэтому решение отложено за интерфейс `VideoProvider` — ровно как `payments/` в `tg-shop-miniapp`. §6 этап 7. |
| Картинки | **sharp** → AVIF/WebP в 5 размерах + blurhash | Генерим при загрузке, кладём в бакет с content-hash именем, отдаём `<picture srcset>`. |
| Бэкап | **googleapis** (Drive API v3), OAuth2 refresh-токен выделенного Google-аккаунта, scope `drive.file` | Обычный аккаунт вместо Service Account — решение команды. Workspace не нужен. Детали и подводные камни — §6, этап 9.0 |
| Прокси/TLS | **Caddy 2** | Как `polina-crm/Caddyfile`: авто-Let's Encrypt, `encode zstd gzip`, поддомены. |
| CI/CD | **GitLab CI → SSH → docker compose** | Как `.gitlab-ci.yml` в polina-crm: `git pull` → `docker compose build` → `up -d`. |
| Уведомления | **grammY** (Telegram-бот) | Как в polina-crm. Алерты бэкапов, падений, логин-ссылки. |

### 3.1 Публичный сайт — Next.js (решение принято)

Требование «максимально быстро в любой точке мира» несовместимо с классическим CSR-SPA: браузер сначала качает JS-бандл, потом делает запрос к API, потом рисует текст. Для контентного сайта это 2–4 последовательных round-trip'а — из Джакарты до сервера во Франкфурте это ~1.5–3 с до появления текста.

Next.js с ISR отдаёт **готовый HTML гайда**, сгенерированный заранее при публикации. Текст виден на первом байте, картинки грузятся с ближайшего edge. Разница в LCP — примерно 3× на дальних гео.

**Что конкретно меняется в работе относительно привычного Vite:**

| | Так же, как раньше | Новое |
|---|---|---|
| Вёрстка | React 18/19 + Tailwind, компоненты переносятся один в один | — |
| Роутинг | — | File-based: `app/g/[slug]/page.tsx` вместо `<Route>` |
| Данные | — | Server Components: компонент по умолчанию рендерится на сервере и ходит в БД/API напрямую; `'use client'` пишем явно |
| Кэш | — | `generateStaticParams()` + `revalidate` + `revalidatePath()` при публикации |
| Сборка | — | `next build` в standalone-режиме → тонкий Docker-образ |

**Главная ловушка, которую нужно проговорить с командой:** не тащить в `web` привычные клиентские паттерны. TanStack Query, axios-клиент и глобальный стор для контента там **не нужны** — гайд приходит из Server Component сразу отрендеренным. Клиентскими остаются ровно четыре вещи: чеклисты, видеоплеер, поиск и сборщик аналитики. Если в `web` появился `useEffect` с фетчем гайда — значит, преимущество потеряно и мы вернулись к SPA.

**Админка остаётся на Vite** — там стек `polina-crm/crm` без единого изменения, никакого нового знания не требуется.

Ориентир на привыкание: 1–2 дня. Знание изолировано в одном сервисе из трёх.

---

## 4. Модель данных

Полная стартовая Prisma-схема. Стиль — как `polina-crm/backend/prisma/schema.prisma`: enum'ы, явные `@@index`, JSON для гибких структур, снимки версий.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ============ Пользователи и доступ ============

enum Role {
  NONE      // зарегистрирован, ждёт подтверждения админом
  VIEWER    // читает
  EDITOR    // создаёт и правит гайды
  ADMIN     // всё + пользователи + настройки + статистика
}

/// Роль внутри команды — нужна для «обязательных гайдов» и срезов статистики
enum TeamRole { BUYER FARMER TECH MEDIABUYER MANAGER OTHER }

model User {
  id               Int       @id @default(autoincrement())
  telegramId       BigInt?   @unique
  telegramUsername String?   @unique
  email            String?   @unique
  name             String
  passwordHash     String?
  role             Role      @default(NONE)
  teamRole         TeamRole  @default(OTHER)
  isActive         Boolean   @default(true)
  lastSeenAt       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  guidesAuthored  Guide[]           @relation("author")
  guideVersions   GuideVersion[]
  progress        UserGuideProgress[]
  feedback        GuideFeedback[]
  refreshTokens   RefreshToken[]

  @@index([role])
}

model InviteCode {
  id         Int       @id @default(autoincrement())
  code       String    @unique
  role       Role      @default(VIEWER)
  teamRole   TeamRole  @default(OTHER)
  note       String?
  createdById Int
  usedById   Int?
  usedAt     DateTime?
  expiresAt  DateTime
  createdAt  DateTime  @default(now())
}

model RefreshToken {
  id         String   @id @default(uuid())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId     Int
  tokenHash  String   @unique      // сам токен не храним
  userAgent  String?
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
  @@index([userId])
}

// ============ Контент ============

enum GuideStatus { DRAFT IN_REVIEW PUBLISHED ARCHIVED }
enum GuideLevel  { BEGINNER INTERMEDIATE ADVANCED }

model Category {
  id        Int        @id @default(autoincrement())
  slug      String     @unique
  title     String
  description String?
  icon      String?              // имя иконки lucide
  color     String?
  parent    Category?  @relation("tree", fields: [parentId], references: [id])
  parentId  Int?
  children  Category[] @relation("tree")
  sortOrder Int        @default(0)
  guides    Guide[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
}

model Tag {
  id     Int         @id @default(autoincrement())
  slug   String      @unique
  title  String
  guides GuideTag[]
}

model Guide {
  id          Int          @id @default(autoincrement())
  slug        String       @unique
  title       String
  summary     String?                      // краткое описание для карточки и превью
  cover       Media?       @relation("cover", fields: [coverId], references: [id])
  coverId     Int?
  category    Category     @relation(fields: [categoryId], references: [id])
  categoryId  Int
  status      GuideStatus  @default(DRAFT)
  level       GuideLevel   @default(BEGINNER)

  /// Опубликованный документ (TipTap JSON) — то, что видит команда
  content       Json
  /// Черновик редактора; при публикации переезжает в content
  contentDraft  Json?
  /// Кэш отрендеренного HTML — для поиска, экспорта в Markdown и превью
  html          String?
  /// Плоский текст для полнотекстового поиска
  plainText     String?

  readingTimeSec Int      @default(0)
  version        Int      @default(1)

  author       User      @relation("author", fields: [authorId], references: [id])
  authorId     Int
  updatedById  Int?

  isPinned         Boolean    @default(false)
  sortOrder        Int        @default(0)
  /// Роли, для которых гайд обязателен к прочтению (для отчёта «покрытие»)
  requiredForRoles TeamRole[] @default([])
  /// Дата, после которой гайд считается «протухшим» и подсвечивается админу
  reviewAt         DateTime?

  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  versions  GuideVersion[]
  tags      GuideTag[]
  media     GuideMedia[]
  related   GuideRelation[] @relation("from")
  relatedBy GuideRelation[] @relation("to")
  progress  UserGuideProgress[]
  feedback  GuideFeedback[]
  events    Event[]

  @@index([status, categoryId])
  @@index([publishedAt])
  @@index([reviewAt])
}

/// Снимок каждой правки — как TicketVersion в polina-crm
model GuideVersion {
  id          Int      @id @default(autoincrement())
  guide       Guide    @relation(fields: [guideId], references: [id], onDelete: Cascade)
  guideId     Int
  version     Int
  title       String
  content     Json
  changedBy   User     @relation(fields: [changedById], references: [id])
  changedById Int
  changeNote  String?
  createdAt   DateTime @default(now())

  @@unique([guideId, version])
  @@index([guideId])
}

model GuideTag {
  guide   Guide @relation(fields: [guideId], references: [id], onDelete: Cascade)
  guideId Int
  tag     Tag   @relation(fields: [tagId], references: [id], onDelete: Cascade)
  tagId   Int
  @@id([guideId, tagId])
}

model GuideRelation {
  from    Guide @relation("from", fields: [fromId], references: [id], onDelete: Cascade)
  fromId  Int
  to      Guide @relation("to",   fields: [toId],   references: [id], onDelete: Cascade)
  toId    Int
  @@id([fromId, toId])
}

/// Связь «какое медиа используется в каком гайде» — нужна для бэкапа и для
/// ответа на вопрос «можно ли удалить этот файл»
model GuideMedia {
  guide   Guide @relation(fields: [guideId], references: [id], onDelete: Cascade)
  guideId Int
  media   Media @relation(fields: [mediaId], references: [id], onDelete: Cascade)
  mediaId Int
  @@id([guideId, mediaId])
}

// ============ Медиа ============

enum MediaType   { IMAGE VIDEO FILE }
enum MediaStatus { PENDING UPLOADING PROCESSING READY FAILED }

model Media {
  id            Int         @id @default(autoincrement())
  type          MediaType
  status        MediaStatus @default(PENDING)
  /// Ключ оригинала в бакете: original/<sha256>.<ext>
  key           String      @unique
  originalName  String
  mime          String
  sizeBytes     BigInt
  sha256        String                       // дедупликация повторных загрузок
  width         Int?
  height        Int?
  durationSec   Float?
  blurhash      String?                      // placeholder, чтобы не было CLS
  /// Производные: картинки [{w,fmt,key,size}], видео [{height,key,bitrate}] + master.m3u8
  variants      Json        @default("[]")
  posterKey     String?                      // постер видео
  alt           String?
  title         String?
  uploadedById  Int
  error         String?
  createdAt     DateTime    @default(now())
  processedAt   DateTime?

  guides   GuideMedia[]
  coverOf  Guide[]      @relation("cover")
  events   Event[]

  @@index([sha256])
  @@index([type, status])
}

// ============ Аналитика ============

enum EventType {
  PAGE_VIEW
  GUIDE_OPEN
  GUIDE_SCROLL       // props: { depth: 25|50|75|100 }
  GUIDE_HEARTBEAT    // props: { sec: 15 } — активное время
  GUIDE_READ         // порог дочитывания достигнут
  VIDEO_PLAY
  VIDEO_PROGRESS     // props: { pct: 25|50|75|95 }
  VIDEO_COMPLETE
  VIDEO_SEEK
  SEARCH
  SEARCH_EMPTY
  LINK_CLICK
  FILE_DOWNLOAD
  FEEDBACK
  CHECKLIST_TOGGLE
}

/// Сырые события. Партиционируется по месяцам (см. Этап 8.4)
model Event {
  id        BigInt    @id @default(autoincrement())
  ts        DateTime  @default(now())
  type      EventType
  visitorId String                       // анонимный id из localStorage
  sessionId String
  userId    Int?
  guide     Guide?    @relation(fields: [guideId], references: [id], onDelete: SetNull)
  guideId   Int?
  media     Media?    @relation(fields: [mediaId], references: [id], onDelete: SetNull)
  mediaId   Int?
  path      String
  referrer  String?
  country   String?                      // из заголовка CF-IPCountry
  device    String?                      // mobile | tablet | desktop
  props     Json      @default("{}")

  @@index([ts])
  @@index([guideId, ts])
  @@index([userId, ts])
  @@index([type, ts])
}

/// Дневные агрегаты — дашборд читает только их, не сырые события
model DailyGuideStat {
  id            Int      @id @default(autoincrement())
  date          DateTime @db.Date
  guideId       Int
  views         Int      @default(0)
  uniqueVisitors Int     @default(0)
  reads         Int      @default(0)     // дочитали
  avgActiveSec  Int      @default(0)
  scroll50      Int      @default(0)
  scroll100     Int      @default(0)
  @@unique([date, guideId])
  @@index([date])
}

model DailyVideoStat {
  id           Int      @id @default(autoincrement())
  date         DateTime @db.Date
  mediaId      Int
  plays        Int      @default(0)
  uniqueViewers Int     @default(0)
  p25          Int      @default(0)
  p50          Int      @default(0)
  p75          Int      @default(0)
  p95          Int      @default(0)
  completes    Int      @default(0)
  avgWatchSec  Int      @default(0)
  @@unique([date, mediaId])
}

model SearchQuery {
  id          Int      @id @default(autoincrement())
  q           String
  resultCount Int
  userId      Int?
  clickedGuideId Int?
  ts          DateTime @default(now())
  @@index([ts])
}

model GuideFeedback {
  id       Int      @id @default(autoincrement())
  guide    Guide    @relation(fields: [guideId], references: [id], onDelete: Cascade)
  guideId  Int
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId   Int
  helpful  Boolean
  comment  String?
  ts       DateTime @default(now())
  @@unique([guideId, userId])
}

/// Личный прогресс: что открыл, что дочитал, состояние чеклистов внутри гайда
model UserGuideProgress {
  id             Int       @id @default(autoincrement())
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId         Int
  guide          Guide     @relation(fields: [guideId], references: [id], onDelete: Cascade)
  guideId        Int
  firstOpenedAt  DateTime  @default(now())
  lastOpenedAt   DateTime  @default(now())
  readAt         DateTime?
  activeSec      Int       @default(0)
  checklistState Json      @default("{}")
  @@unique([userId, guideId])
  @@index([userId])
}

// ============ Бэкап и служебное ============

enum BackupKind   { DB CONTENT MEDIA FULL }
enum BackupStatus { RUNNING SUCCESS FAILED PARTIAL }

model BackupRun {
  id            Int          @id @default(autoincrement())
  kind          BackupKind
  status        BackupStatus @default(RUNNING)
  startedAt     DateTime     @default(now())
  finishedAt    DateTime?
  filesUploaded Int          @default(0)
  filesSkipped  Int          @default(0)
  bytesUploaded BigInt       @default(0)
  driveFolderId String?
  error         String?
  @@index([startedAt])
}

/// Что и с каким хешем уже лежит на Drive — основа инкрементальности
model BackupObject {
  id         Int      @id @default(autoincrement())
  key        String   @unique          // media/original/ab12.jpg | content/fb-launch/guide.json
  sha256     String
  sizeBytes  BigInt
  driveFileId String
  driveMd5   String?
  syncedAt   DateTime @default(now())
  @@index([syncedAt])
}

model AuditLog {
  id       Int      @id @default(autoincrement())
  userId   Int?
  action   String              // guide.publish, media.delete, user.role_change...
  entity   String
  entityId String?
  diff     Json?
  ip       String?
  ts       DateTime @default(now())
  @@index([ts])
  @@index([entity, entityId])
}

/// key/value настройки — как ShopSetting в farm_please_shop
model Setting {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
}
```

### 4.1 Формат контента (TipTap-документ)

Стандартные ноды: `paragraph`, `heading (2–4)`, `bulletList`, `orderedList`, `codeBlock`, `blockquote`, `table`, `horizontalRule`, `link`, `bold/italic/code/highlight`.

Кастомные ноды (свои расширения):

| Нода | Атрибуты | Зачем |
|---|---|---|
| `image` | `mediaId, alt, caption, width, align` | Ссылается на `Media`, а не на URL — при переезде бакета ничего не ломается |
| `video` | `mediaId, poster, autoplay, loop, startAt` | Рендерится в HLS-плеер с трекингом |
| `gallery` | `mediaIds[], layout` | Пошаговые скриншоты в сетке |
| `callout` | `variant: info/warn/danger/success, title` | «⚠️ Не делайте так — уйдёт в бан» |
| `steps` | — (контейнер для `step`) | Нумерованная пошаговая инструкция |
| `checklist` | `items[], persistKey` | Интерактивный чеклист с сохранением прогресса в `UserGuideProgress` |
| `guideRef` | `guideId` | Карточка-ссылка на другой гайд |
| `details` | `summary` | Сворачиваемый блок (длинные приложения) |
| `fileAttachment` | `mediaId` | Шаблоны, таблицы, .txt со списками |

**Важно:** на публичном сайте контент рендерится **собственным React-рендерером** `JSON → React-компоненты`, а не через `generateHTML`. Это даёт контроль над `<picture srcset>`, `loading="lazy"`, `fetchpriority`, размерами под CLS и ленивой инициализацией видеоплеера — то есть ровно над тем, из чего складывается скорость. HTML-кэш в `Guide.html` остаётся для поиска, экспорта в Markdown и превью в админке.

---

## 5. API-контракт

Префикс `/api`, как в polina-crm. JWT в httpOnly-cookie (не в localStorage — контент чувствительный).

### 5.1 Аутентификация

```
POST   /api/auth/telegram          { initData | tgAuthPayload }   → set-cookie + me
POST   /api/auth/login             { login, password }            → set-cookie + me
POST   /api/auth/redeem-invite     { code, name, ... }            → аккаунт + вход
POST   /api/auth/refresh                                          → ротация refresh-токена
POST   /api/auth/logout
GET    /api/auth/me                                               → { id, name, role, teamRole }
```

### 5.2 Чтение (роль ≥ VIEWER)

```
GET    /api/categories                                → дерево категорий + счётчики
GET    /api/guides?category=&tag=&level=&page=&limit= → карточки (без content)
GET    /api/guides/:slug                              → полный гайд + related + прогресс
GET    /api/guides/required                           → обязательные для моей teamRole + статус
GET    /api/search?q=&limit=                          → результаты + подсветка
POST   /api/collect                                   → батч событий (text/plain, без preflight)
POST   /api/guides/:id/feedback   { helpful, comment }
PUT    /api/guides/:id/progress   { checklistState }
```

### 5.3 Редактирование (роль ≥ EDITOR)

```
GET    /api/admin/guides?status=&q=&page=
POST   /api/admin/guides                       { title, categoryId }        → новый черновик
GET    /api/admin/guides/:id
PATCH  /api/admin/guides/:id                   { contentDraft, title, ... } → автосейв
POST   /api/admin/guides/:id/publish           { changeNote }               → версия + purge CDN + revalidate
POST   /api/admin/guides/:id/unpublish
POST   /api/admin/guides/:id/archive
POST   /api/admin/guides/:id/duplicate
GET    /api/admin/guides/:id/versions
GET    /api/admin/guides/:id/versions/:v
POST   /api/admin/guides/:id/revert/:v
POST   /api/admin/guides/:id/lock              // мягкая блокировка от параллельной правки
POST   /api/admin/guides/reorder               { items: [{id, sortOrder}] }

CRUD   /api/admin/categories  /api/admin/tags   (+ reorder)

POST   /api/admin/media/presign   { name, mime, size } → { mediaId, uploadUrl, key }
POST   /api/admin/media/:id/complete                   → ставит задачу в очередь
GET    /api/admin/media?type=&q=&page=                 → библиотека
GET    /api/admin/media/:id                            → статус обработки, варианты
PATCH  /api/admin/media/:id      { alt, title }
DELETE /api/admin/media/:id                            → только если не используется
```

### 5.4 Администрирование (роль ADMIN)

```
GET    /api/admin/stats/overview?from=&to=       → DAU/WAU, сессии, топ-гайды
GET    /api/admin/stats/guides?from=&to=&sort=   → открытия, дочитывания, время, скролл
GET    /api/admin/stats/guides/:id               → детально + профиль скролла + фидбек
GET    /api/admin/stats/videos?from=&to=         → воронка 25/50/75/95, кривая удержания
GET    /api/admin/stats/users?from=&to=          → кто что читал, покрытие обязательных
GET    /api/admin/stats/search?from=&to=         → топ-запросы и запросы без результатов
GET    /api/admin/stats/stale                    → гайды с истёкшим reviewAt и «мёртвые»
GET    /api/admin/stats/export?format=xlsx|csv   → выгрузка (exceljs, как в polina-crm)

GET    /api/admin/users            PATCH /api/admin/users/:id  { role, teamRole, isActive }
POST   /api/admin/invites          GET /api/admin/invites
GET    /api/admin/backups          POST /api/admin/backups/run { kind }
GET    /api/admin/backups/:id
GET    /api/admin/audit?entity=&from=
GET    /api/admin/settings         PUT /api/admin/settings
GET    /health                                    → { ok, db, storage, lastBackupAt }
```

---

## 6. Этапы реализации

Оценки — в человеко-днях для одного fullstack-разработчика (с Claude Code — примерно вдвое быстрее).
**MVP = этапы 0–5 + 9.1** — этого достаточно, чтобы команда начала пользоваться и контент был защищён.

---

### ЭТАП 0. Решения и доступы — 0.5 дня

**Цель:** снять все внешние блокеры до написания кода.

Задачи:
1. Утвердить домен и поддомены (`pai.1sx.biz`, `admin.`, `api.`, `media.`).
2. Cloudflare: завести аккаунт, делегировать NS домена, включить бесплатный план. Там же — Zero Trust → Access: приложение на `admin.pai.1sx.biz` с политикой по списку e-mail редакторов (2–5 человек, бесплатно, см. §6.4). На публичный сайт Access **не вешаем**.
3. Cloudflare R2: создать бакет `pai-media`, выдать S3-ключ (Access Key ID / Secret), привязать custom domain `media.pai.1sx.biz`.
4. Завести **выделенный** Google-аккаунт под бэкапы (например `pai.backup@gmail.com`) — не личный чей-то. Включить 2FA, положить логин/пароль/резервные коды в командный менеджер паролей. При необходимости — Google One 2 ТБ.
   > Почему выделенный: у личного аккаунта смена пароля или увольнение владельца убивают бэкапы. Здесь аккаунт — часть инфраструктуры, а не чья-то собственность.
5. Google Cloud (под этим же аккаунтом): проект → включить Drive API → OAuth consent screen → OAuth Client ID типа **Desktop app**.
   > ⚠️ Два подводных камня, оба стоят потерянного бэкапа:
   > 1. **Publishing status обязательно перевести в «In production».** В статусе «Testing» Google протухает refresh-токен через **7 дней** — бэкап молча умрёт через неделю после запуска. При переходе в Production покажут экран «приложение не проверено» → «Дополнительно» → «Перейти (небезопасно)»; это нормально, приложение наше и внутреннее.
   > 2. **Scope — только `drive.file`**, не `drive`. `drive.file` даёт доступ лишь к тем файлам, которые приложение само создало: этого достаточно (мы создаём всю структуру сами), это не «restricted scope» и не требует платной верификации Google, и заодно наш сервер физически не видит остальное содержимое Диска.
6. Получить refresh-токен: скрипт `npm run drive:auth` поднимает localhost-callback, открывает браузер, вы логинитесь выделенным аккаунтом и подтверждаете доступ. Обязательные параметры запроса — `access_type=offline` и `prompt=consent` (без второго Google не вернёт refresh-токен при повторной авторизации). Токен кладём в `.env`.
7. Telegram: `@BotFather` → бот `pai_guides_bot`, токен.
8. VPS: подтвердить наличие (рекомендую Hetzner CPX31: 4 vCPU / 8 ГБ / 160 ГБ — хватит на транскодинг и БД), выбрать регион по географии команды.
9. GitLab: создать проект, добавить CI-переменные (`SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_USER`, `SSH_HOST`, `ENV_FILE`) — по образцу polina-crm.
10. Видео: решение **отложено осознанно** (объём неизвестен). На этапе 0 ничего не заводим — но если по итогам такта 2 выберете Bunny, аккаунт заводится за 15 минут. См. этап 7.

**Готово, когда:** заполнен `.env.example` со всеми ключами, каждый внешний сервис проверен руками — тестовый файл залит в R2 и в Google Drive скриптом с полученным refresh-токеном (не через веб-интерфейс Диска: проверять надо именно тот путь, которым пойдёт прод).

---

### ЭТАП 1. Скелет репозитория и локальная разработка — 1 день

**Цель:** `start.cmd` поднимает всё одной командой, как во всех проектах команды.

Структура (монорепо папками, как в polina-crm — без submodule'ов, они здесь не нужны):

```
pai/
├── backend/            Fastify + Prisma + воркеры
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── index.ts            регистрация плагинов и роутов
│   │   ├── env.ts              валидация env через zod
│   │   ├── db.ts               PrismaClient singleton
│   │   ├── auth.ts             requireAuth / requireRole / Telegram initData
│   │   ├── routes/             auth, guides, media, search, collect, admin/*
│   │   ├── services/           storage, images, video, backup, analytics, cdn
│   │   ├── jobs/               pg-boss: воркеры и расписания
│   │   └── content/            tiptap-схема, JSON→HTML, JSON→Markdown, plaintext
│   └── Dockerfile
├── web/                Next.js 15 (публичный сайт)
├── admin/              Vite + React (админка)
├── docker-compose.yml
├── docker-compose.local.yml    только Postgres для локалки
├── Caddyfile
├── .gitlab-ci.yml
├── .env.example
├── start.cmd  /  stop.cmd
├── .claude/launch.json
├── README.md
└── CLAUDE.md
```

Задачи:
1. `git init`, `.gitignore`, `.dockerignore`.
2. `docker-compose.local.yml` — только Postgres 16-alpine с healthcheck (как в polina-crm).
3. `backend`: `package.json` (`"type": "module"`, скрипты `dev/build/start/prisma:*/seed`), tsconfig strict, Fastify-скелет с `/health`, `env.ts` на zod.
4. `web`: `create-next-app` (TS, Tailwind, App Router), базовый layout.
5. `admin`: `npm create vite` (react-ts) + Tailwind + React Router + TanStack Query + axios-клиент (копипаст `crm/src/api.ts` с интерсепторами).
6. `start.cmd` по образцу polina-crm: проверка `.env` → docker compose up --wait → npm install → prisma generate/migrate → seed → три окна с `npm run dev`.
7. `.claude/launch.json` для preview.
8. README.md на русском: как поднять, что где живёт.

**Готово, когда:** `start.cmd` на чистой машине поднимает Postgres + 3 сервиса, `/health` отвечает `{ ok: true }`.

---

### ЭТАП 2. Ядро: модель данных, auth, роли — 2.5 дня

**Цель:** пользователи заходят, роли работают, аудит пишется.

Задачи:
1. Полная `schema.prisma` из §4, первая миграция.
2. `seed.ts`: первый ADMIN из `.env` (`ADMIN_TELEGRAM_USERNAME` / `ADMIN_PASSWORD`) + базовые категории (Facebook, TikTok, Прокси, Платёжки, Онбординг) — паттерн `ensureDefaultTicketTypes` из polina-crm.
3. **Аутентификация двумя способами:**
   - Telegram: бот на grammY, команда `/start` регистрирует пользователя с ролью `NONE`; вход на сайт через Telegram Login Widget или одноразовую ссылку от бота (magic link, TTL 5 мин). Валидация `initData` по HMAC-SHA256 — код уже есть в `polina-crm/backend/src/auth.ts`, переносится почти дословно.
   - Логин+пароль (bcryptjs) — fallback.
   - Пригласительные ссылки: админ создаёт ссылку с ролью → человек переходит и сразу получает доступ (DECISIONS §16).
4. JWT: access 15 мин в httpOnly+Secure+SameSite=Lax cookie, refresh 30 дней с ротацией и хранением хеша в `RefreshToken`.
5. `requireAuth` / `requireRole(...)` — препendlers как в polina-crm.
6. Плагины: `@fastify/cors` (whitelist доменов, credentials), `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit` (глобально 300/мин; на `/auth/login` — 10/мин).
7. `AuditLog` — хук на все мутирующие админ-роуты.
8. Админка: экраны Login, Users (список, смена роли/teamRole, деактивация), Invites.
9. Публичный сайт: страница `/login`, middleware Next.js — редирект неавторизованных.

**Готово, когда:** админ заходит через Telegram и через пароль; VIEWER получает 403 на админ-эндпоинтах; каждое действие админа видно в `AuditLog`.

---

### ЭТАП 3. Медиа-подсистема: загрузка, обработка, хранилище — 3 дня

**Цель:** картинка/видео загружается напрямую в R2, обрабатывается фоном, отдаётся с CDN.

Задачи:

**3.1 Абстракция хранилища** — `services/storage.ts`:
```ts
interface StorageProvider {
  presignPut(key, mime, size): Promise<{ url, headers }>
  put(key, body, mime): Promise<void>
  get(key): Promise<Readable>
  delete(key): Promise<void>
  publicUrl(key): string
  list(prefix): AsyncIterable<{ key, size, etag }>
}
```
Реализации: `r2.provider.ts` (через `@aws-sdk/client-s3`, endpoint R2), `minio.provider.ts`, `local.provider.ts` (для локалки — просто папка). Ровно тот же приём, что с провайдером оплат в `tg-shop-miniapp/src/payments/`.

**3.2 Загрузка (прямая в бакет, минуя backend):**
1. Админка: `POST /api/admin/media/presign` → получает presigned PUT URL.
2. Браузер: `PUT` файла напрямую в R2 (прогресс через `XMLHttpRequest.upload.onprogress`).
   > Почему не через backend: видео на 500 МБ не должно дважды проходить через VPS — это и трафик, и таймауты, и память.
3. `POST /api/admin/media/:id/complete` → backend ставит задачу `media.process` в pg-boss.
4. Дедупликация: считаем sha256 в браузере (Web Crypto, стримом) — если такой `Media` уже есть, переиспользуем и не грузим.

**3.3 Обработка картинок** (воркер, sharp):
- Читаем оригинал, автоповорот по EXIF, **вырезаем все EXIF** (в скриншотах FB бывают метаданные — вопрос безопасности).
- Варианты по ширине: 320 / 640 / 960 / 1280 / 1920 (не превышая оригинал), форматы **AVIF + WebP** (+ JPEG fallback для очень старых клиентов — можно опустить).
- `blurhash` (или base64 LQIP 20px) → в `Media.blurhash`, чтобы не было прыжков вёрстки.
- Имена — `img/<sha256-8>/<width>.avif` → content-hash ⇒ можно кэшировать навсегда (`immutable`).
- Лимиты: 25 МБ, форматы png/jpg/webp/gif/avif.

**3.4 Видео (v1 — простое, но с заделом):**
- Валидация (mp4/mov/webm, лимит 2 ГБ), `ffprobe` → длительность/размеры.
- Постер: кадр на 10% длительности → в бакет.
- В `variants` пишем `[{ height: original, key }]` — структура уже готова под HLS этапа 7.
- Отдаём progressive mp4 с `Accept-Ranges` через CDN.

**3.5 Медиа-библиотека в админке:** сетка с превью, фильтр по типу, поиск по имени/alt, статус обработки (PROCESSING со спиннером), «где используется», удаление с проверкой ссылок.

**Готово, когда:** админ грузит 10-мегабайтный скриншот, через ~3 сек видит его в библиотеке в 5 вариантах; `curl -I` на `media.pai.1sx.biz/...` отдаёт AVIF с `cache-control: immutable`.

---

### ЭТАП 4. Админка: редактор гайдов — 4.5 дня

Самый трудоёмкий этап. **Цель:** админ создаёт гайд с текстом, скриншотами и видео без единой строчки кода.

Задачи:

**4.1 Редактор на TipTap:**
- Базовый набор расширений + `Placeholder`, `CharacterCount`, `Typography`, `Link`, `Table`, `CodeBlockLowlight` (подсветка кода), `Dropcursor`.
- **Кастомные ноды** из §4.1 (`image`, `video`, `gallery`, `callout`, `steps`, `checklist`, `guideRef`, `details`, `fileAttachment`) — каждая как `Node.create()` + `ReactNodeViewRenderer` для редактируемого превью.
- **Вставка из буфера**: `Ctrl+V` скриншота → автоматическая загрузка в медиа + вставка ноды. Это главная фича по скорости наполнения — гайды по FB на 80% состоят из скриншотов.
- **Drag & drop** файлов в текст.
- Слэш-команда `/` — меню вставки блоков (как в Notion).
- Bubble-меню на выделении (жирный, ссылка, код, выделение).
- Оглавление собирается автоматически из `heading` — сохраняем якоря-slug'и.

**4.2 Рабочий процесс:**
- Автосохранение `contentDraft` каждые 5 сек и на blur (debounce), индикатор «Сохранено HH:MM».
- Кнопки: Сохранить черновик · Предпросмотр (открывает `web` в режиме draft-preview по подписанному токену) · Опубликовать (спрашивает `changeNote`) · Снять с публикации · В архив.
- При публикации: `contentDraft → content`, `version++`, снимок в `GuideVersion`, пересчёт `plainText`/`html`/`readingTimeSec`, пересбор `GuideMedia`, вызов CDN purge + `revalidatePath` (см. этап 6).
- История версий: список, diff двух версий (по plain-text через `diff-match-patch`), откат в один клик.
- Мягкая блокировка: если гайд открыт другим редактором последние 5 минут — предупреждение (полноценный CRDT не нужен, редакторов 1–3).

**4.3 Метаданные гайда** (боковая панель): категория, теги, уровень, обложка, `summary`, обязателен для ролей, `reviewAt` («проверить актуальность через 30/90/180 дней»), связанные гайды, закрепить.

**4.4 Управление структурой:** категории (дерево, drag-n-drop сортировка через `@dnd-kit` — уже используется в `tg-shop-control-panel`), теги, порядок гайдов внутри категории.

**Готово, когда:** админ за 10 минут создаёт гайд «Запуск первой кампании» с 15 скриншотами, видео, чеклистом и callout'ами — и публикует.

---

### ЭТАП 5. Публичный сайт — 4 дня

**Цель:** читатель открывает гайд, и текст виден мгновенно из любой точки мира.

Задачи:

**5.1 Страницы:**
| Маршрут | Что показывает |
|---|---|
| `/` | Дашборд: обязательные для моей роли (со статусом «прочитано»), новое за неделю, закреплённое, продолжить чтение |
| `/c/[category]` | Категория: карточки гайдов, фильтры по тегам и уровню |
| `/g/[slug]` | Гайд: контент, оглавление-sticky, время чтения, «полезно?», связанные, кнопка «наверх» |
| `/search?q=` | Поиск |
| `/login` | Вход (Telegram-виджет + форма) |
| `/me` | Мой прогресс: что прочитано, что осталось из обязательного |

**5.2 Рендер контента:** собственный маппер `JSON → React`:
- `image` → `<picture>` с `srcset` AVIF/WebP, `sizes`, `width`/`height` (нет CLS), `loading="lazy"` кроме первого экрана, `fetchpriority="high"` для обложки, blurhash-подложка.
- `video` → плеер загружается **лениво** (`next/dynamic` + `IntersectionObserver`), до этого — постер с кнопкой play. Ни байта плеера, если видео не смотрят.
- `callout`, `steps`, `checklist` (клиентский компонент с сохранением прогресса), `guideRef`, таблицы со скроллом на мобильных, код с подсветкой (`shiki` на этапе билда — нулевой JS на клиенте).

**5.3 Генерация и кэш:**
- `generateStaticParams()` по опубликованным гайдам, `export const revalidate = 3600`.
- On-demand ревалидация: при публикации backend дёргает `POST /api/revalidate` в Next.js с секретом → `revalidatePath('/g/'+slug)` и `revalidatePath('/c/'+cat)`.
- `middleware.ts`: проверка auth-cookie, редирект на `/login` (Edge Runtime, работает до отдачи страницы).

**5.4 Поиск (v1):** Postgres full-text.
```sql
ALTER TABLE "Guide" ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('russian', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('russian', coalesce(summary,'')), 'B') ||
    setweight(to_tsvector('russian', coalesce("plainText",'')), 'C')
  ) STORED;
CREATE INDEX guide_tsv_idx ON "Guide" USING GIN(tsv);
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- опечатки и подсказки
```
Плюс подсветка через `ts_headline`. Каждый запрос пишется в `SearchQuery` — это будущий сигнал «каких гайдов не хватает».

**5.5 UI/UX:**
- Tailwind, тёмная тема по умолчанию (как в `tg-shop-miniapp`), адаптив от 360px.
- Шрифты — локальные `next/font` (никаких запросов к Google Fonts: это и скорость, и приватность).
- Хлебные крошки, «читали также», прогресс-бар чтения сверху.
- `noindex, nofollow` в `<meta>` и заголовке `X-Robots-Tag`; `robots.txt` — `Disallow: /`.

**Готово, когда:** Lighthouse (mobile, throttled 4G) ≥ 95 по Performance; LCP < 1.5 c; страница гайда читается с выключенным JS (кроме видео и чеклистов).

---

### ЭТАП 6. CDN, edge-авторизация, производительность — 3 дня

**Цель:** превратить «быстро с сервера» в «быстро в Джакарте и в Буэнос-Айресе».

Задачи:

**6.1 Cloudflare DNS/Proxy:** все четыре поддомена проксируются (оранжевое облако), кроме случая, если вынесете `api` из-под прокси.

**6.2 Cache Rules:**
| Правило | Действие |
|---|---|
| `media.pai.1sx.biz/*` | Cache Everything · Edge TTL 1 год · Browser TTL 1 год (имена с content-hash ⇒ безопасно) |
| `pai.1sx.biz/_next/static/*` | Cache Everything · 1 год · `immutable` |
| `pai.1sx.biz/g/*`, `/c/*`, `/` | Cache Everything · Edge TTL 1 час · Browser TTL 0 (`must-revalidate`) — **включать после 6.4** |
| `api.pai.1sx.biz/*` | Bypass Cache |
| `admin.pai.1sx.biz/*` | Bypass Cache + **Cloudflare Access** (обязательно, см. 6.4) |

**6.3 Настройки зоны:** Brotli, HTTP/3 + 0-RTT, Early Hints, **Tiered Cache** (бесплатно, заметно поднимает hit-rate при географически размазанной аудитории), Auto Minify выключить (Next.js уже минифицирует), Always Use HTTPS, HSTS.

**6.4 Закрытый доступ + кэш HTML на edge — ключевой момент.**

Контент одинаков для всех, но неавторизованному отдавать нельзя. Есть два рабочих механизма, и правильно применить **разные к разным поддоменам**.

**Публичный сайт (`pai.1sx.biz`) — свой JWT + Cloudflare Worker:**
```
запрос → Worker: валидирует JWT из cookie (jose, публичный ключ в env Worker'а)
         ├─ невалиден → 302 на /login (origin вообще не трогаем)
         └─ валиден  → cache.match() → отдать из edge-кэша,
                       иначе fetch(origin) + cache.put()
```
TTFB 20–40 мс в любой точке мира, без cookie контент недостижим. ~1 день вместе с e2e-тестом «без cookie → 302, с cookie → 200».

**Админка (`admin.pai.1sx.biz`) — Cloudflare Access.** Редакторов 2–5, кэшировать там нечего, зато нужен максимально жёсткий гейт. Access даёт SSO + MFA + журнал входов, настраивается мышкой за 20 минут, стоит $0 и на такой горстке людей никогда не упрётся в лимит. Это второй слой защиты, независимый от нашего кода, на самой чувствительной поверхности: даже дыра в нашей авторизации не откроет админку постороннему.

**Почему Access не вешаем на весь сайт, хотя команда сейчас ≤ 50 и формально проходит:**

1. **Обрыв, а не рост расходов.** Бесплатный Zero Trust — ровно 50 мест. 51-й человек включает тариф ~$7/пользователь/мес: 60 человек = **$420/мес** при том, что вся остальная инфраструктура стоит $28. Для команды, которая по своей природе набирает и меняет людей, «сейчас ровно на границе» — это не запас, а мина.
2. **Ломается вход через Telegram.** Access не умеет Telegram как провайдера. Команда логинилась бы по e-mail/OTP вместо привычного «нажал в боте и вошёл» — а вход, требующий усилий, напрямую бьёт по посещаемости базы знаний, ради которой всё и строится.
3. **Два списка доступа вместо одного.** Права жили бы в дашборде Cloudflare отдельно от таблицы `User`. Человек уволился — отключать надо в двух местах, и рано или поздно про одно забудут.

Worker решает ту же задачу один раз, без потолка по людям и с сохранением Telegram-входа.

**Если нужно ускорить MVP:** можно временно не кэшировать HTML вообще. ISR-страница уже сгенерирована и отдаётся с origin за миллисекунды, суммарный TTFB = RTT до VPS (из Европы ~40 мс, из ЮВА ~250 мс). На старте терпимо; Worker добавляется потом без переделок в приложении.

**6.5 Инвалидация:** сервис `services/cdn.ts` — `purgeUrls([...])` через Cloudflare API + `revalidatePath` в Next.js. Дёргается на publish / unpublish / archive / переименование категории.

**6.6 Защита медиа:** `media.pai.1sx.biz` доступен по прямой ссылке. Варианты по возрастанию строгости:
1. Неугадываемые ключи (sha256) + `Referrer-Policy` — минимум (v1).
2. Cloudflare Signed URLs / signed cookie на media-домене — рекомендуется для видео.
3. Worker с проверкой JWT перед отдачей — максимум.

**6.7 Замеры:** WebPageTest из 4 точек (Франкфурт, Сингапур, Сан-Паулу, Мумбаи) до и после; Cloudflare Web Analytics (RUM, бесплатно) для реальных Core Web Vitals команды. Зафиксировать бюджет: LCP < 1.5 c (p75), CLS < 0.05, TTFB < 200 мс.

**Готово, когда:** из трёх удалённых точек LCP < 1.5 c, `cf-cache-status: HIT` на медиа и (после 6.4) на HTML.

---

### ЭТАП 7. Видео — 1.5 дня сейчас + 0.5–2.5 дня позже, по замерам

**Цель:** видеогайды открываются быстро и не «буферятся» — при том, что **объём видео заранее неизвестен**.

Раз объём не спрогнозировать, неправильно закладывать под него архитектуру «на всякий случай»: переусложним ради видео, которого может не быть, или упрёмся, если его окажется много. Поэтому этап разбит на два такта — дешёвый шаг, который не загоняет в угол, и решение по измеренным цифрам.

#### 7.1 Такт 1 — нормализация (делаем сразу, 1.5 дня)

Ключевое наблюдение: проблема обычно не в формате раздачи, а в том, что записи экрана выгружают как есть. 20-минутный гайд, снятый OBS или системным рекордером, легко весит 1.5 ГБ при битрейте, который скриншотному контенту не нужен. Один проход ffmpeg снимает большую часть боли ещё до всякого HLS.

- Задача `video.normalize` в pg-boss, конкурентность 1, `nice -n 10`.
- Один рендишн: `min(исходная высота, 720p)`, H.264 High, CRF 23, `-preset veryfast`, AAC 128k.
- **`-movflags +faststart`** — метаданные в начало файла. Без этого браузер не начнёт воспроизведение, пока не выкачает файл целиком; это самая частая причина «видео не открывается» на progressive mp4.
- Типичная запись экрана 20 мин: 1.5 ГБ → 120–180 МБ без потери читаемости текста на экране.
- Постер (кадр на 10% длительности) + спрайт превью для перемотки (`thumbnails.vtt`).
- Раздача — progressive mp4 с `Accept-Ranges` через CDN; плеер ленивый (до клика только `<img>` постера).
- Структура `Media.variants` — массив рендишнов с самого начала, поэтому добавление лестницы качеств позже не потребует миграции БД.

Этого достаточно, пока видео немного. При этом мы **не написали ни строчки, которую придётся выбрасывать**: нормализация нужна одинаково и при HLS, и при Bunny.

#### 7.2 Такт 2 — решение по фактическим цифрам (через 4–6 недель эксплуатации)

К этому моменту этап 8 уже отдаёт точные данные. Решаем по таблице, а не по ощущениям:

| Что наблюдаем | Решение | Работы |
|---|---|---|
| < 20 ч в библиотеке, 1–2 загрузки в неделю, жалоб нет | Ничего не делаем, такт 1 достаточен | 0 |
| 20–100 ч, есть жалобы на буферизацию с мобильного или дальних гео | **Self-hosted HLS**: лестница 1080/720/480/360, сегменты 4 с, `hls.js` | 2.5 дня |
| > 100 ч, либо загрузки пачками по 10+, либо очередь транскодинга регулярно > 6 ч | **Bunny Stream** — снимаем транскодинг с VPS совсем | 0.5 дня |
| VPS при транскодинге даёт CPU > 50% в рабочие часы (сайт тормозит) | **Bunny Stream**, независимо от объёма | 0.5 дня |

Переключение стоит полдня именно потому, что всё это время работа идёт через интерфейс `VideoProvider` (заложен на этапе 3.1): меняется реализация, не вызовы.

**Как считать деньги, когда цифры появятся:** Bunny ≈ $0.005/ГБ раздачи + $1/мес за зону. 500 ГБ просмотров в месяц ≈ $3.5. Транскодинг на своём VPS бесплатен по деньгам, но платится временем очереди и просадкой сайта в момент обработки — при редких загрузках это незаметно, при пачках критично.

**Обязательно вывести в дашборд этапа 8** две метрики, иначе таблица 7.2 не работает: «ГБ видео роздано за месяц» и «часов видео в библиотеке».

#### 7.3 Что делаем в любом случае, независимо от такта 2

- Multipart-upload в R2 (части по 10 МБ, 3 параллельно), возобновление после обрыва, лимит 2 ГБ на файл.
- Плеер: скорость 0.75×–2× (для обучающего видео важно), запоминание позиции (localStorage + `UserGuideProgress`), горячие клавиши, полноэкранный режим, субтитры `.vtt`.
- Ленивая инициализация плеера — ни байта JS, пока видео не запустили.
- Трекинг: `VIDEO_PLAY`, пороги 25/50/75/95, `VIDEO_COMPLETE`, `VIDEO_SEEK`. Кривая удержания нужна одинаково при любом способе раздачи.
- Ограничение на загрузку в админке + подсказка «пишите экран в 1080p, не в 4K» — самая дешёвая оптимизация из всех.

**Готово (такт 1), когда:** 20-минутный гайд весит < 200 МБ, начинает играть за < 1.5 с на 4G, позиция просмотра восстанавливается, в дашборде видно, сколько трафика съедает видео.

---

### ЭТАП 8. Аналитика — 4 дня

**Цель:** ответить на вопросы «чем команда пользуется», «что не читают», «где отваливаются в видео», «каких гайдов не хватает».

**8.1 Клиентский сборщик** (`web/src/lib/analytics.ts`, ~2.5 КБ, без зависимостей):
- `visitorId` (uuid в localStorage) + `sessionId` (sessionStorage, обнуляется после 30 мин неактивности) + `userId` из auth.
- Очередь событий, flush по: 10 событий / 5 сек / `visibilitychange=hidden` / `pagehide` → `navigator.sendBeacon`.
- **Content-Type: text/plain** — так браузер не делает preflight OPTIONS, экономим round-trip.
- Активное время: тик 15 с только при `document.visibilityState === 'visible'` и наличии активности (scroll/mouse/key) за последние 60 с. Это даёт честное «время чтения», а не «вкладка висела открытой всю ночь».
- Глубина скролла: throttle 250 мс, фиксируем максимум, шлём пороги 25/50/75/100.
- **Критерий «прочитано»:** скролл ≥ 70 % **И** активное время ≥ `readingTimeSec × 0.4`. Порог настраивается в `Setting`.
- Видео: слушатели на элементе, пороги по `timeupdate`.
- Уважаем `navigator.doNotTrack` только для анонимной части (сайт корпоративный, персональная статистика по сотрудникам — это заявленное требование заказчика; команду об этом нужно уведомить).

**8.2 Ingest** (`POST /api/collect`):
- zod-валидация батча, лимит 50 событий и 32 КБ на запрос.
- Rate limit по `visitorId` (600/час).
- Страна — из заголовка `CF-IPCountry` (бесплатно от Cloudflare), устройство — из UA. **IP не сохраняем.**
- Запись `prisma.event.createMany({ skipDuplicates: true })`; идемпотентность по `(visitorId, sessionId, type, ts)` для повторной доставки beacon.
- Побочные эффекты: `GUIDE_READ` → обновляет `UserGuideProgress.readAt`; `SEARCH` → пишет `SearchQuery`.

**8.3 Роллапы** (pg-boss cron):
- Каждые 15 мин — агрегация текущего дня в `DailyGuideStat` / `DailyVideoStat`.
- В 03:00 — полный пересчёт вчерашнего (события могут доехать с опозданием).
- Раз в неделю — удаление сырых `Event` старше 180 дней (агрегаты остаются навсегда).

**8.4 Партиционирование `Event`:** декларативное по месяцам (`PARTITION BY RANGE (ts)`), автосоздание партиции на следующий месяц cron-задачей. Prisma не умеет партиции нативно — создаём их сырым SQL в миграции. При 100 пользователях это ~2–5 млн событий в год: Postgres справится и без партиций, но заложить дешевле сейчас, чем мигрировать потом.

**8.5 Дашборд в админке** (Recharts):

*Обзор:* DAU/WAU/MAU · сессии · среднее время на сайт · топ-10 гайдов недели · динамика неделя-к-неделе.

*Гайды:* таблица — открытия / уникальные / **% дочитывания** / среднее активное время / профиль скролла (гистограмма — сразу видно, на каком месте люди бросают) / 👍👎.

*Мёртвый контент:* 0 открытий за 60/90 дней → кандидаты на удаление. **Это прямой ответ на «понимать, что ненужно».**

*Протухшее:* гайды с истёкшим `reviewAt` — для методичек по FB критично, правила площадки меняются постоянно.

*Видео:* воронка 25/50/75/95/100 % и **кривая удержания** (по бакетам `timeupdate`) — видно точную секунду, где массово закрывают.

*Поиск:* топ-запросы · **запросы без результатов** — готовый список того, какие гайды написать следующими.

*Люди:* кто что читал, покрытие обязательных гайдов по `teamRole`, отчёт «новичок за первые 7 дней прочитал X из Y».

*Экспорт:* XLSX/CSV через `exceljs` — код-донор `polina-crm/backend/src/routes/stats.ts` (там уже есть группировка, итоги, форматы столбцов).

**Готово, когда:** админ за минуту отвечает на «какие 5 гайдов никто не читает» и «на какой секунде бросают видео про запуск кампании».

---

### ЭТАП 9. Бэкап и синхронизация с Google Drive — 4 дня

**Цель заказчика:** «сайт или сервер могут упасть — легко восстановить». Значит ценность не в загрузке файлов, а в **проверенной процедуре восстановления**.

#### 9.0 Авторизация в Drive: OAuth обычного аккаунта

Решение команды — обычный Google-аккаунт с refresh-токеном вместо Service Account. Workspace не нужен, квота берётся с аккаунта (15 ГБ бесплатно, дальше Google One).

**Как устроено в коде** (`services/backup/drive-auth.ts`):
```ts
const oauth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth.setCredentials({ refresh_token: env.googleRefreshToken });
// googleapis сам меняет refresh → access перед истечением, кэшируя access-токен в памяти

// Google изредка ротирует сам refresh-токен — если это произошло, его нужно сохранить,
// иначе следующий рестарт процесса пойдёт со старым и получит invalid_grant
oauth.on('tokens', async (t) => {
  if (t.refresh_token) await saveSetting('google.refresh_token', t.refresh_token);
});
```
Читаем токен так: `Setting['google.refresh_token'] ?? env.GOOGLE_REFRESH_TOKEN`. То есть `.env` — только начальное значение, дальше источник истины в БД (и она сама попадает в бэкап).

**Три вещи, которые обязательно сделать на этапе 0** (иначе бэкап тихо умрёт):

| | Что | Что будет, если забыть |
|---|---|---|
| 1 | OAuth-приложение перевести в статус **In production** | В статусе Testing refresh-токен живёт **7 дней** — бэкапы отвалятся ровно через неделю после запуска, когда все уже расслабились |
| 2 | Scope — только **`drive.file`** | Со scope `drive` приложение попадает в «restricted» и требует платной верификации Google. С `drive.file` наш сервер видит только созданные им самим файлы — и достаточно, и безопаснее |
| 3 | Запрос авторизации с `access_type=offline` **и** `prompt=consent` | Без `prompt=consent` при повторной авторизации Google вернёт только access-токен, а refresh — нет, и это не очевидно из ответа |

**Главное операционное отличие от Service Account: токен можно потерять.** Это плата за отказ от Workspace, и она приемлема — но требует явной обработки:

*Что отзывает токен:* смена пароля аккаунта · ручной отзыв в «Аккаунт Google → Безопасность → Сторонние приложения» · неиспользование 6 месяцев (нам не грозит, задачи идут ежечасно) · удаление OAuth-клиента в Google Cloud.

*Как ловим:* любой ответ `invalid_grant` от Google → `BackupRun.status = FAILED` + **немедленный алерт в Telegram** с текстом «Google отозвал доступ, бэкапы стоят, нужна переавторизация» + баннер в админке. Молчаливая деградация здесь недопустима: бэкап, который перестал идти месяц назад и никто не заметил, — худший из возможных исходов.

*Как чиним (10 минут, в runbook §8.3):* `npm run drive:auth` на любой машине → логин выделенным аккаунтом → новый refresh-токен → `PUT /api/admin/settings` или в `.env` + рестарт. Прогон бэкапа запускается кнопкой, догоняет пропущенное инкрементально.

**Ежеквартально** (вместе с restore drill): проверять в «Сторонние приложения» аккаунта, что доступ на месте, и что 2FA + резервные коды лежат в командном менеджере паролей.

#### 9.1 Страховка с первого дня (делать сразу после этапа 2, 0.5 дня)

Не ждать этапа 9: как только появилась БД, поднять контейнер с ежедневным `pg_dump | gzip` → `rclone copy` в Drive + отчёт в Telegram. Грубо, но с первого дня контент защищён.

rclone авторизуется в Drive тем же способом (`rclone config` → OAuth того же выделенного аккаунта), так что этап 0 закрывает и его. Свой `client_id` в конфиге rclone указать обязательно — на дефолтном общем клиенте rclone упирается в общие лимиты API и загрузка идёт заметно медленнее.

#### 9.2 Формат хранения на Drive

```
PAI Backups/                              папку создаёт само приложение,
                                          её folderId хранится в Setting['google.root_folder_id']
├── manifest-latest.json                 указатель на последний успешный прогон
├── db/
│   ├── 2026-07-31/dump.sql.gz           pg_dump -Fc, gzip (+ опционально age-шифрование)
│   └── ...                              ретеншен: 7 дней × 4 недели × 6 месяцев
├── content/                             ← «живое зеркало», обновляется инкрементально
│   ├── _index.json                      список гайдов, категорий, тегов
│   └── fb-launch-first-campaign/
│       ├── meta.json                    категория, теги, автор, версия, даты, requiredForRoles
│       ├── guide.json                   исходный TipTap JSON (точный restore)
│       ├── guide.md                     Markdown (человекочитаемо — открыть можно с телефона)
│       └── media.json                   какие файлы использует
└── media/                               ← зеркало бакета, инкрементально по sha256
    ├── img/ab12cd34/1280.avif
    └── video/ef56.../master.m3u8 + сегменты
```

Двойной формат контента — сознательно: `guide.json` для машинного восстановления, `guide.md` — чтобы при полном отказе платформы гайды **всё равно можно было прочитать глазами** прямо в Drive.

#### 9.3 Механика инкрементальности

1. Строим список объектов: контент (сериализуем из БД) + все ключи бакета.
2. Для каждого — sha256. Сверяем с `BackupObject`.
3. Загружаем только новые/изменённые (resumable upload для > 5 МБ), в `appProperties` кладём наш sha256.
4. После загрузки сверяем `md5Checksum`, возвращаемый Drive → защита от «залилось битым».
5. Удалённые объекты **не удаляем сразу**, а помечаем и чистим по ретеншену 30 дней — защита от «админ случайно снёс гайд, а бэкап послушно повторил удаление».
6. Пишем `BackupRun` + `manifest.json` со списком, хешами, счётчиками, версией схемы.

#### 9.4 Расписание (pg-boss cron)

| Что | Когда | RPO |
|---|---|---|
| Контент (гайды, категории, метаданные) | каждый час | ≤ 1 ч |
| Новое медиа | каждый час | ≤ 1 ч |
| `pg_dump` полный | ежедневно 04:00 | ≤ 24 ч |
| Полная сверка всех хешей | воскресенье 05:00 | — |
| Тест восстановления (автоматический smoke) | 1-е число месяца | — |

Опция для RPO ≈ 5 мин: архивация WAL (`wal-g` в R2) и PITR. Стоит делать, если появится критичная динамика (например, персональный прогресс станет ценным).

#### 9.5 Восстановление — обязательная часть этапа

Скрипт `npm run restore -- --date=2026-07-30 --target=local|staging|prod`:
1. Скачивает `manifest.json`, проверяет версию схемы и хеши.
2. Разворачивает Postgres из дампа в чистую БД.
3. Заливает медиа обратно в бакет (только отсутствующее).
4. Проверяет целостность: у каждого опубликованного гайда все `mediaId` резолвятся, все ключи есть в бакете.
5. Печатает отчёт: сколько гайдов, медиа, событий, за какое время.

**Учебное восстановление (drill) — раз в квартал**, на отдельной staging-машине, с секундомером. Фиксируем фактические RTO/RPO в `README`. Бэкап, который ни разу не разворачивали, бэкапом не считается.

#### 9.6 Что важно не забыть

- Квота Drive: 750 ГБ/сутки на аккаунт; на 403 `rateLimitExceeded` — экспоненциальный бэкофф.
- **Корневую папку создаёт приложение, а не человек.** Со scope `drive.file` папка, созданная руками в веб-интерфейсе, приложению не видна — запись в неё просто не пройдёт. `folderId` своей папки храним в `Setting`.
- **Удаляем через `files.delete`, а не в корзину.** Файлы в корзине продолжают занимать квоту 30 дней — при ретеншене медиа это тихо съест место, за которое вы платите.
- Место на аккаунте: 15 ГБ бесплатно. Дампы БД и текст влезут, видео — нет. Google One 2 ТБ ≈ $10/мес; мониторить остаток и слать алерт при < 15% свободного (через `about.get` → `storageQuota`).
- Шифрование дампа БД (`age`) — рекомендую, там хеши паролей и вся аналитика. **Ключ хранить отдельно от Drive** (в менеджере паролей команды): потеряете ключ — потеряете бэкап.
- Второй контур: включить versioning в R2 (защита от случайного `delete`) — это дешевле и быстрее Drive для отката одного файла.
- Уведомления в Telegram: провал — сразу; сводка «за сутки залито N файлов, M ГБ» — раз в день.
- Экран в админке: последние прогоны, объём, время, кнопка «Запустить сейчас», индикатор «последний успешный бэкап N часов назад» + алерт, если > 6 ч.

**Готово, когда:** на чистой машине из бэкапа поднимается полная работающая копия сайта, время зафиксировано, процедура записана в runbook.

---

### ЭТАП 10. Прод-деплой, CI/CD, мониторинг — 2 дня

**10.1 `docker-compose.yml`** (по образцу polina-crm): `postgres` (без публикации порта наружу), `backend`, `worker`, `web`, `admin`, `caddy` (80/443/443udp).

**10.2 `Caddyfile`:**
```
{
    email admin@1sx.biz
}
pai.1sx.biz        { encode zstd gzip; reverse_proxy web:3000 }
api.pai.1sx.biz    { encode zstd gzip; reverse_proxy backend:3001 }
admin.pai.1sx.biz  { encode zstd gzip; reverse_proxy admin:80 }
```

**10.3 `.gitlab-ci.yml`** — переносится из polina-crm почти без правок: `.ssh-base` → `deploy` (`git pull --ff-only` → `docker compose build` → `up -d`) + ручные джобы `backup-run`, `restore-drill`, `seed-demo`.
Улучшение против polina-crm: убрать `--no-cache` из обычного деплоя (сборка ускорится в разы), оставить его отдельной ручной джобой.

**10.4 Мониторинг:**
- Healthcheck'и во всех контейнерах; `/health` возвращает состояние БД, бакета и время последнего бэкапа.
- **Uptime Kuma** (docker, self-hosted) — пингует `/health` и публичный сайт, алерты в Telegram.
- **Sentry** (free tier) — ошибки фронта и бэкенда.
- Логи: `docker compose logs` + ротация (`json-file`, `max-size 50m`, `max-file 5`).
- Алерты в Telegram: сервис лёг · бэкап не прошёл · диск > 80 % · ошибка транскодинга · `/api/collect` вернул 5xx.

**10.5 Безопасность прода:** `.env` с `chmod 600` (уже так в CI polina-crm), fail2ban на SSH, ключи вместо паролей, `ufw` (открыты только 22/80/443), автообновления безопасности, Postgres не смотрит наружу.

**Готово, когда:** push в `main` разворачивает прод; падение любого сервиса приходит в Telegram за минуту.

---

### ЭТАП 11. Наполнение и внедрение — параллельно, 2 дня работ + непрерывно

1. **Информационная архитектура до контента:** дерево категорий, соглашение об именовании, шаблон гайда (Цель → Что нужно → Шаги → Частые ошибки → Чеклист → Связанные).
2. **Перенос существующих материалов** (Google Docs / Notion / чаты): импортёр Markdown → TipTap JSON, чтобы залить пачкой, а не руками.
3. **Обязательные гайды по ролям** — заполнить `requiredForRoles`, чтобы заработал отчёт покрытия.
4. **Онбординг:** бот рассылает приглашения; на `/` каждый видит свой список обязательного.
5. **Регламент актуализации:** `reviewAt` = 90 дней для гайдов по FB; раз в месяц админ проходит по списку протухших.
6. **Обратная связь:** 👍/👎 на каждом гайде + запросы без результатов поиска → бэклог контента.

---

### ЭТАП 12. Проверка результата — 1 день

Приёмочный чеклист:

- [ ] Гайд с текстом, 15 картинками, видео и чеклистом создаётся и публикуется за ≤ 10 минут.
- [ ] Lighthouse mobile ≥ 95; LCP < 1.5 с из трёх удалённых гео.
- [ ] Медиа отдаётся с `cf-cache-status: HIT`, `immutable`.
- [ ] Неавторизованный не получает ни HTML гайда, ни файл из бакета.
- [ ] Бэкап отработал; **восстановление из него проверено на чистой машине** с замером времени.
- [ ] Дашборд показывает открытия, % дочитывания, воронку видео, мёртвый контент, пустой поиск.
- [ ] Падение backend не роняет чтение уже сгенерированных страниц (ISR-кэш + edge).
- [ ] Все админ-действия видны в аудит-логе.
- [ ] Алерты приходят в Telegram (проверить, погасив контейнер).

---

## 7. Сквозные темы

### 7.1 Безопасность

Контент — внутренние методички по FB; утечка = прямой ущерб.

- JWT только в httpOnly+Secure+SameSite cookie; refresh с ротацией и отзывом.
- CSP: `default-src 'self'`, `media-src` и `img-src` — только свой media-домен, `script-src 'self'` (никаких внешних CDN и аналитик).
- Строгие лимиты запросов; `@fastify/helmet`.
- `noindex` + `robots.txt` + отсутствие sitemap.
- Аудит-лог на все мутации, деактивация пользователя одним переключателем (уволился — доступ закрыт мгновенно).
- Опция v2: **динамический вотермарк** с ником читателя поверх видео и полноэкранных скринов — деанонимизирует слив.
- 2FA (TOTP) для ролей ADMIN/EDITOR.
- `npm audit` в CI, Renovate для обновлений.
- Бэкапы шифруются; ключ — вне Drive.

### 7.2 Бюджет производительности

| Метрика | Цель | Как держим |
|---|---|---|
| TTFB (p75, все гео) | < 200 мс | Edge-кэш HTML, ISR |
| LCP | < 1.5 с | Готовый HTML, AVIF, `fetchpriority`, локальные шрифты |
| CLS | < 0.05 | Явные `width`/`height` у медиа, blurhash-подложки |
| JS на странице гайда | < 90 КБ gzip | Server Components, ленивый плеер, `shiki` на билде |
| Вес картинки | < 150 КБ на 1280px | AVIF q50 + WebP fallback |
| Старт видео | < 1 с | HLS, младший рендишн первым сегментом |

Правило: любое изменение, роняющее Lighthouse ниже 90, не мержится (проверка в CI через `lighthouse-ci`).

### 7.3 Тестирование

- **Vitest** (backend): валидаторы zod, конвертеры `JSON → Markdown → plainText`, расчёт `readingTimeSec`, логика роллапов аналитики, инкрементальный diff бэкапа.
- **Playwright** (e2e): вход → открытие гайда → отправка событий → админ создаёт гайд с картинкой → публикует → страница обновилась.
- **Нагрузочный smoke:** `autocannon` на `/api/collect` (аналитика не должна тормозить сайт) и на страницу гайда.
- **Restore drill** — тест, который важнее всех остальных (см. 9.5).

---

## 8. Эксплуатация

### 8.1 Runbook: «сайт упал»

1. `docker compose ps` — какой сервис лёг.
2. `docker compose logs --tail=200 <svc>`.
3. Диск: `df -h` (частая причина — забитый диск от видео/логов).
4. Postgres жив? `docker compose exec postgres pg_isready`.
5. Быстрый откат: `git checkout <прошлый-тег> && docker compose up -d --build`.
6. Если сервер утрачен целиком → см. 8.2.

### 8.2 Runbook: «сервер потерян полностью»

1. Поднять новый VPS, поставить Docker, склонировать репозиторий.
2. Положить `.env` из менеджера паролей команды — там же лежат `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`. Если refresh-токен успел протухнуть, сначала `npm run drive:auth` (10 минут, §9.0).
3. `npm run restore -- --date=<последний> --target=prod`.
4. Проверить целостность (скрипт делает это сам), `docker compose up -d`.
5. Переключить DNS в Cloudflare на новый IP (TTL держать 300 с — заранее).
6. Прогреть кэш: пройти по `sitemap` внутренним скриптом.

**Целевые показатели:** RTO ≤ 2 ч, RPO ≤ 1 ч (контент) / ≤ 24 ч (аналитика). Фактические — измерить на drill'е и записать сюда.

### 8.3 Регулярные операции

| Периодичность | Что |
|---|---|
| Ежедневно | Проверить, что бэкап зелёный (алерт в TG приходит сам) |
| Еженедельно | Дашборд: мёртвый контент, пустые поисковые запросы → бэклог |
| Ежемесячно | Гайды с истёкшим `reviewAt`; обновления зависимостей |
| Ежеквартально | **Restore drill**; ротация ключей; ревизия доступов (кто уволился); проверка, что доступ приложения к Drive на месте и 2FA-коды выделенного аккаунта лежат в менеджере паролей |

---

## 9. Стоимость владения

| Статья | Вариант | $/мес |
|---|---|---|
| VPS (Hetzner CPX31, 4 vCPU / 8 ГБ / 160 ГБ) | обязательно | ~14 |
| Cloudflare (CDN + Workers Free) | Free | 0 |
| Cloudflare Access на админку (2–5 редакторов) | Free до 50 мест | **0** |
| — если понадобится Image Resizing / расширенные правила | Pro | +20 |
| — Argo Smart Routing (заметно ускоряет дальние гео) | опция | +5 + трафик |
| R2 хранение (200 ГБ) | обязательно | ~3 |
| R2 egress | — | **0** |
| Google One 2 ТБ на выделенном аккаунте | нужен, как только пойдёт видео | ~10 |
| Домен | | ~1 |
| Sentry / Uptime Kuma | Free / self-hosted | 0 |
| **Итого MVP** | | **≈ $28/мес** |
| Bunny Stream — только если такт 2 этапа 7 к нему приведёт | по замерам | +$5–15 |

Основной ресурс — не деньги, а ~30–35 человеко-дней разработки.

> **Чего в этой таблице сознательно нет:** Cloudflare Zero Trust на весь сайт. При превышении 50 мест это ~$7/пользователь/мес, то есть $420/мес на команде в 60 человек — в 15 раз дороже всей остальной инфраструктуры. Именно поэтому доступ для читателей делаем своим Worker'ом (§6.4).

---

## 10. Риски и открытые вопросы

### 10.1 Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Видео оказалось сильно больше, чем ждали: транскодинг душит VPS | средняя | среднее | Такт 1 (нормализация) дёшев и не выбрасывается; переход на Bunny за 0.5 дня по триггерам таблицы 7.2 — решение принимается по замерам, а не заранее |
| Видео почти нет — заранее построили HLS-инфраструктуру зря | средняя | низкое | Именно поэтому такт 2 отложен: пока цифр нет, HLS не пишем |
| Команда переросла 50 человек | **высокая** | низкое (при нашей схеме) | Access только на админку (там всегда < 10); читатели — через Worker, где потолка по местам нет |
| **Google отозвал refresh-токен, бэкапы молча встали** | средняя | критическое | Алерт в Telegram на первый же `invalid_grant` + баннер в админке + индикатор «последний успешный бэкап N часов назад»; переавторизация за 10 минут по runbook (§9.0) |
| OAuth-приложение осталось в статусе Testing | средняя (легко забыть) | критическое | Вынесено отдельным пунктом в чеклист этапа 0; проверка «токену больше 7 дней и бэкап зелёный» — на первом же еженедельном обзоре |
| Google Drive упирается в квоту/лимиты API | средняя | высокое | Бэкофф на `rateLimitExceeded`, алерт при < 15% свободного места, `files.delete` вместо корзины; R2 versioning как второй контур |
| «Бэкап есть, а восстановиться не смогли» | **высокая** | критическое | Restore-скрипт и квартальный drill — вынесены в обязательную часть этапа 9 |
| Кэш HTML на edge при закрытом доступе сделан неверно → утечка | низкая | критическое | Worker с проверкой JWT до `cache.match()`; тест «без cookie → 302» в e2e |
| Редактор оказался неудобным, админ не наполняет | средняя | высокое | Прототип редактора показать админу на 2-й день этапа 4; вставка скриншотов из буфера — приоритет №1 |
| Контент устаревает (правила FB меняются) | высокая | среднее | `reviewAt` + ежемесячная ревизия + 👍👎 от читателей |
| Слив методичек наружу | средняя | высокое | Вотермарк, аудит-лог, мгновенная деактивация, signed URLs на медиа |
| Next.js — новый инструмент для команды | средняя | среднее | Только публичный сайт (1 сервис из 3), админка на привычном Vite. Главный риск не в синтаксисе, а в переносе SPA-привычек в `web` — явный запрет описан в §3.1 |

### 10.2 Решено

| Вопрос | Ответ | Что из этого следует |
|---|---|---|
| Размер команды | **до 50 сейчас** | Access — только на админку; читатели через Worker, без потолка по местам (§6.4). Партиционирование `Event` оставляем — оно дешевле сейчас, чем миграция потом |
| Объём видео | **неизвестен** | Этап 7 разбит на такты: нормализация сразу, выбор HLS/Bunny — по триггерам из замеров (§7.2) |
| Публичный сайт | **Next.js** | §3.1, этап 5 |
| Хранилище бэкапов | **Обычный Google-аккаунт + OAuth refresh-токен** | Workspace не нужен. Выделенный аккаунт, scope `drive.file`, приложение в статусе Production, обработка отзыва токена — §9.0 |

### 10.3 Что ещё подтвердить перед стартом

1. Хостинг: остаёмся на текущем VPS `1sx.biz` или поднимаем отдельный?
2. Домен для базы знаний (в плане везде подставлен `pai.1sx.biz` как пример).
3. Нужна ли персональная статистика по сотрудникам (кто что читал) — влияет на модель данных и на то, что нужно сообщить команде.
4. Кто будет админом/редакторами — им показать прототип редактора на 2-й день этапа 4, до того как он будет дописан.
5. Список e-mail для политики Cloudflare Access на админку.
6. Кто владеет выделенным Google-аккаунтом для бэкапов и где лежат его 2FA-коды.

---

## 11. Дорожная карта v2

Отсортировано по отношению «польза / трудозатраты»:

1. **Обучающие треки** — последовательности гайдов с прогрессом («Онбординг медиабаера: 12 шагов»), автовыдача по `teamRole` при регистрации.
2. **Тесты после гайда** — 3–5 вопросов, результат в статистику. Превращает базу знаний в подобие LMS.
3. **Telegram-бот как второй интерфейс** — поиск по базе прямо в чате (`/find как обойти зарез`), рассылка новых гайдов, напоминания про непрочитанное обязательное.
4. **Комментарии и вопросы к гайду** — вопрос под гайдом → уведомление автору → ответ становится частью гайда.
5. **Meilisearch** вместо Postgres FTS — если поиска станет много (опечатки, синонимы, мгновенная выдача).
6. **Динамический вотермарк** по нику читателя.
7. **Полнотекстовый поиск внутри видео** — транскрипция (Whisper) → субтитры + поиск по словам с переходом на таймкод. Очень мощно для видеогайдов.
8. **Публичная витрина** (часть гайдов наружу для найма/партнёров) — на той же архитектуре, отдельным флагом `visibility`.
9. **ClickHouse** для аналитики — только если событий станет > 50 млн/год.
10. **PITR** (`wal-g` + WAL-архив в R2) — снизить RPO с 1 часа до минут.

---

## 12. Сводка по срокам

| Этап | Дней | Накопительно |
|---|---|---|
| 0. Решения и доступы | 0.5 | 0.5 |
| 1. Скелет репозитория | 1 | 1.5 |
| 2. Ядро: данные, auth, роли | 2.5 | 4 |
| 3. Медиа-подсистема | 3 | 7 |
| 4. Админка и редактор | 4.5 | 11.5 |
| 5. Публичный сайт | 4 | 15.5 |
| **← MVP работает (+ 9.1 простой бэкап, 0.5)** | | **16** |
| 6. CDN + Worker для edge-auth + Access на админку | 3 | 19 |
| 7. Видео, такт 1 (нормализация, плеер, трекинг) | 1.5 | 20.5 |
| 8. Аналитика | 4 | 24.5 |
| 9. Бэкап на Drive + restore | 4 | 28.5 |
| 10. Прод, CI/CD, мониторинг | 2 | 30.5 |
| 11. Наполнение и внедрение | 2 | 32.5 |
| 12. Приёмка | 1 | **33.5** |
| 7. Видео, такт 2 — **через 4–6 недель по замерам** | 0 / 0.5 / 2.5 | 33.5–36 |

Порядок можно менять: этапы 6 и 8 независимы. Два жёстких требования:

1. **Этап 9.1 (простой ежедневный дамп в Drive) делается сразу после этапа 2** — чтобы контент был защищён с первого дня наполнения, а не с 29-го.
2. **Метрики видео («ГБ роздано за месяц», «часов в библиотеке») попадают в дашборд этапа 8** — без них такт 2 этапа 7 не на чем основывать, и решение опять придётся принимать вслепую.
