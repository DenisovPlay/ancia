export function createChatStoreTransfer({
  getChatStore,
  setChatStore,
  normalizeChatStore,
  ensureActiveChatSessionInStore,
  rebuildChatSessionCounters,
  hydrateChatMoodMapFromStore,
  renderChatSessionList,
  persistCurrentChatStore,
  getChatSessionButtons,
  setActiveChatSession,
}) {
  function exportChatStorePayload() {
    return JSON.stringify(getChatStore(), null, 2);
  }

  function importChatStorePayload(payload) {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    setChatStore(normalizeChatStore(parsed));
    ensureActiveChatSessionInStore();
    rebuildChatSessionCounters();
    hydrateChatMoodMapFromStore();
    renderChatSessionList();
    persistCurrentChatStore();

    const activeSessionId = getChatStore().activeSessionId;
    const activeButton = getChatSessionButtons().find((button) => button.dataset.sessionId === activeSessionId) || null;
    setActiveChatSession(activeButton);

    return {
      sessions: getChatStore().sessions.length,
      activeSessionId,
    };
  }

  return {
    exportChatStorePayload,
    importChatStorePayload,
  };
}
