import {
  createDefaultChatStore as createDefaultChatStorePayload,
  loadChatStore as loadChatStorePayload,
  normalizeChatMessage as normalizeChatMessagePayload,
  normalizeChatSession as normalizeChatSessionPayload,
  normalizeChatStore as normalizeChatStorePayload,
  persistChatStore as persistChatStorePayload,
  resolveStoredToolPayload as resolveStoredToolPayloadPayload,
  syncChatSessionIdSeed as syncChatSessionIdSeedPayload,
} from "./storeUtils.js";

export function createChatStoreCoordinator({
  runtimeMode,
  chatStoreVersion,
  storageKey,
  getChatStore,
  setChatStore,
  getActiveChatSessionId,
  setActiveChatSessionId,
  getNextSessionNumber,
  setNextSessionNumber,
  getChatSessionIdSeq,
  setChatSessionIdSeq,
  chatMoodBySession,
  normalizeBackgroundStateName,
}) {
  function normalizeChatMessage(entry, fallbackIndex = 0) {
    return normalizeChatMessagePayload(entry, fallbackIndex);
  }

  function resolveStoredToolPayload(message) {
    return resolveStoredToolPayloadPayload(message);
  }

  function normalizeChatSession(entry, fallbackIndex = 0) {
    return normalizeChatSessionPayload(entry, fallbackIndex);
  }

  function createDefaultChatStore() {
    return createDefaultChatStorePayload(chatStoreVersion);
  }

  function normalizeChatStore(raw) {
    return normalizeChatStorePayload(raw, {
      runtimeMode,
      chatStoreVersion,
    });
  }

  function loadChatStore() {
    return loadChatStorePayload({
      runtimeMode,
      storageKey,
      chatStoreVersion,
    });
  }

  function persistChatStore(store) {
    return persistChatStorePayload({
      runtimeMode,
      storageKey,
      chatStoreVersion,
      store,
    });
  }

  function syncChatSessionIdSeed(sessionId) {
    const currentSeed = getChatSessionIdSeq();
    const nextSeed = syncChatSessionIdSeedPayload(sessionId, currentSeed);
    setChatSessionIdSeq(nextSeed);
    return nextSeed;
  }

  function persistCurrentChatStore() {
    persistChatStore(getChatStore());
  }

  function getChatSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    return getChatStore().sessions.find((session) => session.id === sessionId) || null;
  }

  function getActiveChatSession() {
    return getChatSessionById(getActiveChatSessionId() || getChatStore().activeSessionId);
  }

  function updateChatSessionTimestamp(session) {
    if (!session) {
      return;
    }
    session.updatedAt = new Date().toISOString();
  }

  function moveChatSessionToFront(sessionId) {
    const store = getChatStore();
    const index = store.sessions.findIndex((session) => session.id === sessionId);
    if (index <= 0) {
      return;
    }
    const [session] = store.sessions.splice(index, 1);
    store.sessions.unshift(session);
  }

  function ensureActiveChatSessionInStore() {
    let store = getChatStore();

    if (!store.sessions.length) {
      if (runtimeMode === "backend") {
        setChatStore({
          version: chatStoreVersion,
          activeSessionId: "",
          sessions: [],
        });
        setActiveChatSessionId(null);
        return;
      }
      setChatStore(createDefaultChatStore());
      store = getChatStore();
    }

    const hasActive = store.sessions.some((session) => session.id === store.activeSessionId);
    if (!hasActive) {
      store.activeSessionId = store.sessions[0]?.id || null;
    }

    setActiveChatSessionId(store.activeSessionId);
  }

  function rebuildChatSessionCounters() {
    setChatSessionIdSeq(0);
    let maxSessionNumberFromTitle = 0;

    getChatStore().sessions.forEach((session) => {
      syncChatSessionIdSeed(session.id);
      const titleMatch = /^Новая сессия (\d+)/i.exec(String(session.title || "").trim());
      if (titleMatch) {
        maxSessionNumberFromTitle = Math.max(maxSessionNumberFromTitle, Number(titleMatch[1]));
      }
    });

    const currentSeed = getChatSessionIdSeq();
    const nextSessionNumber = Math.max(
      maxSessionNumberFromTitle + 1,
      getChatStore().sessions.length + 1,
      currentSeed + 1,
    );
    setNextSessionNumber(nextSessionNumber);
  }

  function hydrateChatMoodMapFromStore() {
    chatMoodBySession.clear();
    getChatStore().sessions.forEach((session) => {
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
    const nextSeed = getChatSessionIdSeq() + 1;
    setChatSessionIdSeq(nextSeed);

    const sessionId = `chat-${nextSeed}`;
    const nowIso = new Date().toISOString();
    return {
      id: sessionId,
      title: sanitizeSessionTitle(title, `Новая сессия ${getNextSessionNumber()}`),
      createdAt: nowIso,
      updatedAt: nowIso,
      mood: "route_chat",
      messages: [],
    };
  }

  function listChatSessions() {
    const activeSessionId = getActiveChatSessionId();
    return getChatStore().sessions.map((session) => ({
      chatId: session.id,
      title: session.title,
      active: session.id === activeSessionId,
    }));
  }

  return {
    normalizeChatMessage,
    resolveStoredToolPayload,
    normalizeChatSession,
    createDefaultChatStore,
    normalizeChatStore,
    loadChatStore,
    persistChatStore,
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
  };
}
