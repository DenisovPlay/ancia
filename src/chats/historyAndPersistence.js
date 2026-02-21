export const BACKEND_HISTORY_MAX_MESSAGES = 12;
export const BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE = 900;
export const BACKEND_HISTORY_MAX_TOTAL_CHARS = 5200;

export function createChatHistoryAndPersistence({
  normalizeTextInput,
  normalizeChatMessage,
  getChatSessionById,
  getActiveChatSession,
  getActiveChatSessionId,
  updateChatSessionTimestamp,
  moveChatSessionToFront,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
}) {
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

  function persistChatMessage({
    chatId = "",
    role,
    text,
    metaSuffix = "",
    meta = {},
    timestamp = new Date().toISOString(),
  }) {
    const targetSessionId = String(chatId || getActiveChatSessionId() || "").trim();
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

    if (targetSession.id === getActiveChatSessionId()) {
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
    return true;
  }

  return {
    getChatHistoryForBackend,
    persistChatMessage,
    clearActiveChatMessages,
  };
}
