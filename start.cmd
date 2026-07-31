@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

echo ==========================================
echo   PAI Guides - запуск одной командой
echo ==========================================

REM ----- 1) .env -----
if not exist ".env" (
    echo [i] .env не найден - копирую из .env.example
    copy /Y .env.example .env >nul
    echo [i] Значений по умолчанию достаточно для локального запуска.
)

REM Каждый сервис читает .env из своей папки
copy /Y .env backend\.env >nul
copy /Y .env web\.env >nul

REM ----- 2) Проверка окружения -----
where docker >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Docker не установлен или не в PATH.
    echo Поставьте Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Node.js не установлен или не в PATH. Нужен Node 20+.
    echo https://nodejs.org/
    pause
    exit /b 1
)

REM ----- 3) Postgres -----
echo.
echo [1/5] Поднимаю PostgreSQL в Docker...
docker compose -f docker-compose.local.yml up -d --wait
if errorlevel 1 (
    echo [ОШИБКА] docker compose не смог поднять Postgres
    pause
    exit /b 1
)

REM ----- 4) Backend: зависимости, миграции, seed -----
echo.
echo [2/5] Backend: зависимости, миграции, начальные данные...
pushd backend

if not exist node_modules (
    call npm install
    if errorlevel 1 ( popd & pause & exit /b 1 )
)

call npx prisma generate
if errorlevel 1 ( popd & pause & exit /b 1 )

if not exist "prisma\migrations" (
    echo [i] Папки migrations нет - создаю первую миграцию...
    call npx prisma migrate dev --name init --skip-seed
) else (
    echo [i] Применяю существующие миграции...
    call npx prisma migrate deploy
)
if errorlevel 1 (
    echo [ОШИБКА] Prisma migrate упал
    popd
    pause
    exit /b 1
)

call npm run seed
if errorlevel 1 (
    echo [!] seed завершился с ошибкой - продолжаю
)
popd

REM ----- 5) Админка -----
echo.
echo [3/5] Админка: зависимости...
pushd admin
if not exist node_modules (
    call npm install
    if errorlevel 1 ( popd & pause & exit /b 1 )
)
popd

REM ----- 6) Публичный сайт -----
echo.
echo [4/5] Публичный сайт: зависимости...
pushd web
if not exist node_modules (
    call npm install
    if errorlevel 1 ( popd & pause & exit /b 1 )
)
popd

REM ----- 7) Запуск -----
echo.
echo [5/5] Запускаю backend, публичный сайт и админку в отдельных окнах...
start "PAI - Backend"     cmd /k "cd /d %~dp0backend && npm run dev"
start "PAI - Web (сайт)"  cmd /k "cd /d %~dp0web && npm run dev"
start "PAI - Admin"       cmd /k "cd /d %~dp0admin && npm run dev"

echo.
echo ==========================================
echo  Всё поднимается!
echo   - API:           http://localhost:3001/health
echo   - Публичный сайт: http://localhost:3000
echo   - Админка:        http://localhost:5173
echo.
echo  Вход по умолчанию: admin / admin12345
echo ==========================================
echo.
echo  Остановить базу: stop.cmd
echo.
endlocal
