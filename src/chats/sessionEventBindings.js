export function bindChatSessionEvents({
  elements,
  isLeftPanelDocked,
  mobileState,
  syncMobilePanels,
  getActiveChatSessionId,
  getShowOnlyActiveSessions,
  setShowOnlyActiveSessions,
  applyChatSessionVisibilityFilter,
  getActiveChatSession,
  pushToast,
  requestActionConfirm,
  isBackendRuntimeEnabled,
  runBackendChatMutation,
  backendClient,
  clearActiveChatMessages,
  getNextSessionNumber,
  setNextSessionNumber,
  createNewChatSessionRecord,
  tryApplyChatStoreFromMutation,
  syncChatStoreFromBackend,
  getChatStore,
  setChatSessionMood,
  persistCurrentChatStore,
  renderChatSessionList,
  getChatSessionButtons,
  setActiveChatSession,
  openContextMenu,
  getAppendMessage,
  focusComposer,
}) {
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

  elements.chatStream?.addEventListener("click", (event) => {
    const copyBtn = event.target instanceof Element ? event.target.closest("[data-copy-code]") : null;
    if (!(copyBtn instanceof HTMLElement)) {
      return;
    }
    const pre = copyBtn.closest(".message-code-block");
    const rawCode = pre instanceof HTMLElement ? String(pre.dataset.rawCode || "") : "";
    if (!rawCode) {
      return;
    }
    navigator.clipboard.writeText(rawCode).then(() => {
      const originalHtml = copyBtn.innerHTML;
      copyBtn.classList.add("message-code-copy--done");
      copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
      window.setTimeout(() => {
        copyBtn.classList.remove("message-code-copy--done");
        copyBtn.innerHTML = originalHtml;
      }, 1800);
    }).catch(() => {});
  });

  elements.chatStream?.addEventListener("contextmenu", (event) => {
    const row = event.target instanceof Element ? event.target.closest("[data-message-id]") : null;
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const messageId = row.dataset.messageId || "";
    const chatId = row.dataset.chatId || getActiveChatSessionId() || "";
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
    setShowOnlyActiveSessions(!getShowOnlyActiveSessions());
    applyChatSessionVisibilityFilter();
    pushToast(
      getShowOnlyActiveSessions() ? "Показываю только активную сессию." : "Показываю все сессии.",
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
    const sessionTitle = `Новая сессия ${getNextSessionNumber()} • ${timestamp}`;
    setNextSessionNumber(getNextSessionNumber() + 1);
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
        setShowOnlyActiveSessions(false);
        applyChatSessionVisibilityFilter();
        pushToast("Создана новая сессия.", { tone: "success" });
        focusComposer();
        return;
      } catch (error) {
        pushToast(`Не удалось создать чат на сервере: ${error.message}. Создана локальная сессия.`, {
          tone: "warning",
          durationMs: 4200,
        });
      }
    }

    const chatStore = getChatStore();
    chatStore.sessions.unshift(session);
    chatStore.activeSessionId = session.id;
    setChatSessionMood(session.id, "route_chat", 0, {
      applyIfActive: false,
      immediate: false,
    });
    persistCurrentChatStore();
    renderChatSessionList();
    setShowOnlyActiveSessions(false);
    const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === session.id) || null;
    setActiveChatSession(targetButton);
    getAppendMessage()?.("assistant", `Создана сессия «${sessionTitle}». Можете начинать новый диалог.`, "новая сессия", {
      persist: true,
    });
    pushToast("Создана новая сессия.", { tone: "success" });
    focusComposer();
  });
}
