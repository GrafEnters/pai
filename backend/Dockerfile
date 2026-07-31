# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json* ./
RUN npm install --include=dev

FROM deps AS builder
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# ffmpeg — нормализация видео и постеры (этап 3.4/7.1)
# postgresql-client — pg_dump для бэкапа БД (этап 9)
RUN apk add --no-cache openssl libc6-compat ffmpeg postgresql16-client
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist

RUN mkdir -p /data/storage /data/backups \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app /data
USER app

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
