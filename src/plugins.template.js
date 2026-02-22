import { icon } from "./ui/icons.js";

export const pluginsPageTemplate = `
  <aside
    id="plugin-aside"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm fixed inset-y-0 left-0 z-10 flex w-[80vw] max-w-[260px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <div class="space-y-1">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 w-full rounded-lg border border-zinc-800 text-left text-sm transition">
        <span class="icon-button justify-start">${icon("grid", "ui-icon-lg")}<span>Все</span></span>
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 w-full rounded-lg border border-zinc-800 text-left text-sm transition">
        <span class="icon-button justify-start">${icon("check-circle", "ui-icon-lg")}<span>Установленные</span></span>
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 w-full rounded-lg border border-zinc-800 text-left text-sm transition">
        <span class="icon-button justify-start">${icon("bot", "ui-icon-lg")}<span>Агент</span></span>
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 w-full rounded-lg border border-zinc-800 text-left text-sm transition">
        <span class="icon-button justify-start">${icon("globe", "ui-icon-lg")}<span>Веб</span></span>
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 w-full rounded-lg border border-zinc-800 text-left text-sm transition">
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
          class="icon-button active:scale-95 h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-plugins-action="refresh"
          class="icon-button active:scale-95 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
      </div>
    </div>

    <div class="mb-2 flex flex-wrap gap-1.5 xl:hidden">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill active:scale-95 rounded-lg border px-2.5 py-1 text-xs transition">Все</button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill active:scale-95 rounded-lg border px-2.5 py-1 text-xs transition">Установленные</button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill active:scale-95 rounded-lg border px-2.5 py-1 text-xs transition">Агент</button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill active:scale-95 rounded-lg border px-2.5 py-1 text-xs transition">Веб</button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill active:scale-95 rounded-lg border px-2.5 py-1 text-xs transition">Система</button>
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
`;
