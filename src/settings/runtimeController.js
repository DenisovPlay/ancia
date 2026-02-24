export function createSettingsRuntimeController({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
  settingsSaveButtons,
  fontController,
  clearFieldValidation,
  isValidTimezone,
  backendClient,
  updateConnectionState,
  BACKEND_STATUS,
  applyRuntimeConfig,
  getChatFeature,
  pushToast,
}) {
  let settingsCommittedFingerprint = getConfigFingerprint(runtimeConfig);
  let saveInFlight = false;

  function getConfigFingerprint(config) {
    return JSON.stringify(normalizeRuntimeConfig(config));
  }

  function hydrateSettingsForm(configOverride = runtimeConfig) {
    const source = normalizeRuntimeConfig(configOverride || runtimeConfig);
    if (elements.settingsRuntimeMode) {
      elements.settingsRuntimeMode.value = source.mode;
    }
    if (elements.settingsBackendUrl) {
      elements.settingsBackendUrl.value = source.backendUrl;
    }
    if (elements.settingsApiKey) {
      elements.settingsApiKey.value = source.apiKey;
    }
    if (elements.settingsTimeoutMs) {
      elements.settingsTimeoutMs.value = String(source.timeoutMs);
    }
    if (elements.settingsAutoReconnect) {
      elements.settingsAutoReconnect.checked = source.autoReconnect;
    }
    if (elements.settingsAutonomousMode) {
      elements.settingsAutonomousMode.checked = Boolean(source.autonomousMode);
    }
    if (elements.settingsContextGuardEnabled) {
      elements.settingsContextGuardEnabled.checked = Boolean(source.contextGuardPluginEnabled);
    }
    if (elements.settingsContextAutoCompress) {
      elements.settingsContextAutoCompress.checked = Boolean(source.contextGuardAutoCompress);
      elements.settingsContextAutoCompress.disabled = !Boolean(source.contextGuardPluginEnabled);
    }
    if (elements.settingsContextChatEvents) {
      elements.settingsContextChatEvents.checked = Boolean(source.contextGuardShowChatEvents);
      elements.settingsContextChatEvents.disabled = !Boolean(source.contextGuardPluginEnabled);
    }
    if (elements.settingsModelFallbackEnabled) {
      elements.settingsModelFallbackEnabled.checked = Boolean(source.modelAutoFallbackEnabled);
    }
    if (elements.settingsModelFallbackProfile) {
      elements.settingsModelFallbackProfile.value = String(source.modelAutoFallbackProfile || "balanced");
      elements.settingsModelFallbackProfile.disabled = !Boolean(source.modelAutoFallbackEnabled);
    }
    if (elements.settingsModelScenarioAutoApply) {
      elements.settingsModelScenarioAutoApply.checked = Boolean(source.modelScenarioAutoApply);
    }
    if (elements.settingsModelScenarioProfile) {
      elements.settingsModelScenarioProfile.value = String(source.modelScenarioProfile || "auto");
      elements.settingsModelScenarioProfile.disabled = !Boolean(source.modelScenarioAutoApply);
    }
    if (elements.settingsBootMood) {
      elements.settingsBootMood.value = source.bootMood;
    }
    if (elements.settingsDefaultTransition) {
      elements.settingsDefaultTransition.value = String(source.defaultTransitionMs);
    }
    if (elements.settingsUserName) {
      elements.settingsUserName.value = source.userName;
    }
    if (elements.settingsUserContext) {
      elements.settingsUserContext.value = source.userContext;
    }
    if (elements.settingsUserLanguage) {
      elements.settingsUserLanguage.value = source.userLanguage;
    }
    if (elements.settingsUserTimezone) {
      elements.settingsUserTimezone.value = source.userTimezone;
    }
    if (elements.settingsUiDensity) {
      elements.settingsUiDensity.value = source.uiDensity;
    }
    if (elements.settingsUiAnimations) {
      elements.settingsUiAnimations.checked = source.uiAnimations;
    }
    if (elements.settingsUiFontScale) {
      elements.settingsUiFontScale.value = String(source.uiFontScale);
    }
    if (elements.settingsUiFontPreset) {
      elements.settingsUiFontPreset.value = String(source.uiFontPreset || "system");
    }
    if (elements.settingsUiFontFamily instanceof HTMLSelectElement) {
      fontController.renderOptions(String(source.uiFontFamily || ""));
    }
    fontController.syncControls();
    if (elements.settingsUiShowInspector) {
      elements.settingsUiShowInspector.checked = source.uiShowInspector;
    }
  }

  function collectSettingsForm() {
    return normalizeRuntimeConfig({
      ...runtimeConfig,
      mode: elements.settingsRuntimeMode?.value,
      backendUrl: elements.settingsBackendUrl?.value,
      apiKey: elements.settingsApiKey?.value,
      timeoutMs: elements.settingsTimeoutMs?.value,
      autoReconnect: elements.settingsAutoReconnect?.checked,
      autonomousMode: elements.settingsAutonomousMode?.checked,
      contextGuardPluginEnabled: elements.settingsContextGuardEnabled?.checked,
      contextGuardAutoCompress: elements.settingsContextAutoCompress?.checked,
      contextGuardShowChatEvents: elements.settingsContextChatEvents?.checked,
      modelAutoFallbackEnabled: elements.settingsModelFallbackEnabled?.checked,
      modelAutoFallbackProfile: elements.settingsModelFallbackProfile?.value,
      modelScenarioAutoApply: elements.settingsModelScenarioAutoApply?.checked,
      modelScenarioProfile: elements.settingsModelScenarioProfile?.value,
      bootMood: elements.settingsBootMood?.value,
      defaultTransitionMs: elements.settingsDefaultTransition?.value,
      userName: elements.settingsUserName?.value,
      userContext: elements.settingsUserContext?.value,
      userLanguage: elements.settingsUserLanguage?.value,
      userTimezone: elements.settingsUserTimezone?.value,
      uiDensity: elements.settingsUiDensity?.value,
      uiAnimations: elements.settingsUiAnimations?.checked,
      uiFontScale: elements.settingsUiFontScale?.value,
      uiFontPreset: elements.settingsUiFontPreset?.value,
      uiFontFamily: elements.settingsUiFontFamily?.value,
      uiShowInspector: elements.settingsUiShowInspector?.checked,
    });
  }

  function syncSettingsDirtyState() {
    if (!elements.settingsRuntimeMode) {
      return;
    }

    const isDirty = getConfigFingerprint(collectSettingsForm()) !== settingsCommittedFingerprint;
    settingsSaveButtons.forEach((button) => {
      const disabled = !isDirty || saveInFlight;
      button.disabled = disabled;
      button.setAttribute("aria-disabled", String(disabled));
    });

    if (elements.settingsDirtyBadge) {
      elements.settingsDirtyBadge.classList.toggle("hidden", !isDirty);
    }
  }

  function resetSettingsValidation() {
    [
      elements.settingsBackendUrl,
      elements.settingsUserTimezone,
    ].forEach(clearFieldValidation);
  }

  function validateSettingsDraft(config) {
    const issues = [];

    if (config.mode === "backend") {
      if (!config.backendUrl) {
        issues.push({
          field: elements.settingsBackendUrl,
          message: "Укажите URL бэкенда для режима сервера.",
        });
      } else {
        try {
          const target = new URL(config.backendUrl);
          if (!/^https?:$/.test(target.protocol)) {
            issues.push({
              field: elements.settingsBackendUrl,
              message: "URL бэкенда должен начинаться с http:// или https://.",
            });
          }
        } catch {
          issues.push({
            field: elements.settingsBackendUrl,
            message: "URL бэкенда указан в неверном формате.",
          });
        }
      }
    }

    if (config.userTimezone && !isValidTimezone(config.userTimezone)) {
      issues.push({
        field: elements.settingsUserTimezone,
        message: "Часовой пояс не распознан. Используйте формат Europe/Moscow.",
      });
    }

    return issues;
  }

  function resolveHealthStartupState(healthPayload) {
    const startup = healthPayload && typeof healthPayload === "object" ? healthPayload.startup : null;
    const autonomousMode = Boolean(
      healthPayload?.policy?.autonomous_mode
      || healthPayload?.autonomous_mode,
    );
    const status = String(startup?.status || "").trim().toLowerCase();
    const stage = String(startup?.stage || "").trim().toLowerCase();
    const rawMessage = String(startup?.message || "").trim();

    const stageLabel = stage === "environment_check"
      ? "Проверка окружения Python/MLX..."
      : stage === "checking_gpu_memory"
        ? "Проверка доступной GPU/unified памяти..."
      : stage === "loading_model"
        ? "Загрузка выбранной модели..."
      : stage === "unloaded"
        ? "Модель пока не загружена. Запустится при первом запросе."
      : stage === "ready"
        ? "Модель готова."
      : stage === "error"
        ? "Ошибка запуска модели."
      : "Проверка состояния модели...";

    return {
      status: status || "loading",
      message: `${rawMessage || stageLabel}${autonomousMode ? " • Автономный режим" : ""}`,
      autonomousMode,
    };
  }

  async function checkBackendConnection(configOverride = runtimeConfig) {
    const effectiveConfig = normalizeRuntimeConfig(configOverride || runtimeConfig);
    backendClient.setConfig({
      baseUrl: effectiveConfig.backendUrl,
      apiKey: effectiveConfig.apiKey,
      timeoutMs: effectiveConfig.timeoutMs,
    });

    if (!effectiveConfig.backendUrl || effectiveConfig.mode !== "backend") {
      updateConnectionState(BACKEND_STATUS.idle, effectiveConfig.mode === "backend"
        ? "Укажите URL бэкенд-сервера"
        : "Активен режим симуляции");
      return { connected: false, status: BACKEND_STATUS.idle };
    }

    updateConnectionState(BACKEND_STATUS.checking, "Проверяем /health ...");
    try {
      const health = await backendClient.ping();
      const startup = resolveHealthStartupState(health);
      if (startup.status === "error") {
        updateConnectionState(BACKEND_STATUS.error, startup.message, health);
        return { connected: false, status: BACKEND_STATUS.error };
      }
      if (startup.status !== "ready" && startup.status !== "idle") {
        updateConnectionState(BACKEND_STATUS.checking, startup.message, health);
        return { connected: false, status: BACKEND_STATUS.checking };
      }

      updateConnectionState(
        BACKEND_STATUS.connected,
        startup.status === "ready"
          ? "Бэкенд доступен, модель готова"
          : "Бэкенд доступен, модель загрузится при первом сообщении",
        health,
      );
      if (effectiveConfig.mode === "backend") {
        void getChatFeature()?.syncChatStoreFromBackend({ preserveActive: true, silent: true });
      }
      return { connected: true, status: BACKEND_STATUS.connected };
    } catch (error) {
      updateConnectionState(BACKEND_STATUS.error, `Недоступен: ${error.message}`);
      return { connected: false, status: BACKEND_STATUS.error };
    }
  }

  async function saveSettings() {
    if (saveInFlight) {
      return false;
    }
    saveInFlight = true;
    syncSettingsDirtyState();
    resetSettingsValidation();
    try {
      const nextConfig = collectSettingsForm();
      if (getConfigFingerprint(nextConfig) === settingsCommittedFingerprint) {
        syncSettingsDirtyState();
        pushToast("Изменений для сохранения нет.", { tone: "neutral", durationMs: 2200 });
        return true;
      }

      const issues = validateSettingsDraft(nextConfig);

      if (issues.length > 0) {
        issues.forEach((issue) => {
          if (issue.field) {
            issue.field.classList.add("field-invalid");
            issue.field.setAttribute("aria-invalid", "true");
          }
        });
        issues[0]?.field?.focus();
        pushToast(issues[0]?.message || "Проверьте введённые настройки.", { tone: "error" });
        syncSettingsDirtyState();
        return false;
      }

      applyRuntimeConfig(nextConfig);
      let settingsSavedInBackend = false;
      if (runtimeConfig.mode === "backend" && runtimeConfig.backendUrl) {
        try {
          await backendClient.updateSettings({
            runtime_config: runtimeConfig,
            autonomous_mode: runtimeConfig.autonomousMode,
          });
          settingsSavedInBackend = true;
        } catch (error) {
          pushToast(`Не удалось сохранить настройки в бэкенде: ${error.message}`, {
            tone: "warning",
            durationMs: 3600,
          });
        }
      }
      getChatFeature()?.applyContextualBackground({ immediate: true });
      updateConnectionState(BACKEND_STATUS.idle, "Настройки сохранены");
      syncSettingsDirtyState();
      pushToast(
        settingsSavedInBackend ? "Настройки сохранены." : "Настройки сохранены локально.",
        { tone: "success" },
      );

      if (runtimeConfig.mode === "backend" && runtimeConfig.autoReconnect) {
        const connection = await checkBackendConnection();
        const connected = connection.connected;
        const loading = !connected && connection.status === BACKEND_STATUS.checking;
        pushToast(
          connected
            ? "Соединение с сервером подтверждено."
            : loading
              ? "Сервер отвечает, модель ещё загружается."
              : "Авто-проверка сервера завершилась ошибкой.",
          { tone: connected ? "success" : loading ? "neutral" : "warning", durationMs: 3400 },
        );
      }

      return true;
    } finally {
      saveInFlight = false;
      syncSettingsDirtyState();
    }
  }

  function onRuntimeConfigApplied() {
    settingsCommittedFingerprint = getConfigFingerprint(runtimeConfig);
    hydrateSettingsForm(runtimeConfig);
    syncSettingsDirtyState();
  }

  return {
    hydrateSettingsForm,
    collectSettingsForm,
    syncSettingsDirtyState,
    resetSettingsValidation,
    validateSettingsDraft,
    checkBackendConnection,
    saveSettings,
    onRuntimeConfigApplied,
  };
}
