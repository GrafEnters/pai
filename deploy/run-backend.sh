#!/bin/sh
# Запуск backend внутри комбинированного контейнера.
# Миграции и seed идемпотентны, поэтому их можно гонять при каждом старте:
# на пустой базе они её разворачивают, на существующей — ничего не меняют.
set -e

cd /app/backend

# До подсети, куда резолвится www.googleapis.com, с площадки может не быть
# маршрута — при том что соседние адреса Google отвечают за 20 мс (SETUP.md,
# ловушка D). Фронтенд Google обслуживает любое своё имя, лишь бы имя пришло
# в SNI: проверено, тот же адрес отвечает 401 на /drive/v3/about с именем
# www.googleapis.com и 404 без него. Поэтому направляем имя на рабочий адрес —
# URL, сертификат и заголовок Host остаются настоящими, меняется только то,
# куда идёт соединение. Годится и для fetch, и для node:https: оба ходят
# через getaddrinfo, а он читает /etc/hosts.
if [ -n "$GOOGLE_API_ADDRESS" ]; then
  GOOGLE_API_NAME="${GOOGLE_API_HOST:-www.googleapis.com}"
  if grep -qE "^[^#]*[[:space:]]$GOOGLE_API_NAME([[:space:]]|\$)" /etc/hosts; then
    echo "[start] $GOOGLE_API_NAME уже направлен в /etc/hosts, не трогаю"
  else
    echo "$GOOGLE_API_ADDRESS  $GOOGLE_API_NAME" >> /etc/hosts
    echo "[start] $GOOGLE_API_NAME → $GOOGLE_API_ADDRESS в обход DNS"
  fi
fi

echo "[start] применяю миграции"
npx prisma migrate deploy

echo "[start] создаю администратора и базовые категории, если их нет"
node dist/seed.js || echo "[start] seed завершился с ошибкой — продолжаю"

echo "[start] запускаю API"
exec node dist/index.js
