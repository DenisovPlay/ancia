export function createChatSessionBootstrap({
  getActiveChatSessionId,
  getNextSessionNumber,
  setNextSessionNumber,
  createNewChatSessionRecord,
  getChatStore,
  setChatSessionMood,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
  sanitizeSessionTitle,
}) {
  function ensureSessionForOutgoingMessage(seedText = "") {
    const activeChatSessionId = getActiveChatSessionId();
    if (activeChatSessionId) {
      return activeChatSessionId;
    }

    const nextSessionNumber = getNextSessionNumber();
    const normalizedSeed = String(seedText || "").replace(/\s+/g, " ").trim();
    const fallbackTitle = normalizedSeed
      ? sanitizeSessionTitle(normalizedSeed.slice(0, 72), `Новая сессия ${nextSessionNumber}`)
      : `Новая сессия ${nextSessionNumber}`;
    setNextSessionNumber(nextSessionNumber + 1);
    const session = createNewChatSessionRecord(fallbackTitle);

    const chatStore = getChatStore();
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

  return {
    ensureSessionForOutgoingMessage,
  };
}
