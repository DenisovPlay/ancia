export function startTokenCounter({
  tokenNode,
  formatValue,
  initialValue = 18200,
  intervalMs = 3200,
}) {
  if (!(tokenNode instanceof HTMLElement) || typeof formatValue !== "function") {
    return;
  }
  let tokenCount = initialValue;
  window.setInterval(() => {
    const drift = Math.floor(Math.random() * 61) - 10;
    tokenCount = Math.max(1000, tokenCount + drift);
    tokenNode.textContent = formatValue(tokenCount);
  }, intervalMs);
}

export function installRuntimeApis({
  runtimeConfig,
  background,
  getChatFeature,
  applyRuntimeConfig,
  getSettingsFeature,
  persistSettingsToBackend,
  navigateToRoute,
  onboardingController,
  loadOnboardingState,
}) {
  const resolveDefaultTransitionMs = () => {
    const value = Number(runtimeConfig.defaultTransitionMs);
    return Number.isFinite(value) ? Math.max(0, value) : 860;
  };

  window.botMood = {
    getState() {
      return background.getCurrentMood();
    },
    getStates() {
      return background.getStates();
    },
    setState(name, transitionMs = resolveDefaultTransitionMs()) {
      const chatFeature = getChatFeature();
      const normalizedMood = chatFeature?.normalizeBackgroundStateName(name) || "neutral";
      const activeChatId = chatFeature?.getActiveChatId();
      if (chatFeature?.getCurrentRouteState() === "chat" && activeChatId) {
        chatFeature.setChatSessionMood(activeChatId, normalizedMood, transitionMs);
        return normalizedMood;
      }
      background.setMood(normalizedMood, transitionMs);
      return normalizedMood;
    },
    registerState(name, config) {
      return background.registerMood(name, config);
    },
    setImmediate(name) {
      const chatFeature = getChatFeature();
      const normalizedMood = chatFeature?.normalizeBackgroundStateName(name) || "neutral";
      const activeChatId = chatFeature?.getActiveChatId();
      if (chatFeature?.getCurrentRouteState() === "chat" && activeChatId) {
        chatFeature.setChatSessionMood(activeChatId, normalizedMood, 0, {
          immediate: true,
        });
        return normalizedMood;
      }
      background.applyMoodInstant(normalizedMood);
      return normalizedMood;
    },
    setChatState(sessionId, name, transitionMs = resolveDefaultTransitionMs(), applyIfActive = true) {
      return getChatFeature()?.setChatSessionMood(
        sessionId,
        name,
        transitionMs,
        { applyIfActive: Boolean(applyIfActive) },
      ) || null;
    },
    clearChatState(sessionId, transitionMs = resolveDefaultTransitionMs()) {
      getChatFeature()?.clearChatSessionMood(sessionId, transitionMs);
    },
    getChatState(sessionId) {
      return getChatFeature()?.getChatSessionMood(sessionId) || null;
    },
    getActiveChatId() {
      return getChatFeature()?.getActiveChatId() || null;
    },
    getContextState() {
      return getChatFeature()?.resolveContextBackgroundMood() || "neutral";
    },
    getRenderStats() {
      return {
        frameMs: background.frameDeltaAverage,
        pixelRatio: background.currentPixelRatio,
        targetFrameMs: background.frameBudgetMs,
      };
    },
  };

  window.chatRuntime = {
    setBotState(state, transitionMs = resolveDefaultTransitionMs()) {
      return window.botMood.setState(state, transitionMs);
    },
    setCurrentChatState(state, transitionMs = resolveDefaultTransitionMs()) {
      return getChatFeature()?.setCurrentChatState(state, transitionMs) || null;
    },
    setChatState(chatId, state, transitionMs = resolveDefaultTransitionMs(), applyIfActive = true) {
      return getChatFeature()?.setChatSessionMood(
        chatId,
        state,
        transitionMs,
        { applyIfActive: Boolean(applyIfActive) },
      ) || null;
    },
    clearCurrentChatState(transitionMs = resolveDefaultTransitionMs()) {
      getChatFeature()?.clearCurrentChatState(transitionMs);
    },
    clearChatState(chatId, transitionMs = resolveDefaultTransitionMs()) {
      getChatFeature()?.clearChatSessionMood(chatId, transitionMs);
    },
    async clearActiveChatHistory() {
      return getChatFeature() ? getChatFeature().clearActiveChatHistory() : false;
    },
    async clearChat(chatId) {
      return getChatFeature() ? getChatFeature().clearChat(chatId) : false;
    },
    async deleteChat(chatId) {
      return getChatFeature() ? getChatFeature().deleteChat(chatId) : false;
    },
    async duplicateChat(chatId) {
      return getChatFeature() ? getChatFeature().duplicateChat(chatId) : null;
    },
    async renameActiveChat(title) {
      return getChatFeature() ? getChatFeature().renameActiveChat(title) : null;
    },
    async renameChat(chatId, title) {
      return getChatFeature() ? getChatFeature().renameChat(chatId, title) : null;
    },
    async editMessage(messageId, text, chatId = getChatFeature()?.getActiveChatId()) {
      return getChatFeature() ? getChatFeature().editMessage(messageId, text, chatId) : false;
    },
    async deleteMessage(messageId, chatId = getChatFeature()?.getActiveChatId()) {
      return getChatFeature() ? getChatFeature().deleteMessage(messageId, chatId) : false;
    },
    async exportChats(formatOrOptions = "json", options = {}) {
      const feature = getChatFeature();
      if (!feature?.exportChats) {
        return "";
      }
      return feature.exportChats(formatOrOptions, options);
    },
    async importChats(payload, options = {}) {
      const feature = getChatFeature();
      if (!feature?.importChats) {
        return { error: "chat feature unavailable" };
      }
      return feature.importChats(payload, options);
    },
    async searchChats(query, options = {}) {
      const feature = getChatFeature();
      if (!feature?.searchChats) {
        return { query: String(query || ""), results: [], count: 0 };
      }
      return feature.searchChats(query, options);
    },
    getActiveChatId() {
      return getChatFeature()?.getActiveChatId() || null;
    },
    getChatState(chatId) {
      return getChatFeature()?.getChatSessionMood(chatId) || null;
    },
    listChats() {
      return getChatFeature()?.listChats() || [];
    },
    listChatStates() {
      return getChatFeature()?.listChatStates() || [];
    },
    markThinking() {
      return window.botMood.setState("thinking", 800);
    },
    markSuccess() {
      return window.botMood.setState("success", 1000);
    },
    markError() {
      return window.botMood.setState("error", 900);
    },
    getConfig() {
      return { ...runtimeConfig };
    },
    setConfig(partial) {
      applyRuntimeConfig(partial || {});
      getSettingsFeature()?.hydrateSettingsForm();
      void persistSettingsToBackend({
        includeRuntime: true,
        autonomousMode: runtimeConfig.autonomousMode,
      });
      return { ...runtimeConfig };
    },
    async pingBackend() {
      const result = await getSettingsFeature()?.checkBackendConnection();
      return Boolean(result?.connected);
    },
    goTo(route) {
      navigateToRoute(route);
    },
    openOnboarding() {
      onboardingController?.openOnboarding();
      return true;
    },
    completeOnboarding(skipped = false) {
      return onboardingController?.finishOnboarding({ skipped: Boolean(skipped) }) ?? false;
    },
    getOnboardingState() {
      return onboardingController?.getState() || loadOnboardingState();
    },
    resetOnboarding() {
      return onboardingController?.resetOnboarding() || loadOnboardingState();
    },
  };
}
