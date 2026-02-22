export function createChatSessionUiController({
  elements,
  getChatStore,
  getActiveChatSessionId,
  setActiveChatSessionId,
  getChatSessionButtons,
  getShowOnlyActiveSessions,
  setShowOnlyActiveSessions,
  getChatSessionIdSeq,
  setChatSessionIdSeq,
  syncChatSessionIdSeed,
  persistCurrentChatStore,
  renderActiveChatMessages,
  isMotionEnabled,
  getCurrentRouteState,
  applyContextualBackground,
  getSyncComposerState,
}) {
  function ensureChatSessionIdentity(button) {
    if (!(button instanceof HTMLElement)) {
      return null;
    }

    if (!button.dataset.sessionId) {
      const nextSeq = getChatSessionIdSeq() + 1;
      setChatSessionIdSeq(nextSeq);
      button.dataset.sessionId = `chat-${nextSeq}`;
    } else {
      setChatSessionIdSeq(syncChatSessionIdSeed(button.dataset.sessionId, getChatSessionIdSeq()));
    }
    return button.dataset.sessionId;
  }

  function createChatSessionButton(session, isActive = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.chatItem = "";
    button.dataset.active = String(isActive);
    button.dataset.sessionId = session.id;
    button.dataset.sessionTitle = session.title;
    button.className = "route-pill active:scale-95 w-full rounded-lg border p-2.5 text-left transition";
    button.setAttribute("aria-pressed", String(isActive));

    const title = document.createElement("p");
    title.className = "text-sm truncate w-full";
    title.textContent = session.title;
    button.appendChild(title);
    return button;
  }

  function renderChatSessionList() {
    if (!elements.chatSessionList) {
      return;
    }

    const chatStore = getChatStore();
    elements.chatSessionList.innerHTML = "";
    chatStore.sessions.forEach((session) => {
      const isActive = session.id === (getActiveChatSessionId() || chatStore.activeSessionId);
      const button = createChatSessionButton(session, isActive);
      elements.chatSessionList.appendChild(button);
    });
  }

  function applyChatSessionVisibilityFilter() {
    const buttons = getChatSessionButtons();
    buttons.forEach(ensureChatSessionIdentity);

    const showOnlyActiveSessions = getShowOnlyActiveSessions();
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
    const previousSessionId = getActiveChatSessionId();

    buttons.forEach((button) => {
      const isActive = button === safeTarget;
      button.dataset.active = String(isActive);
      button.setAttribute("aria-pressed", String(isActive));
      const titleNode = button.querySelector("p");
      if (titleNode) {
        titleNode.className = "text-sm truncate w-full";
      }
    });

    const activeSessionId = safeTarget ? ensureChatSessionIdentity(safeTarget) : null;
    setActiveChatSessionId(activeSessionId);

    const chatStore = getChatStore();
    if (activeSessionId) {
      chatStore.activeSessionId = activeSessionId;
      persistCurrentChatStore();
    }

    if (renderMessages) {
      const switchedSession = Boolean(
        previousSessionId
        && activeSessionId
        && previousSessionId !== activeSessionId,
      );
      renderActiveChatMessages({
        animateEntries: switchedSession,
        transition: switchedSession,
      });
    }
    applyChatSessionVisibilityFilter();

    if (safeTarget && previousSessionId && previousSessionId !== activeSessionId && isMotionEnabled()) {
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

    getSyncComposerState()?.();
  }

  return {
    ensureChatSessionIdentity,
    renderChatSessionList,
    applyChatSessionVisibilityFilter,
    setActiveChatSession,
    getShowOnlyActiveSessions,
    setShowOnlyActiveSessions,
  };
}
