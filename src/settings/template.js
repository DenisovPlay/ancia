import { icon } from "../ui/icons.js";

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
        <span class="icon-button justify-start">${icon("developers", "ui-icon-lg")}<span>Для разработчиков</span></span>
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
              <div class="flex items-center justify-between gap-3">
                <p class="text-xs uppercase tracking-[0.14em] text-zinc-400">Модели</p>
                <a
                  href="#/models"
                  class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1 text-xs text-zinc-200 transition hover:bg-zinc-700/80"
                >
                  ${icon("models")}
                  <span>Перейти в модели</span>
                </a>
              </div>
              <p class="mt-2 text-xs text-zinc-400">
                Выбор модели, её параметры и управление загрузкой доступны только на странице «Модели».
              </p>
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
	    "ui": {},
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
