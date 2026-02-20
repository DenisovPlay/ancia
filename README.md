# Ancia Enterprise

Локальное desktop-приложение: UI на Vite/Tailwind + оболочка Tauri + Python backend.

## Стек

- Frontend: Vite + TailwindCSS + Three.js
- Desktop: Tauri 2 (Rust)
- Backend: FastAPI + SQLite

## Что уже работает

- Автозапуск backend при `npm run tauri:dev` (если порт `127.0.0.1:5055` свободен).
- Реальная загрузка модели Standart через Python/MLX:
  - `lmstudio-community/Qwen2.5-0.5B-Instruct-MLX-4bit`
  - проверка доступной unified (GPU/CPU) памяти на старте
  - статусы старта модели в `GET /health` (`startup.status`, `startup.stage`, `startup.message`)
- API-контракт:
  - `GET /health`
  - `POST /chat`
  - `GET /models`, `POST /models/select`
  - `GET /tools`
  - `GET /plugins`, `POST /plugins/{id}/enable`, `POST /plugins/{id}/disable`
- Хранение истории и настроек backend в SQLite.
- Базовый каркас tool/plugin системы.

## Структура

- `/Users/andrey/Documents/Ancia/src/main.js` - UI логика, запросы в backend
- `/Users/andrey/Documents/Ancia/src/services/backendClient.js` - HTTP клиент
- `/Users/andrey/Documents/Ancia/backend/main.py` - FastAPI backend
- `/Users/andrey/Documents/Ancia/backend/plugins/*.json` - манифесты плагинов
- `/Users/andrey/Documents/Ancia/src-tauri/src/main.rs` - автозапуск/остановка backend процесса

## Локальный запуск

1. Установить JS-зависимости:

```bash
npm install
```

2. Поднять Python окружение:

```bash
npm run backend:setup
```

Важно: для MLX нужен Python `3.10-3.12` (скрипт setup подберёт/пересоздаст `.venv` при необходимости).

3. Запустить приложение:

```bash
npm run tauri:dev
```

Tauri сам поднимет backend через `.venv/bin/python3` (или `python3`).

## Ручной запуск backend (для отладки API)

```bash
npm run backend:dev
```

или с авто-перезапуском:

```bash
npm run backend:dev:reload
```

## Release sidecar (macOS/Windows)

В релизе Tauri ищет backend-бинарник в ресурсах:

- `src-tauri/bin/ancia-backend` (macOS/Linux)
- `src-tauri/bin/ancia-backend.exe` (Windows)

Эти файлы нужно положить перед `tauri build`. Конфиг уже включает `src-tauri/bin/*` в ресурсы.

Сборка sidecar из Python backend:

```bash
npm run backend:sidecar
```
