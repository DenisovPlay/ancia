import { icon } from "./ui/icons.js";

export const modelsPageTemplate = `
  <aside
    id="model-aside"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm fixed inset-y-0 left-0 z-10 flex w-[80vw] max-w-[260px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="model-search-input"
      type="search"
      aria-label="Поиск модели"
      placeholder="Поиск модели"
      class="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
    />
    <div class="mt-3 space-y-1.5">
      <button type="button" data-model-filter="all" data-active="true" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("models", "ui-icon-lg")}<span>Все модели</span></span>
      </button>
      <button type="button" data-model-filter="installed" data-active="false" class="route-pill flex items-center gap-2.5 p-2.5 active:scale-95 duration-300 w-full rounded-lg border border-zinc-800 text-left text-sm">
        <span class="icon-button justify-start">${icon("models-installed", "ui-icon-lg")}<span>Установленные</span></span>
      </button>
    </div>
    <div class="flex-grow"></div>
    <div class="mt-3 pt-1.5 border-t border-zinc-800/60">
      <div class="flex items-end w-full">
        <span id="models-installed-count" class="text-xl font-semibold text-zinc-200">0</span>
        <span class="text-[10px] uppercase tracking-wide text-zinc-500 ml-2">Установлено</span>
      </div>
      <p id="models-catalog-count" class="text-[11px] text-zinc-600">0 в каталоге</p>
    </div>
  </aside>

  <main class="page-main bg-zinc-950/60 backdrop-blur-sm flex h-full min-h-0 flex-col overflow-hidden px-3">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 pt-3">
      <div>
        <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Модели</p>
        <h1 class="text-base font-semibold text-zinc-200 sm:text-lg">Каталог моделей</h1>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-open-model-aside
          aria-label="Фильтр"
          aria-controls="model-aside"
          aria-expanded="false"
          title="Фильтр"
          class="icon-button active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-models-action="refresh"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
        <button
          type="button"
          data-models-action="refresh-catalog"
          class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
        >
          ${icon("huggingface")}
          <span>Найти на HF</span>
        </button>
      </div>
    </div>

    <div class="mb-2 flex flex-wrap gap-1.5 xl:hidden">
      <button type="button" data-model-filter="all" data-active="true" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Все</button>
      <button type="button" data-model-filter="installed" data-active="false" class="route-pill active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs">Установленные</button>
    </div>

    <article id="models-runtime-banner" class="hidden mb-2 rounded-lg border border-sky-900/40 bg-sky-950/30 p-2.5">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p id="models-runtime-status" class="text-sm text-zinc-300">Ожидаем состояние...</p>
          <p id="models-runtime-meta" class="mt-0.5 text-[11px] text-zinc-500"></p>
        </div>
        <span id="models-runtime-badge" class="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 shrink-0">idle</span>
      </div>
      <div class="mt-1.5 h-1 w-full overflow-hidden rounded bg-zinc-800">
        <div id="models-runtime-progress" class="h-full w-0 bg-sky-500/60 transition-all duration-300"></div>
      </div>
    </article>

    <section id="models-grid" class="chat-scroll grid flex-1 min-h-0 auto-rows-max gap-2 overflow-auto pb-2 md:grid-cols-2 2xl:grid-cols-3">
      <article class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500 md:col-span-2 2xl:col-span-3">
        Загружаем каталог моделей...
      </article>
    </section>
    <article id="models-empty-state" class="hidden mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500">
      Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.
    </article>
  </main>
`;
