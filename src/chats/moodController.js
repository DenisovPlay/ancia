export function createChatMoodController({
  runtimeConfig,
  routeBackgroundState,
  normalizeRoute,
  getRouteFromHash,
  background,
  clamp,
  getActiveChatSessionId,
  getChatSessionById,
  chatMoodBySession,
  updateChatSessionTimestamp,
  persistCurrentChatStore,
}) {
  function getCurrentRouteState() {
    return normalizeRoute(document.body.dataset.route || getRouteFromHash());
  }

  function normalizeBackgroundStateName(name) {
    const normalized = String(name || "").trim().toLowerCase();
    if (background.hasMood(normalized)) {
      return normalized;
    }
    return "neutral";
  }

  function getRouteBackgroundMood(route = getCurrentRouteState()) {
    const normalizedRoute = normalizeRoute(route);
    const routeMood = routeBackgroundState[normalizedRoute] || runtimeConfig.bootMood || "neutral";
    return normalizeBackgroundStateName(routeMood);
  }

  function resolveContextBackgroundMood(route = getCurrentRouteState()) {
    const normalizedRoute = normalizeRoute(route);
    if (normalizedRoute === "chat" && getActiveChatSessionId()) {
      const sessionMood = chatMoodBySession.get(getActiveChatSessionId())?.state;
      if (sessionMood) {
        return normalizeBackgroundStateName(sessionMood);
      }
    }
    return getRouteBackgroundMood(normalizedRoute);
  }

  function applyContextualBackground({ transitionMs = runtimeConfig.defaultTransitionMs, immediate = false } = {}) {
    const targetMood = resolveContextBackgroundMood();
    if (immediate) {
      background.applyMoodInstant(targetMood);
      return targetMood;
    }

    const safeTransition = clamp(Number(transitionMs) || runtimeConfig.defaultTransitionMs, 120, 12000);
    background.setMood(targetMood, safeTransition);
    return targetMood;
  }

  function applyTransientMood(sessionId, moodName, transitionMs = 280) {
    if (!sessionId || sessionId !== getActiveChatSessionId()) return;
    if (getCurrentRouteState() !== "chat") return;
    const normalized = normalizeBackgroundStateName(moodName);
    const safeTransition = clamp(Number(transitionMs) || 280, 80, 3000);
    background.setMood(normalized, safeTransition);
  }

  function setChatSessionMood(
    sessionId,
    moodName,
    transitionMs = runtimeConfig.defaultTransitionMs,
    { applyIfActive = true, immediate = false } = {},
  ) {
    if (!sessionId) {
      return null;
    }

    const normalizedMood = normalizeBackgroundStateName(moodName);
    chatMoodBySession.set(sessionId, {
      state: normalizedMood,
      updatedAt: Date.now(),
    });
    const session = getChatSessionById(sessionId);
    if (session) {
      session.mood = normalizedMood;
      updateChatSessionTimestamp(session);
      persistCurrentChatStore();
    }

    const isChatRoute = getCurrentRouteState() === "chat";
    const isActiveSession = sessionId === getActiveChatSessionId();
    if (applyIfActive && isChatRoute && isActiveSession) {
      if (immediate) {
        background.applyMoodInstant(normalizedMood);
      } else {
        const safeTransition = clamp(Number(transitionMs) || runtimeConfig.defaultTransitionMs, 120, 12000);
        background.setMood(normalizedMood, safeTransition);
      }
    }

    return normalizedMood;
  }

  function clearChatSessionMood(sessionId, transitionMs = runtimeConfig.defaultTransitionMs) {
    if (!sessionId) {
      return;
    }

    chatMoodBySession.delete(sessionId);
    const session = getChatSessionById(sessionId);
    if (session) {
      session.mood = "";
      updateChatSessionTimestamp(session);
      persistCurrentChatStore();
    }
    if (getCurrentRouteState() === "chat" && sessionId === getActiveChatSessionId()) {
      applyContextualBackground({ transitionMs });
    }
  }

  function getChatSessionMood(sessionId) {
    return chatMoodBySession.get(sessionId)?.state || null;
  }

  return {
    getCurrentRouteState,
    normalizeBackgroundStateName,
    getRouteBackgroundMood,
    applyTransientMood,
    setChatSessionMood,
    clearChatSessionMood,
    getChatSessionMood,
    resolveContextBackgroundMood,
    applyContextualBackground,
  };
}
