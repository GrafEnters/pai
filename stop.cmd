@echo off
chcp 65001 >nul
echo Останавливаю контейнер с Postgres...
docker compose -f docker-compose.local.yml down
echo Готово. Данные сохранены в docker-томе pai_pgdata.
