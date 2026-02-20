import { icon } from "./ui/icons.js";

export const settingsPageTemplate = `
  <aside
    id="settings-aside"
    class="page-aside glass-panel fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="settings-section-search"
      type="search"
      aria-label="Поиск раздела настроек"
      placeholder="Поиск раздела"
      class="rounded-3xl border border-zinc-600/30 bg-transparent p-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-500/60"
    />
    <p id="settings-section-search-empty" class="mt-3 hidden text-xs text-zinc-500">Разделы не найдены</p>

    <nav class="mt-3 space-y-2" aria-label="Пункты настроек">
      <button
        type="button"
        data-settings-section-target="personalization"
        data-active="true"
        class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold"
      >
        <span class="icon-button justify-start">${icon("personalization", "ui-icon-lg")}<span>Персонализация</span></span>
      </button>
      <button
        type="button"
        data-settings-section-target="interface"
        data-active="false"
        class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold"
      >
        <span class="icon-button justify-start">${icon("interface", "ui-icon-lg")}<span>Настройки интерфейса</span></span>
      </button>
      <button
        type="button"
        data-settings-section-target="developer"
        data-active="false"
        class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold"
      >
        <span class="icon-button justify-start">${icon("developer", "ui-icon-lg")}<span>Для разработчиков</span></span>
      </button>
      <button
        type="button"
        data-settings-section-target="about"
        data-active="false"
        class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold"
      >
        <span class="icon-button justify-start">${icon("info", "ui-icon-lg")}<span>О приложении</span></span>
      </button>
    </nav>
    <div class="flex-grow"></div>
    <div class="mt-3 rounded-3xl border border-zinc-600/30 p-3">
      <p class="text-xs text-zinc-300">Профиль конфигурации</p>
      <p class="mt-1 text-2xl font-semibold text-zinc-100">Локальный</p>
      <p class="text-xs text-zinc-500">Сохранение в backend storage</p>
    </div>
  </aside>

  <main class="page-main glass-panel relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Настройки</p>
        <h1 id="settings-section-title" class="text-lg font-semibold text-zinc-100 sm:text-xl">Персонализация</h1>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span id="settings-dirty-badge" class="hidden rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-amber-300">
          Есть изменения
        </span>
        <button
          type="button"
          data-open-settings-aside
          aria-label="Разделы"
          aria-controls="settings-aside"
          aria-expanded="false"
          title="Разделы"
          class="icon-button active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 bg-zinc-800/80 text-zinc-200 transition hover:bg-zinc-700/80 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          id="settings-save-config"
          type="button"
          aria-keyshortcuts="Control+S Meta+S"
          class="icon-button active:scale-95 rounded-full border border-zinc-500/30 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
        >
          ${icon("save")}
          <span>Сохранить</span>
        </button>
      </div>
    </div>

    <section class="chat-scroll min-h-0 flex-1 overflow-auto pb-3 pr-1">

        <article
          data-settings-section="personalization"
          class="settings-section rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-3"
        >
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-100">Персонализация</h2>
            <span class="rounded-full border border-zinc-600/30 bg-zinc-800/70 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
              профиль
            </span>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Имя
              <input
                id="settings-user-name"
                type="text"
                placeholder="Андрей"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Язык общения
              <select
                id="settings-user-language"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              >
                <option value="ru">ru</option>
                <option value="en">en</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Часовой пояс
              <input
                id="settings-user-timezone"
                type="text"
                placeholder="Europe/Moscow"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Роль / контекст
              <input
                id="settings-user-context"
                type="text"
                placeholder="Например: основатель, продуктовый инженер"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <div class="md:col-span-2 rounded-3xl border border-zinc-600/30 bg-zinc-900/55 p-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <p class="text-xs uppercase tracking-[0.14em] text-zinc-400">Модель</p>
                <span id="settings-model-tier-label" class="rounded-full border border-zinc-600/30 bg-zinc-800/70 px-2 py-1 text-[11px] font-medium text-zinc-100">
                  Lite
                </span>
              </div>
              <input
                id="settings-model-tier"
                type="range"
                min="0"
                max="2"
                step="1"
                value="0"
                aria-label="Выбор модели"
                class="model-tier-range w-full"
              />
              <div class="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                <span>Lite</span>
                <span>Standart</span>
                <span>Plus</span>
              </div>
              <p id="settings-model-tier-meta" class="mt-3 text-xs text-zinc-400">
                Лёгкий режим: минимальная нагрузка и расход памяти.
              </p>

              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
                  Модель (Hugging Face)
                  <select
                    id="settings-model-id"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  >
                    <option value="">Загрузка списка моделей...</option>
                  </select>
                </label>
                <p id="settings-model-id-meta" class="md:col-span-2 text-xs text-zinc-400">
                  Каталог моделей подгружается с бэкенда.
                </p>
              </div>

              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  Профиль устройства/GPU
                  <select
                    id="settings-device-preset"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  >
                    <option value="auto">Авто</option>
                  </select>
                </label>
                <div class="flex items-end">
                  <button
                    id="settings-apply-device-preset"
                    type="button"
                    class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
                  >
                    ${icon("settings")}
                    <span>Применить профиль</span>
                  </button>
                </div>
                <p id="settings-device-preset-meta" class="md:col-span-2 text-xs text-zinc-400">
                  Быстрые преднастройки под устройство и класс видеокарты.
                </p>
              </div>

              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  Контекст (токены)
                  <input
                    id="settings-model-context-window"
                    type="number"
                    min="256"
                    max="32768"
                    step="128"
                    placeholder="auto"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  />
                </label>
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  Max tokens
                  <input
                    id="settings-model-max-tokens"
                    type="number"
                    min="16"
                    max="4096"
                    step="8"
                    placeholder="auto"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  />
                </label>
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  Temperature
                  <input
                    id="settings-model-temperature"
                    type="number"
                    min="0"
                    max="2"
                    step="0.05"
                    placeholder="auto"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  />
                </label>
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400">
                  Top P
                  <input
                    id="settings-model-top-p"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="auto"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  />
                </label>
                <label class="flex flex-col gap-1 text-[11px] uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
                  Top K
                  <input
                    id="settings-model-top-k"
                    type="number"
                    min="1"
                    max="400"
                    step="1"
                    placeholder="auto"
                    class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                  />
                </label>
              </div>
            </div>
          </div>
        </article>

        <article
          data-settings-section="interface"
          class="settings-section hidden rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-3"
        >
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-100">Настройки интерфейса</h2>
            <span class="rounded-full border border-zinc-600/30 bg-zinc-800/70 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-zinc-300">
              интерфейс
            </span>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Плотность интерфейса
              <select
                id="settings-ui-density"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              >
                <option value="comfortable">комфортная</option>
                <option value="compact">компактная</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Масштаб шрифта (%)
              <input
                id="settings-ui-font-scale"
                type="number"
                min="85"
                max="120"
                step="1"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Семейство шрифтов
              <select
                id="settings-ui-font-preset"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              >
                <option value="system">Системный Sans</option>
                <option value="serif">Системный Serif</option>
                <option value="rounded">Системный Rounded</option>
                <option value="mono">Monospace</option>
                <option value="custom">Свой (установленный в ОС)</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
              Доступные системные шрифты
              <div class="flex items-center gap-2">
                <select
                  id="settings-ui-font-family"
                  class="flex-1 rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
                >
                  <option value="">Сканируем шрифты...</option>
                </select>
                <button
                  id="settings-ui-font-refresh"
                  type="button"
                  class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/80 px-3 py-2 text-xs text-zinc-200 transition hover:bg-zinc-700/80"
                >
                  ${icon("refresh")}
                  <span>Обновить</span>
                </button>
              </div>
            </label>
            <p id="settings-ui-font-meta" class="text-xs text-zinc-400 md:col-span-2">
              Показываются реально доступные системные шрифты. Внешние font-CDN отключены.
            </p>

            <label class="flex items-center gap-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/55 px-3 py-2 text-sm text-zinc-200">
              <input id="settings-ui-animations" type="checkbox" class="h-4 w-4 rounded border-zinc-500 bg-zinc-900 text-zinc-100" />
              Анимации интерфейса
            </label>

            <label class="flex items-center gap-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/55 px-3 py-2 text-sm text-zinc-200">
              <input id="settings-ui-show-inspector" type="checkbox" class="h-4 w-4 rounded border-zinc-500 bg-zinc-900 text-zinc-100" />
              Показывать инспектор на широком экране
            </label>
          </div>
        </article>

        <article
          data-settings-section="developer"
          class="settings-section hidden rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-3"
        >
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-sm font-semibold text-zinc-100">Для разработчиков</h2>
            <span
              id="settings-connection-badge"
              class="rounded-full border border-zinc-600/30 bg-zinc-800/70 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-zinc-300"
            >
              не проверен
            </span>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Режим работы
              <select
                id="settings-runtime-mode"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              >
                <option value="mock">симуляция (локальный интерфейс)</option>
                <option value="backend">бэкенд (API сервера)</option>
              </select>
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Таймаут (мс)
              <input
                id="settings-timeout-ms"
                type="number"
                min="500"
                step="100"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
              URL бэкенда
              <input
                id="settings-backend-url"
                type="text"
                placeholder="http://127.0.0.1:5055"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
              API-ключ (необязательно)
              <input
                id="settings-api-key"
                type="password"
                autocomplete="off"
                placeholder="Токен доступа"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex items-center gap-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/55 px-3 py-2 text-sm text-zinc-200 md:col-span-2">
              <input id="settings-auto-reconnect" type="checkbox" class="h-4 w-4 rounded border-zinc-500 bg-zinc-900 text-zinc-100" />
              Авто-проверка соединения при запуске
            </label>

            <label class="flex items-center gap-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/55 px-3 py-2 text-sm text-zinc-200 md:col-span-2">
              <input id="settings-autonomous-mode" type="checkbox" class="h-4 w-4 rounded border-zinc-500 bg-zinc-900 text-zinc-100" />
              Автономный режим (блокировать все внешние запросы)
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400">
              Длительность перехода (мс)
              <input
                id="settings-default-transition"
                type="number"
                min="120"
                step="50"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              />
            </label>

            <label class="flex flex-col gap-1 text-xs uppercase tracking-[0.14em] text-zinc-400 md:col-span-2">
              Стартовое состояние
              <select
                id="settings-boot-mood"
                class="rounded-3xl border border-zinc-600/30 bg-zinc-900/70 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-500/60"
              >
                <option value="neutral">нейтрально</option>
                <option value="thinking">размышление</option>
                <option value="waiting">ожидание</option>
                <option value="success">успех</option>
                <option value="friendly">дружелюбно</option>
                <option value="planning">планирование</option>
                <option value="coding">кодинг</option>
                <option value="researching">исследование</option>
                <option value="warning">предупреждение</option>
                <option value="creative">креатив</option>
                <option value="offline">офлайн</option>
                <option value="error">ошибка</option>
                <option value="aggression">агрессия</option>
              </select>
            </label>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              id="settings-test-connection"
              type="button"
              class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/80 px-3 py-1 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
            >
              ${icon("inspector")}
              <span>Проверить соединение</span>
            </button>
          </div>

          <p id="settings-connection-meta" class="mt-3 text-xs text-zinc-400">Сервер не проверялся</p>

          <div class="mt-3 rounded-3xl border border-zinc-600/30 bg-zinc-950/60 p-3">
            <p class="text-xs text-zinc-400">Черновик контракта бэкенда</p>
            <ul class="mt-3 space-y-1 text-xs font-mono text-zinc-300">
              <li>GET /health - состояние сервера</li>
              <li>GET /settings - runtime/onboarding/policy</li>
              <li>PATCH /settings - сохранить настройки</li>
              <li>POST /app/reset - полный сброс данных</li>
              <li>GET /chats - список чатов и сообщений</li>
              <li>POST /chats - создать чат</li>
              <li>PATCH /chats/{id} - обновить чат</li>
              <li>DELETE /chats/{id} - удалить чат</li>
              <li>PATCH /chats/{id}/messages/{msgId} - изменить сообщение</li>
              <li>DELETE /chats/{id}/messages/{msgId} - удалить сообщение</li>
              <li>POST /chat - ответ модели</li>
              <li>POST /chat/stream - потоковый ответ (SSE)</li>
              <li>POST /chat/stop - остановить текущую генерацию</li>
              <li>GET /plugins/registry - маркетплейс и установленные плагины</li>
              <li>PATCH /plugins/registry - изменить URL реестра</li>
              <li>POST /plugins/install - установить плагин по id/manifest_url</li>
              <li>DELETE /plugins/{id}/uninstall - удалить пользовательский плагин</li>
            </ul>
            <pre class="mt-3 overflow-auto text-[11px] leading-5 text-zinc-300">{
  "message": "text",
  "attachments": [],
  "context": {
    "mood": "neutral",
    "ui": {
      "modelTier": "lite",
      "modelId": "qwen2.5-0.5b-instruct-mlx-4bit"
    },
    "history": []
  }
}</pre>
          </div>
        </article>

        <article
          data-settings-section="about"
          class="settings-section hidden rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-3"
        >
          <h2 class="text-sm font-semibold text-zinc-100">О приложении</h2>
          <div class="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div class="flex items-center justify-between rounded-3xl bg-zinc-900/55 px-3 py-2">
              <span class="text-zinc-300">Название</span>
              <span class="font-mono text-zinc-100">Ancia Локальный агент-чат</span>
            </div>
            <div class="flex items-center justify-between rounded-3xl bg-zinc-900/55 px-3 py-2">
              <span class="text-zinc-300">Версия интерфейса</span>
              <span class="font-mono text-zinc-100">0.1.0</span>
            </div>
            <div class="flex items-center justify-between rounded-3xl bg-zinc-900/55 px-3 py-2">
              <span class="text-zinc-300">Стек</span>
              <span class="font-mono text-zinc-100">Vite + Tailwind + Tauri</span>
            </div>
            <div class="flex items-center justify-between rounded-3xl bg-zinc-900/55 px-3 py-2">
              <span class="text-zinc-300">Целевой бэкенд</span>
              <span class="font-mono text-zinc-100">Python API</span>
            </div>
            <div class="flex items-center justify-between rounded-3xl bg-zinc-900/55 px-3 py-2 md:col-span-2">
              <span class="text-zinc-300">Горячие клавиши</span>
              <span class="font-mono text-zinc-100">1/2/3 - разделы, Ctrl/Cmd+S - сохранить</span>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-end">
            <button
              id="settings-reset-all"
              type="button"
              class="icon-button action-dialog__confirm-danger active:scale-95 rounded-full border border-red-500/35 bg-red-500/15 px-3 py-2 text-sm text-red-200 transition hover:bg-red-500/25"
            >
              ${icon("trash")}
              <span>Сбросить всё</span>
            </button>
          </div>
        </article>

      </section>
  </main>
`;

const VALID_SETTINGS_SECTIONS = new Set(["personalization", "interface", "developer", "about"]);
const SETTINGS_SECTION_TITLE = {
  personalization: "Персонализация",
  interface: "Интерфейс",
  developer: "Для разработчиков",
  about: "О приложении",
};
const SETTINGS_SECTION_TRANSITION_MS = 190;
const SYSTEM_FONT_FALLBACK_CANDIDATES = [
  "SF Pro Text",
  "SF Pro Display",
  "SF Pro Rounded",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Avenir Next",
  "Avenir",
  "Gill Sans",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
  "Segoe UI",
  "Segoe UI Variable",
  "Calibri",
  "Candara",
  "Corbel",
  "Cambria",
  "Constantia",
  "Georgia",
  "Times New Roman",
  "Palatino",
  "Iowan Old Style",
  "Menlo",
  "Monaco",
  "Consolas",
  "Cascadia Mono",
  "Courier New",
  "Lucida Console",
  "JetBrains Mono",
  "Fira Code",
  "Fira Mono",
  "Source Code Pro",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
  "Roboto",
  "Roboto Slab",
  "Ubuntu",
  "Ubuntu Mono",
  "Cantarell",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "PT Sans",
  "PT Serif",
  "Open Sans",
  "Lato",
  "Inter",
  "Source Sans 3",
  "Baskerville",
  "Didot",
  "Charter",
  "Comic Sans MS",
];

export function createSettingsFeature({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
  normalizeModelTier,
  normalizeModelId,
  getModelLabelById,
  getModelTierMeta,
  modelTierToRangeIndex,
  modelTierOrder,
  devicePresetMeta,
  devicePresetOrder,
  normalizeDevicePreset,
  getDevicePresetMeta,
  applyDevicePreset,
  isMotionEnabled,
  pushToast,
  backendClient,
  updateConnectionState,
  BACKEND_STATUS,
  applyRuntimeConfig,
  getChatFeature,
  isSettingsAsideDocked,
  mobileState,
  syncMobilePanels,
  clearFieldValidation,
  isValidTimezone,
}) {
  const settingsSectionButtons = [...document.querySelectorAll("[data-settings-section-target]")];
  const settingsSections = [...document.querySelectorAll("[data-settings-section]")];
  const settingsSaveButtons = [elements.settingsSaveConfig].filter(Boolean);
  const settingsFields = [
    elements.settingsRuntimeMode,
    elements.settingsBackendUrl,
    elements.settingsApiKey,
    elements.settingsTimeoutMs,
    elements.settingsModelTier,
    elements.settingsModelId,
    elements.settingsDevicePreset,
    elements.settingsModelContextWindow,
    elements.settingsModelMaxTokens,
    elements.settingsModelTemperature,
    elements.settingsModelTopP,
    elements.settingsModelTopK,
    elements.settingsAutoReconnect,
    elements.settingsAutonomousMode,
    elements.settingsBootMood,
    elements.settingsDefaultTransition,
    elements.settingsUserName,
    elements.settingsUserContext,
    elements.settingsUserLanguage,
    elements.settingsUserTimezone,
    elements.settingsUiDensity,
    elements.settingsUiAnimations,
    elements.settingsUiFontScale,
    elements.settingsUiFontPreset,
    elements.settingsUiFontFamily,
    elements.settingsUiShowInspector,
  ].filter(Boolean);

  let currentSettingsSection = "personalization";
  let settingsSectionTransitionToken = 0;
  let settingsCommittedFingerprint = getConfigFingerprint(runtimeConfig);
  let eventsBound = false;
  let saveInFlight = false;
  let modelCatalog = [];
  let systemFontCatalog = [];
  let systemFontLoading = false;

  function getConfigFingerprint(config) {
    return JSON.stringify(normalizeRuntimeConfig(config));
  }

  function normalizeSettingsSection(section) {
    const normalized = String(section || "").trim().toLowerCase();
    return VALID_SETTINGS_SECTIONS.has(normalized) ? normalized : "personalization";
  }

  function syncSettingsSectionTitle(section) {
    if (!elements.settingsSectionTitle) {
      return;
    }
    const safeSection = normalizeSettingsSection(section);
    elements.settingsSectionTitle.textContent = SETTINGS_SECTION_TITLE[safeSection] || SETTINGS_SECTION_TITLE.personalization;
  }

  function applySettingsSection(section, { animate = true } = {}) {
    const nextSection = normalizeSettingsSection(section);
    const prevSection = currentSettingsSection;
    currentSettingsSection = nextSection;
    syncSettingsSectionTitle(nextSection);
    const shouldAnimate = animate && isMotionEnabled() && prevSection !== nextSection;
    const transitionId = ++settingsSectionTransitionToken;
    const isCurrentTransition = () => transitionId === settingsSectionTransitionToken;

    settingsSectionButtons.forEach((button) => {
      const isActive = button.dataset.settingsSectionTarget === nextSection;
      button.dataset.active = String(isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    settingsSections.forEach((panel) => {
      const isVisible = panel.dataset.settingsSection === nextSection;
      if (!shouldAnimate) {
        panel.classList.remove("settings-section-enter", "settings-section-leave");
        panel.classList.toggle("hidden", !isVisible);
        panel.setAttribute("aria-hidden", String(!isVisible));
        return;
      }

      if (!isVisible) {
        panel.classList.remove("settings-section-enter", "settings-section-leave");
        panel.classList.add("hidden");
        panel.setAttribute("aria-hidden", "true");
        return;
      }

      panel.classList.remove("hidden", "settings-section-leave", "settings-section-enter");
      panel.setAttribute("aria-hidden", "false");
      void panel.offsetWidth;
      panel.classList.add("settings-section-enter");
      window.setTimeout(() => {
        if (!isCurrentTransition()) {
          return;
        }
        panel.classList.remove("settings-section-enter");
      }, SETTINGS_SECTION_TRANSITION_MS);
    });
  }

  function syncModelTierPreview(tierLike) {
    const tier = normalizeModelTier(tierLike ?? runtimeConfig.modelTier);
    const tierMeta = getModelTierMeta(tier);
    const tierIndex = modelTierToRangeIndex(tier);
    const tierPercent = (tierIndex / Math.max(1, modelTierOrder.length - 1)) * 100;

    if (elements.settingsModelTier instanceof HTMLInputElement) {
      elements.settingsModelTier.value = String(tierIndex);
      elements.settingsModelTier.style.setProperty("--tier-progress", `${tierPercent.toFixed(1)}%`);
    }
    if (elements.settingsModelTierLabel) {
      elements.settingsModelTierLabel.textContent = tierMeta.label;
    }
    if (elements.settingsModelTierMeta) {
      elements.settingsModelTierMeta.textContent = tierMeta.description;
    }
  }

  function normalizeModelCatalogItem(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const id = normalizeModelId(raw.id || raw.model_id || "");
    if (!id) {
      return null;
    }
    return {
      id,
      label: String(raw.label || getModelLabelById(id, id)).trim() || id,
      description: String(raw.description || "").trim(),
      family: String(raw.family || "").trim(),
      size: String(raw.size || "").trim(),
      quantization: String(raw.quantization || "").trim(),
      supportsTools: raw.supports_tools !== false,
      supportsVision: Boolean(raw.supports_vision),
      supportsDocuments: raw.supports_documents !== false,
      recommendedTier: normalizeModelTier(raw.recommended_tier || "lite"),
    };
  }

  function getAvailableModelIds() {
    return modelCatalog.map((item) => item.id);
  }

  function syncDevicePresetMeta() {
    if (!elements.settingsDevicePresetMeta) {
      return;
    }
    const presetId = normalizeDevicePreset(elements.settingsDevicePreset?.value || runtimeConfig.devicePreset);
    const meta = getDevicePresetMeta(presetId);
    elements.settingsDevicePresetMeta.textContent = String(meta?.description || "");
  }

  function normalizeFontFamilyName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function uniqueSortedFontNames(values) {
    const seen = new Set();
    const out = [];
    (values || []).forEach((value) => {
      const safe = normalizeFontFamilyName(value);
      if (!safe) {
        return;
      }
      const key = safe.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      out.push(safe);
    });
    return out.sort((a, b) => a.localeCompare(b, "ru"));
  }

  async function queryLocalSystemFonts() {
    if (typeof window.queryLocalFonts !== "function") {
      return [];
    }
    try {
      const records = await window.queryLocalFonts();
      const names = (records || [])
        .map((item) => normalizeFontFamilyName(item?.family || item?.fullName || ""))
        .filter(Boolean);
      return uniqueSortedFontNames(names);
    } catch (error) {
      return [];
    }
  }

  function detectSystemFontsByCanvasProbe() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return [];
    }
    const text = "mmmmmmmmmmlliWWWW@@##12345";
    const fontSize = "72px";
    const baseFamilies = ["monospace", "sans-serif", "serif"];
    const baseWidths = new Map();
    baseFamilies.forEach((base) => {
      context.font = `${fontSize} ${base}`;
      baseWidths.set(base, context.measureText(text).width);
    });

    const detected = [];
    SYSTEM_FONT_FALLBACK_CANDIDATES.forEach((candidate) => {
      const safeCandidate = normalizeFontFamilyName(candidate);
      if (!safeCandidate) {
        return;
      }
      const exists = baseFamilies.some((base) => {
        context.font = `${fontSize} "${safeCandidate}", ${base}`;
        const width = context.measureText(text).width;
        return Math.abs(width - Number(baseWidths.get(base) || 0)) > 0.01;
      });
      if (exists) {
        detected.push(safeCandidate);
      }
    });
    return uniqueSortedFontNames(detected);
  }

  function renderSystemFontOptions(preferredValue = "") {
    const select = elements.settingsUiFontFamily;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const preferred = normalizeFontFamilyName(preferredValue);
    const current = normalizeFontFamilyName(select.value);
    const selected = preferred || current;

    select.innerHTML = "";
    if (!systemFontCatalog.length) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = "";
      fallbackOption.textContent = "Системные шрифты не обнаружены";
      select.append(fallbackOption);
      select.value = "";
      return;
    }

    systemFontCatalog.forEach((fontName) => {
      const option = document.createElement("option");
      option.value = fontName;
      option.textContent = fontName;
      select.append(option);
    });
    const resolved = systemFontCatalog.includes(selected)
      ? selected
      : systemFontCatalog[0];
    select.value = resolved;
  }

  async function loadSystemFontCatalog({ silent = true } = {}) {
    if (systemFontLoading) {
      return false;
    }
    systemFontLoading = true;
    try {
      let detectedFonts = await queryLocalSystemFonts();
      if (!detectedFonts.length) {
        detectedFonts = detectSystemFontsByCanvasProbe();
      }
      systemFontCatalog = uniqueSortedFontNames(detectedFonts);
      renderSystemFontOptions(runtimeConfig.uiFontFamily);
      if (!systemFontCatalog.length && !silent) {
        pushToast("Не удалось получить список системных шрифтов автоматически.", {
          tone: "warning",
          durationMs: 3600,
        });
      }
      return systemFontCatalog.length > 0;
    } finally {
      systemFontLoading = false;
      syncUiFontControls();
    }
  }

  function syncUiFontControls() {
    const selectedPreset = String(
      elements.settingsUiFontPreset?.value
      || runtimeConfig.uiFontPreset
      || "system",
    ).trim().toLowerCase();
    const isCustom = selectedPreset === "custom";
    const customField = elements.settingsUiFontFamily;
    if (customField instanceof HTMLSelectElement) {
      customField.disabled = !isCustom;
      customField.setAttribute("aria-disabled", String(!isCustom));
      customField.classList.toggle("opacity-60", !isCustom);
    }
    if (elements.settingsUiFontMeta) {
      if (!isCustom) {
        elements.settingsUiFontMeta.textContent = "Показываются реально доступные системные шрифты. Внешние font-CDN отключены.";
      } else if (systemFontLoading) {
        elements.settingsUiFontMeta.textContent = "Сканируем доступные системные шрифты...";
      } else if (!systemFontCatalog.length) {
        elements.settingsUiFontMeta.textContent = "Список системных шрифтов недоступен. Нажмите «Обновить».";
      } else {
        elements.settingsUiFontMeta.textContent = `Найдено системных шрифтов: ${systemFontCatalog.length}.`;
      }
    }
  }

  function syncSelectedModelMeta() {
    if (!elements.settingsModelIdMeta) {
      return;
    }
    const selectedId = normalizeModelId(elements.settingsModelId?.value || runtimeConfig.modelId);
    const model = modelCatalog.find((item) => item.id === selectedId) || null;
    if (!model) {
      elements.settingsModelIdMeta.textContent = "Выберите модель из каталога бэкенда.";
      return;
    }
    const features = [
      model.supportsTools ? "tools" : "",
      model.supportsVision ? "vision" : "text-only",
      model.supportsDocuments ? "docs" : "",
    ].filter(Boolean).join(", ");
    const short = [model.family, model.size, model.quantization].filter(Boolean).join(" • ");
    const description = model.description || short || "Описание модели недоступно.";
    elements.settingsModelIdMeta.textContent = `${description}${features ? ` (${features})` : ""}`;
  }

  function renderDevicePresetOptions() {
    if (!(elements.settingsDevicePreset instanceof HTMLSelectElement)) {
      return;
    }
    const current = normalizeDevicePreset(elements.settingsDevicePreset.value || runtimeConfig.devicePreset || "auto");
    const optionsHtml = devicePresetOrder
      .map((id) => {
        const meta = devicePresetMeta[id];
        if (!meta) {
          return "";
        }
        const label = String(meta.label || id).trim() || id;
        return `<option value="${id}">${label}</option>`;
      })
      .filter(Boolean)
      .join("");
    elements.settingsDevicePreset.innerHTML = optionsHtml || '<option value="auto">Авто</option>';
    elements.settingsDevicePreset.value = current;
    syncDevicePresetMeta();
  }

  function renderModelCatalogOptions() {
    if (!(elements.settingsModelId instanceof HTMLSelectElement)) {
      return;
    }
    const selectedModelId = normalizeModelId(elements.settingsModelId.value || runtimeConfig.modelId);
    if (!modelCatalog.length) {
      elements.settingsModelId.innerHTML = "<option value=''>Список моделей недоступен</option>";
      elements.settingsModelId.value = "";
      syncSelectedModelMeta();
      return;
    }

    elements.settingsModelId.innerHTML = modelCatalog
      .map((model) => {
        const suffix = [model.size, model.quantization].filter(Boolean).join(" • ");
        const optionLabel = suffix ? `${model.label} (${suffix})` : model.label;
        return `<option value="${model.id}">${optionLabel}</option>`;
      })
      .join("");
    const fallbackId = modelCatalog[0]?.id || "";
    elements.settingsModelId.value = modelCatalog.some((item) => item.id === selectedModelId)
      ? selectedModelId
      : fallbackId;
    syncSelectedModelMeta();
  }

  async function loadModelCatalog({ silent = true } = {}) {
    try {
      const payload = await backendClient.listModels();
      const catalog = Array.isArray(payload?.models)
        ? payload.models.map(normalizeModelCatalogItem).filter(Boolean)
        : [];
      if (catalog.length) {
        modelCatalog = catalog;
      }

      const selectedServerTier = normalizeModelTier(payload?.selected || runtimeConfig.modelTier);
      const selectedServerModelId = normalizeModelId(
        payload?.selected_model,
        selectedServerTier,
      );
      if (selectedServerModelId && selectedServerModelId !== runtimeConfig.modelId) {
        applyRuntimeConfig({
          modelTier: selectedServerTier,
          modelId: selectedServerModelId,
        });
      }

      renderModelCatalogOptions();
      return true;
    } catch (error) {
      if (!silent) {
        pushToast(`Не удалось загрузить каталог моделей: ${error.message}`, {
          tone: "warning",
          durationMs: 3600,
        });
      }
      renderModelCatalogOptions();
      return false;
    }
  }

  function applySettingsSectionFilter(query = "") {
    const normalizedQuery = String(query).trim().toLowerCase();
    let visibleCount = 0;

    settingsSectionButtons.forEach((button) => {
      const label = button.textContent?.toLowerCase() || "";
      const isVisible = !normalizedQuery || label.includes(normalizedQuery);
      button.classList.toggle("hidden", !isVisible);
      button.setAttribute("aria-hidden", String(!isVisible));
      if (isVisible) {
        visibleCount += 1;
      }
    });

    if (elements.settingsSectionSearchEmpty) {
      elements.settingsSectionSearchEmpty.classList.toggle("hidden", visibleCount > 0);
    }

    if (visibleCount > 0) {
      const activeButtonVisible = settingsSectionButtons.some((button) => (
        button.dataset.settingsSectionTarget === currentSettingsSection
        && !button.classList.contains("hidden")
      ));

      if (!activeButtonVisible) {
        const firstVisible = settingsSectionButtons.find((button) => !button.classList.contains("hidden"));
        if (firstVisible) {
          applySettingsSection(firstVisible.dataset.settingsSectionTarget, { animate: false });
        }
      }
    }
  }

  function hydrateSettingsForm(configOverride = runtimeConfig) {
    const source = normalizeRuntimeConfig(configOverride || runtimeConfig);
    if (elements.settingsRuntimeMode) {
      elements.settingsRuntimeMode.value = source.mode;
    }
    if (elements.settingsBackendUrl) {
      elements.settingsBackendUrl.value = source.backendUrl;
    }
    if (elements.settingsApiKey) {
      elements.settingsApiKey.value = source.apiKey;
    }
    if (elements.settingsTimeoutMs) {
      elements.settingsTimeoutMs.value = String(source.timeoutMs);
    }
    syncModelTierPreview(source.modelTier);
    if (elements.settingsModelId) {
      elements.settingsModelId.value = normalizeModelId(source.modelId, source.modelTier);
    }
    if (elements.settingsDevicePreset) {
      elements.settingsDevicePreset.value = normalizeDevicePreset(source.devicePreset);
      syncDevicePresetMeta();
    }
    if (elements.settingsAutoReconnect) {
      elements.settingsAutoReconnect.checked = source.autoReconnect;
    }
    if (elements.settingsAutonomousMode) {
      elements.settingsAutonomousMode.checked = Boolean(source.autonomousMode);
    }
    if (elements.settingsModelContextWindow) {
      elements.settingsModelContextWindow.value = source.modelContextWindow == null
        ? ""
        : String(source.modelContextWindow);
    }
    if (elements.settingsModelMaxTokens) {
      elements.settingsModelMaxTokens.value = source.modelMaxTokens == null
        ? ""
        : String(source.modelMaxTokens);
    }
    if (elements.settingsModelTemperature) {
      elements.settingsModelTemperature.value = source.modelTemperature == null
        ? ""
        : String(source.modelTemperature);
    }
    if (elements.settingsModelTopP) {
      elements.settingsModelTopP.value = source.modelTopP == null
        ? ""
        : String(source.modelTopP);
    }
    if (elements.settingsModelTopK) {
      elements.settingsModelTopK.value = source.modelTopK == null
        ? ""
        : String(source.modelTopK);
    }
    if (elements.settingsBootMood) {
      elements.settingsBootMood.value = source.bootMood;
    }
    if (elements.settingsDefaultTransition) {
      elements.settingsDefaultTransition.value = String(source.defaultTransitionMs);
    }
    if (elements.settingsUserName) {
      elements.settingsUserName.value = source.userName;
    }
    if (elements.settingsUserContext) {
      elements.settingsUserContext.value = source.userContext;
    }
    if (elements.settingsUserLanguage) {
      elements.settingsUserLanguage.value = source.userLanguage;
    }
    if (elements.settingsUserTimezone) {
      elements.settingsUserTimezone.value = source.userTimezone;
    }
    if (elements.settingsUiDensity) {
      elements.settingsUiDensity.value = source.uiDensity;
    }
    if (elements.settingsUiAnimations) {
      elements.settingsUiAnimations.checked = source.uiAnimations;
    }
    if (elements.settingsUiFontScale) {
      elements.settingsUiFontScale.value = String(source.uiFontScale);
    }
    if (elements.settingsUiFontPreset) {
      elements.settingsUiFontPreset.value = String(source.uiFontPreset || "system");
    }
    if (elements.settingsUiFontFamily instanceof HTMLSelectElement) {
      renderSystemFontOptions(String(source.uiFontFamily || ""));
    }
    syncUiFontControls();
    if (elements.settingsUiShowInspector) {
      elements.settingsUiShowInspector.checked = source.uiShowInspector;
    }
    syncSelectedModelMeta();
  }

  function collectSettingsForm() {
    return normalizeRuntimeConfig({
      ...runtimeConfig,
      mode: elements.settingsRuntimeMode?.value,
      backendUrl: elements.settingsBackendUrl?.value,
      apiKey: elements.settingsApiKey?.value,
      timeoutMs: elements.settingsTimeoutMs?.value,
      modelTier: elements.settingsModelTier?.value,
      modelId: elements.settingsModelId?.value,
      devicePreset: elements.settingsDevicePreset?.value,
      modelContextWindow: elements.settingsModelContextWindow?.value,
      modelMaxTokens: elements.settingsModelMaxTokens?.value,
      modelTemperature: elements.settingsModelTemperature?.value,
      modelTopP: elements.settingsModelTopP?.value,
      modelTopK: elements.settingsModelTopK?.value,
      autoReconnect: elements.settingsAutoReconnect?.checked,
      autonomousMode: elements.settingsAutonomousMode?.checked,
      bootMood: elements.settingsBootMood?.value,
      defaultTransitionMs: elements.settingsDefaultTransition?.value,
      userName: elements.settingsUserName?.value,
      userContext: elements.settingsUserContext?.value,
      userLanguage: elements.settingsUserLanguage?.value,
      userTimezone: elements.settingsUserTimezone?.value,
      uiDensity: elements.settingsUiDensity?.value,
      uiAnimations: elements.settingsUiAnimations?.checked,
      uiFontScale: elements.settingsUiFontScale?.value,
      uiFontPreset: elements.settingsUiFontPreset?.value,
      uiFontFamily: elements.settingsUiFontFamily?.value,
      uiShowInspector: elements.settingsUiShowInspector?.checked,
    });
  }

  function syncSettingsDirtyState() {
    if (!elements.settingsRuntimeMode) {
      return;
    }

    const isDirty = getConfigFingerprint(collectSettingsForm()) !== settingsCommittedFingerprint;
    settingsSaveButtons.forEach((button) => {
      const disabled = !isDirty || saveInFlight;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
    });

    if (elements.settingsDirtyBadge) {
      elements.settingsDirtyBadge.classList.toggle("hidden", !isDirty);
    }
  }

  function resetSettingsValidation() {
    [
      elements.settingsBackendUrl,
      elements.settingsUserTimezone,
    ].forEach(clearFieldValidation);
  }

  function validateSettingsDraft(config) {
    const issues = [];

    if (config.mode === "backend") {
      if (!config.backendUrl) {
        issues.push({
          field: elements.settingsBackendUrl,
          message: "Укажите URL бэкенда для режима сервера.",
        });
      } else {
        try {
          const target = new URL(config.backendUrl);
          if (!/^https?:$/.test(target.protocol)) {
            issues.push({
              field: elements.settingsBackendUrl,
              message: "URL бэкенда должен начинаться с http:// или https://.",
            });
          }
        } catch (error) {
          issues.push({
            field: elements.settingsBackendUrl,
            message: "URL бэкенда указан в неверном формате.",
          });
        }
      }
    }

    if (config.userTimezone && !isValidTimezone(config.userTimezone)) {
      issues.push({
        field: elements.settingsUserTimezone,
        message: "Часовой пояс не распознан. Используйте формат Europe/Moscow.",
      });
    }

    return issues;
  }

  function resolveHealthStartupState(healthPayload) {
    const startup = healthPayload && typeof healthPayload === "object" ? healthPayload.startup : null;
    const autonomousMode = Boolean(
      healthPayload?.policy?.autonomous_mode
      || healthPayload?.autonomous_mode,
    );
    const status = String(startup?.status || "").trim().toLowerCase();
    const stage = String(startup?.stage || "").trim().toLowerCase();
    const rawMessage = String(startup?.message || "").trim();

    const stageLabel = stage === "environment_check"
      ? "Проверка окружения Python/MLX..."
      : stage === "checking_gpu_memory"
        ? "Проверка доступной GPU/unified памяти..."
        : stage === "loading_model"
          ? "Загрузка выбранной модели..."
          : stage === "ready"
            ? "Модель готова."
            : stage === "error"
              ? "Ошибка запуска модели."
              : "Проверка состояния модели...";

    return {
      status: status || "loading",
      message: `${rawMessage || stageLabel}${autonomousMode ? " • Автономный режим" : ""}`,
      autonomousMode,
    };
  }

  async function checkBackendConnection(configOverride = runtimeConfig) {
    const effectiveConfig = normalizeRuntimeConfig(configOverride || runtimeConfig);
    backendClient.setConfig({
      baseUrl: effectiveConfig.backendUrl,
      apiKey: effectiveConfig.apiKey,
      timeoutMs: effectiveConfig.timeoutMs,
    });

    if (!effectiveConfig.backendUrl || effectiveConfig.mode !== "backend") {
      updateConnectionState(BACKEND_STATUS.idle, effectiveConfig.mode === "backend"
        ? "Укажите URL бэкенд-сервера"
        : "Активен режим симуляции");
      return { connected: false, status: BACKEND_STATUS.idle };
    }

    updateConnectionState(BACKEND_STATUS.checking, "Проверяем /health ...");
    try {
      const health = await backendClient.ping();
      const startup = resolveHealthStartupState(health);
      if (startup.status === "error") {
        updateConnectionState(BACKEND_STATUS.error, startup.message, health);
        return { connected: false, status: BACKEND_STATUS.error };
      }
      if (startup.status !== "ready") {
        updateConnectionState(BACKEND_STATUS.checking, startup.message, health);
        return { connected: false, status: BACKEND_STATUS.checking };
      }

      updateConnectionState(BACKEND_STATUS.connected, "Бэкенд доступен, модель готова", health);
      void loadModelCatalog({ silent: true });
      if (effectiveConfig.mode === "backend") {
        void getChatFeature()?.syncChatStoreFromBackend({ preserveActive: true, silent: true });
      }
      return { connected: true, status: BACKEND_STATUS.connected };
    } catch (error) {
      updateConnectionState(BACKEND_STATUS.error, `Недоступен: ${error.message}`);
      return { connected: false, status: BACKEND_STATUS.error };
    }
  }

  async function waitForBackendReadyAfterModelSwitch(timeoutMs = 90000) {
    const startedAt = Date.now();
    let lastMessage = "Ожидаем запуск модели...";

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const health = await backendClient.ping();
        const startup = resolveHealthStartupState(health);
        if (startup.status === "error") {
          updateConnectionState(BACKEND_STATUS.error, startup.message, health);
          return false;
        }
        if (startup.status === "ready") {
          updateConnectionState(BACKEND_STATUS.connected, "Бэкенд доступен, модель готова", health);
          return true;
        }
        lastMessage = startup.message || lastMessage;
        updateConnectionState(BACKEND_STATUS.checking, lastMessage, health);
      } catch (error) {
        lastMessage = `Ожидаем модель: ${error.message}`;
        updateConnectionState(BACKEND_STATUS.checking, lastMessage);
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 900);
      });
    }

    updateConnectionState(BACKEND_STATUS.checking, lastMessage);
    return false;
  }

  async function saveSettings() {
    if (saveInFlight) {
      return false;
    }
    saveInFlight = true;
    syncSettingsDirtyState();
    resetSettingsValidation();
    try {
      const nextConfig = collectSettingsForm();
      if (getConfigFingerprint(nextConfig) === settingsCommittedFingerprint) {
        syncSettingsDirtyState();
        pushToast("Изменений для сохранения нет.", { tone: "neutral", durationMs: 2200 });
        return true;
      }

      const issues = validateSettingsDraft(nextConfig);

      if (issues.length > 0) {
        issues.forEach((issue) => {
          if (issue.field) {
            issue.field.classList.add("field-invalid");
            issue.field.setAttribute("aria-invalid", "true");
          }
        });
        issues[0]?.field?.focus();
        pushToast(issues[0]?.message || "Проверьте введённые настройки.", { tone: "error" });
        syncSettingsDirtyState();
        return false;
      }

      applyRuntimeConfig(nextConfig);
      let settingsSavedInBackend = false;
      if (runtimeConfig.mode === "backend" && runtimeConfig.backendUrl) {
        try {
          await backendClient.updateSettings({
            runtime_config: runtimeConfig,
            autonomous_mode: runtimeConfig.autonomousMode,
          });
          settingsSavedInBackend = true;
        } catch (error) {
          pushToast(`Не удалось сохранить настройки в бэкенде: ${error.message}`, {
            tone: "warning",
            durationMs: 3600,
          });
        }
      }
      getChatFeature()?.applyContextualBackground({ immediate: true });
      updateConnectionState(BACKEND_STATUS.idle, "Настройки сохранены");
      syncSettingsDirtyState();
      pushToast(
        settingsSavedInBackend ? "Настройки сохранены." : "Настройки сохранены локально.",
        { tone: "success" },
      );

      if (runtimeConfig.mode === "backend" && runtimeConfig.backendUrl) {
        try {
          const modelState = await backendClient.selectModel({
            tier: runtimeConfig.modelTier,
            model_id: runtimeConfig.modelId,
          });
          if (modelState?.selected_model) {
            applyRuntimeConfig({
              modelId: modelState.selected_model,
            });
            try {
              await backendClient.updateSettings({
                runtime_config: runtimeConfig,
                autonomous_mode: runtimeConfig.autonomousMode,
              });
            } catch (syncError) {
              // Оставляем применённый runtime в UI, даже если синхронизация настроек временно недоступна.
            }
          }
          void loadModelCatalog({ silent: true });
          const startup = resolveHealthStartupState(modelState);
          const status = startup.status === "error"
            ? BACKEND_STATUS.error
            : startup.status === "ready"
              ? BACKEND_STATUS.connected
              : BACKEND_STATUS.checking;
          updateConnectionState(status, startup.message, modelState);
          if (startup.status !== "error" && runtimeConfig.autoReconnect) {
            const ready = await waitForBackendReadyAfterModelSwitch();
            if (!ready) {
              pushToast("Модель ещё загружается. Можно продолжать работу, ответ появится после готовности.", {
                tone: "warning",
                durationMs: 4200,
              });
            }
          }
        } catch (error) {
          pushToast(`Не удалось применить модель на сервере: ${error.message}`, {
            tone: "warning",
            durationMs: 3600,
          });
        }
      }

      if (runtimeConfig.mode === "backend" && runtimeConfig.autoReconnect) {
        const connection = await checkBackendConnection();
        const connected = connection.connected;
        const loading = !connected && connection.status === BACKEND_STATUS.checking;
        pushToast(
          connected
            ? "Соединение с сервером подтверждено."
            : loading
              ? "Сервер отвечает, модель ещё загружается."
              : "Авто-проверка сервера завершилась ошибкой.",
          { tone: connected ? "success" : loading ? "neutral" : "warning", durationMs: 3400 },
        );
      }

      return true;
    } finally {
      saveInFlight = false;
      syncSettingsDirtyState();
    }
  }

  function applySelectedDevicePresetToForm() {
    const presetId = normalizeDevicePreset(elements.settingsDevicePreset?.value || runtimeConfig.devicePreset);
    const draft = collectSettingsForm();
    const nextDraft = applyDevicePreset(draft, presetId, getAvailableModelIds());
    hydrateSettingsForm(nextDraft);
    syncSettingsDirtyState();
    pushToast(`Применен профиль: ${getDevicePresetMeta(presetId)?.label || presetId}.`, {
      tone: "success",
      durationMs: 2400,
    });
  }

  function bindSettingsFieldListeners() {
    settingsFields.forEach((field) => {
      field.addEventListener("input", () => {
        clearFieldValidation(field);
        syncSettingsDirtyState();
      });
      field.addEventListener("change", () => {
        clearFieldValidation(field);
        syncSettingsDirtyState();
      });
    });
  }

  function bindEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    settingsSaveButtons.forEach((button) => {
      button.addEventListener("click", () => {
        void saveSettings();
      });
    });

    elements.settingsTestConnection?.addEventListener("click", async () => {
      resetSettingsValidation();
      const nextConfig = collectSettingsForm();
      const issues = validateSettingsDraft(nextConfig);
      if (issues.length > 0) {
        issues.forEach((issue) => {
          if (issue.field) {
            issue.field.classList.add("field-invalid");
            issue.field.setAttribute("aria-invalid", "true");
          }
        });
        issues[0]?.field?.focus();
        pushToast(issues[0]?.message || "Проверьте поля перед тестом.", { tone: "error" });
        return;
      }

      const previousClientConfig = backendClient.getConfig();
      const connection = await checkBackendConnection(nextConfig);
      backendClient.setConfig(previousClientConfig);
      pushToast(
        connection.connected ? "Сервер отвечает на /health." : "Проверка соединения не прошла.",
        { tone: connection.connected ? "success" : "error", durationMs: 3400 },
      );
    });

    settingsSectionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        applySettingsSection(button.dataset.settingsSectionTarget);
        if (!isSettingsAsideDocked()) {
          mobileState.settingsAsideOpen = false;
          syncMobilePanels();
        }
      });
    });

    elements.settingsSectionSearch?.addEventListener("input", () => {
      applySettingsSectionFilter(elements.settingsSectionSearch?.value || "");
    });

    elements.settingsModelTier?.addEventListener("input", () => {
      syncModelTierPreview(elements.settingsModelTier?.value);
      syncSelectedModelMeta();
    });

    elements.settingsModelId?.addEventListener("change", () => {
      syncSelectedModelMeta();
      syncSettingsDirtyState();
    });

    elements.settingsDevicePreset?.addEventListener("change", () => {
      syncDevicePresetMeta();
      syncSettingsDirtyState();
    });

    elements.settingsUiFontPreset?.addEventListener("change", () => {
      syncUiFontControls();
      if (String(elements.settingsUiFontPreset?.value || "").trim().toLowerCase() === "custom") {
        void loadSystemFontCatalog({ silent: true });
      }
      syncSettingsDirtyState();
    });

    elements.settingsUiFontRefresh?.addEventListener("click", () => {
      void loadSystemFontCatalog({ silent: false }).then(() => {
        syncSettingsDirtyState();
      });
    });

    elements.settingsApplyDevicePreset?.addEventListener("click", () => {
      applySelectedDevicePresetToForm();
    });

    bindSettingsFieldListeners();
  }

  function initialize() {
    renderDevicePresetOptions();
    renderModelCatalogOptions();
    renderSystemFontOptions(runtimeConfig.uiFontFamily);
    bindEvents();
    hydrateSettingsForm();
    void loadSystemFontCatalog({ silent: true }).then(() => {
      hydrateSettingsForm();
      syncSettingsDirtyState();
    });
    void loadModelCatalog({ silent: true }).then(() => {
      hydrateSettingsForm();
      syncSettingsDirtyState();
    });
    applySettingsSection(currentSettingsSection, { animate: false });
    applySettingsSectionFilter(elements.settingsSectionSearch?.value || "");
    syncSettingsDirtyState();
  }

  function applyCurrentSection({ animate = true } = {}) {
    applySettingsSection(currentSettingsSection, { animate });
  }

  function onRuntimeConfigApplied() {
    settingsCommittedFingerprint = getConfigFingerprint(runtimeConfig);
    hydrateSettingsForm(runtimeConfig);
    syncSettingsDirtyState();
  }

  return {
    initialize,
    hydrateSettingsForm,
    collectSettingsForm,
    syncModelTierPreview,
    syncSettingsDirtyState,
    applySettingsSection,
    applyCurrentSection,
    applySettingsSectionFilter,
    checkBackendConnection,
    loadModelCatalog,
    saveSettings,
    onRuntimeConfigApplied,
  };
}
