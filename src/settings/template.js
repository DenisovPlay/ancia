import { icon } from "../ui/icons.js";

const inputCls = "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm normal-case tracking-normal text-zinc-100 outline-none transition focus:border-zinc-600";
const rowCls  = "flex items-center justify-between gap-4 py-3 border-b border-zinc-800/60 last:border-0";
const labelCls = "text-xs text-zinc-500 shrink-0";

export const settingsPageTemplate = `
  <aside
    id="settings-aside"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[260px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="settings-section-search"
      type="search"
      aria-label="Поиск раздела"
      placeholder="Поиск раздела"
      class="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-100 outline-none transition focus:border-zinc-600"
    />
    <p id="settings-section-search-empty" class="mt-3 hidden text-xs text-zinc-500">Разделы не найдены</p>

    <nav class="mt-3 space-y-1.5" aria-label="Пункты настроек">
      <button type="button" data-settings-section-target="personalization" data-active="true"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("personalization", "ui-icon-lg")}<span>Персонализация</span></span>
      </button>
      <button type="button" data-settings-section-target="interface" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("interface", "ui-icon-lg")}<span>Интерфейс</span></span>
      </button>
      <button type="button" data-settings-section-target="developer" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("developers", "ui-icon-lg")}<span>Разработчик</span></span>
      </button>
      <button type="button" data-settings-section-target="about" data-active="false"
        class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("info", "ui-icon-lg")}<span>О приложении</span></span>
      </button>
    </nav>
  </aside>

  <main class="page-main bg-zinc-950/60 backdrop-blur-sm relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-3">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 pt-3">
      <div>
        <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Настройки</p>
        <h1 id="settings-section-title" class="text-base font-semibold text-zinc-200 sm:text-lg">Персонализация</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span id="settings-dirty-badge" class="hidden rounded-md border border-amber-900/40 bg-amber-950/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-400">
          Есть изменения
        </span>
        <button type="button" data-open-settings-aside aria-label="Разделы" aria-controls="settings-aside" aria-expanded="false" title="Разделы"
          class="icon-button active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden">
          ${icon("categories")}
        </button>
        <button id="settings-save-config" type="button" aria-keyshortcuts="Control+S Meta+S"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-600 bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200">
          ${icon("save")}
          <span>Сохранить</span>
        </button>
      </div>
    </div>

    <section class="chat-scroll min-h-0 flex-1 overflow-auto pb-3">

      <article data-settings-section="personalization" class="settings-section rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Имя</span>
          <input id="settings-user-name" type="text" placeholder="Андрей" class="${inputCls} w-48 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Язык</span>
          <select id="settings-user-language" class="${inputCls} w-28 text-right">
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Часовой пояс</span>
          <input id="settings-user-timezone" type="text" placeholder="Europe/Moscow" class="${inputCls} w-48 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Контекст</span>
          <input id="settings-user-context" type="text" placeholder="Основатель, инженер..." class="${inputCls} flex-1 min-w-0 text-right" />
        </div>
      </article>

      <article data-settings-section="interface" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Плотность</span>
          <select id="settings-ui-density" class="${inputCls} w-40 text-right">
            <option value="comfortable">Комфортная</option>
            <option value="compact">Компактная</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Масштаб шрифта</span>
          <input id="settings-ui-font-scale" type="number" min="85" max="120" step="1" class="${inputCls} w-20 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Семейство шрифтов</span>
          <select id="settings-ui-font-preset" class="${inputCls} w-40 text-right">
            <option value="system">Sans</option>
            <option value="serif">Serif</option>
            <option value="rounded">Rounded</option>
            <option value="mono">Mono</option>
            <option value="custom">Свой</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Системный шрифт</span>
          <div class="flex items-center gap-2">
            <select id="settings-ui-font-family" class="${inputCls} w-40 text-right">
              <option value="">Сканируем...</option>
            </select>
            <button id="settings-ui-font-refresh" type="button"
              class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-zinc-400 transition hover:bg-zinc-800">
              ${icon("refresh")}
            </button>
          </div>
        </div>
        <p id="settings-ui-font-meta" class="px-3.5 py-2.5 text-xs text-zinc-600">Системные шрифты, без внешних CDN</p>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-ui-animations" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Анимации</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-ui-show-inspector" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Показывать инспектор</span>
          </label>
        </div>
      </article>

      <article data-settings-section="developer" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Режим</span>
          <select id="settings-runtime-mode" class="${inputCls} w-44 text-right">
            <option value="mock">Симуляция</option>
            <option value="backend">Бэкенд</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">URL бэкенда</span>
          <input id="settings-backend-url" type="text" placeholder="http://127.0.0.1:5055" class="${inputCls} flex-1 min-w-0 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">API-ключ</span>
          <input id="settings-api-key" type="password" autocomplete="off" placeholder="Токен доступа" class="${inputCls} flex-1 min-w-0 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Таймаут (мс)</span>
          <input id="settings-timeout-ms" type="number" min="500" step="100" class="${inputCls} w-24 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Переход (мс)</span>
          <input id="settings-default-transition" type="number" min="120" step="50" class="${inputCls} w-24 text-right" />
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Стартовое состояние</span>
          <select id="settings-boot-mood" class="${inputCls} w-36 text-right">
            <option value="neutral">Нейтральное</option>
            <option value="thinking">Размышление</option>
            <option value="waiting">Ожидание</option>
            <option value="success">Успех</option>
            <option value="friendly">Дружелюбное</option>
            <option value="planning">Планирование</option>
            <option value="coding">Кодинг</option>
            <option value="researching">Исследование</option>
            <option value="warning">Предупреждение</option>
            <option value="creative">Креатив</option>
            <option value="offline">Офлайн</option>
            <option value="error">Ошибка</option>
          </select>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-auto-reconnect" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Авто-проверка соединения</span>
          </label>
        </div>
        <div class="${rowCls} px-3.5">
          <label class="flex items-center gap-3 w-full cursor-pointer">
            <input id="settings-autonomous-mode" type="checkbox" class="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-zinc-400" />
            <span class="text-sm text-zinc-300">Автономный режим</span>
          </label>
        </div>
        <div class="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span id="settings-connection-badge" class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">не проверен</span>
            <p id="settings-connection-meta" class="text-xs text-zinc-600">Сервер не проверялся</p>
          </div>
          <button id="settings-test-connection" type="button"
            class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800">
            ${icon("inspector")}
            <span>Проверить</span>
          </button>
        </div>
      </article>

      <article data-settings-section="about" class="settings-section hidden rounded-xl border border-zinc-800/60 divide-y divide-zinc-800/60">
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Приложение</span>
          <span class="text-sm text-zinc-200">Ancia Local</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Версия</span>
          <span class="font-mono text-sm text-zinc-200">0.1.0</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Стек</span>
          <span class="font-mono text-xs text-zinc-400">Vite · Tailwind · Tauri · Python</span>
        </div>
        <div class="${rowCls} px-3.5">
          <span class="${labelCls}">Горячие клавиши</span>
          <span class="font-mono text-xs text-zinc-400">1/2/3 — разделы · Cmd+S — сохранить</span>
        </div>
        <div class="px-3.5 py-2.5 flex justify-end">
          <button id="settings-reset-all" type="button"
            class="icon-button active:scale-95 duration-300 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-950/60">
            ${icon("trash")}
            <span>Сбросить все настройки</span>
          </button>
        </div>
      </article>

    </section>
  </main>
`;
