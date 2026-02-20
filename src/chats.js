import { icon } from "./ui/icons.js";
import { normalizeTextInput, renderMessageHtml, typesetMathInElement } from "./ui/messageFormatter.js";

export const chatPageTemplate = `
  <aside
    id="panel-left"
    class="page-aside glass-panel pt-10 xl:pt-3 !backdrop-blur-none 2xl:backdrop-blur-md fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto"
  >
    <button
      id="chat-new-session-button"
      type="button"
      class="icon-button active:scale-95 mb-3 rounded-3xl border border-zinc-600/30 bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
    >
      ${icon("plus")}
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

    <section id="chat-stream" aria-live="polite" class="chat-scroll min-h-0 overflow-y-auto flex-1 space-y-3 overflow-auto pr-1 pb-6 pt-14 -mb-3">
      
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
    class="page-aside glass-panel pt-10 2xl:pt-3 !backdrop-blur-none 2xl:backdrop-blur-md fixed inset-y-0 right-0 z-10 flex w-[86vw] max-w-[360px] translate-x-[112%] flex-col p-3 opacity-0 pointer-events-none transition-transform duration-300 2xl:relative 2xl:z-10 2xl:h-full 2xl:min-h-0 2xl:translate-x-0 2xl:opacity-100 2xl:pointer-events-auto"
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

const APP_CHAT_STORE_KEY = "ancia.chat.store.v1";
const CHAT_STORE_VERSION = 1;
const CONTEXT_MENU_TRANSITION_MS = 180;
const CHAT_STREAM_SWITCH_OUT_MS = 110;
const CHAT_STREAM_SWITCH_IN_MS = 210;
const CHAT_HISTORY_STAGGER_MS = 18;
const CHAT_HISTORY_STAGGER_CAP_MS = 180;
const CHAT_HISTORY_ANIMATED_LIMIT = 12;

export function createChatFeature({
  elements,
  runtimeConfig,
  backendClient,
  background,
  normalizeRoute,
  getRouteFromHash,
  clamp,
  isMotionEnabled,
  pushToast,
  requestActionConfirm,
  requestActionText,
  updateConnectionState,
  BACKEND_STATUS,
  routeBackgroundState,
  mobileState,
  syncMobilePanels,
  isLeftPanelDocked,
}) {
  const getChatSessionButtons = () => [...document.querySelectorAll("[data-chat-item]")];
  const contextMenuState = {
    open: false,
    kind: "",
    chatId: "",
    messageId: "",
    closeTimerId: null,
    openRafId: 0,
    transitionToken: 0,
  };
  let chatStore = loadChatStore();

function normalizeChatMessage(entry, fallbackIndex = 0) {
  const roleCandidate = String(entry?.role || "").toLowerCase();
  const role = (roleCandidate === "user" || roleCandidate === "assistant" || roleCandidate === "tool")
    ? roleCandidate
    : "assistant";
  const rawText = entry?.text == null ? "" : String(entry.text);
  if (!rawText.trim()) {
    return null;
  }

  const parsedTimestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
  const timestamp = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    ? parsedTimestamp.toISOString()
    : new Date(Date.now() + fallbackIndex).toISOString();

  const meta = entry?.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)
    ? { ...entry.meta }
    : {};

  return {
    id: String(entry?.id || `msg-${fallbackIndex + 1}`),
    role,
    text: normalizeTextInput(rawText),
    metaSuffix: String(entry?.metaSuffix || "").trim(),
    meta,
    timestamp,
  };
}

function resolveStoredToolPayload(message) {
  if (!message || String(message.role || "").toLowerCase() !== "tool") {
    return null;
  }

  const meta = message.meta && typeof message.meta === "object" ? message.meta : {};
  const name = String(meta.tool_name || meta.toolName || "").trim();
  const status = String(meta.status || meta.tool_status || meta.toolStatus || "ok").trim().toLowerCase() || "ok";
  const output = meta.tool_output && typeof meta.tool_output === "object" ? meta.tool_output : (
    meta.toolOutput && typeof meta.toolOutput === "object" ? meta.toolOutput : null
  );
  const args = meta.tool_args && typeof meta.tool_args === "object" ? meta.tool_args : (
    meta.toolArgs && typeof meta.toolArgs === "object" ? meta.toolArgs : {}
  );
  if (!name && !output && !Object.keys(args).length) {
    return null;
  }

  return {
    name: name || "tool",
    status,
    output: output || undefined,
    args,
    text: normalizeTextInput(String(message.text || "")),
  };
}

function normalizeChatSession(entry, fallbackIndex = 0) {
  const title = String(entry?.title || "").trim() || `Сессия ${fallbackIndex + 1}`;
  const createdRaw = entry?.createdAt ? new Date(entry.createdAt) : null;
  const updatedRaw = entry?.updatedAt ? new Date(entry.updatedAt) : null;
  const createdAt = createdRaw && !Number.isNaN(createdRaw.getTime())
    ? createdRaw.toISOString()
    : new Date().toISOString();
  const updatedAt = updatedRaw && !Number.isNaN(updatedRaw.getTime())
    ? updatedRaw.toISOString()
    : createdAt;
  const messages = Array.isArray(entry?.messages)
    ? entry.messages
      .map((message, index) => normalizeChatMessage(message, index))
      .filter(Boolean)
    : [];

  return {
    id: String(entry?.id || `chat-${fallbackIndex + 1}`),
    title,
    createdAt,
    updatedAt,
    mood: entry?.mood ? String(entry.mood).trim().toLowerCase() : "",
    messages,
  };
}

function createDefaultChatStore() {
  const now = Date.now();
  const chat1Created = new Date(now - 3600 * 1000 * 8).toISOString();
  const chat2Created = new Date(now - 3600 * 1000 * 26).toISOString();

  return {
    version: CHAT_STORE_VERSION,
    activeSessionId: "chat-1",
    sessions: [
      {
        id: "chat-1",
        title: "Оболочка интерфейса и состояния фона",
        createdAt: chat1Created,
        updatedAt: new Date(now - 3600 * 1000 * 6).toISOString(),
        mood: "route_chat",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            text: "Обновил оболочку чата под стиль Ancial и добавил заготовку состояний бота для фоновой анимации.",
            metaSuffix: "",
            timestamp: new Date(now - 3600 * 1000 * 8 + 1000).toISOString(),
          },
          {
            id: "msg-2",
            role: "user",
            text: "Нужно чтобы фон менялся по состоянию: ошибка, ожидание, успех.",
            metaSuffix: "",
            timestamp: new Date(now - 3600 * 1000 * 8 + 4000).toISOString(),
          },
          {
            id: "msg-3",
            role: "tool",
            text: "Вызов инструмента: DuckDuckGO",
            metaSuffix: "инструмент",
            timestamp: new Date(now - 3600 * 1000 * 8 + 7000).toISOString(),
          },
        ],
      },
      {
        id: "chat-2",
        title: "План интеграции Python-бэкенда",
        createdAt: chat2Created,
        updatedAt: chat2Created,
        mood: "",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            text: "Сессия для планирования интеграции готова. Можем описать API-контракт и этапы.",
            metaSuffix: "черновик",
            timestamp: new Date(now - 3600 * 1000 * 26 + 2000).toISOString(),
          },
        ],
      },
    ],
  };
}

function normalizeChatStore(raw) {
  const fallback = runtimeConfig.mode === "backend"
    ? {
      version: CHAT_STORE_VERSION,
      activeSessionId: "",
      sessions: [],
    }
    : createDefaultChatStore();
  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map((session, index) => normalizeChatSession(session, index)).filter(Boolean)
    : [];

  if (sessions.length === 0) {
    return fallback;
  }

  const uniqueSessions = [];
  const seenIds = new Set();
  sessions.forEach((session, index) => {
    const sessionId = String(session.id || `chat-${index + 1}`);
    if (seenIds.has(sessionId)) {
      return;
    }
    seenIds.add(sessionId);
    uniqueSessions.push({
      ...session,
      id: sessionId,
    });
  });

  const activeSessionId = String(raw.activeSessionId || "").trim();
  const hasActive = uniqueSessions.some((session) => session.id === activeSessionId);

  return {
    version: CHAT_STORE_VERSION,
    activeSessionId: hasActive ? activeSessionId : uniqueSessions[0].id,
    sessions: uniqueSessions,
  };
}

function loadChatStore() {
  if (runtimeConfig.mode === "backend") {
    return {
      version: CHAT_STORE_VERSION,
      activeSessionId: "",
      sessions: [],
    };
  }
  try {
    const raw = window.localStorage.getItem(APP_CHAT_STORE_KEY);
    if (!raw) {
      return createDefaultChatStore();
    }
    return normalizeChatStore(JSON.parse(raw));
  } catch (error) {
    return createDefaultChatStore();
  }
}

function persistChatStore(store) {
  if (runtimeConfig.mode === "backend") {
    return;
  }
  window.localStorage.setItem(APP_CHAT_STORE_KEY, JSON.stringify(normalizeChatStore(store)));
}
let showOnlyActiveSessions = false;
let nextSessionNumber = 1;
let chatSessionIdSeq = 0;
let activeChatSessionId = null;
let chatStreamTransitionToken = 0;
const chatMoodBySession = new Map();

function syncChatSessionIdSeed(sessionId) {
  const match = /^chat-(\d+)$/.exec(String(sessionId || "").trim());
  if (!match) {
    return;
  }
  chatSessionIdSeq = Math.max(chatSessionIdSeq, Number(match[1]));
}

function persistCurrentChatStore() {
  persistChatStore(chatStore);
}

function getChatSessionById(sessionId) {
  if (!sessionId) {
    return null;
  }
  return chatStore.sessions.find((session) => session.id === sessionId) || null;
}

function getActiveChatSession() {
  return getChatSessionById(activeChatSessionId || chatStore.activeSessionId);
}

function updateChatSessionTimestamp(session) {
  if (!session) {
    return;
  }
  session.updatedAt = new Date().toISOString();
}

function moveChatSessionToFront(sessionId) {
  const index = chatStore.sessions.findIndex((session) => session.id === sessionId);
  if (index <= 0) {
    return;
  }
  const [session] = chatStore.sessions.splice(index, 1);
  chatStore.sessions.unshift(session);
}

function ensureActiveChatSessionInStore() {
  if (!chatStore.sessions.length) {
    if (runtimeConfig.mode === "backend") {
      chatStore = {
        version: CHAT_STORE_VERSION,
        activeSessionId: "",
        sessions: [],
      };
      activeChatSessionId = null;
      return;
    }
    chatStore = createDefaultChatStore();
  }

  const hasActive = chatStore.sessions.some((session) => session.id === chatStore.activeSessionId);
  if (!hasActive) {
    chatStore.activeSessionId = chatStore.sessions[0]?.id || null;
  }

  activeChatSessionId = chatStore.activeSessionId;
}

function rebuildChatSessionCounters() {
  chatSessionIdSeq = 0;
  let maxSessionNumberFromTitle = 0;

  chatStore.sessions.forEach((session) => {
    syncChatSessionIdSeed(session.id);
    const titleMatch = /^Новая сессия (\d+)/i.exec(String(session.title || "").trim());
    if (titleMatch) {
      maxSessionNumberFromTitle = Math.max(maxSessionNumberFromTitle, Number(titleMatch[1]));
    }
  });

  nextSessionNumber = Math.max(maxSessionNumberFromTitle + 1, chatStore.sessions.length + 1, chatSessionIdSeq + 1);
}

function hydrateChatMoodMapFromStore() {
  chatMoodBySession.clear();
  chatStore.sessions.forEach((session) => {
    const normalizedMood = normalizeBackgroundStateName(session.mood || "");
    if (normalizedMood && normalizedMood !== "neutral") {
      chatMoodBySession.set(session.id, {
        state: normalizedMood,
        updatedAt: Date.now(),
      });
    }
  });
}

function sanitizeSessionTitle(rawTitle, fallback = "Новая сессия") {
  const clean = String(rawTitle || "").replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function createNewChatSessionRecord(title) {
  chatSessionIdSeq += 1;
  const sessionId = `chat-${chatSessionIdSeq}`;
  const nowIso = new Date().toISOString();
  return {
    id: sessionId,
    title: sanitizeSessionTitle(title, `Новая сессия ${nextSessionNumber}`),
    createdAt: nowIso,
    updatedAt: nowIso,
    mood: "route_chat",
    messages: [],
  };
}

function ensureSessionForOutgoingMessage(seedText = "") {
  if (activeChatSessionId) {
    return activeChatSessionId;
  }

  const normalizedSeed = String(seedText || "").replace(/\s+/g, " ").trim();
  const fallbackTitle = normalizedSeed
    ? sanitizeSessionTitle(normalizedSeed.slice(0, 72), `Новая сессия ${nextSessionNumber}`)
    : `Новая сессия ${nextSessionNumber}`;
  nextSessionNumber += 1;
  const session = createNewChatSessionRecord(fallbackTitle);

  chatStore.sessions.unshift(session);
  chatStore.activeSessionId = session.id;
  setChatSessionMood(session.id, "route_chat", 0, {
    applyIfActive: false,
    immediate: false,
  });
  persistCurrentChatStore();
  renderChatSessionList();
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === session.id) || null;
  setActiveChatSession(targetButton, { renderMessages: true, applyBackground: true });
  return session.id;
}

function ensureChatSessionIdentity(button) {
  if (!(button instanceof HTMLElement)) {
    return null;
  }

  if (!button.dataset.sessionId) {
    chatSessionIdSeq += 1;
    button.dataset.sessionId = `chat-${chatSessionIdSeq}`;
  } else {
    syncChatSessionIdSeed(button.dataset.sessionId);
  }
  return button.dataset.sessionId;
}

function listChatSessions() {
  return chatStore.sessions.map((session) => ({
    chatId: session.id,
    title: session.title,
    active: session.id === activeChatSessionId,
  }));
}

function isBackendRuntimeEnabled() {
  return runtimeConfig.mode === "backend";
}

function applyChatStoreSnapshot(
  snapshot,
  { preserveActive = true, preferredActiveId = "" } = {},
) {
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.sessions)) {
    return false;
  }
  if (snapshot.sessions.length === 0 && runtimeConfig.mode === "backend") {
    chatStore = {
      version: CHAT_STORE_VERSION,
      activeSessionId: "",
      sessions: [],
    };
    activeChatSessionId = null;
    renderChatSessionList();
    persistCurrentChatStore();
    renderActiveChatMessages();
    return true;
  }
  if (snapshot.sessions.length === 0) {
    return false;
  }

  const currentActive = String(activeChatSessionId || chatStore.activeSessionId || "").trim();
  const fallbackActive = String(snapshot.activeSessionId || "").trim();
  const preferred = String(preferredActiveId || "").trim();

  const nextStore = normalizeChatStore({
    version: Number(snapshot.version || CHAT_STORE_VERSION),
    activeSessionId: preferred || (preserveActive ? currentActive : "") || fallbackActive,
    sessions: snapshot.sessions,
  });

  const nextActiveId = [preferred, preserveActive ? currentActive : "", fallbackActive, nextStore.activeSessionId]
    .find((candidate) => (
      candidate
      && nextStore.sessions.some((session) => session.id === candidate)
    ))
    || nextStore.sessions[0]?.id
    || "";

  nextStore.activeSessionId = nextActiveId;
  chatStore = nextStore;

  ensureActiveChatSessionInStore();
  rebuildChatSessionCounters();
  hydrateChatMoodMapFromStore();
  renderChatSessionList();
  persistCurrentChatStore();

  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatStore.activeSessionId)
    || getChatSessionButtons()[0]
    || null;
  setActiveChatSession(targetButton);
  return true;
}

function tryApplyChatStoreFromMutation(response, options = {}) {
  const payload = response?.store && typeof response.store === "object"
    ? response.store
    : response;

  if (payload && typeof payload === "object" && Array.isArray(payload.sessions)) {
    return applyChatStoreSnapshot(payload, options);
  }
  return false;
}

async function syncChatStoreFromBackend(
  { preserveActive = true, preferredActiveId = "", silent = false } = {},
) {
  if (!isBackendRuntimeEnabled()) {
    return false;
  }

  try {
    const payload = await backendClient.listChats();
    const applied = applyChatStoreSnapshot(payload, { preserveActive, preferredActiveId });
    if (!applied && !silent) {
      pushToast("Бэкенд не вернул валидный список чатов.", { tone: "warning" });
    }
    return applied;
  } catch (error) {
    if (!silent) {
      pushToast(`Не удалось синхронизировать чаты: ${error.message}`, { tone: "error", durationMs: 3600 });
    }
    return false;
  }
}

async function runBackendChatMutation(
  mutate,
  { preserveActive = true, preferredActiveId = "", silent = true } = {},
) {
  const response = await mutate();
  const applied = tryApplyChatStoreFromMutation(response, { preserveActive, preferredActiveId });
  if (!applied) {
    await syncChatStoreFromBackend({ preserveActive, preferredActiveId, silent });
  }
  return response;
}

function getCurrentRouteState() {
  return normalizeRoute(document.body.dataset.route || getRouteFromHash());
}

function normalizeBackgroundStateName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (background.hasMood(normalized)) {
    return normalized;
  }
  return "neutral";
}

function getRouteBackgroundMood(route = getCurrentRouteState()) {
  const normalizedRoute = normalizeRoute(route);
  const routeMood = routeBackgroundState[normalizedRoute] || runtimeConfig.bootMood || "neutral";
  return normalizeBackgroundStateName(routeMood);
}

function applyTransientMood(sessionId, moodName, transitionMs = 280) {
  if (!sessionId || sessionId !== activeChatSessionId) return;
  if (getCurrentRouteState() !== "chat") return;
  const normalized = normalizeBackgroundStateName(moodName);
  const safeTransition = clamp(Number(transitionMs) || 280, 80, 3000);
  background.setMood(normalized, safeTransition);
}

function setChatSessionMood(
  sessionId,
  moodName,
  transitionMs = runtimeConfig.defaultTransitionMs,
  { applyIfActive = true, immediate = false } = {},
) {
  if (!sessionId) {
    return null;
  }

  const normalizedMood = normalizeBackgroundStateName(moodName);
  chatMoodBySession.set(sessionId, {
    state: normalizedMood,
    updatedAt: Date.now(),
  });
  const session = getChatSessionById(sessionId);
  if (session) {
    session.mood = normalizedMood;
    updateChatSessionTimestamp(session);
    persistCurrentChatStore();
  }

  const isChatRoute = getCurrentRouteState() === "chat";
  const isActiveSession = sessionId === activeChatSessionId;
  if (applyIfActive && isChatRoute && isActiveSession) {
    if (immediate) {
      background.applyMoodInstant(normalizedMood);
    } else {
      const safeTransition = clamp(Number(transitionMs) || runtimeConfig.defaultTransitionMs, 120, 12000);
      background.setMood(normalizedMood, safeTransition);
    }
  }

  return normalizedMood;
}

function clearChatSessionMood(sessionId, transitionMs = runtimeConfig.defaultTransitionMs) {
  if (!sessionId) {
    return;
  }

  chatMoodBySession.delete(sessionId);
  const session = getChatSessionById(sessionId);
  if (session) {
    session.mood = "";
    updateChatSessionTimestamp(session);
    persistCurrentChatStore();
  }
  if (getCurrentRouteState() === "chat" && sessionId === activeChatSessionId) {
    applyContextualBackground({ transitionMs });
  }
}

function getChatSessionMood(sessionId) {
  return chatMoodBySession.get(sessionId)?.state || null;
}

function resolveContextBackgroundMood(route = getCurrentRouteState()) {
  const normalizedRoute = normalizeRoute(route);
  if (normalizedRoute === "chat" && activeChatSessionId) {
    const sessionMood = chatMoodBySession.get(activeChatSessionId)?.state;
    if (sessionMood) {
      return normalizeBackgroundStateName(sessionMood);
    }
  }
  return getRouteBackgroundMood(normalizedRoute);
}

function applyContextualBackground({ transitionMs = runtimeConfig.defaultTransitionMs, immediate = false } = {}) {
  const targetMood = resolveContextBackgroundMood();
  if (immediate) {
    background.applyMoodInstant(targetMood);
    return targetMood;
  }

  const safeTransition = clamp(Number(transitionMs) || runtimeConfig.defaultTransitionMs, 120, 12000);
  background.setMood(targetMood, safeTransition);
  return targetMood;
}

function createChatSessionButton(session, isActive = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.chatItem = "";
  button.dataset.active = String(isActive);
  button.dataset.sessionId = session.id;
  button.dataset.sessionTitle = session.title;
  button.className = "active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left transition hover:bg-zinc-800/80 data-[active=true]:bg-zinc-700/80";
  button.setAttribute("aria-pressed", String(isActive));

  const title = document.createElement("p");
  title.className = isActive ? "text-sm font-semibold text-zinc-100" : "text-sm font-medium text-zinc-100";
  title.textContent = session.title;
  button.appendChild(title);
  return button;
}

function renderChatSessionList() {
  if (!elements.chatSessionList) {
    return;
  }

  elements.chatSessionList.innerHTML = "";
  chatStore.sessions.forEach((session) => {
    const isActive = session.id === (activeChatSessionId || chatStore.activeSessionId);
    const button = createChatSessionButton(session, isActive);
    elements.chatSessionList.appendChild(button);
  });
}

const BACKEND_HISTORY_MAX_MESSAGES = 12;
const BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE = 900;
const BACKEND_HISTORY_MAX_TOTAL_CHARS = 5200;

function getChatHistoryForBackend(limit = BACKEND_HISTORY_MAX_MESSAGES) {
  const activeSession = getActiveChatSession();
  if (!activeSession || !Array.isArray(activeSession.messages)) {
    return [];
  }

  const safeLimit = Math.max(
    2,
    Math.min(BACKEND_HISTORY_MAX_MESSAGES, Number(limit) || BACKEND_HISTORY_MAX_MESSAGES),
  );
  const recent = activeSession.messages.slice(-safeLimit);
  const compact = [];
  let totalChars = 0;

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const role = String(message?.role || "").trim().toLowerCase();
    if (!["user", "assistant", "system"].includes(role)) {
      continue;
    }

    let text = normalizeTextInput(message?.text || "").trim();
    if (!text) {
      continue;
    }
    if (text.length > BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE) {
      text = `${text.slice(0, BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE - 1).trimEnd()}…`;
    }

    const projectedTotal = totalChars + text.length;
    if (projectedTotal > BACKEND_HISTORY_MAX_TOTAL_CHARS && compact.length > 0) {
      break;
    }
    totalChars = projectedTotal;
    compact.push({
      role,
      text,
      timestamp: message.timestamp,
    });
  }

  return compact.reverse();
}

function renderChatEmptyState() {
  if (!elements.chatStream) {
    return;
  }
  elements.chatStream.innerHTML = "";

  const wrapper = document.createElement("section");
  wrapper.className = "chat-empty-state";
  wrapper.dataset.chatEmpty = "true";
  wrapper.setAttribute("role", "status");
  wrapper.setAttribute("aria-live", "polite");

  const title = document.createElement("p");
  title.className = "chat-empty-state__title";
  title.textContent = "Привет! Напиши свой вопрос!";

  wrapper.append(title);
  elements.chatStream.append(wrapper);
}

function renderActiveChatMessages({ animateEntries = false, transition = false } = {}) {
  if (!elements.chatStream) {
    return;
  }
  const transitionToken = ++chatStreamTransitionToken;
  const shouldTransition = Boolean(transition && isMotionEnabled());

  const commitRender = () => {
    if (!elements.chatStream || transitionToken !== chatStreamTransitionToken) {
      return;
    }

    const activeSession = getActiveChatSession();
    elements.chatStream.innerHTML = "";

    if (!activeSession || !Array.isArray(activeSession.messages) || activeSession.messages.length === 0) {
      renderChatEmptyState();
      return;
    }

    activeSession.messages.forEach((message, index) => {
      const shouldAnimateEntry = Boolean(animateEntries && index < CHAT_HISTORY_ANIMATED_LIMIT);
      const storedToolPayload = resolveStoredToolPayload(message);
      appendMessage(message.role, message.text, message.metaSuffix, {
        persist: false,
        animate: shouldAnimateEntry,
        animationDelayMs: shouldAnimateEntry ? Math.min(index * CHAT_HISTORY_STAGGER_MS, CHAT_HISTORY_STAGGER_CAP_MS) : 0,
        autoScroll: false,
        timestamp: message.timestamp,
        messageId: message.id,
        toolPayload: storedToolPayload || undefined,
        toolPhase: "result",
      });
    });

    elements.chatStream.scrollTo({
      top: elements.chatStream.scrollHeight,
      behavior: "auto",
    });
  };

  if (!shouldTransition) {
    elements.chatStream.classList.remove("chat-stream-switch-out", "chat-stream-switch-in");
    commitRender();
    return;
  }

  elements.chatStream.classList.remove("chat-stream-switch-in");
  elements.chatStream.classList.add("chat-stream-switch-out");
  window.setTimeout(() => {
    if (!elements.chatStream || transitionToken !== chatStreamTransitionToken) {
      return;
    }

    commitRender();
    elements.chatStream.classList.remove("chat-stream-switch-out");
    elements.chatStream.classList.add("chat-stream-switch-in");
    window.setTimeout(() => {
      if (!elements.chatStream || transitionToken !== chatStreamTransitionToken) {
        return;
      }
      elements.chatStream.classList.remove("chat-stream-switch-in");
    }, CHAT_STREAM_SWITCH_IN_MS);
  }, CHAT_STREAM_SWITCH_OUT_MS);
}

function persistChatMessage({
  chatId = "",
  role,
  text,
  metaSuffix = "",
  meta = {},
  timestamp = new Date().toISOString(),
}) {
  const targetSessionId = String(chatId || activeChatSessionId || "").trim();
  const targetSession = getChatSessionById(targetSessionId) || getActiveChatSession();
  if (!targetSession) {
    return null;
  }

  const safeMeta = meta && typeof meta === "object" && !Array.isArray(meta) ? { ...meta } : {};
  const normalized = normalizeChatMessage({
    id: `msg-${targetSession.messages.length + 1}`,
    role,
    text,
    metaSuffix,
    meta: safeMeta,
    timestamp,
  }, targetSession.messages.length + 1);

  if (!normalized) {
    return null;
  }

  targetSession.messages.push(normalized);
  updateChatSessionTimestamp(targetSession);
  moveChatSessionToFront(targetSession.id);
  persistCurrentChatStore();
  renderChatSessionList();
  if (targetSession.id === activeChatSessionId) {
    const activeButton = getChatSessionButtons().find((button) => button.dataset.sessionId === targetSession.id) || null;
    if (activeButton) {
      setActiveChatSession(activeButton, { renderMessages: false, applyBackground: false });
    }
  }
  return normalized;
}

function clearActiveChatMessages() {
  const activeSession = getActiveChatSession();
  if (!activeSession) {
    return false;
  }

  activeSession.messages = [];
  updateChatSessionTimestamp(activeSession);
  persistCurrentChatStore();
  renderActiveChatMessages();
  return true;
}

function clearChatMessagesById(chatId) {
  const session = getChatSessionById(chatId);
  if (!session) {
    return false;
  }

  session.messages = [];
  updateChatSessionTimestamp(session);
  moveChatSessionToFront(session.id);
  persistCurrentChatStore();
  renderChatSessionList();

  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === session.id) || null;
  if (targetButton) {
    setActiveChatSession(targetButton, {
      renderMessages: session.id === activeChatSessionId,
      applyBackground: false,
    });
  } else if (session.id === activeChatSessionId) {
    renderActiveChatMessages();
  }

  return true;
}

function renameChatSessionById(chatId, nextTitle) {
  const session = getChatSessionById(chatId);
  if (!session) {
    return null;
  }

  const title = sanitizeSessionTitle(nextTitle, session.title);
  session.title = title;
  updateChatSessionTimestamp(session);
  moveChatSessionToFront(session.id);
  persistCurrentChatStore();
  renderChatSessionList();
  const activeButton = getChatSessionButtons().find((button) => button.dataset.sessionId === session.id) || null;
  setActiveChatSession(activeButton, { applyBackground: false });
  return title;
}

function renameActiveChatSession(nextTitle) {
  return renameChatSessionById(activeChatSessionId, nextTitle);
}

function deleteChatSessionById(chatId) {
  const index = chatStore.sessions.findIndex((session) => session.id === chatId);
  if (index < 0) {
    return false;
  }
  if (chatStore.sessions.length <= 1) {
    pushToast("Нельзя удалить единственный чат. Создайте новый перед удалением.", { tone: "warning" });
    return false;
  }

  chatStore.sessions.splice(index, 1);
  chatMoodBySession.delete(chatId);

  if (activeChatSessionId === chatId || chatStore.activeSessionId === chatId) {
    chatStore.activeSessionId = chatStore.sessions[0]?.id || "";
    activeChatSessionId = chatStore.activeSessionId || null;
  }

  persistCurrentChatStore();
  renderChatSessionList();
  const nextButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatStore.activeSessionId) || null;
  setActiveChatSession(nextButton);
  return true;
}

function duplicateChatSessionById(chatId) {
  const source = getChatSessionById(chatId);
  if (!source) {
    return null;
  }

  chatSessionIdSeq += 1;
  const newSessionId = `chat-${chatSessionIdSeq}`;
  const nowIso = new Date().toISOString();
  const clonedMessages = source.messages.map((message, index) => ({
    ...message,
    id: `msg-${index + 1}`,
    timestamp: message.timestamp || nowIso,
  }));
  const duplicated = {
    id: newSessionId,
    title: `${source.title} (копия)`,
    createdAt: nowIso,
    updatedAt: nowIso,
    mood: source.mood || "",
    messages: clonedMessages,
  };

  chatStore.sessions.unshift(duplicated);
  chatStore.activeSessionId = duplicated.id;
  if (duplicated.mood) {
    chatMoodBySession.set(duplicated.id, {
      state: normalizeBackgroundStateName(duplicated.mood),
      updatedAt: Date.now(),
    });
  }
  persistCurrentChatStore();
  renderChatSessionList();
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === duplicated.id) || null;
  setActiveChatSession(targetButton);
  return duplicated;
}

function getMessageRecord(chatId, messageId) {
  const session = getChatSessionById(chatId);
  if (!session || !Array.isArray(session.messages)) {
    return null;
  }
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0) {
    return null;
  }
  return {
    session,
    index,
    message: session.messages[index],
  };
}

function editMessageById(chatId, messageId, nextText) {
  const record = getMessageRecord(chatId, messageId);
  if (!record) {
    return false;
  }
  const text = String(nextText || "").trim();
  if (!text) {
    return false;
  }

  record.session.messages[record.index] = {
    ...record.message,
    text,
  };
  updateChatSessionTimestamp(record.session);
  moveChatSessionToFront(record.session.id);
  persistCurrentChatStore();
  renderChatSessionList();
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === record.session.id) || null;
  setActiveChatSession(targetButton, {
    renderMessages: record.session.id === activeChatSessionId,
    applyBackground: false,
  });
  return true;
}

function deleteMessageById(chatId, messageId) {
  const record = getMessageRecord(chatId, messageId);
  if (!record) {
    return false;
  }

  record.session.messages.splice(record.index, 1);
  updateChatSessionTimestamp(record.session);
  moveChatSessionToFront(record.session.id);
  persistCurrentChatStore();
  renderChatSessionList();
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === record.session.id) || null;
  setActiveChatSession(targetButton, {
    renderMessages: record.session.id === activeChatSessionId,
    applyBackground: false,
  });
  return true;
}

function exportChatStorePayload() {
  return JSON.stringify(chatStore, null, 2);
}

function importChatStorePayload(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  chatStore = normalizeChatStore(parsed);
  ensureActiveChatSessionInStore();
  rebuildChatSessionCounters();
  hydrateChatMoodMapFromStore();
  renderChatSessionList();
  persistCurrentChatStore();
  const activeButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatStore.activeSessionId) || null;
  setActiveChatSession(activeButton);
  return {
    sessions: chatStore.sessions.length,
    activeSessionId: chatStore.activeSessionId,
  };
}

const CHAT_CONTEXT_MENU_ITEMS = [
  { id: "chat-open", label: "Открыть чат" },
  { id: "chat-rename", label: "Переименовать чат" },
  { id: "chat-duplicate", label: "Дублировать чат" },
  { id: "chat-clear", label: "Очистить историю" },
  { divider: true },
  { id: "chat-delete", label: "Удалить чат", tone: "danger" },
];

const MESSAGE_CONTEXT_MENU_ITEMS = [
  { id: "message-copy", label: "Копировать текст" },
  { id: "message-quote", label: "Вставить в поле ввода" },
  { id: "message-edit", label: "Редактировать сообщение" },
  { divider: true },
  { id: "message-delete", label: "Удалить сообщение", tone: "danger" },
];

function canEditMessageInUI(chatId, messageId) {
  const record = getMessageRecord(chatId, messageId);
  return String(record?.message?.role || "").toLowerCase() === "user";
}

function getMessageContextMenuItems(chatId, messageId) {
  if (canEditMessageInUI(chatId, messageId)) {
    return MESSAGE_CONTEXT_MENU_ITEMS;
  }
  return MESSAGE_CONTEXT_MENU_ITEMS.filter((item) => item.id !== "message-edit");
}

function finalizeContextMenuClose({ clearItems = true } = {}) {
  if (!elements.contextMenu) {
    return;
  }

  if (contextMenuState.closeTimerId != null) {
    window.clearTimeout(contextMenuState.closeTimerId);
    contextMenuState.closeTimerId = null;
  }
  if (contextMenuState.openRafId) {
    window.cancelAnimationFrame(contextMenuState.openRafId);
    contextMenuState.openRafId = 0;
  }

  elements.contextMenu.classList.remove("is-open", "is-closing");
  elements.contextMenu.classList.add("hidden");
  elements.contextMenu.setAttribute("aria-hidden", "true");
  if (clearItems) {
    elements.contextMenu.innerHTML = "";
  }
}

function closeContextMenu({ immediate = false } = {}) {
  if (!elements.contextMenu) {
    return;
  }

  const hasVisibleMenu = contextMenuState.open
    || elements.contextMenu.classList.contains("is-open")
    || elements.contextMenu.classList.contains("is-closing");
  if (!hasVisibleMenu) {
    return;
  }

  contextMenuState.open = false;
  contextMenuState.kind = "";
  contextMenuState.chatId = "";
  contextMenuState.messageId = "";

  const shouldAnimate = isMotionEnabled()
    && !immediate
    && elements.contextMenu.classList.contains("is-open");
  if (!shouldAnimate) {
    finalizeContextMenuClose({ clearItems: true });
    return;
  }

  if (contextMenuState.closeTimerId != null) {
    window.clearTimeout(contextMenuState.closeTimerId);
    contextMenuState.closeTimerId = null;
  }
  if (contextMenuState.openRafId) {
    window.cancelAnimationFrame(contextMenuState.openRafId);
    contextMenuState.openRafId = 0;
  }

  const transitionToken = ++contextMenuState.transitionToken;
  elements.contextMenu.classList.remove("is-open");
  elements.contextMenu.classList.add("is-closing");
  elements.contextMenu.setAttribute("aria-hidden", "true");
  contextMenuState.closeTimerId = window.setTimeout(() => {
    if (transitionToken !== contextMenuState.transitionToken) {
      return;
    }
    contextMenuState.closeTimerId = null;
    finalizeContextMenuClose({ clearItems: true });
  }, CONTEXT_MENU_TRANSITION_MS);
}

function renderContextMenuItems(items) {
  if (!elements.contextMenu) {
    return;
  }
  const fragment = document.createDocumentFragment();
  let menuItemIndex = 0;
  items.forEach((item) => {
    if (item.divider) {
      const divider = document.createElement("div");
      divider.className = "context-menu__divider";
      divider.setAttribute("role", "separator");
      fragment.appendChild(divider);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu__item";
    button.dataset.contextAction = item.id;
    button.style.setProperty("--context-item-index", String(menuItemIndex));
    button.textContent = item.label;
    button.setAttribute("role", "menuitem");
    if (item.tone) {
      button.dataset.tone = item.tone;
    }
    fragment.appendChild(button);
    menuItemIndex += 1;
  });
  elements.contextMenu.innerHTML = "";
  elements.contextMenu.appendChild(fragment);
}

function positionContextMenu(x, y) {
  if (!elements.contextMenu) {
    return;
  }

  const margin = 10;
  const rect = elements.contextMenu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = clamp(x, margin, Math.max(margin, viewportWidth - rect.width - margin));
  const top = clamp(y, margin, Math.max(margin, viewportHeight - rect.height - margin));
  elements.contextMenu.style.left = `${left}px`;
  elements.contextMenu.style.top = `${top}px`;
}

function openContextMenu({ kind, chatId = "", messageId = "", x = 0, y = 0 }) {
  if (!elements.contextMenu) {
    return;
  }

  const isChatMenu = kind === "chat";
  const isMessageMenu = kind === "message";
  if (!isChatMenu && !isMessageMenu) {
    closeContextMenu();
    return;
  }

  contextMenuState.open = true;
  contextMenuState.kind = kind;
  contextMenuState.chatId = chatId;
  contextMenuState.messageId = messageId;

  if (contextMenuState.closeTimerId != null) {
    window.clearTimeout(contextMenuState.closeTimerId);
    contextMenuState.closeTimerId = null;
  }
  if (contextMenuState.openRafId) {
    window.cancelAnimationFrame(contextMenuState.openRafId);
    contextMenuState.openRafId = 0;
  }

  const menuItems = isChatMenu
    ? CHAT_CONTEXT_MENU_ITEMS
    : getMessageContextMenuItems(chatId, messageId);
  renderContextMenuItems(menuItems);
  const transitionToken = ++contextMenuState.transitionToken;
  elements.contextMenu.classList.remove("hidden", "is-open", "is-closing");
  elements.contextMenu.setAttribute("aria-hidden", "false");
  positionContextMenu(x, y);
  if (!isMotionEnabled()) {
    elements.contextMenu.classList.add("is-open");
    return;
  }

  contextMenuState.openRafId = window.requestAnimationFrame(() => {
    contextMenuState.openRafId = 0;
    if (!contextMenuState.open || transitionToken !== contextMenuState.transitionToken) {
      return;
    }
    elements.contextMenu?.classList.add("is-open");
  });
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // fallback below
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }
  textarea.remove();
  return copied;
}

async function executeContextMenuAction(
  actionId,
  context = {},
) {
  const chatId = String(context.chatId ?? contextMenuState.chatId ?? "").trim();
  const messageId = String(context.messageId ?? contextMenuState.messageId ?? "").trim();
  const isChatAction = String(actionId || "").startsWith("chat-");
  const isMessageAction = String(actionId || "").startsWith("message-");

  if (isChatAction && !chatId) {
    pushToast("Не удалось определить чат для действия.", { tone: "error", durationMs: 3200 });
    return;
  }
  if (isMessageAction && (!chatId || !messageId)) {
    pushToast("Не удалось определить сообщение для действия.", { tone: "error", durationMs: 3200 });
    return;
  }

  if (actionId === "chat-open") {
    const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatId) || null;
    if (targetButton) {
      setActiveChatSession(targetButton);
    }
    return;
  }

  if (actionId === "chat-rename") {
    const session = getChatSessionById(chatId);
    const promptBaseTitle = session?.title || chatId;
    const nextTitle = await requestActionText("Введите новое название чата.", promptBaseTitle, {
      title: "Переименование чата",
      confirmLabel: "Сохранить",
      placeholder: "Название чата",
    });
    if (nextTitle == null) {
      return;
    }
    const safeTitle = sanitizeSessionTitle(nextTitle, promptBaseTitle);
    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.updateChat(chatId, { title: safeTitle }),
          { preserveActive: true, preferredActiveId: chatId },
        );
        pushToast("Чат переименован.", { tone: "success" });
      } catch (error) {
        const localRenamed = renameChatSessionById(chatId, safeTitle);
        if (localRenamed) {
          pushToast(`Сервер недоступен, чат переименован локально: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось переименовать чат: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    if (!session) {
      pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
      return;
    }

    const renamed = renameChatSessionById(chatId, safeTitle);
    if (renamed) {
      pushToast("Чат переименован.", { tone: "success" });
    }
    return;
  }

  if (actionId === "chat-duplicate") {
    if (isBackendRuntimeEnabled()) {
      try {
        const response = await backendClient.duplicateChat(chatId, {});
        const duplicatedId = String(response?.chat?.id || "").trim();
        const applied = tryApplyChatStoreFromMutation(response, {
          preserveActive: false,
          preferredActiveId: duplicatedId,
        });
        if (!applied) {
          await syncChatStoreFromBackend({
            preserveActive: false,
            preferredActiveId: duplicatedId,
            silent: true,
          });
        }
        const duplicatedTitle = String(response?.chat?.title || "дубликат");
        pushToast(`Создан дубликат «${duplicatedTitle}».`, { tone: "success" });
      } catch (error) {
        const duplicated = duplicateChatSessionById(chatId);
        if (duplicated) {
          pushToast(`Сервер недоступен, создан локальный дубликат: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось дублировать чат: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    const duplicated = duplicateChatSessionById(chatId);
    if (duplicated) {
      pushToast(`Создан дубликат «${duplicated.title}».`, { tone: "success" });
    }
    return;
  }

  if (actionId === "chat-clear") {
    const session = getChatSessionById(chatId);
    const sessionLabel = session?.title || chatId;
    const allow = await requestActionConfirm(`Очистить историю чата «${sessionLabel}»?`, {
      title: "Очистка истории",
      confirmLabel: "Очистить",
      danger: true,
    });
    if (!allow) {
      return;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.clearChatMessages(chatId),
          { preserveActive: true, preferredActiveId: chatId },
        );
        pushToast("История чата очищена.", { tone: "success" });
      } catch (error) {
        const cleared = clearChatMessagesById(chatId);
        if (cleared) {
          pushToast(`Сервер недоступен, чат очищен локально: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось очистить чат: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    if (!session) {
      pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
      return;
    }

    const cleared = clearChatMessagesById(chatId);
    if (cleared) {
      pushToast("История чата очищена.", { tone: "success" });
    }
    return;
  }

  if (actionId === "chat-delete") {
    const session = getChatSessionById(chatId);
    const sessionLabel = session?.title || chatId;
    const allow = await requestActionConfirm(`Удалить чат «${sessionLabel}»?`, {
      title: "Удаление чата",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!allow) {
      return;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.deleteChat(chatId),
          { preserveActive: false, preferredActiveId: "" },
        );
        pushToast("Чат удалён.", { tone: "success" });
      } catch (error) {
        const deleted = deleteChatSessionById(chatId);
        if (deleted) {
          pushToast(`Сервер недоступен, чат удалён локально: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось удалить чат: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    if (!session) {
      pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
      return;
    }

    const deleted = deleteChatSessionById(chatId);
    if (deleted) {
      pushToast("Чат удалён.", { tone: "success" });
    }
    return;
  }

  if (actionId === "message-copy") {
    const record = getMessageRecord(chatId, messageId);
    if (!record) {
      pushToast("Сообщение не найдено.", { tone: "error", durationMs: 3200 });
      return;
    }
    const copied = await copyTextToClipboard(record.message.text);
    pushToast(copied ? "Текст сообщения скопирован." : "Не удалось скопировать сообщение.", {
      tone: copied ? "success" : "error",
    });
    return;
  }

  if (actionId === "message-quote") {
    const record = getMessageRecord(chatId, messageId);
    if (!record || !elements.composerInput) {
      pushToast("Сообщение не найдено для цитирования.", { tone: "error", durationMs: 3200 });
      return;
    }
    const prefix = elements.composerInput.value.trim() ? `${elements.composerInput.value.trim()}\n\n` : "";
    const quoted = normalizeTextInput(record.message.text)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    elements.composerInput.value = `${prefix}${quoted}`;
    elements.composerInput.focus();
    syncComposerState();
    pushToast("Сообщение добавлено в поле ввода.", { tone: "success" });
    return;
  }

  if (actionId === "message-edit") {
    if (!canEditMessageInUI(chatId, messageId)) {
      pushToast("Редактирование доступно только для сообщений пользователя.", {
        tone: "warning",
        durationMs: 3200,
      });
      return;
    }

    const record = getMessageRecord(chatId, messageId);
    const currentText = record?.message?.text || "";
    const nextText = await requestActionText("Измените текст сообщения.", currentText, {
      title: "Редактирование сообщения",
      confirmLabel: "Сохранить",
      placeholder: "Текст сообщения",
    });
    if (nextText == null) {
      return;
    }

    if (!String(nextText).trim()) {
      pushToast("Текст сообщения не может быть пустым.", { tone: "error", durationMs: 3200 });
      return;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.updateMessage(chatId, messageId, { text: nextText }),
          { preserveActive: true, preferredActiveId: chatId },
        );
        pushToast("Сообщение обновлено.", { tone: "success" });
      } catch (error) {
        const edited = editMessageById(chatId, messageId, nextText);
        if (edited) {
          pushToast(`Сервер недоступен, сообщение изменено локально: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось обновить сообщение: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    if (!record) {
      pushToast("Сообщение не найдено в локальном хранилище.", { tone: "error", durationMs: 3200 });
      return;
    }

    const edited = editMessageById(chatId, messageId, nextText);
    if (edited) {
      pushToast("Сообщение обновлено.", { tone: "success" });
    }
    return;
  }

  if (actionId === "message-delete") {
    const record = getMessageRecord(chatId, messageId);
    const allow = await requestActionConfirm("Удалить это сообщение?", {
      title: "Удаление сообщения",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!allow) {
      return;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.deleteMessage(chatId, messageId),
          { preserveActive: true, preferredActiveId: chatId },
        );
        pushToast("Сообщение удалено.", { tone: "success" });
      } catch (error) {
        const deleted = deleteMessageById(chatId, messageId);
        if (deleted) {
          pushToast(`Сервер недоступен, сообщение удалено локально: ${error.message}`, {
            tone: "warning",
            durationMs: 4200,
          });
        } else {
          pushToast(`Не удалось удалить сообщение: ${error.message}`, { tone: "error", durationMs: 3600 });
        }
      }
      return;
    }

    if (!record) {
      pushToast("Сообщение не найдено в локальном хранилище.", { tone: "error", durationMs: 3200 });
      return;
    }

    const deleted = deleteMessageById(chatId, messageId);
    if (deleted) {
      pushToast("Сообщение удалено.", { tone: "success" });
    }
    return;
  }

  pushToast("Действие меню пока не поддерживается.", { tone: "warning", durationMs: 2600 });
}

function applyChatSessionVisibilityFilter() {
  const buttons = getChatSessionButtons();
  buttons.forEach(ensureChatSessionIdentity);
  buttons.forEach((button) => {
    const isActive = button.dataset.active === "true";
    const shouldHide = showOnlyActiveSessions && !isActive;
    button.classList.toggle("hidden", shouldHide);
    button.setAttribute("aria-hidden", String(shouldHide));
  });

  if (elements.chatSessionFilterButton) {
    elements.chatSessionFilterButton.setAttribute("aria-pressed", String(showOnlyActiveSessions));
    elements.chatSessionFilterButton.title = showOnlyActiveSessions ? "Показать все" : "Показать только активную";
    elements.chatSessionFilterButton.classList.toggle("bg-zinc-700/85", showOnlyActiveSessions);
    elements.chatSessionFilterButton.classList.toggle("text-zinc-100", showOnlyActiveSessions);
  }
}

function setActiveChatSession(targetButton, { renderMessages = true, applyBackground = true } = {}) {
  const buttons = getChatSessionButtons();
  buttons.forEach(ensureChatSessionIdentity);
  const fallbackTarget = buttons[0] || null;
  const safeTarget = targetButton instanceof HTMLElement && buttons.includes(targetButton)
    ? targetButton
    : fallbackTarget;
  const previousSessionId = activeChatSessionId;

  buttons.forEach((button) => {
    const isActive = button === safeTarget;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
    const titleNode = button.querySelector("p");
    if (titleNode) {
      titleNode.className = isActive ? "text-sm font-semibold text-zinc-100" : "text-sm font-medium text-zinc-100";
    }
  });

  activeChatSessionId = safeTarget ? ensureChatSessionIdentity(safeTarget) : null;
  if (activeChatSessionId) {
    chatStore.activeSessionId = activeChatSessionId;
    persistCurrentChatStore();
  }
  if (renderMessages) {
    const switchedSession = Boolean(
      previousSessionId
      && activeChatSessionId
      && previousSessionId !== activeChatSessionId,
    );
    renderActiveChatMessages({
      animateEntries: switchedSession,
      transition: switchedSession,
    });
  }
  applyChatSessionVisibilityFilter();

  if (safeTarget && previousSessionId && previousSessionId !== activeChatSessionId && isMotionEnabled()) {
    safeTarget.classList.remove("session-item-activated");
    void safeTarget.offsetWidth;
    safeTarget.classList.add("session-item-activated");
    window.setTimeout(() => {
      safeTarget.classList.remove("session-item-activated");
    }, 280);
  }

  if (applyBackground && getCurrentRouteState() === "chat") {
    applyContextualBackground({ transitionMs: 760 });
  }
  syncComposerState();
}
elements.chatSessionList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-chat-item]") : null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }
  setActiveChatSession(target);
  if (!isLeftPanelDocked()) {
    mobileState.leftOpen = false;
    syncMobilePanels();
  }
});

elements.chatSessionList?.addEventListener("contextmenu", (event) => {
  const target = event.target instanceof Element ? event.target.closest("[data-chat-item]") : null;
  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const chatId = target.dataset.sessionId || "";
  if (!chatId) {
    return;
  }

  event.preventDefault();
  openContextMenu({
    kind: "chat",
    chatId,
    x: event.clientX,
    y: event.clientY,
  });
});

elements.chatStream?.addEventListener("contextmenu", (event) => {
  const row = event.target instanceof Element ? event.target.closest("[data-message-id]") : null;
  if (!(row instanceof HTMLElement)) {
    return;
  }

  const messageId = row.dataset.messageId || "";
  const chatId = row.dataset.chatId || activeChatSessionId || "";
  if (!messageId || !chatId) {
    return;
  }

  event.preventDefault();
  openContextMenu({
    kind: "message",
    chatId,
    messageId,
    x: event.clientX,
    y: event.clientY,
  });
});

elements.chatSessionFilterButton?.addEventListener("click", () => {
  showOnlyActiveSessions = !showOnlyActiveSessions;
  applyChatSessionVisibilityFilter();
  pushToast(
    showOnlyActiveSessions ? "Показываю только активную сессию." : "Показываю все сессии.",
    { tone: "neutral" },
  );
});

elements.chatClearSessionButton?.addEventListener("click", async () => {
  const activeSession = getActiveChatSession();
  if (!activeSession) {
    pushToast("Активная сессия не найдена.", { tone: "error", durationMs: 3200 });
    return;
  }

  const shouldClear = await requestActionConfirm(`Очистить историю сессии «${activeSession.title}»?`, {
    title: "Очистка сессии",
    confirmLabel: "Очистить",
    danger: true,
  });
  if (!shouldClear) {
    return;
  }

  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.clearChatMessages(activeSession.id),
        { preserveActive: true, preferredActiveId: activeSession.id },
      );
      pushToast("История активной сессии очищена.", { tone: "success" });
    } catch (error) {
      const cleared = clearActiveChatMessages();
      if (cleared) {
        pushToast(`Сервер недоступен, история очищена локально: ${error.message}`, {
          tone: "warning",
          durationMs: 4200,
        });
      } else {
        pushToast(`Не удалось очистить историю: ${error.message}`, { tone: "error", durationMs: 3600 });
      }
    }
    return;
  }

  const cleared = clearActiveChatMessages();
  if (cleared) {
    pushToast("История активной сессии очищена.", { tone: "success" });
  }
});

elements.chatNewSessionButton?.addEventListener("click", async () => {
  const timestamp = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  const sessionTitle = `Новая сессия ${nextSessionNumber} • ${timestamp}`;
  nextSessionNumber += 1;
  const session = createNewChatSessionRecord(sessionTitle);

  if (isBackendRuntimeEnabled()) {
    try {
      const response = await backendClient.createChat({
        id: session.id,
        title: sessionTitle,
        mood: "route_chat",
      });
      const applied = tryApplyChatStoreFromMutation(response, {
        preserveActive: false,
        preferredActiveId: session.id,
      });
      if (!applied) {
        await syncChatStoreFromBackend({
          preserveActive: false,
          preferredActiveId: session.id,
          silent: true,
        });
      }
      showOnlyActiveSessions = false;
      applyChatSessionVisibilityFilter();
      pushToast("Создана новая сессия.", { tone: "success" });
      elements.composerInput?.focus();
      return;
    } catch (error) {
      pushToast(`Не удалось создать чат на сервере: ${error.message}. Создана локальная сессия.`, {
        tone: "warning",
        durationMs: 4200,
      });
    }
  }

  chatStore.sessions.unshift(session);
  chatStore.activeSessionId = session.id;
  setChatSessionMood(session.id, "route_chat", 0, {
    applyIfActive: false,
    immediate: false,
  });
  persistCurrentChatStore();
  renderChatSessionList();
  showOnlyActiveSessions = false;
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === session.id) || null;
  setActiveChatSession(targetButton);
  appendMessage("assistant", `Создана сессия «${sessionTitle}». Можете начинать новый диалог.`, "новая сессия", {
    persist: true,
  });
  pushToast("Создана новая сессия.", { tone: "success" });
  elements.composerInput?.focus();
});
elements.contextMenu?.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

elements.contextMenu?.addEventListener("click", async (event) => {
  const actionButton = event.target instanceof Element
    ? event.target.closest("[data-context-action]")
    : null;
  if (!(actionButton instanceof HTMLButtonElement)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const actionId = actionButton.dataset.contextAction || "";
  const snapshot = {
    kind: contextMenuState.kind,
    chatId: contextMenuState.chatId,
    messageId: contextMenuState.messageId,
  };
  closeContextMenu();
  try {
    await executeContextMenuAction(actionId, snapshot);
  } catch (error) {
    pushToast(`Сбой выполнения действия: ${error.message}`, { tone: "error", durationMs: 3600 });
  }
});
const roleStyleMap = {
  assistant: {
    contentClass: "message-content message-content-assistant",
    metaPrefix: "",
  },
  user: {
    contentClass: "message-content message-content-user",
    metaPrefix: "",
  },
  tool: {
    contentClass: "message-content message-content-tool",
    metaPrefix: "",
  },
};
const ASSISTANT_PENDING_LABEL = "Модель формирует ответ";

function getClockTime(value = Date.now()) {
  const candidate = value instanceof Date ? value : new Date(value);
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

const mathTypesetDebounceByNode = new WeakMap();

function scheduleMathTypeset(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const previous = mathTypesetDebounceByNode.get(container);
  if (previous) {
    window.clearTimeout(previous);
  }
  const timer = window.setTimeout(() => {
    mathTypesetDebounceByNode.delete(container);
    void typesetMathInElement(container);
  }, 60);
  mathTypesetDebounceByNode.set(container, timer);
}

function renderMessageBody(body, text) {
  if (!(body instanceof HTMLElement)) {
    return;
  }
  body.innerHTML = renderMessageHtml(normalizeTextInput(text));
  scheduleMathTypeset(body);
}

function renderPendingMessageBody(body, label = ASSISTANT_PENDING_LABEL) {
  if (!(body instanceof HTMLElement)) {
    return;
  }
  body.innerHTML = "";

  const pending = document.createElement("span");
  pending.className = "message-pending";
  pending.setAttribute("role", "status");
  pending.setAttribute("aria-live", "polite");

  const orb = document.createElement("span");
  orb.className = "message-pending__orb";
  orb.setAttribute("aria-hidden", "true");

  const orbCore = document.createElement("span");
  orbCore.className = "message-pending__core";
  orb.append(orbCore);

  const pendingLabel = document.createElement("span");
  pendingLabel.className = "message-pending__label";
  pendingLabel.textContent = String(label || ASSISTANT_PENDING_LABEL).trim() || ASSISTANT_PENDING_LABEL;

  pending.append(orb, pendingLabel);
  body.append(pending);
}

function resolveMessageMeta(roleStyle, metaSuffix, timestamp) {
  const metaParts = [];
  if (roleStyle.metaPrefix && roleStyle.metaPrefix.trim()) {
    metaParts.push(roleStyle.metaPrefix.trim());
  }
  if (metaSuffix && String(metaSuffix).trim()) {
    metaParts.push(String(metaSuffix).trim());
  }
  if (metaParts.length === 0) {
    return "";
  }
  return `${metaParts.join(" • ")} • ${getClockTime(timestamp)}`;
}

function updateMessageRowContent(wrapper, {
  text = "",
  metaSuffix = "",
  timestamp = new Date(),
  pending = false,
  pendingLabel = ASSISTANT_PENDING_LABEL,
} = {}) {
  if (!(wrapper instanceof HTMLElement)) {
    return;
  }
  const role = String(wrapper.dataset.role || "assistant");
  const roleStyle = roleStyleMap[role] || roleStyleMap.assistant;

  const body = wrapper.querySelector("[data-message-body]");
  if (body instanceof HTMLElement) {
    if (pending) {
      wrapper.dataset.pending = "true";
      body.setAttribute("data-pending", "true");
      renderPendingMessageBody(body, pendingLabel);
    } else {
      delete wrapper.dataset.pending;
      body.removeAttribute("data-pending");
      renderMessageBody(body, text);
    }
  }

  const metaText = resolveMessageMeta(roleStyle, metaSuffix, timestamp);
  const metaNode = wrapper.querySelector("[data-message-meta]");
  if (metaNode instanceof HTMLElement) {
    if (!metaText) {
      metaNode.classList.add("hidden");
      metaNode.textContent = "";
    } else {
      metaNode.classList.remove("hidden");
      metaNode.textContent = metaText;
    }
  }
}

function resolveToolMeta(toolName) {
  const map = {
    "web.search.duckduckgo": { displayName: "Поиск",              iconKey: "search-web" },
    "web.visit.website":     { displayName: "Открытие страницы",  iconKey: "globe" },
    "system.time":           { displayName: "Системное время",    iconKey: "clock" },
    "chat.set_mood":         { displayName: "Смена состояния",    iconKey: "mood" },
  };
  return map[String(toolName).trim()] || { displayName: String(toolName).trim() || "Инструмент", iconKey: "plugins" };
}

function normalizeLegacyToolName(rawName = "") {
  const safeName = String(rawName || "").trim();
  const lower = safeName.toLowerCase();
  if (lower.startsWith("web.search.duckduckgo") || lower.startsWith("поиск")) {
    return "web.search.duckduckgo";
  }
  if (lower.startsWith("web.visit.website") || lower.startsWith("страница")) {
    return "web.visit.website";
  }
  if (lower.startsWith("chat.set_mood")) {
    return "chat.set_mood";
  }
  if (lower.startsWith("system.time")) {
    return "system.time";
  }
  return safeName;
}

function resolveToolQueryPreview(name, args, output = null) {
  const safeOutput = output && typeof output === "object" ? output : {};
  if (name === "web.search.duckduckgo") {
    const query = String(args?.query || safeOutput?.query || "").trim();
    return query ? `Поиск: ${query}` : "";
  }
  if (name === "web.visit.website") {
    const candidateUrl = String(args?.url || safeOutput?.url || safeOutput?.requested_url || "").trim();
    if (!candidateUrl) {
      return "";
    }
    try { return new URL(candidateUrl).hostname; } catch { return candidateUrl.slice(0, 48); }
  }
  if (name === "chat.set_mood") {
    const mood = String(args?.mood || safeOutput?.mood || "").trim();
    return mood || "";
  }
  return "";
}

function buildToolStatusSvg(status) {
  if (status === "running") {
    return `<svg class="ui-icon tool-spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="28 16" stroke-linecap="round"/></svg>`;
  }
  if (status === "error") return icon("x-mark");
  return icon("check");
}

function buildToolCardInto(wrapper, payload, phase) {
  const name   = normalizeLegacyToolName(String(payload.name || "tool"));
  const status = String(payload.status || (phase === "start" ? "running" : "ok")).toLowerCase();
  const args   = payload.args && typeof payload.args === "object" ? payload.args : {};
  const output = payload.output && typeof payload.output === "object" ? payload.output : null;
  const invId  = String(payload.invocation_id || "").trim();

  if (invId) wrapper.dataset.invocationId = invId;

  const { displayName, iconKey } = resolveToolMeta(name);
  const queryPreview = resolveToolQueryPreview(name, args, output);

  // Карточка
  const card = document.createElement("div");
  card.className = "tool-call-card";

  const statusIcon = document.createElement("span");
  statusIcon.className = `tool-call-status-icon tool-status-${status}`;
  statusIcon.setAttribute("data-tool-status", status);
  statusIcon.innerHTML = buildToolStatusSvg(status);

  const info = document.createElement("div");
  info.className = "tool-call-info";
  const nameEl = document.createElement("span");
  nameEl.className = "tool-call-name";
  nameEl.textContent = displayName;
  info.append(nameEl);
  if (queryPreview) {
    const qEl = document.createElement("span");
    qEl.className = "tool-call-query";
    qEl.textContent = queryPreview;
    info.append(qEl);
  }

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.disabled = false;
  expandBtn.className = "tool-expand-btn icon-button active:scale-95 h-7 w-7 rounded-full bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200";
  expandBtn.setAttribute("aria-label", "Подробности");
  expandBtn.setAttribute("aria-expanded", "false");
  expandBtn.innerHTML = icon("chevron-down");

  card.append(statusIcon, info, expandBtn);
  wrapper.append(card);

  const details = document.createElement("div");
  details.className = "tool-call-details";
  details.setAttribute("data-tool-details", "true");

  const detailsInner = document.createElement("div");
  detailsInner.className = "tool-call-details-inner";

  const detailsBody = document.createElement("div");
  detailsBody.className = "message-body text-xs leading-6 text-zinc-200";
  detailsBody.setAttribute("data-message-body", "true");
  detailsInner.append(detailsBody);
  details.append(detailsInner);
  wrapper.append(details);

  const fallbackText = normalizeTextInput(String(payload.text || "")).trim();
  const detailContent = phase === "result" && output
    ? formatToolOutputText(name, output)
    : Object.keys(args).length
      ? "```json\n" + JSON.stringify(args, null, 2) + "\n```"
      : fallbackText;

  if (detailContent) {
    renderMessageBody(detailsBody, detailContent);
  } else {
    expandBtn.disabled = true;
    expandBtn.style.display = "none";
    expandBtn.setAttribute("tabindex", "-1");
    expandBtn.setAttribute("aria-hidden", "true");
  }

  expandBtn.addEventListener("click", () => {
    if (expandBtn.disabled) return;
    const isOpen = details.classList.toggle("is-open");
    expandBtn.setAttribute("aria-expanded", String(isOpen));
  });
}

function updateToolRow(row, payload) {
  if (!(row instanceof HTMLElement)) {
    return;
  }
  const status = String(payload.status || "ok").toLowerCase();

  const statusIcon = row.querySelector("[data-tool-status]");
  if (statusIcon) {
    statusIcon.className = `tool-call-status-icon tool-status-${status}`;
    statusIcon.setAttribute("data-tool-status", status);
    statusIcon.innerHTML = buildToolStatusSvg(status);
  }

  if (payload.output) {
    const name = normalizeLegacyToolName(String(payload.name || "tool"));
    const detailsEl = row.querySelector("[data-tool-details]");
    const bodyEl = row.querySelector("[data-tool-details] [data-message-body]");
    if (bodyEl) {
      renderMessageBody(bodyEl, formatToolOutputText(name, payload.output));
    }
    const expandBtn = row.querySelector(".tool-expand-btn");
    if (expandBtn && expandBtn.style.display === "none") {
      expandBtn.disabled = false;
      expandBtn.style.display = "";
      expandBtn.removeAttribute("tabindex");
      expandBtn.removeAttribute("aria-hidden");
    }
    // Плавно раскрываем детали при получении результата
    if (detailsEl && bodyEl?.textContent.trim()) {
      requestAnimationFrame(() => {
        detailsEl.classList.add("is-open");
        expandBtn?.setAttribute("aria-expanded", "true");
      });
    }
  }

  const meta = row.querySelector("[data-message-meta]");
  if (meta) {
    meta.textContent = String(payload.meta_suffix || `инструмент • ${status}`);
    meta.classList.remove("hidden");
  }
}

function formatToolOutputText(name, output) {
  if (!output || typeof output !== "object") return String(output || "");
  if (output.error) return `**Ошибка:** ${output.error}`;

  if (name === "chat.set_mood") {
    const MOOD_LABELS = {
      neutral:     "Нейтральное",
      waiting:     "Ожидание",
      thinking:    "Размышление",
      planning:    "Планирование",
      coding:      "Разработка",
      researching: "Исследование",
      creative:    "Творчество",
      success:     "Успех",
      error:       "Ошибка",
      warning:     "Предупреждение",
      friendly:    "Дружелюбное",
      offline:     "Офлайн",
    };
    const mood = String(output.mood || "").trim().toLowerCase();
    const label = MOOD_LABELS[mood] || mood || "—";
    return `**Состояние изменено:** ${label}`;
  }

  if (name === "system.time") {
    const time = String(output.time || output.datetime || "").trim();
    const tz = String(output.timezone || output.tz || "").trim();
    const lines = [];
    if (time) lines.push(`**Время:** ${time}`);
    if (tz) lines.push(`**Часовой пояс:** ${tz}`);
    return lines.join("\n") || "**Системное время**";
  }

  if (name === "web.search.duckduckgo") {
    const query = String(output.query || "").trim();
    const results = Array.isArray(output.results) ? output.results : [];
    const lines = [];
    if (query) {
      lines.push(`**Поиск:** ${query}`);
    } else {
      lines.push("**Поиск по интернету**");
    }
    if (!results.length) {
      lines.push("_Ничего не найдено._");
      return lines.join("\n");
    }
    lines.push("");
    results.slice(0, 8).forEach((item, index) => {
      const title = String(item?.title || "").trim() || `Результат ${index + 1}`;
      const url = String(item?.url || "").trim();
      if (url) {
        lines.push(`${index + 1}. [${title}](${url})`);
      } else {
        lines.push(`${index + 1}. ${title}`);
      }
    });
    return lines.join("\n");
  }

  if (name === "web.visit.website") {
    const title = String(output.title || "").trim();
    const url = String(output.url || output.requested_url || "").trim();
    const content = normalizeTextInput(String(output.content || "")).trim();
    const links = Array.isArray(output.links) ? output.links : [];
    const lines = [];

    if (title && url) {
      lines.push(`**Страница:** [${title}](${url})`);
    } else if (url) {
      lines.push(`**Страница:** ${url}`);
    } else if (title) {
      lines.push(`**Страница:** ${title}`);
    } else {
      lines.push("**Открытие страницы**");
    }

    if (content) {
      lines.push("");
      lines.push(content.length > 2200 ? `${content.slice(0, 2199)}…` : content);
    }

    if (links.length) {
      lines.push("");
      lines.push("**Ссылки:**");
      links.slice(0, 10).forEach((link) => {
        const safeLink = String(link || "").trim();
        if (safeLink) {
          lines.push(`- ${safeLink}`);
        }
      });
    }

    return lines.join("\n").trim();
  }

  const json = JSON.stringify(output, null, 2);
  return "```json\n" + (json.length > 2000 ? json.slice(0, 2000) + "\n…" : json) + "\n```";
}

function appendMessage(role, text, metaSuffix = "", options = {}) {
  if (!elements.chatStream) {
    return null;
  }
  const emptyState = elements.chatStream.querySelector("[data-chat-empty='true']");
  if (emptyState instanceof HTMLElement) {
    emptyState.remove();
  }

  const persist = Boolean(options?.persist);
  const animate = options?.animate !== false;
  const autoScroll = options?.autoScroll !== false;
  const animationDelayMs = Math.max(0, Number(options?.animationDelayMs || 0));
  const chatId = String(options?.chatId || activeChatSessionId || "");
  const timestamp = options?.timestamp ? new Date(options.timestamp) : new Date();
  const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  const resolvedRole = role in roleStyleMap ? role : "assistant";
  const pending = Boolean(options?.pending && resolvedRole === "assistant");
  const pendingLabel = String(options?.pendingLabel || ASSISTANT_PENDING_LABEL);
  const roleStyle = roleStyleMap[resolvedRole] || roleStyleMap.assistant;
  let messageId = String(options?.messageId || "").trim();

  const wrapper = document.createElement("article");
  const shouldAnimate = Boolean(isMotionEnabled() && animate);
  wrapper.className = `message-row${shouldAnimate ? " animate-rise-in" : ""}`;
  if (shouldAnimate && animationDelayMs > 0) {
    wrapper.style.animationDelay = `${animationDelayMs}ms`;
  }
  wrapper.dataset.role = resolvedRole;
  if (pending) {
    wrapper.dataset.pending = "true";
  }
  if (chatId) {
    wrapper.dataset.chatId = chatId;
  }

  if (resolvedRole === "tool") {
    const payload = options.toolPayload;
    if (payload) {
      buildToolCardInto(wrapper, payload, options.toolPhase || "result");
    } else {
      // Фоллбек для истории: парсим текст
      const rawText = String(text || "").trim();
      const [titleLine, ...detailLines] = rawText.split("\n");
      const rawToolName = String(titleLine || "").replace(/^вызов( инструмента)?\s*[:\-]?\s*/i, "").trim() || rawText || "Инструмент";
      const toolName = normalizeLegacyToolName(rawToolName);
      const detailsText = normalizeTextInput(detailLines.join("\n")).trim();
      const searchQueryMatch = rawToolName.match(/^(?:web\.search\.duckduckgo|поиск)\s*:\s*(.+)$/i);
      const visitUrlMatch = rawToolName.match(/^(?:web\.visit\.website|страница)\s*:\s*(.+)$/i);
      const fallbackArgs = {};
      if (toolName === "web.search.duckduckgo" && searchQueryMatch?.[1]) {
        fallbackArgs.query = searchQueryMatch[1].trim();
      }
      if (toolName === "web.visit.website" && visitUrlMatch?.[1]) {
        fallbackArgs.url = visitUrlMatch[1].trim();
      }
      buildToolCardInto(wrapper, {
        name: toolName,
        status: "ok",
        args: fallbackArgs,
        text: detailsText || rawText,
      }, "result");
    }

    const meta = document.createElement("p");
    meta.className = "message-meta";
    meta.setAttribute("data-message-meta", "true");
    const metaText = resolveMessageMeta(roleStyle, metaSuffix, safeTimestamp);
    if (!metaText) meta.classList.add("hidden");
    else meta.textContent = metaText;
    wrapper.append(meta);
  } else {
    const card = document.createElement("div");
    card.className = roleStyle.contentClass;

    const body = document.createElement("div");
    body.className = "message-body text-sm leading-6 text-zinc-100";
    body.setAttribute("data-message-body", "true");
    if (pending) {
      body.setAttribute("data-pending", "true");
      renderPendingMessageBody(body, pendingLabel);
    } else {
      renderMessageBody(body, text);
    }

    const meta = document.createElement("p");
    meta.className = "message-meta";
    meta.setAttribute("data-message-meta", "true");
    const metaText = resolveMessageMeta(roleStyle, metaSuffix, safeTimestamp);
    if (!metaText) {
      meta.classList.add("hidden");
    } else {
      meta.textContent = metaText;
    }

    card.append(body, meta);
    wrapper.append(card);
  }
  elements.chatStream.appendChild(wrapper);
  if (autoScroll) {
    elements.chatStream.scrollTo({
      top: elements.chatStream.scrollHeight,
      behavior: isMotionEnabled() ? "smooth" : "auto",
    });
  }

  if (persist) {
    const persisted = persistChatMessage({
      chatId,
      role: wrapper.dataset.role,
      text,
      metaSuffix,
      timestamp: safeTimestamp.toISOString(),
    });
    messageId = persisted?.id || messageId;
  }

  if (messageId) {
    wrapper.dataset.messageId = messageId;
  }

  return wrapper;
}

function appendTypingIndicator() {
  if (!elements.chatStream) {
    return null;
  }

  const wrapper = document.createElement("article");
  wrapper.className = `message-row${isMotionEnabled() ? " animate-rise-in" : ""}`;
  wrapper.dataset.role = "assistant";
  wrapper.dataset.typing = "true";

  const card = document.createElement("div");
  card.className = "message-content message-content-assistant";

  const dots = document.createElement("div");
  dots.className = "typing-indicator";
  dots.innerHTML = "<span></span><span></span><span></span>";

  const meta = document.createElement("p");
  meta.className = "message-meta";
  meta.textContent = "печатает...";

  card.append(dots, meta);
  wrapper.append(card);
  elements.chatStream.appendChild(wrapper);
  elements.chatStream.scrollTo({
    top: elements.chatStream.scrollHeight,
    behavior: isMotionEnabled() ? "smooth" : "auto",
  });
  return wrapper;
}

function inferMoodFromText(text) {
  const normalized = text.toLowerCase();

  if (/offline|off-line|нет сети|no network|network down|сервер недоступ|lost connection/i.test(normalized)) {
    return "offline";
  }
  if (/error|ошиб|fail|panic|агресс/i.test(normalized)) {
    return "error";
  }
  if (/warn|warning|риск|опас|осторож|caution/i.test(normalized)) {
    return "warning";
  }
  if (/wait|ожид|think|дума|анализ/i.test(normalized)) {
    return "thinking";
  }
  if (/plan|план|roadmap|этап|шаг/i.test(normalized)) {
    return "planning";
  }
  if (/code|код|refactor|patch|фикс|исправ|bugfix|dev/i.test(normalized)) {
    return "coding";
  }
  if (/research|исслед|поиск|browse|документац|источник|lookup/i.test(normalized)) {
    return "researching";
  }
  if (/idea|креатив|brainstorm|концепт|дизайн/i.test(normalized)) {
    return "creative";
  }
  if (/success|готово|done|ok|отлично/i.test(normalized)) {
    return "success";
  }
  if (/friend|друж|hello|привет|спасибо/i.test(normalized)) {
    return "friendly";
  }

  return "neutral";
}

const DRAFT_REPLIES = {
  offline:     "Похоже на офлайн-сценарий. Переключаю фон в режим недоступности и продолжаю с локальным контекстом.",
  error:       "Понял. Включаю состояние ошибки для визуального сигнала и фиксирую инцидент в контексте.",
  warning:     "Есть потенциальный риск. Перевожу интерфейс в предупреждающее состояние до подтверждения действий.",
  planning:    "Принято. Начинаю декомпозицию задачи и отмечаю режим планирования.",
  coding:      "Вхожу в инженерный цикл: анализ, правки, проверка. Фон переключён в режим кодинга.",
  researching: "Фиксирую исследовательский режим: собираю источники и сопоставляю факты.",
  creative:    "Включаю творческий режим. Подготовлю несколько вариаций и выберем лучший вариант.",
  thinking:    "Запрос принят. Оставляю состояние размышления до завершения расчётов и проверки файлов.",
  success:     "Отлично, операция отмечена как успешная. Переключаю фон в состояние успеха.",
  friendly:    "Держу дружелюбный режим. При необходимости могу переключиться в рабочее или аварийное состояние.",
};

function draftAssistantReply(userText) {
  const mood = inferMoodFromText(userText);
  return {
    text: DRAFT_REPLIES[mood] || "Контекст обновлён. Могу принять состояние от вызова инструмента через botMood API.",
    mood,
  };
}

function parseBackendResponse(response, fallbackText) {
  if (typeof response === "string") {
    return {
      text: response,
      mood: inferMoodFromText(response),
      toolEvents: [],
      chatTitle: "",
    };
  }

  const text = response?.reply || response?.message || response?.output || response?.result || fallbackText;
  const mood = String(response?.mood || inferMoodFromText(text || fallbackText)).toLowerCase();
  const chatTitle = String(response?.chat_title || response?.chatTitle || "").trim();
  const toolEvents = Array.isArray(response?.tool_events)
    ? response.tool_events
    : Array.isArray(response?.toolEvents)
      ? response.toolEvents
      : [];

  return {
    text: String(text || fallbackText),
    mood,
    toolEvents,
    chatTitle,
  };
}

function buildBackendChatPayload(userText, chatId = activeChatSessionId, attachments = []) {
  const targetChatSession = getChatSessionById(chatId || activeChatSessionId);
  const safeAttachments = Array.isArray(attachments)
    ? attachments
      .map((item) => (item && typeof item === "object" ? {
        id: String(item.id || ""),
        name: String(item.name || ""),
        kind: String(item.kind || "file"),
        mimeType: String(item.mimeType || ""),
        size: Number(item.size || 0),
        textContent: String(item.textContent || ""),
        dataUrl: String(item.dataUrl || ""),
      } : null))
      .filter(Boolean)
    : [];
  return {
    message: userText,
    attachments: safeAttachments,
    context: {
      chat_id: chatId || "default",
      chat_title: targetChatSession?.title || "",
      mood: background.getCurrentMood().name,
      user: {
        name: runtimeConfig.userName,
        context: runtimeConfig.userContext,
        language: runtimeConfig.userLanguage,
        timezone: runtimeConfig.userTimezone,
      },
      ui: {
        density: runtimeConfig.uiDensity,
        animations: runtimeConfig.uiAnimations,
        modelTier: runtimeConfig.modelTier,
        modelId: runtimeConfig.modelId,
        contextWindow: runtimeConfig.modelContextWindow,
        maxTokens: runtimeConfig.modelMaxTokens,
        temperature: runtimeConfig.modelTemperature,
        topP: runtimeConfig.modelTopP,
        topK: runtimeConfig.modelTopK,
      },
      history: getChatHistoryForBackend(BACKEND_HISTORY_MAX_MESSAGES),
    },
  };
}

function extractStreamErrorMessage(payload) {
  if (!payload) {
    return "неизвестная ошибка потока";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail.trim();
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return "неизвестная ошибка потока";
  }
}

function formatToolStreamMessage(eventPayload = {}, phase = "result") {
  const name = String(eventPayload?.name || "tool").trim();
  const status = String(eventPayload?.status || (phase === "start" ? "running" : "ok")).trim().toLowerCase();
  const text = normalizeTextInput(String(eventPayload?.text || "")).trim();
  const args = eventPayload?.args && typeof eventPayload.args === "object"
    ? eventPayload.args
    : {};

  const fallbackText = phase === "start"
    ? `${name}\nЗапуск инструмента.\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``
    : name;

  return {
    invocationId: String(eventPayload?.invocation_id || "").trim(),
    text: text || fallbackText,
    metaSuffix: String(eventPayload?.meta_suffix || `инструмент • ${status || "ok"}`).trim(),
  };
}

function chunkTextForPreview(text, maxChunk = 42) {
  const normalized = normalizeTextInput(text);
  const parts = normalized.match(/\S+\s*|\s+/g) || [normalized];
  const chunks = [];
  let buffer = "";
  parts.forEach((part) => {
    const next = buffer + part;
    if (buffer && next.length > maxChunk) {
      chunks.push(buffer);
      buffer = part;
    } else {
      buffer = next;
    }
  });
  if (buffer) {
    chunks.push(buffer);
  }
  return chunks;
}

async function requestAssistantReply(
  userText,
  chatId = activeChatSessionId,
  { onPartial, onToolEvent, signal, attachments = [] } = {},
) {
  let streamedText = "";
  let streamError = "";
  let donePayload = null;
  let pendingStreamDelta = "";
  let streamFlushTimer = 0;

  const resolveIncomingDelta = (incomingText) => {
    const incoming = String(incomingText || "");
    if (!incoming) {
      return "";
    }
    const current = `${streamedText}${pendingStreamDelta}`;
    if (!current) {
      return incoming;
    }
    if (incoming.startsWith(current)) {
      return incoming.slice(current.length);
    }
    if (current.endsWith(incoming) || current.includes(incoming)) {
      return "";
    }
    const maxOverlap = Math.min(current.length, incoming.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      if (current.endsWith(incoming.slice(0, overlap))) {
        return incoming.slice(overlap);
      }
    }
    return incoming;
  };

  const flushStreamDeltaStep = () => {
    streamFlushTimer = 0;
    if (!pendingStreamDelta) {
      return;
    }
    const chunkSize = 1;
    streamedText += pendingStreamDelta.slice(0, chunkSize);
    pendingStreamDelta = pendingStreamDelta.slice(chunkSize);
    onPartial?.(streamedText);
    if (pendingStreamDelta) {
      streamFlushTimer = window.setTimeout(flushStreamDeltaStep, 6);
    }
  };

  const queueStreamDelta = (deltaText) => {
    const safeDelta = resolveIncomingDelta(deltaText);
    if (!safeDelta) {
      return;
    }
    pendingStreamDelta += safeDelta;
    if (!streamFlushTimer) {
      flushStreamDeltaStep();
    }
  };

  const flushAllStreamDelta = () => {
    if (streamFlushTimer) {
      window.clearTimeout(streamFlushTimer);
      streamFlushTimer = 0;
    }
    if (!pendingStreamDelta) {
      return;
    }
    streamedText += pendingStreamDelta;
    pendingStreamDelta = "";
    onPartial?.(streamedText);
  };

  if (runtimeConfig.mode !== "backend") {
    const draft = {
      ...draftAssistantReply(userText),
      metaSuffix: "симуляция",
    };
    const previewChunks = chunkTextForPreview(draft.text, 28);
    let partial = "";
    // В симуляции тоже показываем инкрементальный вывод, чтобы UX совпадал с backend-режимом.
    for (const chunk of previewChunks) {
      partial += chunk;
      onPartial?.(partial);
      await new Promise((resolve) => {
        window.setTimeout(resolve, 45);
      });
    }
    return draft;
  }

  try {
    updateConnectionState(BACKEND_STATUS.checking, "Отправка запроса /chat/stream ...");
    const requestPayload = buildBackendChatPayload(userText, chatId, attachments);

    await backendClient.sendMessageStream(requestPayload, {
      signal,
      onStart: () => {
        updateConnectionState(BACKEND_STATUS.checking, "Поток ответа запущен...");
      },
      onToolStart: (payload) => {
        onToolEvent?.({
          phase: "start",
          payload: payload || {},
        });
      },
      onToolResult: (payload) => {
        onToolEvent?.({
          phase: "result",
          payload: payload || {},
        });
      },
      onStatus: (payload) => {
        const message = String(payload?.message || "").trim();
        if (message) {
          updateConnectionState(BACKEND_STATUS.checking, message);
        }
      },
      onDelta: (deltaPayload) => {
        const delta = String(deltaPayload?.text || "");
        if (!delta) {
          return;
        }
        queueStreamDelta(delta);
      },
      onDone: (payload) => {
        donePayload = payload || {};
      },
      onError: (payload) => {
        streamError = extractStreamErrorMessage(payload);
      },
    });

    flushAllStreamDelta();

    if (streamError) {
      throw new Error(streamError);
    }
    if (!donePayload && !streamedText) {
      throw new Error("Поток ответа завершился без данных (/chat/stream)");
    }

    const finalPayload = donePayload || {
      reply: streamedText,
      mood: inferMoodFromText(streamedText),
      model: "backend-stream",
    };
    updateConnectionState(BACKEND_STATUS.connected, "Поток ответа завершён");
    const parsed = parseBackendResponse(finalPayload, streamedText || "Бэкенд вернул пустой ответ.");
    if (streamedText && !parsed.text) {
      parsed.text = streamedText;
    }
    return {
      ...parsed,
      metaSuffix: "бэкенд",
    };
  } catch (error) {
    flushAllStreamDelta();

    if (error?.code === "ABORTED" || /REQUEST_ABORTED/.test(String(error?.message || ""))) {
      return {
        text: streamedText,
        mood: "neutral",
        metaSuffix: "остановлено",
        cancelled: true,
      };
    }

    const streamErrorMessage = String(error?.message || "");
    const isStreamTransportIssue = /HTTP \d+/.test(streamErrorMessage)
      || /Поток ответа недоступен/i.test(streamErrorMessage)
      || /\/chat\/stream/i.test(streamErrorMessage);
    if (isStreamTransportIssue) {
      try {
        const payload = await backendClient.sendMessage(buildBackendChatPayload(userText, chatId, attachments));
        const parsed = parseBackendResponse(payload, "Бэкенд вернул пустой ответ.");
        if (Array.isArray(parsed.toolEvents)) {
          parsed.toolEvents.forEach((toolEvent, index) => {
            onToolEvent?.({
              phase: "result",
              payload: {
                invocation_id: `fallback-${index + 1}`,
                name: toolEvent?.name || "tool",
                status: toolEvent?.status || "ok",
                output: toolEvent?.output || {},
                text: String(toolEvent?.name || "tool"),
                meta_suffix: `инструмент • ${String(toolEvent?.status || "ok").toLowerCase()}`,
              },
            });
          });
        }
        onPartial?.(parsed.text);
        updateConnectionState(BACKEND_STATUS.connected, "Ответ получен от бэкенда");
        return {
          ...parsed,
          metaSuffix: "бэкенд",
        };
      } catch (fallbackError) {
        error = fallbackError;
      }
    }

    const detail = String(error?.message || "неизвестная ошибка");
    updateConnectionState(BACKEND_STATUS.error, `Ошибка бэкенда: ${detail}`);
    pushToast(`Бэкенд недоступен: ${detail}`, { tone: "error", durationMs: 3600 });
    return {
      text: `Не удалось получить ответ модели: ${detail}`,
      mood: "error",
      metaSuffix: "ошибка бэкенда",
    };
  } finally {
    if (streamFlushTimer) {
      window.clearTimeout(streamFlushTimer);
      streamFlushTimer = 0;
    }
  }
}

let activeGeneration = null;
let composerAttachments = [];
const MAX_COMPOSER_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TEXT_CHARS = 8000;
const MAX_IMAGE_DATA_URL_CHARS = 140000;

function classifyAttachmentKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const mimeType = String(file?.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (
    mimeType.startsWith("text/")
    || mimeType.includes("json")
    || mimeType.includes("xml")
    || mimeType.includes("yaml")
    || mimeType.includes("csv")
    || /\.(txt|md|markdown|json|csv|xml|ya?ml|html?|js|ts|py|java|go|rs|c|cpp|h)$/i.test(name)
  ) {
    return "text";
  }
  if (/\.(pdf|doc|docx|rtf|odt)$/i.test(name)) {
    return "document";
  }
  return "file";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read_error"));
    reader.readAsDataURL(file);
  });
}

async function buildComposerAttachment(file) {
  const kind = classifyAttachmentKind(file);
  const attachment = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(file?.name || "file"),
    kind,
    mimeType: String(file?.type || ""),
    size: Number(file?.size || 0),
    textContent: "",
    dataUrl: "",
  };

  if (kind === "text") {
    try {
      const text = await file.text();
      attachment.textContent = normalizeTextInput(text).slice(0, MAX_ATTACHMENT_TEXT_CHARS);
    } catch (error) {
      attachment.textContent = "";
    }
  } else if (kind === "image") {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      attachment.dataUrl = String(dataUrl || "").slice(0, MAX_IMAGE_DATA_URL_CHARS);
    } catch (error) {
      attachment.dataUrl = "";
    }
  }
  return attachment;
}

function renderComposerAttachments() {
  if (!(elements.composerAttachmentsList instanceof HTMLElement)) {
    return;
  }
  if (!composerAttachments.length) {
    elements.composerAttachmentsList.classList.add("hidden");
    elements.composerAttachmentsList.innerHTML = "";
    return;
  }

  elements.composerAttachmentsList.classList.remove("hidden");
  elements.composerAttachmentsList.innerHTML = composerAttachments
    .map((item) => {
      const label = String(item?.name || "file");
      const kind = String(item?.kind || "file");
      return `
        <span class="inline-flex items-center gap-2 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1 text-xs text-zinc-200">
          <span>${label}</span>
          <span class="text-zinc-400">${kind}</span>
          <button
            type="button"
            data-attachment-remove="${item.id}"
            class="icon-button h-5 w-5 rounded-full border border-zinc-600/40 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-700/80"
            aria-label="Удалить вложение"
            title="Удалить вложение"
          >
            ${icon("x-mark")}
          </button>
        </span>
      `;
    })
    .join("");
}

async function queueComposerAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) {
    return;
  }
  const slotsLeft = Math.max(0, MAX_COMPOSER_ATTACHMENTS - composerAttachments.length);
  const selected = files.slice(0, slotsLeft);
  if (selected.length < files.length) {
    pushToast(`Можно прикрепить не более ${MAX_COMPOSER_ATTACHMENTS} файлов за раз.`, {
      tone: "warning",
      durationMs: 3200,
    });
  }

  let warnedAboutVision = false;
  for (const file of selected) {
    const item = await buildComposerAttachment(file);
    composerAttachments.push(item);
    if (!warnedAboutVision && item.kind === "image" && !/qwen3-vl/i.test(String(runtimeConfig.modelId || ""))) {
      warnedAboutVision = true;
      pushToast("Текущая модель может не анализировать изображения. Для фото лучше выбрать vision-модель.", {
        tone: "warning",
        durationMs: 3600,
      });
    }
  }
  renderComposerAttachments();
  syncComposerState();
}

function collectComposerAttachmentsSnapshot() {
  return composerAttachments.map((item) => ({ ...item }));
}

function clearComposerAttachments() {
  composerAttachments = [];
  if (elements.composerAttachmentsInput instanceof HTMLInputElement) {
    elements.composerAttachmentsInput.value = "";
  }
  renderComposerAttachments();
}

function setComposerSubmitMode(mode = "send") {
  if (!(elements.composerSubmit instanceof HTMLButtonElement)) {
    return;
  }
  if (mode === "stop") {
    elements.composerSubmit.innerHTML = icon("stop");
    elements.composerSubmit.setAttribute("aria-label", "Остановить генерацию");
    elements.composerSubmit.setAttribute("title", "Остановить генерацию");
    elements.composerSubmit.classList.add("bg-amber-200");
    elements.composerSubmit.classList.remove("bg-zinc-100");
    return;
  }
  elements.composerSubmit.innerHTML = icon("send");
  elements.composerSubmit.setAttribute("aria-label", "Отправить сообщение");
  elements.composerSubmit.setAttribute("title", "Отправить сообщение");
  elements.composerSubmit.classList.remove("bg-amber-200");
  elements.composerSubmit.classList.add("bg-zinc-100");
}

function isGenerationActiveForChat(chatId = activeChatSessionId) {
  if (!activeGeneration) {
    return false;
  }
  const generationChatId = String(activeGeneration.chatId || "");
  const targetChatId = String(chatId || "");
  return generationChatId === targetChatId;
}

function syncComposerState() {
  const rawValue = elements.composerInput?.value || "";
  const hasText = rawValue.trim().length > 0;
  const hasAttachments = composerAttachments.length > 0;
  const stopMode = isGenerationActiveForChat();
  const canSubmit = stopMode ? true : (hasText || hasAttachments);
  if (elements.composerSubmit) {
    elements.composerSubmit.disabled = !canSubmit;
    elements.composerSubmit.setAttribute("aria-disabled", String(!canSubmit));
    elements.composerSubmit.classList.toggle("opacity-60", !canSubmit);
  }
  if (elements.composerForm instanceof HTMLElement) {
    elements.composerForm.setAttribute("aria-busy", String(stopMode));
  }
  setComposerSubmitMode(stopMode ? "stop" : "send");
}

async function stopActiveGeneration({ silent = false } = {}) {
  if (!activeGeneration) {
    return false;
  }
  const generation = activeGeneration;
  activeGeneration = null;
  generation.stoppedByUser = true;

  let stopPromise = Promise.resolve(null);
  if (runtimeConfig.mode === "backend") {
    stopPromise = backendClient.stopChatGeneration();
  }
  generation.abortController?.abort();

  if (generation.assistantRow instanceof HTMLElement) {
    const rowBody = generation.assistantRow.querySelector("[data-message-body]");
    const isPending = generation.assistantRow.dataset.pending === "true";
    const hasText = !isPending && rowBody instanceof HTMLElement && rowBody.textContent?.trim();
    if (!hasText) {
      generation.assistantRow.remove();
    } else {
      const finalStoppedText = generation.latestText || "Генерация остановлена.";
      updateMessageRowContent(generation.assistantRow, {
        text: finalStoppedText,
        metaSuffix: "остановлено",
        timestamp: new Date(),
      });
      if (!generation.assistantRow.dataset.messageId) {
        const persisted = persistChatMessage({
          chatId: generation.assistantRow.dataset.chatId || generation.chatId || activeChatSessionId || "",
          role: "assistant",
          text: finalStoppedText,
          metaSuffix: "остановлено",
          timestamp: new Date().toISOString(),
        });
        if (persisted?.id) {
          generation.assistantRow.dataset.messageId = persisted.id;
        }
      }
    }
  }

  syncComposerState();
  updateConnectionState(BACKEND_STATUS.idle, "Генерация остановлена");
  if (!silent) {
    pushToast("Генерация остановлена.", { tone: "neutral", durationMs: 1800 });
  }
  if (runtimeConfig.mode === "backend") {
    void stopPromise.catch((error) => {
      if (!silent) {
        pushToast(`Не удалось отправить stop на сервер: ${error.message}`, {
          tone: "warning",
          durationMs: 3200,
        });
      }
    });
  }
  return true;
}

elements.composerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const rawValue = normalizeTextInput(elements.composerInput?.value || "");
  const hasDraft = rawValue.trim().length > 0;
  const hasAttachments = composerAttachments.length > 0;
  const attachmentsSnapshot = hasAttachments ? collectComposerAttachmentsSnapshot() : [];
  const effectiveText = hasDraft ? rawValue : (hasAttachments ? "Проанализируй вложения пользователя." : "");
  if (activeGeneration) {
    if (!isGenerationActiveForChat() && !hasDraft && !hasAttachments) {
      syncComposerState();
      return;
    }
    await stopActiveGeneration(hasDraft ? { silent: true } : {});
    if (!hasDraft && !hasAttachments) return;
  }

  if (!hasDraft && !hasAttachments) {
    syncComposerState();
    return;
  }

  const userMessageText = hasAttachments
    ? `${effectiveText}\n\nВложения:\n${attachmentsSnapshot.map((item, index) => (
      `${index + 1}. ${String(item.name || "file")} (${String(item.kind || "file")})`
    )).join("\n")}`
    : effectiveText;
  ensureSessionForOutgoingMessage(userMessageText);
  appendMessage("user", userMessageText, "", { persist: true });
  if (elements.composerInput) elements.composerInput.value = "";
  clearComposerAttachments();
  syncComposerState();

  const requestSessionId = activeChatSessionId || ensureSessionForOutgoingMessage(userMessageText);
  const savedMood = getChatSessionMood(requestSessionId) || "neutral";

  applyTransientMood(requestSessionId, "waiting", 420);
  if (!requestSessionId) background.setMood("waiting", 420);
  const initialMetaSuffix = runtimeConfig.mode === "backend" ? "бэкенд" : "симуляция";
  const assistantRow = appendMessage("assistant", "", initialMetaSuffix, {
    persist: false,
    chatId: requestSessionId,
    pending: true,
    pendingLabel: ASSISTANT_PENDING_LABEL,
  });
  const abortController = new AbortController();
  const generationId = Date.now() + Math.random();
  activeGeneration = {
    id: generationId,
    chatId: requestSessionId || "",
    assistantRow,
    abortController,
    latestText: "",
    stoppedByUser: false,
  };
  syncComposerState();

  let latestPartial = "";
  const seenToolInvocations = new Set();
  const toolRowsByInvocationId = new Map();
  let lastInsertedToolRow = null;

  const insertToolRowAfterAssistant = (row) => {
    if (row instanceof HTMLElement && assistantRow instanceof HTMLElement
      && assistantRow.parentNode === elements.chatStream) {
      const anchor = lastInsertedToolRow instanceof HTMLElement ? lastInsertedToolRow : assistantRow;
      if (anchor.parentNode === elements.chatStream && anchor.nextSibling) {
        elements.chatStream.insertBefore(row, anchor.nextSibling);
      } else {
        elements.chatStream.appendChild(row);
      }
      lastInsertedToolRow = row;
    }
  };

  const appendAndInsertToolRow = (payload, phase) => {
    const metaDefault = phase === "start" ? "инструмент • запуск" : "инструмент • ok";
    const row = appendMessage("tool", payload.name, String(payload.meta_suffix || metaDefault), {
      persist: false,
      chatId: requestSessionId,
      toolPayload: payload,
      toolPhase: phase,
    });
    insertToolRowAfterAssistant(row);
    return row;
  };

  try {
    const reply = await requestAssistantReply(effectiveText, requestSessionId, {
      signal: abortController.signal,
      attachments: attachmentsSnapshot,
      onToolEvent: (eventPayload) => {
        const phase = eventPayload?.phase === "start" ? "start" : "result";
        const rawPayload = eventPayload?.payload || {};
        const normalizedToolName = normalizeLegacyToolName(String(rawPayload.name || "").trim());
        const payload = {
          ...rawPayload,
          name: normalizedToolName,
        };
        if (!payload.name || requestSessionId !== activeChatSessionId) return;

        const invId = String(payload.invocation_id || "").trim();
        const toolStatus = String(payload.status || "").toLowerCase();
        const toolMeta = resolveToolMeta(payload.name);

        if (phase === "start") {
          if (invId && seenToolInvocations.has(invId)) return;
          if (invId) seenToolInvocations.add(invId);
          const row = appendAndInsertToolRow(payload, "start");
          if (row && invId) toolRowsByInvocationId.set(invId, row);
          applyTransientMood(requestSessionId, "researching", 220);
        } else if (invId && toolRowsByInvocationId.has(invId)) {
          updateToolRow(toolRowsByInvocationId.get(invId), payload);
          elements.chatStream?.scrollTo({ top: elements.chatStream.scrollHeight, behavior: "auto" });
        } else {
          const row = appendAndInsertToolRow(payload, "result");
          if (row && invId) {
            toolRowsByInvocationId.set(invId, row);
          }
        }

        if (phase === "result" && payload.name === "chat.set_mood" && toolStatus !== "error") {
          const newMood = String(payload.output?.mood || payload.args?.mood || "").trim();
          if (newMood && requestSessionId) {
            setChatSessionMood(requestSessionId, newMood, runtimeConfig.defaultTransitionMs);
          }
        } else if (phase === "result") {
          applyTransientMood(requestSessionId, "waiting", 220);
        }

        updateConnectionState(
          BACKEND_STATUS.checking,
          phase === "start"
            ? `Вызов: ${toolMeta.displayName}...`
            : `${toolMeta.displayName} (${toolStatus || "ok"})`,
        );
      },
      onPartial: (partialText) => {
        latestPartial = normalizeTextInput(partialText);
        if (activeGeneration && activeGeneration.id === generationId) {
          activeGeneration.latestText = latestPartial;
        }
        if (assistantRow) {
          const hasPartialText = latestPartial.trim().length > 0;
          updateMessageRowContent(assistantRow, {
            text: hasPartialText ? latestPartial : "",
            metaSuffix: initialMetaSuffix,
            timestamp: new Date(),
            pending: !hasPartialText,
            pendingLabel: ASSISTANT_PENDING_LABEL,
          });
        }
        if (requestSessionId && /<think>|<thinking>|\bthink|дум|размыш/i.test(latestPartial)) {
          applyTransientMood(requestSessionId, "thinking", 180);
        }
        elements.chatStream?.scrollTo({
          top: elements.chatStream.scrollHeight,
          behavior: "auto",
        });
      },
    });

    if (reply?.cancelled) {
      applyTransientMood(requestSessionId, getChatSessionMood(requestSessionId) || savedMood, runtimeConfig.defaultTransitionMs);
      if (isBackendRuntimeEnabled()) {
        await syncChatStoreFromBackend({
          preserveActive: true,
          preferredActiveId: requestSessionId,
          silent: true,
        });
      }
      return;
    }

    const finalText = normalizeTextInput(reply.text || latestPartial || "Бэкенд вернул пустой ответ.");
    const finalMetaSuffix = String(reply.metaSuffix || initialMetaSuffix);
    const generatedChatTitle = sanitizeSessionTitle(String(reply.chatTitle || "").trim(), "");
    if (requestSessionId && generatedChatTitle) {
      renameChatSessionById(requestSessionId, generatedChatTitle);
    }

    const finalToolEvents = Array.isArray(reply.toolEvents) ? reply.toolEvents : [];
    finalToolEvents.forEach((eventItem) => {
      const toolName = normalizeLegacyToolName(String(eventItem?.name || "tool"));
      const toolStatus = String(eventItem?.status || "ok").trim().toLowerCase() || "ok";
      const toolOutput = eventItem?.output && typeof eventItem.output === "object" ? eventItem.output : {};
      const toolText = formatToolOutputText(toolName, toolOutput) || toolName;
      persistChatMessage({
        chatId: requestSessionId,
        role: "tool",
        text: toolText,
        metaSuffix: `инструмент • ${toolStatus}`,
        meta: {
          tool_name: toolName,
          status: toolStatus,
          tool_output: toolOutput,
          tool_args: {},
        },
        timestamp: new Date().toISOString(),
      });
    });

    if (assistantRow) {
      updateMessageRowContent(assistantRow, {
        text: finalText,
        metaSuffix: finalMetaSuffix,
        timestamp: new Date(),
      });
    }

    const persisted = persistChatMessage({
      chatId: requestSessionId,
      role: "assistant",
      text: finalText,
      metaSuffix: finalMetaSuffix,
      timestamp: new Date().toISOString(),
    });
    if (assistantRow && persisted?.id) {
      assistantRow.dataset.messageId = persisted.id;
    }

    const finalMood = String(reply.mood || "").trim();
    if (requestSessionId) {
      const currentSessionMood = getChatSessionMood(requestSessionId);
      const toolChangedMood = currentSessionMood && currentSessionMood !== savedMood;
      if (!toolChangedMood && finalMood && finalMood !== "neutral" && finalMood !== "waiting" && finalMood !== "thinking") {
        setChatSessionMood(requestSessionId, finalMood, runtimeConfig.defaultTransitionMs);
      } else {
        applyTransientMood(requestSessionId, currentSessionMood || savedMood, runtimeConfig.defaultTransitionMs);
      }
      if (isBackendRuntimeEnabled()) {
        await syncChatStoreFromBackend({
          preserveActive: true,
          preferredActiveId: requestSessionId,
          silent: true,
        });
      }
    } else {
      background.setMood(finalMood || "neutral", runtimeConfig.defaultTransitionMs);
    }
  } finally {
    if (!activeGeneration || activeGeneration.id === generationId) {
      activeGeneration = null;
      syncComposerState();
    }
  }
});

elements.composerAttachButton?.addEventListener("click", () => {
  if (isGenerationActiveForChat()) {
    return;
  }
  elements.composerAttachmentsInput?.click();
});

elements.composerAttachmentsInput?.addEventListener("change", async () => {
  const input = elements.composerAttachmentsInput;
  const files = input?.files;
  if (!files || files.length === 0) {
    return;
  }
  await queueComposerAttachments(files);
  if (input) {
    input.value = "";
  }
});

elements.composerAttachmentsList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest("[data-attachment-remove]")
    : null;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const attachmentId = String(target.dataset.attachmentRemove || "").trim();
  if (!attachmentId) {
    return;
  }
  composerAttachments = composerAttachments.filter((item) => String(item.id || "") !== attachmentId);
  renderComposerAttachments();
  syncComposerState();
});

elements.composerInput?.addEventListener("input", () => {
  syncComposerState();
});

elements.composerInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composerForm.requestSubmit();
  }
});


function initialize() {
  chatStore = normalizeChatStore(chatStore);
  ensureActiveChatSessionInStore();
  rebuildChatSessionCounters();
  hydrateChatMoodMapFromStore();
  renderChatSessionList();
  persistCurrentChatStore();

  const initialActiveSessionButton = getChatSessionButtons()
    .find((button) => button.dataset.sessionId === chatStore.activeSessionId)
    || getChatSessionButtons()[0]
    || null;
  setActiveChatSession(initialActiveSessionButton, { renderMessages: false });
  applyChatSessionVisibilityFilter();
  renderComposerAttachments();
  syncComposerState();
  renderActiveChatMessages();
}

function isContextMenuOpen() {
  return contextMenuState.open;
}

function getActiveChatId() {
  return activeChatSessionId;
}

function listChatStates() {
  return [...chatMoodBySession.entries()].map(([chatId, payload]) => ({
    chatId,
    state: payload.state,
    updatedAt: payload.updatedAt,
  }));
}

function setCurrentChatState(state, transitionMs = runtimeConfig.defaultTransitionMs) {
  if (!activeChatSessionId) {
    return null;
  }
  return setChatSessionMood(activeChatSessionId, state, transitionMs);
}

function clearCurrentChatState(transitionMs = runtimeConfig.defaultTransitionMs) {
  if (!activeChatSessionId) {
    return;
  }
  clearChatSessionMood(activeChatSessionId, transitionMs);
}

async function clearActiveChatHistory() {
  const chatId = activeChatSessionId;
  if (!chatId) {
    return false;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.clearChatMessages(chatId),
        { preserveActive: true, preferredActiveId: chatId },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  return clearActiveChatMessages();
}

async function clearChat(chatId) {
  const targetChatId = chatId || activeChatSessionId;
  if (!targetChatId) {
    return false;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.clearChatMessages(targetChatId),
        { preserveActive: true, preferredActiveId: targetChatId },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  return clearChatMessagesById(targetChatId);
}

async function deleteChat(chatId) {
  const targetChatId = chatId || activeChatSessionId;
  if (!targetChatId) {
    return false;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.deleteChat(targetChatId),
        { preserveActive: false, preferredActiveId: "" },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  return deleteChatSessionById(targetChatId);
}

async function duplicateChat(chatId) {
  const targetChatId = chatId || activeChatSessionId;
  if (!targetChatId) {
    return null;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      const response = await backendClient.duplicateChat(targetChatId, {});
      const duplicatedId = String(response?.chat?.id || "").trim();
      const applied = tryApplyChatStoreFromMutation(response, {
        preserveActive: false,
        preferredActiveId: duplicatedId,
      });
      if (!applied) {
        await syncChatStoreFromBackend({
          preserveActive: false,
          preferredActiveId: duplicatedId,
          silent: true,
        });
      }
      return response?.chat || null;
    } catch (error) {
      return null;
    }
  }
  return duplicateChatSessionById(targetChatId);
}

async function renameActiveChat(title) {
  if (!activeChatSessionId) {
    return null;
  }
  return renameChat(activeChatSessionId, title);
}

async function renameChat(chatId, title) {
  const targetChatId = chatId || activeChatSessionId;
  if (!targetChatId) {
    return null;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      const safeTitle = sanitizeSessionTitle(title, getChatSessionById(targetChatId)?.title || "Новая сессия");
      const response = await runBackendChatMutation(
        () => backendClient.updateChat(targetChatId, { title: safeTitle }),
        { preserveActive: true, preferredActiveId: targetChatId },
      );
      return response?.chat?.title || safeTitle;
    } catch (error) {
      return null;
    }
  }
  return renameChatSessionById(targetChatId, title);
}

async function editMessage(messageId, text, chatId = activeChatSessionId) {
  if (!chatId || !messageId) {
    return false;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.updateMessage(chatId, messageId, { text }),
        { preserveActive: true, preferredActiveId: chatId },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  return editMessageById(chatId, messageId, text);
}

async function deleteMessage(messageId, chatId = activeChatSessionId) {
  if (!chatId || !messageId) {
    return false;
  }
  if (isBackendRuntimeEnabled()) {
    try {
      await runBackendChatMutation(
        () => backendClient.deleteMessage(chatId, messageId),
        { preserveActive: true, preferredActiveId: chatId },
      );
      return true;
    } catch (error) {
      return false;
    }
  }
  return deleteMessageById(chatId, messageId);
}

function exportChats() {
  return exportChatStorePayload();
}

function importChats(payload) {
  try {
    return importChatStorePayload(payload);
  } catch (error) {
    return {
      error: String(error?.message || error),
    };
  }
}

function listChats() {
  return listChatSessions();
}

return {
  initialize,
  closeContextMenu,
  isContextMenuOpen,
  applyContextualBackground,
  syncChatStoreFromBackend,
  normalizeBackgroundStateName,
  resolveContextBackgroundMood,
  setChatSessionMood,
  clearChatSessionMood,
  getChatSessionMood,
  getCurrentRouteState,
  isBackendRuntimeEnabled,
  getActiveChatId,
  getActiveChatSession,
  openContextMenu,
  executeContextMenuAction,
  setActiveChatSession,
  applyChatSessionVisibilityFilter,
  clearActiveChatMessages,
  clearChatMessagesById,
  renameChatSessionById,
  renameActiveChatSession,
  deleteChatSessionById,
  duplicateChatSessionById,
  getChatSessionById,
  sanitizeSessionTitle,
  runBackendChatMutation,
  editMessageById,
  deleteMessageById,
  exportChatStorePayload,
  importChatStorePayload,
  listChatSessions,
  listChatStates,
  setCurrentChatState,
  clearCurrentChatState,
  clearActiveChatHistory,
  clearChat,
  deleteChat,
  duplicateChat,
  renameActiveChat,
  renameChat,
  editMessage,
  deleteMessage,
  exportChats,
  importChats,
  listChats,
};
}
