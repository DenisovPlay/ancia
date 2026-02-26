export function bindChatSessionEvents({
  elements,
  isLeftPanelDocked,
  mobileState,
  syncMobilePanels,
  getActiveChatSessionId,
  getShowOnlyActiveSessions,
  setShowOnlyActiveSessions,
  setSessionSearchQuery,
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
  runGenerationAction,
  focusComposer,
  searchChats,
  openSearchResult,
  exportChats,
  importChats,
  requestChatExportFormat,
}) {
  let searchDebounceTimer = 0;
  let searchRequestSeq = 0;

  const hideSearchResults = () => {
    if (!(elements.chatSessionSearchResults instanceof HTMLElement)) {
      return;
    }
    elements.chatSessionSearchResults.dataset.open = "false";
    elements.chatSessionSearchResults.classList.add("hidden");
    elements.chatSessionSearchResults.innerHTML = "";
  };

  const renderSearchResults = (payload = {}) => {
    if (!(elements.chatSessionSearchResults instanceof HTMLElement)) {
      return;
    }
    const query = String(payload?.query || "").trim();
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    if (!query || rows.length === 0) {
      hideSearchResults();
      return;
    }

    const limitedRows = rows.slice(0, 24);
    const fragment = document.createDocumentFragment();
    limitedRows.forEach((item) => {
      const chatId = String(item?.chat_id || "").trim();
      const messageId = String(item?.message_id || "").trim();
      const chatTitle = String(item?.chat_title || "Чат").trim() || "Чат";
      const role = String(item?.role || "").trim() || "assistant";
      const snippet = String(item?.snippet || item?.text || "").replace(/\s+/g, " ").trim();
      const timestamp = String(item?.timestamp || "").trim();
      const safeSnippet = snippet || "Совпадение без текста";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-search-result-item";
      button.dataset.searchChatId = chatId;
      button.dataset.searchMessageId = messageId;

      const titleNode = document.createElement("span");
      titleNode.className = "chat-search-result-item__title";
      titleNode.textContent = chatTitle;
      button.append(titleNode);

      const snippetNode = document.createElement("span");
      snippetNode.className = "chat-search-result-item__snippet";
      snippetNode.textContent = safeSnippet;
      button.append(snippetNode);

      const metaNode = document.createElement("span");
      metaNode.className = "chat-search-result-item__meta";
      metaNode.textContent = `${role}${timestamp ? ` • ${timestamp}` : ""}`;
      button.append(metaNode);

      fragment.append(button);
    });

    elements.chatSessionSearchResults.innerHTML = "";
    elements.chatSessionSearchResults.append(fragment);
    elements.chatSessionSearchResults.classList.remove("hidden");
    elements.chatSessionSearchResults.dataset.open = "true";
  };

  const runGlobalSearch = (query) => {
    const safeQuery = String(query || "").trim();
    if (searchDebounceTimer) {
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = 0;
    }
    if (safeQuery.length < 2 || typeof searchChats !== "function") {
      hideSearchResults();
      return;
    }
    const requestSeq = searchRequestSeq + 1;
    searchRequestSeq = requestSeq;
    searchDebounceTimer = window.setTimeout(async () => {
      searchDebounceTimer = 0;
      try {
        const result = await searchChats(safeQuery, { limit: 120 });
        if (requestSeq !== searchRequestSeq) {
          return;
        }
        renderSearchResults(result);
      } catch {
        if (requestSeq !== searchRequestSeq) {
          return;
        }
        hideSearchResults();
      }
    }, 220);
  };

  const normalizeExportFormat = (value) => {
    const rawValue = String(value || "").trim().toLowerCase();
    return rawValue === "md" || rawValue === "markdown" ? "md" : "json";
  };

  const buildExportFileName = ({ format = "json", chatId = "" } = {}) => {
    const now = new Date();
    const datePart = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("-");
    const scopePart = chatId ? `chat-${chatId}` : "all-chats";
    const extension = format === "md" ? "md" : "json";
    return `ancia-${scopePart}-${datePart}.${extension}`;
  };

  const downloadBlob = (blob, fileName) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const extractStorePayload = (payload) => {
    if (payload && typeof payload === "object" && payload.store && typeof payload.store === "object") {
      return payload.store;
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.sessions)) {
      return {
        version: Number(payload.version || 1),
        activeSessionId: String(payload.activeSessionId || ""),
        sessions: payload.sessions,
      };
    }
    if (payload && typeof payload === "object" && payload.format === "json" && payload.store && typeof payload.store === "object") {
      return payload.store;
    }
    return null;
  };

  const parseImportFile = (rawContent, fileName = "") => {
    const safeText = String(rawContent || "");
    const loweredName = String(fileName || "").toLowerCase();
    const looksLikeMarkdown = loweredName.endsWith(".md")
      || loweredName.endsWith(".markdown")
      || safeText.includes("```ancia-json")
      || safeText.includes("<!-- ancia-chat-export:1 -->");
    if (looksLikeMarkdown) {
      return {
        format: "md",
        content: safeText,
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(safeText);
    } catch {
      throw new Error("Файл импорта должен быть JSON или markdown-экспортом Ancia.");
    }

    const storePayload = extractStorePayload(parsed);
    if (!storePayload || !Array.isArray(storePayload.sessions)) {
      throw new Error("В JSON не найден корректный payload чатов.");
    }
    return {
      format: "json",
      store: storePayload,
    };
  };

  const handleExport = async ({
    activeOnly = false,
    chatIdOverride = "",
    formatOverride = "",
  } = {}) => {
    if (typeof exportChats !== "function") {
      pushToast("Экспорт недоступен.", { tone: "warning", durationMs: 2600 });
      return false;
    }
    let format = normalizeExportFormat(formatOverride);
    const activeChatId = String(getActiveChatSessionId?.() || "").trim();
    const chatId = activeOnly
      ? String(chatIdOverride || activeChatId).trim()
      : "";
    if (activeOnly && !chatId) {
      pushToast("Нет активного чата для экспорта.", { tone: "warning", durationMs: 2600 });
      return false;
    }
    if (activeOnly && !formatOverride && typeof requestChatExportFormat === "function") {
      const chatTitle = String(
        getChatStore?.()?.sessions?.find?.((item) => String(item?.id || "").trim() === chatId)?.title || "",
      ).trim();
      const selectedFormat = await requestChatExportFormat({ chatId, chatTitle });
      if (!selectedFormat) {
        return false;
      }
      format = normalizeExportFormat(selectedFormat);
    }
    try {
      const payload = await exportChats({
        format,
        chatId,
      });
      const exportedFormat = String(payload?.format || format).trim().toLowerCase();
      if (exportedFormat === "md") {
        const content = String(payload?.content || "").trim();
        if (!content) {
          throw new Error("Пустой markdown payload.");
        }
        downloadBlob(
          new Blob([content], { type: "text/markdown;charset=utf-8" }),
          buildExportFileName({ format: "md", chatId }),
        );
      } else {
        const storePayload = extractStorePayload(payload);
        if (!storePayload) {
          throw new Error("Некорректный JSON payload экспорта.");
        }
        downloadBlob(
          new Blob([JSON.stringify(storePayload, null, 2)], { type: "application/json;charset=utf-8" }),
          buildExportFileName({ format: "json", chatId }),
        );
      }
      pushToast(activeOnly ? "Активный чат экспортирован." : "Чаты экспортированы.", {
        tone: "success",
        durationMs: 2400,
      });
      return true;
    } catch (error) {
      pushToast(`Не удалось выполнить экспорт: ${error.message}`, {
        tone: "error",
        durationMs: 3600,
      });
      return false;
    }
  };

  const handleImportFileSelection = async () => {
    if (!(elements.chatImportFileInput instanceof HTMLInputElement)) {
      return;
    }
    const selectedFile = elements.chatImportFileInput.files?.[0] || null;
    if (!selectedFile) {
      return;
    }
    try {
      const rawContent = await selectedFile.text();
      const importPayload = parseImportFile(rawContent, selectedFile.name);
      const shouldImport = await requestActionConfirm(
        "Импортировать чаты в текущую базу в режиме объединения?",
        {
          title: "Импорт чатов",
          confirmLabel: "Импортировать",
        },
      );
      if (!shouldImport) {
        return;
      }
      if (typeof importChats !== "function") {
        throw new Error("Импорт недоступен.");
      }
      const result = await importChats(importPayload, { mode: "merge" });
      if (result?.error) {
        throw new Error(String(result.error || "import_failed"));
      }
      if (isBackendRuntimeEnabled()) {
        await syncChatStoreFromBackend({
          preserveActive: true,
          silent: true,
        });
      }
      const sessionsImported = Number(result?.imported?.sessions || result?.sessions || 0);
      const messagesImported = Number(result?.imported?.messages || result?.messages || 0);
      pushToast(
        `Импорт завершён: ${sessionsImported} чатов, ${messagesImported} сообщений.`,
        { tone: "success", durationMs: 3200 },
      );
    } catch (error) {
      pushToast(`Не удалось импортировать файл: ${error.message}`, {
        tone: "error",
        durationMs: 3800,
      });
    } finally {
      elements.chatImportFileInput.value = "";
    }
  };

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
    const generationActionButton = event.target instanceof Element
      ? event.target.closest("[data-generation-action]")
      : null;
    if (generationActionButton instanceof HTMLButtonElement) {
      const row = generationActionButton.closest(".message-row");
      const action = String(generationActionButton.dataset.generationAction || "").trim().toLowerCase();
      const chatId = String(row?.dataset.chatId || getActiveChatSessionId() || "").trim();
      const messageId = String(row?.dataset.messageId || "").trim();
      if (action && chatId && messageId) {
        event.preventDefault();
        generationActionButton.disabled = true;
        Promise.resolve(runGenerationAction?.({
          action,
          chatId,
          messageId,
        })).finally(() => {
          generationActionButton.disabled = false;
        });
      }
      return;
    }

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

  elements.chatSessionSearch?.addEventListener("input", () => {
    const searchValue = elements.chatSessionSearch?.value || "";
    setSessionSearchQuery?.(searchValue);
    applyChatSessionVisibilityFilter();
    runGlobalSearch(searchValue);
  });

  elements.chatSessionSearch?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    hideSearchResults();
    elements.chatSessionSearch?.blur();
  });

  elements.chatSessionSearchResults?.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("[data-search-chat-id]")
      : null;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const chatId = String(target.dataset.searchChatId || "").trim();
    const messageId = String(target.dataset.searchMessageId || "").trim();
    if (!chatId) {
      return;
    }
    hideSearchResults();
    Promise.resolve(openSearchResult?.({ chatId, messageId }));
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (elements.chatSessionSearch instanceof HTMLElement && elements.chatSessionSearch.contains(target)) {
      return;
    }
    if (elements.chatSessionSearchResults instanceof HTMLElement && elements.chatSessionSearchResults.contains(target)) {
      return;
    }
    hideSearchResults();
  });

  elements.chatImportFileInput?.addEventListener("change", () => {
    void handleImportFileSelection();
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

  return {
    requestChatExport: async ({ chatId = "" } = {}) => {
      const safeChatId = String(chatId || "").trim();
      if (!safeChatId) {
        return false;
      }
      return handleExport({
        activeOnly: true,
        chatIdOverride: safeChatId,
      });
    },
    openChatImportDialog: () => {
      elements.chatImportFileInput?.click();
    },
    requestExportAll: async ({ format = "json" } = {}) => handleExport({
      activeOnly: false,
      formatOverride: format,
    }),
  };
}
