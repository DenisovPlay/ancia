export function createRuntimeConfigController({
  runtimeConfig,
  normalizeRuntimeConfig,
  persistRuntimeConfig,
  backendClient,
  updateRuntimeBadges,
  applyInterfacePreferences,
  getSettingsFeature,
  getPluginsFeature,
  getOnboardingController,
  loadOnboardingState,
  pushToast,
}) {
  function applyRuntimeConfig(partial = {}) {
    const previousConfig = { ...runtimeConfig };
    const next = normalizeRuntimeConfig({
      ...runtimeConfig,
      ...partial,
    });

    Object.assign(runtimeConfig, next);
    persistRuntimeConfig(runtimeConfig);

    backendClient.setConfig({
      baseUrl: runtimeConfig.backendUrl,
      apiKey: runtimeConfig.apiKey,
      timeoutMs: runtimeConfig.timeoutMs,
    });

    updateRuntimeBadges();
    applyInterfacePreferences();
    getSettingsFeature()?.onRuntimeConfigApplied();
    if (previousConfig.autonomousMode !== runtimeConfig.autonomousMode) {
      void getPluginsFeature()?.reload?.();
    }
    if (getOnboardingController()?.isOpen()) {
      getOnboardingController()?.hydrateForm();
    }
  }

  async function hydrateSettingsFromBackend({ silent = true } = {}) {
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.backendUrl) {
      return false;
    }
    try {
      const payload = await backendClient.getSettings();
      if (payload && typeof payload === "object") {
        const runtimeFromBackend = payload.runtime_config;
        if (runtimeFromBackend && typeof runtimeFromBackend === "object") {
          applyRuntimeConfig(runtimeFromBackend);
        }
        const onboardingFromBackend = payload.onboarding_state;
        if (onboardingFromBackend && typeof onboardingFromBackend === "object") {
          getOnboardingController()?.setStateFromBackend(onboardingFromBackend);
        }
      }
      return true;
    } catch (error) {
      if (!silent) {
        pushToast(`Не удалось получить настройки из бэкенда: ${error.message}`, {
          tone: "warning",
          durationMs: 3600,
        });
      }
      return false;
    }
  }

  async function persistSettingsToBackend({
    includeRuntime = false,
    includeOnboarding = false,
    autonomousMode = undefined,
  } = {}) {
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.backendUrl) {
      return false;
    }

    const payload = {};
    if (includeRuntime) {
      payload.runtime_config = { ...runtimeConfig };
    }
    if (includeOnboarding) {
      payload.onboarding_state = getOnboardingController()?.getState?.() || loadOnboardingState();
    }
    if (autonomousMode !== undefined) {
      payload.autonomous_mode = Boolean(autonomousMode);
    }
    if (Object.keys(payload).length === 0) {
      return true;
    }

    try {
      await backendClient.updateSettings(payload);
      return true;
    } catch (error) {
      return false;
    }
  }

  return {
    applyRuntimeConfig,
    hydrateSettingsFromBackend,
    persistSettingsToBackend,
  };
}
