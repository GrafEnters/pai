# syntax=docker/dockerfile:1.7
#
# Комбинированный образ для Amvera: backend, публичный сайт и админка в одном
# контейнере, nginx маршрутизирует между ними.
#
# Почему одним контейнером, а не тремя проектами:
#   • Amvera не поддерживает docker-compose — только классический Dockerfile,
#     и один проект = один сервис. Три сервиса = три оплаты плюс три сборки;
#   • один origin снимает разом три проблемы: кука авторизации работает и на
#     сайте, и в админке, CORS не нужен, а адрес API становится относительным
#     путём — и его не надо вшивать в бандл на этапе сборки.
#
# Локальная разработка этим файлом НЕ пользуется: там по-прежнему три
# отдельных npm run dev (см. start.cmd).

# ============================ backend: сборка ============================
FROM node:20-alpine AS backend-build
WORKDIR /src
RUN apk add --no-cache openssl libc6-compat
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --include=dev
COPY backend/tsconfig.json ./
COPY backend/prisma ./prisma
COPY backend/src ./src
RUN npx prisma generate && npm run build

# ======================= backend: зависимости прода ======================
FROM node:20-alpine AS backend-deps
WORKDIR /src
RUN apk add --no-cache openssl libc6-compat
COPY backend/package.json backend/package-lock.json* ./
# prisma лежит в обычных зависимостях: CLI нужен в рантайме для migrate deploy
RUN npm install --omit=dev && npm cache clean --force

# ========================= публичный сайт: сборка ========================
FROM node:20-alpine AS web-build
WORKDIR /src
RUN apk add --no-cache libc6-compat
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Пустая строка = тот же origin. Именно поэтому здесь не нужны переменные
# этапа сборки: фронтенд ходит на /api/..., а не на отдельный домен.
ENV NEXT_PUBLIC_API_URL=""
RUN npm run build

# ============================ админка: сборка ============================
FROM node:20-alpine AS admin-build
WORKDIR /src
COPY admin/package.json admin/package-lock.json* ./
RUN npm install
COPY admin/ ./
ENV VITE_API_URL=""
RUN npm run build

# ================================ рантайм ================================
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

# nginx — маршрутизация, supervisor — три процесса в одном контейнере,
# ffmpeg — постеры видео, postgresql-client — pg_dump для бэкапа
RUN apk add --no-cache \
      nginx supervisor openssl libc6-compat ffmpeg postgresql16-client \
 && mkdir -p /run/nginx /data/storage /data/backups

# --- backend ---
COPY --from=backend-deps  /src/node_modules            ./backend/node_modules
COPY --from=backend-build /src/node_modules/.prisma    ./backend/node_modules/.prisma
COPY --from=backend-build /src/node_modules/@prisma    ./backend/node_modules/@prisma
COPY --from=backend-build /src/dist                    ./backend/dist
COPY --from=backend-build /src/prisma                  ./backend/prisma
COPY backend/package.json                              ./backend/package.json

# --- публичный сайт (standalone-сборка Next.js) ---
COPY --from=web-build /src/.next/standalone ./web/
COPY --from=web-build /src/.next/static     ./web/.next/static
COPY --from=web-build /src/public           ./web/public

# --- админка: просто статика ---
COPY --from=admin-build /src/dist ./admin/

# --- обвязка ---
COPY deploy/nginx.conf      /etc/nginx/http.d/default.conf
COPY deploy/supervisord.conf /etc/supervisord.conf
COPY deploy/run-backend.sh   ./run-backend.sh
RUN chmod +x ./run-backend.sh

# Server Components ходят в backend по петле. Это внутреннее устройство образа,
# а не настройка: снаружи задавать эту переменную не нужно.
ENV API_INTERNAL_URL=http://127.0.0.1:3001

# Наружу отдаёт только nginx; backend и Next.js слушают петлю
EXPOSE 80

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
