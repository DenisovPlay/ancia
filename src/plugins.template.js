import { icon } from "./ui/icons.js";

export const pluginsPageTemplate = `
  <aside
    id="plugin-aside"
    class="page-aside glass-panel fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="plugin-search-input"
      type="search"
      aria-label="Поиск плагина"
      placeholder="Поиск плагина"
      class="rounded-3xl border border-zinc-600/30 bg-transparent p-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-500/60"
    />
    <div class="mt-3 space-y-2">
      <button type="button" data-plugin-filter="all" data-active="true" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("plugins", "ui-icon-lg")}<span>Все категории</span></span>
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("plugins-installed", "ui-icon-lg")}<span>Установленные</span></span>
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("tools", "ui-icon-lg")}<span>Инструменты агента</span></span>
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("browsing", "ui-icon-lg")}<span>Веб и браузинг</span></span>
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("integrations", "ui-icon-lg")}<span>Системные интеграции</span></span>
      </button>
    </div>
    <div class="flex-grow"></div>
    <div class="mt-3 rounded-3xl border border-zinc-600/30 p-3">
      <p class="text-xs text-zinc-300">Установлено</p>
      <p id="plugins-installed-count" class="mt-1 text-2xl font-semibold text-zinc-100">0</p>
      <p id="plugins-updates-count" class="text-xs text-zinc-500">0 доступно к обновлению</p>
    </div>
  </aside>

  <main class="page-main glass-panel flex h-full min-h-0 flex-col overflow-hidden px-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3 pt-3">
      <div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Плагины</p>
        <h1 class="text-lg font-semibold text-zinc-100 sm:text-xl">Маркетплейс плагинов</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          data-open-plugin-aside
          aria-label="Категории"
          aria-controls="plugin-aside"
          aria-expanded="false"
          title="Категории"
          class="icon-button active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 bg-zinc-900/60 text-zinc-200 transition hover:bg-zinc-700/80 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-plugin-action="reload"
          class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
      </div>
    </div>

    <div class="mb-3 flex flex-wrap gap-3 xl:hidden">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Все
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Установленные
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Агент
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Веб
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Система
      </button>
    </div>

    <article id="plugins-autonomous-banner" class="hidden mb-3 rounded-3xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      Включён автономный режим: внешние запросы отключены. Показаны только установленные плагины.
    </article>

    <section id="plugins-grid" class="chat-scroll grid flex-1 min-h-0 auto-rows-max gap-3 overflow-auto pb-2 md:grid-cols-2 2xl:grid-cols-3">
      <article class="rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400 md:col-span-2 2xl:col-span-3">
        Загружаем плагины...
      </article>
    </section>
    <article id="plugin-empty-state" class="hidden mt-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400">
      Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.
    </article>
  </main>
`;
