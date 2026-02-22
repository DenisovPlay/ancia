# Ancia Local

Локальное desktop-приложение: интерфейс на Vite/Tailwind, оболочка Tauri и Python-бэкенд с локальными LLM (MLX).

## Что это сейчас

- Локальные чаты с историей в SQLite.
- Потоковые ответы модели (`/chat/stream`, SSE) с отображением tool-calls.
- Отдельная страница моделей: выбор, загрузка/выгрузка, удаление кэша, параметры генерации.
- Маркетплейс плагинов + предустановленные плагины.
- Автономный режим (блокирует сетевые инструменты).
- Полный backend-first state: настройки, чаты и сообщения хранятся на стороне бэка.

## Стек

- Frontend: Vite + TailwindCSS + Three.js
- Desktop: Tauri 2 (Rust)
- Backend: FastAPI + SQLite
- Inference: MLX + mlx-lm

## Архитектура

- `src/main.js` — сборка UI, роутинг страниц, общие состояния.
- `src/chats.js` — чат, стриминг, отображение tool-вызовов, вложения.
- `src/models.js` — управление моделями и параметрами.
- `src/plugins.js` — маркетплейс/установленные плагины.
- `src/settings.js` — настройки приложения.
- `src/services/backendClient.js` — HTTP/SSE клиент к API.
- `backend/main.py` — инициализация FastAPI, CORS, регистрация tools.
- `backend/routes.py` — API-эндпоинты.
- `backend/engine.py` — загрузка моделей, генерация, tool-calling цикл.
- `backend/model_catalog.py` — каталог моделей и метаданные совместимости.
- `backend/storage.py` — безопасное хранение чатов/настроек в SQLite.
- `src-tauri/src/main.rs` — автозапуск и контроль backend-процесса.

## Требования

- Node.js 18+ и npm
- Python 3.10–3.12
- Для MLX: macOS (Apple Silicon)

Скрипт `npm run backend:setup` сам подберёт подходящий Python и при необходимости пересоздаст `.venv`.

## Быстрый старт

```bash
npm install
npm run backend:setup
npm run tauri:dev
```

По умолчанию бэкенд слушает `http://127.0.0.1:5055`.

## Скрипты

```bash
npm run dev                 # frontend (Vite)
npm run tauri:dev           # desktop в режиме разработки
npm run tauri:build         # release сборка Tauri
npm run backend:dev         # backend вручную (uvicorn)
npm run backend:dev:reload  # backend с --reload
npm run backend:setup       # подготовка .venv + pip install
npm run backend:sidecar     # сборка backend sidecar (PyInstaller)
```

## Модели

Каталог моделей задан в `backend/model_catalog.py` (источник правды для UI/бэка).

- Поддерживаются загрузка по требованию, выгрузка и удаление локального кэша.
- Проверяется совместимость с доступной unified memory.
- Кэш и снапшоты моделей хранятся в `backend/data/models/` и игнорируются Git (`.gitignore`).
- Для моделей с vision backend автоматически переключает runtime: текстовые запросы -> `mlx_lm`, запросы с image-вложениями -> `mlx_vlm`.
- Параметры модели можно менять отдельно для каждой модели:
  - `context_window`
  - `max_tokens`
  - `temperature`
  - `top_p`
  - `top_k`

Модель не обязана загружаться при старте приложения: загрузка может происходить при первом запросе или вручную из страницы моделей.

## Инструменты и плагины

Предустановленные плагины находятся в `backend/preinstalled_plugins.py`:

- `web.search.duckduckgo`
- `web.visit.website`
- `system.time`
- `chat.set_mood`

Плагины управляются через API и могут устанавливаться из реестра (`/plugins/registry`, `/plugins/install`).
В автономном режиме сетевые инструменты блокируются.

## Хранение данных и безопасность

- Все чаты, сообщения, настройки и состояния плагинов хранятся в SQLite (`backend/storage.py`).
- Для БД включены:
  - `PRAGMA journal_mode=WAL`
  - `PRAGMA foreign_keys=ON`
  - `PRAGMA secure_delete=ON`
- Права доступа:
  - директория данных: `0700`
  - файл БД: `0600`

В Tauri-режиме путь данных передаётся через `ANCIA_BACKEND_DATA_DIR` в системную директорию приложения.

## API (основное)

- Health:
  - `GET /health`
- Models:
  - `GET /models`
  - `POST /models/select`
  - `POST /models/load`
  - `POST /models/unload`
  - `DELETE /models/{model_id}/cache`
  - `PATCH /models/{model_id}/params`
- Chat:
  - `POST /chat`
  - `POST /chat/stream` (SSE)
  - `POST /chat/stop`
- Chats:
  - `GET /chats`
  - `POST /chats`
  - `PATCH /chats/{chat_id}`
  - `DELETE /chats/{chat_id}`
  - `POST /chats/{chat_id}/duplicate`
  - `GET /chats/{chat_id}/history`
  - `DELETE /chats/{chat_id}/messages`
  - `PATCH /chats/{chat_id}/messages/{message_id}`
  - `DELETE /chats/{chat_id}/messages/{message_id}`
- Plugins:
  - `GET /plugins`
  - `GET /plugins/registry`
  - `PATCH /plugins/registry`
  - `POST /plugins/install`
  - `DELETE /plugins/{plugin_id}/uninstall`
  - `POST /plugins/{plugin_id}/enable`
  - `POST /plugins/{plugin_id}/disable`
  - `POST /plugins/{plugin_id}/update`
- Settings/App:
  - `GET /settings`
  - `PATCH /settings`
  - `GET /app/state`
  - `POST /app/reset`

Также реализован общий preflight-обработчик:

- `OPTIONS /{full_path:path}` -> `204 No Content`

## Полезные переменные окружения

- `ANCIA_BACKEND_HOST` (по умолчанию `127.0.0.1`)
- `ANCIA_BACKEND_PORT` (по умолчанию `5055`)
- `ANCIA_BACKEND_DATA_DIR` (путь к данным бэка)
- `ANCIA_CORS_ALLOW_ORIGINS` (по умолчанию `*`)
- `ANCIA_ENABLE_MODEL_EAGER_LOAD=1` (загрузка модели на старте)
- `ANCIA_PLUGIN_REGISTRY_URL` (URL реестра плагинов)

## Troubleshooting

- `405 Method Not Allowed` на `OPTIONS ...`
  - Проверьте, что запущен актуальный backend с `OPTIONS /{full_path:path}` (должен отвечать `204`).
- `503 Не удалось загрузить модель`
  - Проверьте Python (`3.10–3.12`) и `npm run backend:setup`.
  - Проверьте доступную unified memory и выбранную модель.
- Tauri пишет `backend already running on 127.0.0.1:5055`
  - Обычно это нормальное поведение: найден живой backend-процесс.
  - Если процесс “залип”, освободите порт `5055` и перезапустите `npm run tauri:dev`.

## Release: sidecar backend

Соберите sidecar:

```bash
npm run backend:sidecar
```

Ожидаемый артефакт:

- `src-tauri/bin/ancia-backend` (macOS/Linux)
- `src-tauri/bin/ancia-backend.exe` (Windows)

При `tauri build` этот бинарь подтягивается как ресурс.
