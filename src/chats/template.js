import { icon } from "../ui/icons.js";

export const chatPageTemplate = `
  <aside
    id="panel-left"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm mt-[2.5rem] xl:mt-0 pt-3 fixed inset-y-0 left-0 z-10 flex w-[80vw] max-w-[260px] -translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-200 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto"
  >
    <button
      id="chat-new-session-button"
      type="button"
      class="icon-button active:scale-95 duration-300 mb-3 rounded-lg border border-zinc-700 bg-zinc-100 p-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
    >
      ${icon("chat-plus")}
      <span>Новый чат</span>
    </button>

    <input
      id="chat-import-file-input"
      type="file"
      class="hidden"
      accept=".json,.md,.markdown,application/json,text/markdown,text/plain"
    />

    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Диалоги</h2>
      <div class="flex items-center gap-1">
        <button
          id="chat-clear-session-button"
          type="button"
          aria-label="Очистить активную сессию"
          title="Очистить активную сессию"
          class="border border-zinc-800 icon-button active:scale-95 duration-300 h-6 w-6 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ${icon("trash")}
        </button>
        <button
          id="chat-session-filter-button"
          type="button"
          aria-label="Фильтр"
          title="Фильтр"
          class="border border-zinc-800 icon-button active:scale-95 duration-300 h-6 w-6 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ${icon("filter")}
        </button>
      </div>
    </div>

    <div style="z-index:99;">
      <input
        id="chat-session-search"
        type="search"
        placeholder="Поиск чата"
        class="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
      />
      <div id="chat-session-search-results" class="chat-search-results hidden" data-open="false"></div>
    </div>

    <div id="chat-session-list" class="chat-scroll grow flex-1 min-h-0 space-y-1.5 overflow-auto py-6 -my-3">
      
    </div>

    <div id="chat-holiday-banner" class="chat-holiday-banner hidden border border-zinc-800 bg-zinc-950 shadow flex flex-col items-center justify-center rounded-xl sticky bottom-0 w-full z-90 p-3 gap-2.5">
      <img id="chat-holiday-banner-logo" src="/ancia.png" alt="Логотип" class="w-14 h-14 rounded-xl object-cover">
      <span id="chat-holiday-banner-title" class="font-bold text-center">С праздником!</span>
      <span id="chat-holiday-banner-body" class="text-sm text-zinc-300 text-center">Желаем вам хорошего дня и отличного настроения.</span>
      <button
        id="chat-holiday-banner-dismiss"
        type="button"
        class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-100 p-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
      >
        <span>Спасибо!</span>
      </button>
    </div>
  </aside>

  <main class="page-main bg-zinc-950/60 backdrop-blur-sm relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 pt-0">
    <div class="fixed top-0 inset-x-0 p-3 flex flex-wrap items-center justify-between gap-2 z-50">
      <div class="flex items-center justify-between xl:justify-end gap-2 2xl:hidden w-full">
        <button
          id="open-left-panel"
          type="button"
          aria-label="Сессии"
          aria-controls="panel-left"
          aria-expanded="false"
          title="Сессии"
          class="icon-button backdrop-blur-sm bg-zinc-900/80 active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 xl:hidden"
        >
          ${icon("sessions")}
        </button>
        <button
          id="open-right-panel"
          type="button"
          aria-label="Инспектор"
          aria-controls="panel-right"
          aria-expanded="false"
          title="Инспектор"
          class="icon-button backdrop-blur-sm bg-zinc-900/80 active:scale-95 duration-300 h-8 w-8 rounded-lg border border-zinc-800 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 2xl:hidden"
        >
          ${icon("inspector")}
        </button>
      </div>
    </div>

    <section id="chat-stream" aria-live="polite" class="chat-scroll min-h-0 overflow-y-auto flex-1 space-y-2.5 pb-4 pt-[3.5rem] -mb-3">
      
    </section>

    <form id="composer-form" class="flex flex-col w-full border border-zinc-800 bg-zinc-950 p-2.5 rounded-xl relative z-10">
      <div class="flex items-start w-full gap-2">
        <textarea
          id="composer-input"
          rows="3"
          aria-label="Поле ввода сообщения"
          spellcheck="false"
          autocorrect="off"
          autocapitalize="off"
          autocomplete="off"
          placeholder="Спросите что-нибудь…"
          class="flex-1 resize-none text-sm text-zinc-200 outline-none bg-transparent focus:ring-none focus:outline-none placeholder:text-zinc-600 min-h-[4.25rem] py-1"
        ></textarea>
        <button
          id="composer-submit"
          type="submit"
          aria-label="Отправить сообщение"
          class="icon-button flex-shrink-0 flex items-center justify-center active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-100 h-9 w-9 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 mb-0.5"
        >
          ${icon("send")}
        </button>
      </div>
      <div class="flex items-center justify-between gap-1.5 pt-1 mt-1.5">
        <button
          id="composer-attach-button"
          type="button"
          aria-label="Добавить вложение"
          title="Добавить вложение"
          class="icon-button active:scale-95 duration-300 h-7 w-7 rounded-md border border-zinc-800 bg-transparent text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          ${icon("attach")}
        </button>
        <div
          id="composer-context-indicator"
          class="composer-context-indicator"
          tabindex="0"
          role="button"
        >
          <span id="composer-context-ring" class="composer-context-ring" aria-hidden="true">
            <span class="composer-context-ring__inner"></span>
          </span>
          <span id="composer-context-label" class="composer-context-label">0%</span>
            <span id="composer-context-popover" class="composer-context-popover" role="tooltip" aria-hidden="true">
              <span class="composer-context-popover__title">Контекст</span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Занято (с резервом)</span>
                <span id="composer-context-used" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Максимум</span>
                <span id="composer-context-max" class="composer-context-popover__value">—</span>
            </span>
            <span class="composer-context-popover__row">
              <span class="composer-context-popover__key">История чата</span>
              <span id="composer-context-history" class="composer-context-popover__value">—</span>
            </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Системный промпт</span>
                <span id="composer-context-system" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Служебный каркас</span>
                <span id="composer-context-service" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Черновик и вложения</span>
                <span id="composer-context-draft" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Ожидаемый ответ</span>
                <span id="composer-context-pending" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Резерв генерации</span>
                <span id="composer-context-reserve" class="composer-context-popover__value">—</span>
              </span>
              <span class="composer-context-popover__row">
                <span class="composer-context-popover__key">Слои сжатия</span>
                <span id="composer-context-layers" class="composer-context-popover__value">0</span>
              </span>
            <span class="composer-context-popover__layers-title">Последние слои</span>
            <span id="composer-context-layers-list" class="composer-context-popover__layers-list">
              <span class="composer-context-popover__layers-empty">Слои пока не созданы</span>
            </span>
            <span class="composer-context-popover__actions w-full grid grid-cols-2 gap-[0.35rem] mt-[0.1rem]">
              <button id="composer-context-cycle-mode" type="button" class="composer-context-popover__action-btn col-span-2">
                Режим
              </button>
              <button id="composer-context-compress-now" type="button" class="composer-context-popover__action-btn">
                Сжать
              </button>
              <button id="composer-context-reset-layers" type="button" class="composer-context-popover__action-btn">
                Сбросить
              </button>
            </span>
          </span>
        </div>
      </div>
      <input
        id="composer-attachments-input"
        type="file"
        class="hidden"
        multiple
        accept="image/*,text/*,.md,.txt,.json,.csv,.xml,.yaml,.yml,.html,.pdf,.doc,.docx"
      />
      <div id="composer-attachments-list" class="mt-2 hidden flex flex-wrap gap-1.5"></div>
    </form>
  </main>

  <aside
    id="panel-right"
    class="page-aside bg-zinc-950/60 backdrop-blur-sm mt-[2.5rem] 2xl:mt-0 pt-3 fixed inset-y-0 right-0 z-10 flex w-[82vw] max-w-[320px] translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-200 2xl:relative 2xl:z-10 2xl:h-full 2xl:min-h-0 2xl:translate-x-0 2xl:opacity-100 2xl:pointer-events-auto"
  >
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-[10px] uppercase tracking-[0.14em] text-zinc-500">Инспектор</h2>
      <div class="flex items-center gap-1.5">
        <span class="state-dot flex-shrink-0"></span>
        <span id="inspector-mood" class="text-[11px] font-mono text-zinc-400">нейтрально</span>
      </div>
    </div>

    <div class="space-y-3">
      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <p class="mb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-600">Модель</p>
        <p id="runtime-model-label" class="truncate text-xs font-medium text-zinc-200">—</p>
        <div class="mt-2 flex items-center justify-between text-[11px]">
          <span class="text-zinc-500">Режим</span>
          <span id="runtime-mode" class="font-mono text-zinc-400">—</span>
        </div>
        <div class="mt-1 flex items-center justify-between text-[11px]">
          <span class="text-zinc-500">Бэкенд</span>
          <span id="backend-status" class="font-mono text-zinc-400">—</span>
        </div>
      </div>

      <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
        <p class="mb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-600">Сессия</p>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-zinc-500">Токены</span>
            <span id="token-count" class="font-mono text-zinc-400">—</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-zinc-500">Бюджет кадра</span>
            <span id="frame-budget" class="font-mono text-zinc-400">—</span>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-zinc-500">Качество рендера</span>
            <span id="render-quality" class="font-mono text-zinc-400">адаптивный</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1"></div>
    <div class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5">
      <p class="text-[10px] uppercase tracking-[0.14em] text-zinc-600">Сборка</p>
      <p class="mt-1 text-[11px] font-mono text-zinc-500">Запуск #0189</p>
    </div>
  </aside>

  <div id="chat-export-modal-overlay" class="app-modal-overlay chat-export-modal-overlay hidden" aria-hidden="true">
    <div class="action-dialog chat-export-modal">
      <p id="chat-export-modal-title" class="action-dialog__title">Экспорт чата</p>
      <p class="action-dialog__message">Выберите формат файла для экспорта.</p>
      <div class="chat-export-modal__field">
        <select id="chat-export-modal-format" class="action-dialog__input">
          <option value="json">JSON (.json)</option>
          <option value="md">Markdown (.md)</option>
        </select>
      </div>
      <div class="action-dialog__actions">
        <button id="chat-export-modal-cancel" type="button" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800">Отмена</button>
        <button id="chat-export-modal-confirm" type="button" class="icon-button active:scale-95 duration-300 rounded-lg border border-zinc-700 bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200">Экспортировать</button>
      </div>
    </div>
  </div>
`;
