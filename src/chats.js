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
const getCurrentRouteState = (...args) => moodController.getCurrentRouteState(...args);
const normalizeBackgroundStateName = (...args) => moodController.normalizeBackgroundStateName(...args);
const getRouteBackgroundMood = (...args) => moodController.getRouteBackgroundMood(...args);
const applyTransientMood = (...args) => moodController.applyTransientMood(...args);
const setChatSessionMood = (...args) => moodController.setChatSessionMood(...args);
const clearChatSessionMood = (...args) => moodController.clearChatSessionMood(...args);
const getChatSessionMood = (...args) => moodController.getChatSessionMood(...args);
const resolveContextBackgroundMood = (...args) => moodController.resolveContextBackgroundMood(...args);
const applyContextualBackground = (...args) => moodController.applyContextualBackground(...args);

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
}));
contextMenuController.bind();

function applyChatSessionVisibilityFilter() {
  sessionUiController?.applyChatSessionVisibilityFilter();
}

function setActiveChatSession(targetButton, options = {}) {
  sessionUiController?.setActiveChatSession(targetButton, options);
}
bindChatSessionEvents({
  elements,
  isLeftPanelDocked,
  mobileState,
  syncMobilePanels,
  getActiveChatSessionId: () => activeChatSessionId,
  getShowOnlyActiveSessions: () => showOnlyActiveSessions,
  setShowOnlyActiveSessions: (value) => {
    showOnlyActiveSessions = Boolean(value);
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
  focusComposer: () => {
    elements.composerInput?.focus();
  },
});
const {
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
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
  isBackendRuntimeEnabled,
  syncChatStoreFromBackend,
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
  normalizeLegacyToolName,
  resolveToolMeta,
  formatToolOutputText,
  requestAssistantReply,
  resolveModelMetaSuffix,
  ensureSessionForOutgoingMessage,
  getActiveChatSessionId: () => activeChatSessionId,
  getChatSessionMood,
  applyTransientMood,
  setChatSessionMood,
  renameChatSessionById,
  sanitizeSessionTitle,
  persistChatMessage,
  ASSISTANT_PENDING_LABEL,
});
syncComposerState = () => composerController.syncState();
composerController.bind();


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

return {
  initialize,
  refreshToolCatalog,
  rerenderMessages: () => renderActiveChatMessages({ animateEntries: false, transition: false }),
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
  listChats: chatPublicApi.listChats,
};
}
