import { icon } from "./ui/icons.js";

export const modelsPageTemplate = `
  <aside
    id="model-aside"
    class="page-aside glass-panel fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="model-search-input"
      type="search"
      aria-label="Поиск модели"
      placeholder="Поиск модели"
      class="rounded-3xl border border-zinc-600/30 bg-transparent p-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-500/60"
    />
    <div class="mt-3 space-y-2">
      <button type="button" data-model-filter="all" data-active="true" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("models", "ui-icon-lg")}<span>Все модели</span></span>
      </button>
      <button type="button" data-model-filter="installed" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("models-installed", "ui-icon-lg")}<span>Установленные</span></span>
      </button>

    </div>
    <div class="flex-grow"></div>
    <div class="mt-3 rounded-3xl border border-zinc-600/30 p-3">
      <p class="text-xs text-zinc-300">Установлено</p>
      <p id="models-installed-count" class="mt-1 text-2xl font-semibold text-zinc-100">0</p>
      <p id="models-catalog-count" class="text-xs text-zinc-500">0 в каталоге</p>
    </div>
  </aside>

  <main class="page-main glass-panel flex h-full min-h-0 flex-col overflow-hidden px-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3 pt-3">
      <div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Модели</p>
        <h1 class="text-lg font-semibold text-zinc-100 sm:text-xl">Каталог моделей</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          data-open-model-aside
          aria-label="Фильтр"
          aria-controls="model-aside"
          aria-expanded="false"
          title="Фильтр"
          class="icon-button active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 bg-zinc-900/60 text-zinc-200 transition hover:bg-zinc-700/80 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-models-action="refresh"
          class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
        <button
          type="button"
          data-models-action="refresh-catalog"
          class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
        >
          ${icon("huggingface")}
          <span>Найти на HF</span>
        </button>
      </div>
    </div>

    <div class="mb-3 flex flex-wrap gap-2 xl:hidden">
      <button type="button" data-model-filter="all" data-active="true" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">Все</button>
      <button type="button" data-model-filter="installed" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">Установленные</button>

    </div>

    <article id="models-runtime-banner" class="hidden mb-3 rounded-3xl border border-sky-500/30 bg-sky-500/10 p-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <p id="models-runtime-status" class="text-sm text-zinc-200">Ожидаем состояние...</p>
          <p id="models-runtime-meta" class="mt-0.5 text-xs text-zinc-400"></p>
        </div>
        <span id="models-runtime-badge" class="rounded-full border border-zinc-600/30 bg-zinc-800/80 px-3 py-1 text-[11px] uppercase tracking-[0.14em] text-zinc-300 shrink-0">idle</span>
      </div>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/70">
        <div id="models-runtime-progress" class="h-full w-0 bg-sky-400/80 transition-all duration-300"></div>
      </div>
    </article>

    <section id="models-grid" class="chat-scroll grid flex-1 min-h-0 auto-rows-max gap-3 overflow-auto pb-2 md:grid-cols-2 2xl:grid-cols-3">
      <article class="rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400 md:col-span-2 2xl:col-span-3">
        Загружаем каталог моделей...
      </article>
    </section>
    <article id="models-empty-state" class="hidden mt-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400">
      Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.
    </article>
  </main>
`;
