export function createChatBackendStoreSync({
  runtimeMode,
  chatStoreVersion,
  normalizeChatStore,
  getChatStore,
  setChatStore,
  getActiveChatSessionId,
  setActiveChatSessionId,
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
}) {
  function applyChatStoreSnapshot(
    snapshot,
    { preserveActive = true, preferredActiveId = "" } = {},
  ) {
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.sessions)) {
      return false;
    }

    if (snapshot.sessions.length === 0 && runtimeMode === "backend") {
      setChatStore({
        version: chatStoreVersion,
        activeSessionId: "",
        sessions: [],
      });
      setActiveChatSessionId(null);
      renderChatSessionList();
      persistCurrentChatStore();
      renderActiveChatMessages();
      return true;
    }

    if (snapshot.sessions.length === 0) {
      return false;
    }

    const chatStore = getChatStore();
    const currentActive = String(getActiveChatSessionId() || chatStore.activeSessionId || "").trim();
    const fallbackActive = String(snapshot.activeSessionId || "").trim();
    const preferred = String(preferredActiveId || "").trim();

    const nextStore = normalizeChatStore({
      version: Number(snapshot.version || chatStoreVersion),
      activeSessionId: preferred || (preserveActive ? currentActive : "") || fallbackActive,
      sessions: snapshot.sessions,
    });

    const nextActiveId = [preferred, preserveActive ? currentActive : "", fallbackActive, nextStore.activeSessionId]
      .find((candidate) => (
        candidate
        && nextStore.sessions.some((session) => session.id === candidate)
      ))
      || nextStore.sessions[0]?.id
      || "";

    nextStore.activeSessionId = nextActiveId;
    setChatStore(nextStore);

    ensureActiveChatSessionInStore();
    rebuildChatSessionCounters();
    hydrateChatMoodMapFromStore();
    renderChatSessionList();
    persistCurrentChatStore();

    const refreshedStore = getChatStore();
    const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === refreshedStore.activeSessionId)
      || getChatSessionButtons()[0]
      || null;
    setActiveChatSession(targetButton);
    return true;
  }

  function tryApplyChatStoreFromMutation(response, options = {}) {
    const payload = response?.store && typeof response.store === "object"
      ? response.store
      : response;

    if (payload && typeof payload === "object" && Array.isArray(payload.sessions)) {
      return applyChatStoreSnapshot(payload, options);
    }
    return false;
  }

  async function syncChatStoreFromBackend(
    { preserveActive = true, preferredActiveId = "", silent = false } = {},
  ) {
    if (runtimeMode !== "backend") {
      return false;
    }

    try {
      const payload = await backendClient.listChats();
      const applied = applyChatStoreSnapshot(payload, { preserveActive, preferredActiveId });
      if (!applied && !silent) {
        pushToast("Бэкенд не вернул валидный список чатов.", { tone: "warning" });
      }
      return applied;
    } catch (error) {
      if (!silent) {
        pushToast(`Не удалось синхронизировать чаты: ${error.message}`, { tone: "error", durationMs: 3600 });
      }
      return false;
    }
  }

  async function runBackendChatMutation(
    mutate,
    { preserveActive = true, preferredActiveId = "", silent = true } = {},
  ) {
    const response = await mutate();
    const applied = tryApplyChatStoreFromMutation(response, { preserveActive, preferredActiveId });
    if (!applied) {
      await syncChatStoreFromBackend({ preserveActive, preferredActiveId, silent });
    }
    return response;
  }

  return {
    applyChatStoreSnapshot,
    tryApplyChatStoreFromMutation,
    syncChatStoreFromBackend,
    runBackendChatMutation,
  };
}
