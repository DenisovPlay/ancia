import { icon } from "../ui/icons.js";

export const pluginsPageTemplate = `
  <aside
    id="plugin-aside"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm fixed inset-y-0 left-0 z-10 flex w-[80vw] max-w-[260px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="plugin-search-input"
      type="search"
      placeholder="Поиск плагина"
      class="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
    />
    <div class="space-y-1.5 mt-3">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("grid", "ui-icon-lg")}<span>Все</span></span>
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("check-circle", "ui-icon-lg")}<span>Установленные</span></span>
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("bot", "ui-icon-lg")}<span>Агент</span></span>
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("globe", "ui-icon-lg")}<span>Веб</span></span>
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("settings", "ui-icon-lg")}<span>Система</span></span>
      </button>
    </div>
    <div class="flex-grow"></div>
    <div class="mt-3 pt-1.5 border-t border-zinc-800/60">
      <div class="flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-wide text-zinc-500">Авто‑режим</span>
        <span id="plugin-autonomous-badge" class="text-xs text-zinc-400">выкл</span>
      </div>
      <p id="plugin-autonomous-label" class="mt-1 text-[11px] text-zinc-600">Установленные плагины работают только с подтверждением.</p>
    </div>
  </aside>

  <main class="page-main bg-zinc-950/60 backdrop-blur-sm flex h-full min-h-0 flex-col overflow-hidden px-3">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 pt-3">
      <div>
        <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Плагины</p>
        <h1 class="text-base font-semibold text-zinc-200 sm:text-lg">Маркетплейс плагинов</h1>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-open-plugin-aside
          aria-label="Категории"
          aria-controls="plugin-aside"
          aria-expanded="false"
          title="Категории"
          class="icon-button active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-plugins-action="open-permissions-center"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          ${icon("shield-check")}
          <span>Разрешения</span>
        </button>
        <button
          type="button"
          data-plugins-action="refresh"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
      </div>
    </div>

    <div class="mb-2 flex flex-wrap gap-1.5 xl:hidden">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Все</button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Установленные</button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Агент</button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Веб</button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Система</button>
    </div>

    <section id="plugins-grid" class="chat-scroll grid flex-1 min-h-0 auto-rows-max gap-2 overflow-auto pb-2 md:grid-cols-2 2xl:grid-cols-3">
      <article class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500 md:col-span-2 2xl:col-span-3">
        Загружаем плагины...
      </article>
    </section>
    <article id="plugins-empty-state" class="hidden mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
      Нет плагинов, соответствующих фильтру.
    </article>
  </main>

  <div id="plugin-permissions-modal" class="app-modal-overlay plugin-permissions-modal hidden" aria-hidden="true">
    <div class="plugin-permissions-modal__panel">
      <div class="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <p id="plugin-permissions-modal-title" class="text-sm font-semibold text-zinc-100">Разрешения плагина</p>
        <button id="plugin-permissions-modal-close" type="button" class="icon-button active:scale-95 duration-300 h-7 w-7 rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          ${icon("x-mark")}
        </button>
      </div>
      <div id="plugin-permissions-modal-body" class="chat-scroll min-h-0 flex-1 overflow-auto px-4 py-3">
        <p class="text-xs text-zinc-500">Нет данных для редактирования.</p>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
        <button id="plugin-permissions-modal-cancel" type="button" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800">Отмена</button>
        <button id="plugin-permissions-modal-save" type="button" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200">Сохранить</button>
      </div>
    </div>
  </div>

  <div id="plugins-permissions-center-modal" class="app-modal-overlay plugins-permissions-center-modal hidden" aria-hidden="true">
    <div class="plugins-permissions-center-modal__panel">
      <div class="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
        <div class="grid gap-0.5">
          <p class="text-sm font-semibold text-zinc-100">Центр разрешений и домены</p>
          <span id="plugins-permissions-summary" class="text-[11px] text-zinc-500">—</span>
        </div>
        <button id="plugins-permissions-center-modal-close" type="button" class="icon-button active:scale-95 duration-300 h-7 w-7 rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          ${icon("x-mark")}
        </button>
      </div>
      <div class="chat-scroll min-h-0 flex-1 overflow-auto px-4 py-3">
        <article class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Центр разрешений</p>
          </div>
          <div class="mt-2 grid grid-cols-3 gap-1.5">
            <button type="button" data-plugin-permission-bulk="allow" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Разрешено</button>
            <button type="button" data-plugin-permission-bulk="ask" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Спрашивать</button>
            <button type="button" data-plugin-permission-bulk="deny" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">Запрещено</button>
          </div>
        </article>

        <article id="plugins-domain-panel" class="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
          <div class="flex items-center justify-between gap-2">
            <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Домены</p>
          </div>
          <div class="mt-2 grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-center">
            <p class="text-xs text-zinc-400">Неизвестные домены</p>
            <select
              id="plugins-domain-default-policy"
              class="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
            >
              <option value="allow">Разрешать</option>
              <option value="deny">Блокировать</option>
            </select>
          </div>
          <div class="mt-2 grid gap-1.5 md:grid-cols-[1fr_auto_auto]">
            <input
              id="plugins-domain-input"
              type="text"
              placeholder="example.com"
              class="h-8 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
            />
            <select
              id="plugins-domain-policy"
              class="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
            >
              <option value="allow">Разрешено</option>
              <option value="deny">Запрещено</option>
              <option value="ask">С подтверждением</option>
            </select>
            <button
              id="plugins-domain-add"
              type="button"
              class="icon-button active:scale-95 duration-300 h-8 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Добавить
            </button>
          </div>
          <div class="mt-2 grid gap-2 lg:grid-cols-2">
            <div class="rounded-md border border-emerald-900/30 bg-emerald-950/20 p-2">
              <p class="text-[10px] uppercase tracking-[0.12em] text-emerald-400">Разрешённые</p>
              <div id="plugins-domain-list-allow" class="mt-1.5 grid gap-1.5"></div>
            </div>
            <div class="rounded-md border border-rose-900/30 bg-rose-950/20 p-2">
              <p class="text-[10px] uppercase tracking-[0.12em] text-rose-400">Запрещённые</p>
              <div id="plugins-domain-list-deny" class="mt-1.5 grid gap-1.5"></div>
            </div>
          </div>
          <div class="mt-2 rounded-md border border-amber-900/30 bg-amber-950/20 p-2">
            <p class="text-[10px] uppercase tracking-[0.12em] text-amber-400">С подтверждением</p>
            <div id="plugins-domain-list-ask" class="mt-1.5 grid gap-1.5"></div>
          </div>
        </article>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
        <button id="plugins-permissions-center-modal-done" type="button" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200">Готово</button>
      </div>
    </div>
  </div>
`;
