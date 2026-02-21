export function createChatSessionStoreActions({
  getChatStore,
  getChatSessionById,
  getActiveChatSessionId,
  setActiveChatSessionId,
  getNextSessionNumber,
  setNextSessionNumber,
  getChatSessionIdSeq,
  setChatSessionIdSeq,
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
}) {
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
        renderMessages: session.id === getActiveChatSessionId(),
        applyBackground: false,
      });
    } else if (session.id === getActiveChatSessionId()) {
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

  function deleteChatSessionById(chatId) {
    const chatStore = getChatStore();
    const index = chatStore.sessions.findIndex((session) => session.id === chatId);
    if (index < 0) {
      return false;
    }

    chatStore.sessions.splice(index, 1);
    chatMoodBySession.delete(chatId);

    if (chatStore.sessions.length === 0) {
      const nextSessionNumber = getNextSessionNumber() + 1;
      setNextSessionNumber(nextSessionNumber);
      const fresh = createNewChatSessionRecord(`Новая сессия ${nextSessionNumber}`);
      chatStore.sessions.push(fresh);
    }

    if (getActiveChatSessionId() === chatId || chatStore.activeSessionId === chatId) {
      chatStore.activeSessionId = chatStore.sessions[0]?.id || "";
      setActiveChatSessionId(chatStore.activeSessionId || null);
    }

    persistCurrentChatStore();
    renderChatSessionList();
    const nextButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatStore.activeSessionId) || null;
    setActiveChatSession(nextButton);
    return true;
  }

  function duplicateChatSessionById(chatId) {
    const chatStore = getChatStore();
    const source = getChatSessionById(chatId);
    if (!source) {
      return null;
    }

    const nextSeq = getChatSessionIdSeq() + 1;
    setChatSessionIdSeq(nextSeq);
    const newSessionId = `chat-${nextSeq}`;
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
      renderMessages: record.session.id === getActiveChatSessionId(),
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
      renderMessages: record.session.id === getActiveChatSessionId(),
      applyBackground: false,
    });
    return true;
  }

  return {
    clearChatMessagesById,
    renameChatSessionById,
    deleteChatSessionById,
    duplicateChatSessionById,
    getMessageRecord,
    editMessageById,
    deleteMessageById,
  };
}
