export { chatPageTemplate } from "./chats/template.js";
import { normalizeTextInput } from "./ui/messageFormatter.js";
import { ASSISTANT_PENDING_LABEL, createChatMessageUi } from "./chats/messageUi.js";
import { createChatAssistantRuntime } from "./chats/assistantRuntime.js";
import { createChatComposerController } from "./chats/composerController.js";
import { createChatContextMenuActions } from "./chats/contextMenuActions.js";
import { createChatContextMenuController } from "./chats/contextMenuController.js";
import { createChatSessionStoreActions } from "./chats/sessionStoreActions.js";
import { createChatSessionUiController } from "./chats/sessionUiController.js";
import { bindChatSessionEvents } from "./chats/sessionEventBindings.js";
import { createChatStreamRenderer } from "./chats/chatStreamRenderer.js";
import { createChatBackendStoreSync } from "./chats/backendStoreSync.js";
import { createChatMoodController } from "./chats/moodController.js";
import { createChatPublicApi } from "./chats/publicApi.js";
import { createChatStoreCoordinator } from "./chats/storeCoordinator.js";
import { createChatStoreTransfer } from "./chats/storeTransfer.js";
import { createChatToolCatalog } from "./chats/toolCatalog.js";
import { createChatSessionBootstrap } from "./chats/sessionBootstrap.js";
import { createChatHolidayBannerController } from "./chats/holidayBanner.js";
import { createModalOverlayManager } from "./ui/modalOverlayManager.js";
import {
  BACKEND_HISTORY_MAX_MESSAGES,
  createChatHistoryAndPersistence,
} from "./chats/historyAndPersistence.js";

const APP_CHAT_STORE_KEY = "ancia.chat.store.v1";
const CHAT_STORE_VERSION = 1;
const CONTEXT_MENU_TRANSITION_MS = 180;

export function createChatFeature({
  elements,
  runtimeConfig,
  backendClient,
  getPluginToolRenderer,
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
  let showOnlyActiveSessions = false;
  let sessionSearchQuery = "";
  let nextSessionNumber = 1;
  let chatSessionIdSeq = 0;
  let activeChatSessionId = null;

  const chatMoodBySession = new Map();
  const storeCoordinator = createChatStoreCoordinator({
    runtimeMode: runtimeConfig.mode,
    chatStoreVersion: CHAT_STORE_VERSION,
    storageKey: APP_CHAT_STORE_KEY,
    getChatStore: () => chatStore,
    setChatStore: (store) => {
      chatStore = store;
    },
    getActiveChatSessionId: () => activeChatSessionId,
    setActiveChatSessionId: (value) => {
      activeChatSessionId = value;
    },
    getNextSessionNumber: () => nextSessionNumber,
    setNextSessionNumber: (value) => {
      nextSessionNumber = Number(value) || nextSessionNumber;
    },
    getChatSessionIdSeq: () => chatSessionIdSeq,
    setChatSessionIdSeq: (value) => {
      chatSessionIdSeq = Number(value) || 0;
    },
    chatMoodBySession,
    normalizeBackgroundStateName: (...args) => normalizeBackgroundStateName(...args),
  });
  const {
    normalizeChatMessage,
    resolveStoredToolPayload,
    normalizeChatStore,
    syncChatSessionIdSeed,
    persistCurrentChatStore,
    getChatSessionById,
    getActiveChatSession,
    updateChatSessionTimestamp,
    moveChatSessionToFront,
    ensureActiveChatSessionInStore,
    rebuildChatSessionCounters,
    hydrateChatMoodMapFromStore,
    sanitizeSessionTitle,
    createNewChatSessionRecord,
    listChatSessions,
  } = storeCoordinator;
  let chatStore = storeCoordinator.loadChatStore();

let sessionUiController = null;
let syncComposerState = null;
function ensureChatSessionIdentity(button) {
  return sessionUiController?.ensureChatSessionIdentity(button) || null;
}

function isBackendRuntimeEnabled() {
  return runtimeConfig.mode === "backend";
}

  let streamRenderer = null;
  const {
    normalizeToolName,
    lookupToolMeta,
    refreshToolCatalog,
  } = createChatToolCatalog({
    runtimeMode: runtimeConfig.mode,
    backendClient,
    pushToast,
    getStreamRenderer: () => streamRenderer,
    rerenderMessages: () => renderActiveChatMessages({ animateEntries: false, transition: false }),
  });

let applyChatStoreSnapshot = () => false;
let tryApplyChatStoreFromMutation = () => false;
let syncChatStoreFromBackend = async () => false;
let runBackendChatMutation = async () => null;
const moodController = createChatMoodController({
  runtimeConfig,
  routeBackgroundState,
  normalizeRoute,
  getRouteFromHash,
  background,
  clamp,
  getActiveChatSessionId: () => activeChatSessionId,
  getChatSessionById,
  chatMoodBySession,
  updateChatSessionTimestamp,
  persistCurrentChatStore,
});
const getCurrentRouteState = () => moodController?.getCurrentRouteState?.() || { state: "neutral" };
const normalizeBackgroundStateName = (...args) => moodController?.normalizeBackgroundStateName?.(...args) || "neutral";
const getRouteBackgroundMood = (...args) => moodController?.getRouteBackgroundMood?.(...args) || "neutral";
const applyTransientMood = (...args) => moodController?.applyTransientMood?.(...args);
const setChatSessionMood = (...args) => moodController?.setChatSessionMood?.(...args);
const clearChatSessionMood = (...args) => moodController?.clearChatSessionMood?.(...args);
const getChatSessionMood = (...args) => moodController?.getChatSessionMood?.(...args);
const resolveContextBackgroundMood = (...args) => moodController?.resolveContextBackgroundMood?.(...args);
const applyContextualBackground = (...args) => moodController?.applyContextualBackground?.(...args);

function renderChatSessionList() {
  sessionUiController?.renderChatSessionList();
}
let appendMessageFn = null;
function renderActiveChatMessages(options = {}) {
  streamRenderer?.renderActiveChatMessages(options);
}
const {
  getChatHistoryForBackend,
  persistChatMessage,
  clearActiveChatMessages: clearActiveChatMessagesRaw,
} = createChatHistoryAndPersistence({
  normalizeTextInput,
  normalizeChatMessage,
  getChatSessionById,
  getActiveChatSession,
  getActiveChatSessionId: () => activeChatSessionId,
  updateChatSessionTimestamp,
  moveChatSessionToFront,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
});
function clearActiveChatMessages() {
  const cleared = clearActiveChatMessagesRaw();
  if (cleared) {
    renderActiveChatMessages();
  }
  return cleared;
}

sessionUiController = createChatSessionUiController({
  elements,
  getChatStore: () => chatStore,
  getActiveChatSessionId: () => activeChatSessionId,
  setActiveChatSessionId: (value) => {
    activeChatSessionId = value;
  },
  getChatSessionButtons,
  getShowOnlyActiveSessions: () => showOnlyActiveSessions,
  setShowOnlyActiveSessions: (value) => {
    showOnlyActiveSessions = Boolean(value);
  },
  getChatSessionIdSeq: () => chatSessionIdSeq,
  setChatSessionIdSeq: (value) => {
    chatSessionIdSeq = value;
  },
  syncChatSessionIdSeed,
  persistCurrentChatStore,
  renderActiveChatMessages,
  isMotionEnabled,
  getCurrentRouteState,
  applyContextualBackground,
  getSyncComposerState: () => syncComposerState,
  getSessionSearchQuery: () => sessionSearchQuery,
});
const holidayBannerController = createChatHolidayBannerController({
  elements,
});

const sessionStoreActions = createChatSessionStoreActions({
  getChatStore: () => chatStore,
  getChatSessionById,
  getActiveChatSessionId: () => activeChatSessionId,
  setActiveChatSessionId: (value) => {
    activeChatSessionId = value;
  },
  getNextSessionNumber: () => nextSessionNumber,
  setNextSessionNumber: (value) => {
    nextSessionNumber = value;
  },
  getChatSessionIdSeq: () => chatSessionIdSeq,
  setChatSessionIdSeq: (value) => {
    chatSessionIdSeq = value;
  },
  createNewChatSessionRecord,
  chatMoodBySession,
  normalizeBackgroundStateName,
  sanitizeSessionTitle,
  updateChatSessionTimestamp,
  moveChatSessionToFront,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
  renderActiveChatMessages,
});

function clearChatMessagesById(chatId) {
  return sessionStoreActions.clearChatMessagesById(chatId);
}

function renameChatSessionById(chatId, nextTitle) {
  return sessionStoreActions.renameChatSessionById(chatId, nextTitle);
}

function renameActiveChatSession(nextTitle) {
  return renameChatSessionById(activeChatSessionId, nextTitle);
}

function deleteChatSessionById(chatId) {
  return sessionStoreActions.deleteChatSessionById(chatId);
}

function duplicateChatSessionById(chatId) {
  return sessionStoreActions.duplicateChatSessionById(chatId);
}

function getMessageRecord(chatId, messageId) {
  return sessionStoreActions.getMessageRecord(chatId, messageId);
}

function editMessageById(chatId, messageId, nextText) {
  return sessionStoreActions.editMessageById(chatId, messageId, nextText);
}

function deleteMessageById(chatId, messageId) {
  return sessionStoreActions.deleteMessageById(chatId, messageId);
}
const {
  exportChatStorePayload,
  importChatStorePayload,
} = createChatStoreTransfer({
  getChatStore: () => chatStore,
  setChatStore: (store) => {
    chatStore = store;
  },
  normalizeChatStore,
  ensureActiveChatSessionInStore,
  rebuildChatSessionCounters,
  hydrateChatMoodMapFromStore,
  renderChatSessionList,
  persistCurrentChatStore,
  getChatSessionButtons,
  setActiveChatSession,
});

const backendStoreSync = createChatBackendStoreSync({
  runtimeMode: runtimeConfig.mode,
  chatStoreVersion: CHAT_STORE_VERSION,
  normalizeChatStore,
  getChatStore: () => chatStore,
  setChatStore: (store) => {
    chatStore = store;
  },
  getActiveChatSessionId: () => activeChatSessionId,
  setActiveChatSessionId: (value) => {
    activeChatSessionId = value;
  },
  ensureActiveChatSessionInStore,
  rebuildChatSessionCounters,
  hydrateChatMoodMapFromStore,
  renderChatSessionList,
  persistCurrentChatStore,
  renderActiveChatMessages,
  getChatSessionButtons,
  setActiveChatSession,
  backendClient,
  pushToast,
});
applyChatStoreSnapshot = (...args) => backendStoreSync.applyChatStoreSnapshot(...args);
tryApplyChatStoreFromMutation = (...args) => backendStoreSync.tryApplyChatStoreFromMutation(...args);
syncChatStoreFromBackend = (...args) => backendStoreSync.syncChatStoreFromBackend(...args);
runBackendChatMutation = (...args) => backendStoreSync.runBackendChatMutation(...args);

function canEditMessageInUI(chatId, messageId) {
  const record = getMessageRecord(chatId, messageId);
  return String(record?.message?.role || "").toLowerCase() === "user";
}

const chatExportModalOverlay = createModalOverlayManager({
  overlay: elements.chatExportModalOverlay,
  isMotionEnabled,
  transitionMs: 200,
});
const chatExportModalState = {
  open: false,
  resolve: null,
  keydownHandler: null,
  lastFormat: "json",
};
const normalizeChatExportFormat = (value) => (
  String(value || "").trim().toLowerCase() === "md" ? "md" : "json"
);
const hasChatExportModalSupport = () => Boolean(
  chatExportModalOverlay.hasSupport()
    && elements.chatExportModalTitle instanceof HTMLElement
    && elements.chatExportModalFormat instanceof HTMLSelectElement
    && elements.chatExportModalCancel instanceof HTMLButtonElement
    && elements.chatExportModalConfirm instanceof HTMLButtonElement,
);
function settleChatExportModal(selectedFormat = null, { skipAnimation = false } = {}) {
  if (!chatExportModalState.open) {
    return;
  }

  const resolver = chatExportModalState.resolve;
  const keydownHandler = chatExportModalState.keydownHandler;
  chatExportModalState.open = false;
  chatExportModalState.resolve = null;
  chatExportModalState.keydownHandler = null;

  if (typeof keydownHandler === "function") {
    document.removeEventListener("keydown", keydownHandler);
  }

  chatExportModalOverlay.close({ skipAnimation });
  const normalizedResult = selectedFormat == null ? null : normalizeChatExportFormat(selectedFormat);
  if (normalizedResult) {
    chatExportModalState.lastFormat = normalizedResult;
  }
  if (typeof resolver === "function") {
    resolver(normalizedResult);
  }
}

function requestChatExportFormat({ chatTitle = "" } = {}) {
  if (!hasChatExportModalSupport()) {
    const fallbackPrompt = window.prompt?.(
      "Формат экспорта (json/md):",
      chatExportModalState.lastFormat,
    );
    if (fallbackPrompt == null) {
      return Promise.resolve(null);
    }
    const fallbackFormat = normalizeChatExportFormat(fallbackPrompt);
    chatExportModalState.lastFormat = fallbackFormat;
    return Promise.resolve(fallbackFormat);
  }

  if (chatExportModalState.open) {
    settleChatExportModal(null, { skipAnimation: true });
  }

  const safeTitle = String(chatTitle || "").trim();
  elements.chatExportModalTitle.textContent = safeTitle
    ? `Экспорт чата «${safeTitle}»`
    : "Экспорт чата";
  elements.chatExportModalFormat.value = chatExportModalState.lastFormat;
  chatExportModalState.open = true;
  chatExportModalOverlay.open({ captureFocus: true });

  return new Promise((resolve) => {
    chatExportModalState.resolve = resolve;
    const keydownHandler = (event) => {
      if (!chatExportModalState.open) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        settleChatExportModal(null);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        settleChatExportModal(elements.chatExportModalFormat?.value || "json");
      }
    };
    chatExportModalState.keydownHandler = keydownHandler;
    document.addEventListener("keydown", keydownHandler);

    window.requestAnimationFrame(() => {
      elements.chatExportModalFormat?.focus({ preventScroll: true });
    });
  });
}

if (hasChatExportModalSupport()) {
  elements.chatExportModalConfirm.addEventListener("click", () => {
    settleChatExportModal(elements.chatExportModalFormat?.value || "json");
  });
  elements.chatExportModalCancel.addEventListener("click", () => {
    settleChatExportModal(null);
  });
  elements.chatExportModalOverlay.addEventListener("click", (event) => {
    if (event.target === elements.chatExportModalOverlay) {
      settleChatExportModal(null);
    }
  });
}

let requestChatExportFromEventBindings = async () => false;
let openChatImportDialogFromEventBindings = () => {};

let executeContextMenuAction = async () => {};
const contextMenuController = createChatContextMenuController({
  menuElement: elements.contextMenu,
  isMotionEnabled,
  clamp,
  transitionMs: CONTEXT_MENU_TRANSITION_MS,
  canEditMessage: canEditMessageInUI,
  pushToast,
  onAction: async (actionId, snapshot) => executeContextMenuAction(actionId, snapshot),
});
function closeContextMenu(options = {}) {
  contextMenuController.close(options);
}

function openContextMenu(options = {}) {
  contextMenuController.open(options);
}

({ executeContextMenuAction } = createChatContextMenuActions({
  getDefaultContext: () => {
    const snapshot = contextMenuController.getSnapshot();
    return {
      chatId: snapshot.chatId,
      messageId: snapshot.messageId,
    };
  },
  pushToast,
  getChatSessionButtons,
  setActiveChatSession,
  getChatSessionById,
  requestActionText,
  sanitizeSessionTitle,
  isBackendRuntimeEnabled,
  runBackendChatMutation,
  backendClient,
  renameChatSessionById,
  duplicateChatSessionById,
  tryApplyChatStoreFromMutation,
  syncChatStoreFromBackend,
  clearChatMessagesById,
  deleteChatSessionById,
  getMessageRecord,
  elements,
  syncComposerState: () => composerController.syncState(),
  canEditMessageInUI,
  editMessageById,
  requestActionConfirm,
  deleteMessageById,
  requestChatExport: (...args) => requestChatExportFromEventBindings(...args),
  openChatImportDialog: (...args) => openChatImportDialogFromEventBindings(...args),
}));
contextMenuController.bind();

function applyChatSessionVisibilityFilter() {
  sessionUiController?.applyChatSessionVisibilityFilter();
}

function setActiveChatSession(targetButton, options = {}) {
  sessionUiController?.setActiveChatSession(targetButton, options);
}

async function searchChatsForUi(query, options = {}) {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) {
    return { query: "", results: [], count: 0 };
  }
  if (isBackendRuntimeEnabled()) {
    try {
      return await backendClient.searchChats(safeQuery, options);
    } catch {
      return { query: safeQuery, results: [], count: 0 };
    }
  }

  const needle = safeQuery.toLowerCase();
  const localResults = [];
  const sessions = Array.isArray(chatStore?.sessions) ? chatStore.sessions : [];
  sessions.forEach((session) => {
    const chatId = String(session?.id || "").trim();
    const chatTitle = String(session?.title || "Чат").trim() || "Чат";
    const titleMatch = chatTitle.toLowerCase().includes(needle);
    if (titleMatch) {
      localResults.push({
        chat_id: chatId,
        chat_title: chatTitle,
        message_id: "",
        role: "assistant",
        text: chatTitle,
        snippet: chatTitle,
        timestamp: String(session?.updatedAt || session?.createdAt || ""),
      });
    }
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    messages.forEach((message) => {
      const text = normalizeTextInput(String(message?.text || "")).trim();
      if (!text || !text.toLowerCase().includes(needle)) {
        return;
      }
      localResults.push({
        chat_id: chatId,
        chat_title: chatTitle,
        message_id: String(message?.id || "").trim(),
        role: String(message?.role || "assistant").trim().toLowerCase() || "assistant",
        text,
        snippet: text.slice(0, 220),
        timestamp: String(message?.timestamp || ""),
      });
    });
  });

  return {
    query: safeQuery,
    results: localResults.slice(0, 120),
    count: localResults.length,
  };
}

function openSearchResult({ chatId = "", messageId = "" } = {}) {
  const safeChatId = String(chatId || "").trim();
  const safeMessageId = String(messageId || "").trim();
  if (!safeChatId) {
    return;
  }
  const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === safeChatId) || null;
  if (targetButton) {
    setActiveChatSession(targetButton, { renderMessages: true, applyBackground: true });
  }
  if (!isLeftPanelDocked()) {
    mobileState.leftOpen = false;
    syncMobilePanels();
  }
  if (!safeMessageId || !(elements.chatStream instanceof HTMLElement)) {
    return;
  }
  window.setTimeout(() => {
    const row = elements.chatStream.querySelector(`.message-row[data-message-id="${safeMessageId}"]`);
    if (!(row instanceof HTMLElement)) {
      return;
    }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.remove("message-row-highlight");
    void row.offsetWidth;
    row.classList.add("message-row-highlight");
    window.setTimeout(() => {
      row.classList.remove("message-row-highlight");
    }, 1300);
  }, 80);
}

let runGenerationAction = async () => false;
let exportChatsForUi = async () => ({ format: "json", store: { sessions: [] } });
let importChatsForUi = async () => ({ imported: { sessions: 0, messages: 0 } });
const chatSessionEventBindings = bindChatSessionEvents({
  elements,
  isLeftPanelDocked,
  mobileState,
  syncMobilePanels,
  getActiveChatSessionId: () => activeChatSessionId,
  getShowOnlyActiveSessions: () => showOnlyActiveSessions,
  setShowOnlyActiveSessions: (value) => {
    showOnlyActiveSessions = Boolean(value);
  },
  setSessionSearchQuery: (value) => {
    sessionSearchQuery = String(value || "").trim().toLowerCase();
  },
  applyChatSessionVisibilityFilter,
  getActiveChatSession,
  pushToast,
  requestActionConfirm,
  isBackendRuntimeEnabled,
  runBackendChatMutation,
  backendClient,
  clearActiveChatMessages,
  getNextSessionNumber: () => nextSessionNumber,
  setNextSessionNumber: (value) => {
    nextSessionNumber = Number(value) || nextSessionNumber;
  },
  createNewChatSessionRecord,
  tryApplyChatStoreFromMutation,
  syncChatStoreFromBackend,
  getChatStore: () => chatStore,
  setChatSessionMood,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
  openContextMenu,
  getAppendMessage: () => appendMessage,
  runGenerationAction: async (payload) => runGenerationAction(payload),
  focusComposer: () => {
    elements.composerInput?.focus();
  },
  searchChats: (query, options = {}) => searchChatsForUi(query, options),
  openSearchResult,
  exportChats: (...args) => exportChatsForUi(...args),
  importChats: (...args) => importChatsForUi(...args),
  requestChatExportFormat,
});
requestChatExportFromEventBindings = (...args) => {
  if (typeof chatSessionEventBindings?.requestChatExport !== "function") {
    return Promise.resolve(false);
  }
  return chatSessionEventBindings.requestChatExport(...args);
};
openChatImportDialogFromEventBindings = (...args) => {
  chatSessionEventBindings?.openChatImportDialog?.(...args);
};
const {
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
  setAssistantGenerationActions,
  normalizeLegacyToolName,
  resolveToolMeta,
  formatToolOutputText,
} = createChatMessageUi({
  elements,
  isMotionEnabled,
  persistChatMessage,
  getActiveChatSessionId: () => activeChatSessionId,
  normalizeToolName,
  lookupToolMeta,
  getPluginToolRenderer,
});
appendMessageFn = appendMessage;
streamRenderer = createChatStreamRenderer({
  chatStreamElement: elements.chatStream,
  isMotionEnabled,
  getActiveChatSession,
  getAppendMessage: () => appendMessageFn,
  resolveStoredToolPayload,
});

  const { ensureSessionForOutgoingMessage } = createChatSessionBootstrap({
    getActiveChatSessionId: () => activeChatSessionId,
    getNextSessionNumber: () => nextSessionNumber,
    setNextSessionNumber: (value) => {
      nextSessionNumber = Number(value) || nextSessionNumber;
    },
    createNewChatSessionRecord,
    getChatStore: () => chatStore,
    setChatSessionMood,
    persistCurrentChatStore,
    renderChatSessionList,
    getChatSessionButtons,
    setActiveChatSession,
    sanitizeSessionTitle,
  });

const {
  resolveModelMetaSuffix,
  requestAssistantReply,
} = createChatAssistantRuntime({
  runtimeConfig,
  background,
  backendClient,
  getChatHistoryForBackend,
  getChatSessionById,
  getActiveChatSessionId: () => activeChatSessionId,
  updateConnectionState,
  BACKEND_STATUS,
  pushToast,
  backendHistoryMaxMessages: BACKEND_HISTORY_MAX_MESSAGES,
});

const composerController = createChatComposerController({
  elements,
  runtimeConfig,
  backendClient,
  background,
  updateConnectionState,
  BACKEND_STATUS,
  pushToast,
  requestActionConfirm,
  isBackendRuntimeEnabled,
  syncChatStoreFromBackend,
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
  setAssistantGenerationActions,
  normalizeLegacyToolName,
  resolveToolMeta,
  formatToolOutputText,
  requestAssistantReply,
  resolveModelMetaSuffix,
  ensureSessionForOutgoingMessage,
  getActiveChatSessionId: () => activeChatSessionId,
  getChatHistoryForBackend,
  getChatSessionMood,
  applyTransientMood,
  setChatSessionMood,
  renameChatSessionById,
  getMessageRecord,
  sanitizeSessionTitle,
  persistChatMessage,
  ASSISTANT_PENDING_LABEL,
  getCurrentRouteState,
});
syncComposerState = (options = {}) => composerController.syncState(options);
runGenerationAction = async (payload) => composerController.triggerGenerationAction(payload);
composerController.bind();


function initialize() {
  holidayBannerController.initialize();
  sessionSearchQuery = String(elements.chatSessionSearch?.value || "").trim().toLowerCase();
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
  composerController.renderAttachments();
  syncComposerState();
  renderActiveChatMessages();
  void refreshToolCatalog({ silent: true });
}

function isContextMenuOpen() {
  return contextMenuController.isOpen();
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
  const chatPublicApi = createChatPublicApi({
    backendClient,
    getActiveChatId: () => activeChatSessionId,
    getChatSessionById,
    isBackendRuntimeEnabled,
    runBackendChatMutation,
    clearActiveChatMessages,
    clearChatMessagesById,
    deleteChatSessionById,
    duplicateChatSessionById,
    renameChatSessionById,
    editMessageById,
    deleteMessageById,
    sanitizeSessionTitle,
    tryApplyChatStoreFromMutation,
    syncChatStoreFromBackend,
    exportChatStorePayload,
    importChatStorePayload,
    listChatSessions,
  });
  exportChatsForUi = (...args) => chatPublicApi.exportChats(...args);
  importChatsForUi = (...args) => chatPublicApi.importChats(...args);

return {
  initialize,
  refreshToolCatalog,
  rerenderMessages: () => renderActiveChatMessages({ animateEntries: false, transition: false }),
  closeContextMenu,
  isContextMenuOpen,
  applyContextualBackground,
  syncComposerState,
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
  clearActiveChatHistory: chatPublicApi.clearActiveChatHistory,
  clearChat: chatPublicApi.clearChat,
  deleteChat: chatPublicApi.deleteChat,
  duplicateChat: chatPublicApi.duplicateChat,
  renameActiveChat: chatPublicApi.renameActiveChat,
  renameChat: chatPublicApi.renameChat,
  editMessage: chatPublicApi.editMessage,
  deleteMessage: chatPublicApi.deleteMessage,
  exportChats: chatPublicApi.exportChats,
  importChats: chatPublicApi.importChats,
  searchChats: chatPublicApi.searchChats,
  listChats: chatPublicApi.listChats,
};
}
