#!/bin/sh
# Запуск backend внутри комбинированного контейнера.
# Миграции и seed идемпотентны, поэтому их можно гонять при каждом старте:
# на пустой базе они её разворачивают, на существующей — ничего не меняют.
set -e

cd /app/backend

echo "[start] применяю миграции"
npx prisma migrate deploy

echo "[start] создаю администратора и базовые категории, если их нет"
node dist/seed.js || echo "[start] seed завершился с ошибкой — продолжаю"

echo "[start] запускаю API"
exec node dist/index.js
