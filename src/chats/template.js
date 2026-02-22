import { icon } from "../ui/icons.js";

export const chatPageTemplate = `
  <aside
    id="panel-left"
    class="page-aside glass-panel mt-[2.5rem] xl:mt-0 pt-3 !backdrop-blur-none 2xl:backdrop-blur-md fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto"
  >
    <button
      id="chat-new-session-button"
      type="button"
      class="icon-button active:scale-95 mb-3 rounded-3xl border border-zinc-600/30 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
    >
      ${icon("chat-plus")}
      <span>Новый чат</span>
    </button>

    <div class="mb-3 flex items-center justify-between px-1">
      <h2 class="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Диалоги</h2>
      <div class="flex items-center gap-1">
        <button
          id="chat-clear-session-button"
          type="button"
          aria-label="Очистить активную сессию"
          title="Очистить активную сессию"
          class="border border-zinc-600/30 icon-button active:scale-95 h-7 w-7 rounded-full text-zinc-200 hover:bg-zinc-700/80"
        >
          ${icon("trash")}
        </button>
        <button
          id="chat-session-filter-button"
          type="button"
          aria-label="Фильтр"
          title="Фильтр"
          class="border border-zinc-600/30 icon-button active:scale-95 h-7 w-7 rounded-full text-zinc-200 hover:bg-zinc-700/80"
        >
          ${icon("filter")}
        </button>
      </div>
    </div>

    <div id="chat-session-list" class="chat-scroll flex-1 min-h-0 space-y-2 overflow-auto pr-1">
      
    </div>
  </aside>

  <main class="page-main glass-panel relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-3 pt-0">
    <div class="fixed top-0 inset-x-0 p-3 flex flex-wrap items-center justify-between gap-3" style="z-index:9999;">
      <div class=" flex items-center justify-between xl:justify-end gap-3 2xl:hidden w-full">
        <button
          id="open-left-panel"
          type="button"
          aria-label="Сессии"
          aria-controls="panel-left"
          aria-expanded="false"
          title="Сессии"
          class="icon-button backdrop-blur-lg bg-zinc-900/50 active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 text-zinc-200 transition hover:bg-zinc-700/80 xl:hidden"
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
          class="icon-button backdrop-blur-lg bg-zinc-900/50 active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 text-zinc-200 transition hover:bg-zinc-700/80 2xl:hidden"
        >
          ${icon("inspector")}
        </button>
      </div>
    </div>

    <section id="chat-stream" aria-live="polite" class="chat-scroll min-h-0 overflow-y-auto flex-1 space-y-3 pr-1 pb-6 pt-14 -mb-3">
      
    </section>

    <form id="composer-form" class="flex flex-col w-full border border-zinc-600/30 bg-zinc-900 p-3 rounded-3xl" style="z-index:99999;">
      <div class="flex items-start w-full">
        <textarea
          id="composer-input"
          rows="3"
          aria-label="Поле ввода сообщения"
          placeholder="Спросите что-нибудь!"
          class="w-full resize-none text-sm text-zinc-100 outline-none bg-transparent focus:ring-none focus:outline-none"
        ></textarea>
        <button
          id="composer-submit"
          type="submit"
          aria-label="Отправить сообщение"
          class="icon-button flex items-center justify-center active:scale-95 rounded-full border border-zinc-500/30 bg-zinc-100 h-10 w-10 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
        >
          ${icon("send")}
        </button>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <button
            id="composer-attach-button"
            type="button"
            aria-label="Добавить вложение"
            title="Добавить вложение"
            class="icon-button active:scale-95 h-8 w-8 rounded-full border border-zinc-600/30 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80"
          >
            ${icon("attach")}
          </button>
        </div>
      </div>
      <input
        id="composer-attachments-input"
        type="file"
        class="hidden"
        multiple
        accept="image/*,text/*,.md,.txt,.json,.csv,.xml,.yaml,.yml,.html,.pdf,.doc,.docx"
      />
      <div id="composer-attachments-list" class="mt-2 hidden flex flex-wrap gap-2"></div>
    </form>
  </main>

  <aside
    id="panel-right"
    class="page-aside glass-panel mt-[2.5rem] 2xl:mt-0 pt-3 !backdrop-blur-none 2xl:backdrop-blur-md fixed inset-y-0 right-0 z-10 flex w-[86vw] max-w-[360px] translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-300 2xl:relative 2xl:z-10 2xl:h-full 2xl:min-h-0 2xl:translate-x-0 2xl:opacity-100 2xl:pointer-events-auto"
  >
    <div class="mb-3 flex items-center justify-between rounded-3xl bg-zinc-800/75 px-3 py-2">
      <h2 class="text-sm font-semibold">Инспектор</h2>
      <span class="rounded-full border border-zinc-600/30 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-300">Запуск #0189</span>
    </div>

    <section class="mb-3">
      <h3 class="text-xs uppercase tracking-[0.18em] text-zinc-400">Состояние бота</h3>
      <div class="mt-3 space-y-2 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Текущее состояние</span>
          <span id="inspector-mood" class="font-mono text-zinc-100">нейтрально</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Переход</span>
          <span class="font-mono text-zinc-100">плавный</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Режим рендера</span>
          <span id="render-quality" class="font-mono text-zinc-100">адаптивный</span>
        </div>
      </div>
    </section>

    <section class="mb-3">
      <h3 class="text-xs uppercase tracking-[0.18em] text-zinc-400">Рантайм</h3>
      <div class="mt-3 space-y-2 text-sm">
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Токены контекста</span>
          <span class="font-mono text-zinc-100" id="token-count">18.2k</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Бюджет кадра</span>
          <span class="font-mono text-zinc-100" id="frame-budget">20ms</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Бэкенд</span>
          <span class="font-mono text-zinc-100" id="backend-status">не проверен</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Режим</span>
          <span class="font-mono text-zinc-100" id="runtime-mode">симуляция</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-zinc-300">Модель</span>
          <span class="font-mono text-zinc-100" id="runtime-model-label">codex-local</span>
        </div>
      </div>
    </section>

    <section class="chat-scroll flex-1 min-h-0 overflow-auto">
      <h3 class="text-xs uppercase tracking-[0.18em] text-zinc-400">API состояний</h3>
      <ul class="mt-3 space-y-2 text-xs font-mono text-zinc-300">
        <li class="">window.botMood.setState("thinking")</li>
        <li class="">window.chatRuntime.setCurrentChatState("coding")</li>
        <li class="">window.chatRuntime.setChatState("chat-2", "warning")</li>
        <li class="">window.chatRuntime.listChats()</li>
        <li class="">window.chatRuntime.renameChat("chat-2", "План интеграции")</li>
        <li class="">window.chatRuntime.clearCurrentChatState()</li>
        <li class="">window.chatRuntime.clearActiveChatHistory()</li>
        <li class="">window.chatRuntime.deleteMessage("msg-4")</li>
        <li class="">window.chatRuntime.exportChats()</li>
        <li class="">window.chatRuntime.openOnboarding()</li>
        <li class="">window.botMood.registerState("custom", {...})</li>
      </ul>
    </section>
  </aside>
`;
