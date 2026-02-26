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
  let auditRefreshRevision = 0;
  let serverUsersCache = new Map();

  const USER_PERMISSION_MODELS_DOWNLOAD = "models_download";
  const USER_PERMISSION_PLUGINS_DOWNLOAD = "plugins_download";
  const LEGACY_USER_PERMISSION_MODELS = "models";
  const LEGACY_USER_PERMISSION_PLUGINS = "plugins";

  function getConfigFingerprint(config) {
    return JSON.stringify(normalizeRuntimeConfig(config));
  }

  function hydrateSettingsForm(configOverride = runtimeConfig) {
    const source = normalizeRuntimeConfig(configOverride || runtimeConfig);
    if (elements.settingsDeploymentMode) {
      elements.settingsDeploymentMode.value = source.deploymentMode || "local";
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
    if (elements.settingsServerAllowRegistration) {
      elements.settingsServerAllowRegistration.checked = Boolean(source.serverAllowRegistration);
    }
    if (elements.settingsLoginUsername && !String(elements.settingsLoginUsername.value || "").trim()) {
      elements.settingsLoginUsername.value = String(source.authUsername || "");
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
    const deploymentMode = String(elements.settingsDeploymentMode?.value || runtimeConfig.deploymentMode || "local")
      .trim()
      .toLowerCase();
    const safeDeploymentMode = (
      deploymentMode === "remote_client" || deploymentMode === "remote_server"
        ? deploymentMode
        : "local"
    );
    return normalizeRuntimeConfig({
      ...runtimeConfig,
      mode: "backend",
      deploymentMode: safeDeploymentMode,
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
      serverAllowRegistration: elements.settingsServerAllowRegistration?.checked,
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
    if (!settingsSaveButtons.length) {
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
    const deploymentMode = resolveDeploymentModeValue(effectiveConfig.deploymentMode);
    backendClient.setConfig({
      baseUrl: effectiveConfig.backendUrl,
      apiKey: effectiveConfig.apiKey,
      authToken: effectiveConfig.authToken,
      timeoutMs: effectiveConfig.timeoutMs,
    });

    if (!effectiveConfig.backendUrl) {
      updateConnectionState(
        BACKEND_STATUS.idle,
        "Укажите URL бэкенд-сервера",
      );
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
      void getChatFeature()?.syncChatStoreFromBackend({ preserveActive: true, silent: true });
      if (deploymentMode !== "local") {
        void refreshServerAuthState({
          includeUsers: isRemoteServerMode(effectiveConfig.deploymentMode),
          includeAudit: true,
          silent: true,
        });
      }
      return { connected: true, status: BACKEND_STATUS.connected };
    } catch (error) {
      updateConnectionState(BACKEND_STATUS.error, `Недоступен: ${error.message}`);
      return { connected: false, status: BACKEND_STATUS.error };
    }
  }

  function setAuthStatusLabel(text, { tone = "neutral" } = {}) {
    if (!(elements.settingsAuthStatus instanceof HTMLElement)) {
      return;
    }
    const safeTone = String(tone || "neutral").trim().toLowerCase();
    elements.settingsAuthStatus.textContent = String(text || "unknown");
    elements.settingsAuthStatus.className = "rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide";
    if (safeTone === "success") {
      elements.settingsAuthStatus.classList.add("border-emerald-900/40", "bg-emerald-950/40", "text-emerald-300");
    } else if (safeTone === "warning") {
      elements.settingsAuthStatus.classList.add("border-amber-900/40", "bg-amber-950/40", "text-amber-300");
    } else if (safeTone === "error") {
      elements.settingsAuthStatus.classList.add("border-red-900/40", "bg-red-950/40", "text-red-300");
    } else {
      elements.settingsAuthStatus.classList.add("border-zinc-800", "bg-zinc-900", "text-zinc-400");
    }
  }

  function setAuthUserText(text) {
    if (elements.settingsAuthUser instanceof HTMLElement) {
      elements.settingsAuthUser.textContent = String(text || "");
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function permissionValueToBool(value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ["1", "true", "yes", "on", "allow", "allowed", "enabled"].includes(normalized);
  }

  function readUserPermissionValue(user, permissionKey, fallbackKeys = []) {
    const permissions = user?.permissions && typeof user.permissions === "object" ? user.permissions : {};
    if (Object.prototype.hasOwnProperty.call(permissions, permissionKey)) {
      return permissionValueToBool(permissions[permissionKey]);
    }
    for (const fallbackKey of fallbackKeys) {
      if (Object.prototype.hasOwnProperty.call(permissions, fallbackKey)) {
        return permissionValueToBool(permissions[fallbackKey]);
      }
    }
    return false;
  }

  function buildUserPermissionSnapshot(user) {
    const permissions = user?.permissions && typeof user.permissions === "object" ? { ...user.permissions } : {};
    return {
      raw: permissions,
      modelsDownload: readUserPermissionValue(
        user,
        USER_PERMISSION_MODELS_DOWNLOAD,
        [LEGACY_USER_PERMISSION_MODELS],
      ),
      pluginsDownload: readUserPermissionValue(
        user,
        USER_PERMISSION_PLUGINS_DOWNLOAD,
        [LEGACY_USER_PERMISSION_PLUGINS],
      ),
    };
  }

  function resolveDeploymentModeValue(value = runtimeConfig.deploymentMode) {
    const normalized = String(value || "local").trim().toLowerCase();
    if (normalized === "remote_server" || normalized === "remote_client") {
      return normalized;
    }
    return "local";
  }

  function isRemoteServerMode(value = runtimeConfig.deploymentMode) {
    return resolveDeploymentModeValue(value) === "remote_server";
  }

  function toggleSectionVisibility(node, hidden = false) {
    if (node instanceof HTMLElement) {
      node.classList.toggle("hidden", Boolean(hidden));
    }
  }

  function setServerModeHint(text, { tone = "neutral" } = {}) {
    if (!(elements.settingsServerModeHint instanceof HTMLElement)) {
      return;
    }
    elements.settingsServerModeHint.textContent = String(text || "");
    elements.settingsServerModeHint.className = "text-xs";
    const safeTone = String(tone || "neutral").trim().toLowerCase();
    if (safeTone === "error") {
      elements.settingsServerModeHint.classList.add("text-red-400");
    } else if (safeTone === "warning") {
      elements.settingsServerModeHint.classList.add("text-amber-400");
    } else if (safeTone === "success") {
      elements.settingsServerModeHint.classList.add("text-emerald-400");
    } else {
      elements.settingsServerModeHint.classList.add("text-zinc-600");
    }
  }

  function setAuthControlsEnabled(enabled = true) {
    const shouldEnable = Boolean(enabled);
    [
      elements.settingsLoginUsername,
      elements.settingsLoginPassword,
      elements.settingsLoginButton,
      elements.settingsRegisterButton,
      elements.settingsLogoutButton,
    ].forEach((node) => {
      if (
        node instanceof HTMLInputElement
        || node instanceof HTMLSelectElement
        || node instanceof HTMLButtonElement
      ) {
        node.disabled = !shouldEnable;
      }
    });
  }

  function applyServerModeUi({
    deploymentMode = runtimeConfig.deploymentMode,
    authenticated = false,
    isAdmin = false,
    allowRegistration = false,
    hasAdmin = false,
  } = {}) {
    const mode = resolveDeploymentModeValue(deploymentMode);
    const isLocal = mode === "local";
    const isServerMode = mode === "remote_server";
    const isClientMode = mode === "remote_client";

    const canUseAuthControls = !isLocal;
    const canRegister = canUseAuthControls && !authenticated && (allowRegistration || !hasAdmin);
    const canManageServer = isServerMode && authenticated && isAdmin;
    const canBootstrap = isServerMode && !hasAdmin;

    if (isLocal) {
      setServerModeHint("Локальный режим: обычная работа с локальными моделями и плагинами, без аккаунтов.");
    } else if (isClientMode) {
      setServerModeHint("Удалённый режим: подключение к серверу по логину/паролю или токену.", { tone: "neutral" });
    } else if (!authenticated) {
      setServerModeHint(
        hasAdmin
          ? "Серверный режим: войдите как администратор для управления доступами."
          : "Серверный режим: сначала создайте первого администратора.",
        { tone: hasAdmin ? "warning" : "neutral" },
      );
    } else if (isAdmin) {
      setServerModeHint("Серверный режим: административные функции активны.", { tone: "success" });
    } else {
      setServerModeHint("Серверный режим: вы вошли без прав администратора.", { tone: "warning" });
    }

    setAuthControlsEnabled(canUseAuthControls);
    if (elements.settingsRegisterButton instanceof HTMLButtonElement) {
      elements.settingsRegisterButton.disabled = !canRegister;
      elements.settingsRegisterButton.title = canRegister
        ? ""
        : isLocal
          ? "Регистрация недоступна в локальном режиме."
          : hasAdmin && !allowRegistration
            ? "Регистрация отключена сервером."
            : authenticated
              ? "Вы уже авторизованы."
              : "Регистрация недоступна.";
    }

    toggleSectionVisibility(elements.settingsServerRegistrationRow, !isServerMode);
    toggleSectionVisibility(elements.settingsServerAuthStatusRow, isLocal);
    toggleSectionVisibility(elements.settingsServerBootstrapPanel, !isServerMode);
    toggleSectionVisibility(elements.settingsServerSessionPanel, isLocal);
    toggleSectionVisibility(elements.settingsServerUsersPanel, !isServerMode);
    toggleSectionVisibility(elements.settingsServerAuditPanel, !isServerMode);

    if (elements.settingsServerAllowRegistration instanceof HTMLInputElement) {
      elements.settingsServerAllowRegistration.disabled = !canManageServer;
    }
    if (elements.settingsBootstrapUsername instanceof HTMLInputElement) {
      elements.settingsBootstrapUsername.disabled = !canBootstrap;
    }
    if (elements.settingsBootstrapPassword instanceof HTMLInputElement) {
      elements.settingsBootstrapPassword.disabled = !canBootstrap;
    }
    if (elements.settingsBootstrapAdmin instanceof HTMLButtonElement) {
      elements.settingsBootstrapAdmin.disabled = !canBootstrap;
    }

    setServerAdminControlsEnabled(canManageServer);
  }

  function renderServerUsers(users = [], { isAdmin = false } = {}) {
    const target = elements.settingsUsersList;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    serverUsersCache = new Map();
    target.innerHTML = "";

    const safeUsers = Array.isArray(users) ? users : [];
    if (!safeUsers.length) {
      target.innerHTML = '<p class="text-xs text-zinc-600">Пользователи не найдены.</p>';
      return;
    }

    safeUsers.forEach((user) => {
      const id = String(user?.id || "").trim();
      const username = String(user?.username || "").trim() || "user";
      const role = String(user?.role || "user").trim().toLowerCase();
      const status = String(user?.status || "active").trim().toLowerCase();
      serverUsersCache.set(id, user);
      const permissionSnapshot = buildUserPermissionSnapshot(user);
      const modelsDownloadEnabled = permissionSnapshot.modelsDownload;
      const pluginsDownloadEnabled = permissionSnapshot.pluginsDownload;
      const safeId = escapeHtml(id);
      const safeUsername = escapeHtml(username);
      const row = document.createElement("div");
      row.className = "rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 text-xs text-zinc-300";
      const roleBadge = role === "admin"
        ? '<span class="rounded border border-sky-900/40 bg-sky-950/40 px-1.5 py-0.5 text-[10px] text-sky-300">admin</span>'
        : '<span class="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">user</span>';
      const statusBadge = status === "blocked"
        ? '<span class="rounded border border-red-900/40 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">blocked</span>'
        : '<span class="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">active</span>';
      const modelsPermissionBadge = modelsDownloadEnabled
        ? '<span class="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">models dl:on</span>'
        : '<span class="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">models dl:off</span>';
      const pluginsPermissionBadge = pluginsDownloadEnabled
        ? '<span class="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">plugins dl:on</span>'
        : '<span class="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">plugins dl:off</span>';
      const actions = isAdmin
        ? `
          <button type="button" data-server-user-action="toggle-status" data-user-id="${safeId}" data-user-status="${status}" class="rounded border border-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-800">
            ${status === "blocked" ? "Разблокировать" : "Блокировать"}
          </button>
          <button type="button" data-server-user-action="toggle-role" data-user-id="${safeId}" data-user-role="${role}" class="rounded border border-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-800">
            ${role === "admin" ? "Сделать user" : "Сделать admin"}
          </button>
          <button type="button" data-server-user-action="toggle-permission" data-user-id="${safeId}" data-permission-key="${USER_PERMISSION_MODELS_DOWNLOAD}" data-permission-value="${modelsDownloadEnabled ? "true" : "false"}" class="rounded border border-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-800">
            ${modelsDownloadEnabled ? "Модели: запретить" : "Модели: разрешить"}
          </button>
          <button type="button" data-server-user-action="toggle-permission" data-user-id="${safeId}" data-permission-key="${USER_PERMISSION_PLUGINS_DOWNLOAD}" data-permission-value="${pluginsDownloadEnabled ? "true" : "false"}" class="rounded border border-zinc-700 px-2 py-1 text-[10px] hover:bg-zinc-800">
            ${pluginsDownloadEnabled ? "Плагины: запретить" : "Плагины: разрешить"}
          </button>
        `
        : "";
      row.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] text-zinc-200">${safeUsername}</span>
            ${roleBadge}
            ${statusBadge}
            ${modelsPermissionBadge}
            ${pluginsPermissionBadge}
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            ${actions}
          </div>
        </div>
      `;
      target.append(row);
    });
  }

  function setServerAdminControlsEnabled(enabled = false) {
    const shouldEnable = Boolean(enabled);
    [
      elements.settingsUsersRefresh,
      elements.settingsCreateUserUsername,
      elements.settingsCreateUserPassword,
      elements.settingsCreateUserRole,
      elements.settingsCreateUserModelDownload,
      elements.settingsCreateUserPluginDownload,
      elements.settingsCreateUserButton,
      elements.settingsAuditRefresh,
      elements.settingsAuditActionPrefix,
      elements.settingsAuditActorUserId,
      elements.settingsAuditStatus,
      elements.settingsAuditLimit,
    ].forEach((node) => {
      if (
        node instanceof HTMLInputElement
        || node instanceof HTMLSelectElement
        || node instanceof HTMLButtonElement
      ) {
        node.disabled = !shouldEnable;
      }
    });
  }

  function setAuditMetaText(text, { tone = "neutral" } = {}) {
    if (!(elements.settingsAuditMeta instanceof HTMLElement)) {
      return;
    }
    elements.settingsAuditMeta.textContent = String(text || "");
    elements.settingsAuditMeta.className = "text-xs";
    const safeTone = String(tone || "neutral").trim().toLowerCase();
    if (safeTone === "error") {
      elements.settingsAuditMeta.classList.add("text-red-400");
    } else if (safeTone === "warning") {
      elements.settingsAuditMeta.classList.add("text-amber-400");
    } else if (safeTone === "success") {
      elements.settingsAuditMeta.classList.add("text-emerald-400");
    } else {
      elements.settingsAuditMeta.classList.add("text-zinc-600");
    }
  }

  function collectServerAuditFilters() {
    const parsedLimit = Math.round(Number(elements.settingsAuditLimit?.value || 200));
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(1000, parsedLimit))
      : 200;
    const safeStatus = String(elements.settingsAuditStatus?.value || "").trim().toLowerCase();
    return {
      limit: safeLimit,
      actorUserId: String(elements.settingsAuditActorUserId?.value || "").trim(),
      actionPrefix: String(elements.settingsAuditActionPrefix?.value || "").trim().toLowerCase(),
      status: safeStatus && safeStatus !== "all" ? safeStatus : "",
    };
  }

  function formatAuditTimestamp(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "unknown time";
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return raw;
    }
    return parsed.toLocaleString("ru-RU", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function summarizeAuditDetails(details) {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return "";
    }
    try {
      const serialized = JSON.stringify(details);
      if (serialized.length <= 240) {
        return serialized;
      }
      return `${serialized.slice(0, 237)}...`;
    } catch {
      return "";
    }
  }

  function renderServerAudit(events = [], { message = "" } = {}) {
    const listTarget = elements.settingsAuditList;
    if (!(listTarget instanceof HTMLElement)) {
      return;
    }
    listTarget.innerHTML = "";

    if (message) {
      setAuditMetaText(message, { tone: "warning" });
      listTarget.innerHTML = '<p class="text-xs text-zinc-600">События аудита недоступны.</p>';
      return;
    }

    const safeEvents = Array.isArray(events) ? events : [];
    if (!safeEvents.length) {
      setAuditMetaText("События не найдены.", { tone: "neutral" });
      listTarget.innerHTML = '<p class="text-xs text-zinc-600">Журнал пуст.</p>';
      return;
    }

    safeEvents.forEach((event) => {
      const action = escapeHtml(String(event?.action || "unknown"));
      const actorName = String(event?.actor_username || "").trim();
      const actorUserId = String(event?.actor_user_id || "").trim();
      const actorLabelRaw = actorName || actorUserId || "system";
      const actorLabel = escapeHtml(actorLabelRaw);
      const targetType = String(event?.target_type || "").trim();
      const targetId = String(event?.target_id || "").trim();
      const targetLabelRaw = [targetType, targetId].filter(Boolean).join(":") || "-";
      const targetLabel = escapeHtml(targetLabelRaw);
      const createdAt = escapeHtml(formatAuditTimestamp(event?.created_at));
      const status = String(event?.status || "ok").trim().toLowerCase();
      const statusBadge = status === "error"
        ? '<span class="rounded border border-red-900/40 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">error</span>'
        : status === "denied"
          ? '<span class="rounded border border-amber-900/40 bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">denied</span>'
          : '<span class="rounded border border-emerald-900/40 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">ok</span>';
      const detailsText = escapeHtml(summarizeAuditDetails(event?.details));
      const detailsBlock = detailsText
        ? `<p class="mt-1 break-all font-mono text-[10px] text-zinc-500">${detailsText}</p>`
        : "";
      const row = document.createElement("div");
      row.className = "rounded-lg border border-zinc-800 bg-zinc-900/30 px-2.5 py-2";
      row.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-mono text-[10px] text-zinc-500">${createdAt}</span>
          ${statusBadge}
        </div>
        <p class="mt-1 break-all font-mono text-[11px] text-zinc-200">${action}</p>
        <p class="mt-1 text-[11px] text-zinc-400">actor: ${actorLabel}</p>
        <p class="text-[11px] text-zinc-500">target: ${targetLabel}</p>
        ${detailsBlock}
      `;
      listTarget.append(row);
    });
  }

  async function refreshServerAuditLog({ silent = true } = {}) {
    const deploymentMode = resolveDeploymentModeValue(runtimeConfig.deploymentMode);
    if (deploymentMode === "local") {
      renderServerAudit([], { message: "Локальный режим: аудит отключен." });
      setServerAdminControlsEnabled(false);
      return {
        deploymentMode,
        events: [],
      };
    }
    if (deploymentMode !== "remote_server") {
      renderServerAudit([], { message: "Аудит доступен только в режиме удалённого сервера." });
      setServerAdminControlsEnabled(false);
      return {
        deploymentMode,
        events: [],
      };
    }
    if (!runtimeConfig.backendUrl) {
      renderServerAudit([], { message: "Укажите URL бэкенда для аудита." });
      setServerAdminControlsEnabled(false);
      return {
        deploymentMode,
        events: [],
      };
    }

    const revision = ++auditRefreshRevision;
    setAuditMetaText("Загружаем аудит...", { tone: "neutral" });
    try {
      const filters = collectServerAuditFilters();
      const payload = await backendClient.getAdminAudit(filters);
      if (revision !== auditRefreshRevision) {
        return {
          deploymentMode,
          events: [],
        };
      }
      const events = Array.isArray(payload?.events) ? payload.events : [];
      renderServerAudit(events);
      const count = Number(payload?.count ?? events.length);
      const prefixSuffix = filters.actionPrefix ? ` · prefix=${filters.actionPrefix}` : "";
      setAuditMetaText(`Событий: ${count}${prefixSuffix}`, { tone: "neutral" });
      return {
        deploymentMode,
        events,
      };
    } catch (error) {
      renderServerAudit([], { message: "Не удалось загрузить аудит." });
      setAuditMetaText(`Ошибка аудита: ${error.message}`, { tone: "error" });
      if (!silent) {
        pushToast(`Не удалось получить аудит: ${error.message}`, {
          tone: "error",
          durationMs: 3600,
        });
      }
      return {
        deploymentMode,
        events: [],
      };
    }
  }

  async function refreshServerAuthState({ includeUsers = false, includeAudit = true, silent = true } = {}) {
    const deploymentMode = resolveDeploymentModeValue(runtimeConfig.deploymentMode);
    const isServerMode = deploymentMode === "remote_server";
    const shouldLoadUsers = Boolean(includeUsers) && isServerMode;
    const shouldLoadAudit = Boolean(includeAudit) && isServerMode;

    if (deploymentMode === "local") {
      setAuthStatusLabel("local", { tone: "neutral" });
      setAuthUserText("Локальный режим: аккаунты отключены.");
      renderServerUsers([], { isAdmin: false });
      renderServerAudit([], { message: "Локальный режим: аудит отключен." });
      applyServerModeUi({
        deploymentMode,
        authenticated: false,
        isAdmin: false,
        allowRegistration: false,
        hasAdmin: false,
      });
      return {
        deploymentMode,
        authenticated: false,
        me: null,
        isAdmin: false,
      };
    }

    if (!runtimeConfig.backendUrl) {
      setAuthStatusLabel("no backend", { tone: "warning" });
      setAuthUserText("Укажите URL бэкенда.");
      renderServerUsers([], { isAdmin: false });
      renderServerAudit([], { message: "Укажите URL бэкенда для аудита." });
      applyServerModeUi({
        deploymentMode,
        authenticated: false,
        isAdmin: false,
        allowRegistration: false,
        hasAdmin: false,
      });
      return {
        deploymentMode,
        authenticated: false,
        me: null,
        isAdmin: false,
      };
    }

    try {
      const authConfig = await backendClient.getAuthConfig();
      const authRequired = Boolean(authConfig?.auth_required);
      const hasAdmin = Boolean(authConfig?.has_admin);
      const allowRegistration = Boolean(authConfig?.allow_registration);
      const usersCount = Number(authConfig?.users_count || 0);
      const serverDeploymentMode = String(authConfig?.deployment_mode || "").trim().toLowerCase();
      const targetIsRemoteServer = serverDeploymentMode === "remote_server";
      const baseStatus = authRequired ? "auth required" : "open";
      setAuthStatusLabel(baseStatus, { tone: authRequired ? "warning" : "neutral" });
      if (elements.settingsServerAllowRegistration instanceof HTMLInputElement) {
        elements.settingsServerAllowRegistration.checked = allowRegistration;
      }

      if (!targetIsRemoteServer) {
        setAuthStatusLabel("auth off", { tone: "warning" });
        setAuthUserText("Целевой backend не работает в режиме удалённого сервера.");
        renderServerUsers([], { isAdmin: false });
        renderServerAudit([], { message: "Аудит недоступен: сервер работает без remote_server." });
        applyServerModeUi({
          deploymentMode,
          authenticated: false,
          isAdmin: false,
          allowRegistration: false,
          hasAdmin,
        });
        setServerModeHint("Целевой бэкенд не поддерживает серверную авторизацию.", { tone: "warning" });
        return {
          deploymentMode,
          authConfig,
          authenticated: false,
          me: null,
          isAdmin: false,
        };
      }

      let mePayload = null;
      try {
        mePayload = await backendClient.getMe();
      } catch {
        mePayload = null;
      }

      const isAuthenticated = Boolean(mePayload?.authenticated && mePayload?.user);
      const meUser = isAuthenticated ? mePayload.user : null;
      if (isAuthenticated) {
        const userName = String(meUser?.username || "user");
        const userRole = String(meUser?.role || "user");
        setAuthStatusLabel("authenticated", { tone: "success" });
        setAuthUserText(`Вы вошли как ${userName} (${userRole}).`);
        if (runtimeConfig.authUsername !== userName) {
          applyRuntimeConfig({
            authUsername: userName,
          });
        }
      } else {
        setAuthUserText(
          hasAdmin
            ? `Сервер готов (${usersCount} users). Войдите по логину/паролю или токену.`
            : "Сервер без админа: выполните bootstrap.",
        );
      }

      const isAdmin = String(meUser?.role || "").trim().toLowerCase() === "admin";
      applyServerModeUi({
        deploymentMode,
        authenticated: isAuthenticated,
        isAdmin,
        allowRegistration,
        hasAdmin,
      });

      if (shouldLoadUsers && isAuthenticated && isAdmin) {
        try {
          const usersPayload = await backendClient.listAdminUsers();
          renderServerUsers(usersPayload?.users || [], { isAdmin: true });
        } catch (error) {
          renderServerUsers([], { isAdmin: false });
          if (!silent) {
            pushToast(`Не удалось получить список пользователей: ${error.message}`, {
              tone: "warning",
              durationMs: 3400,
            });
          }
        }
      } else {
        renderServerUsers([], { isAdmin: false });
      }

      if (shouldLoadAudit) {
        if (isAuthenticated && isAdmin) {
          await refreshServerAuditLog({ silent });
        } else {
          renderServerAudit([], {
            message: isAuthenticated
              ? "Аудит доступен только администратору."
              : "Войдите как администратор для просмотра аудита.",
          });
        }
      }

      return {
        deploymentMode,
        authConfig,
        authenticated: isAuthenticated,
        me: meUser,
        isAdmin,
      };
    } catch (error) {
      setAuthStatusLabel("offline", { tone: "error" });
      setAuthUserText(`Auth API недоступен: ${error.message}`);
      renderServerUsers([], { isAdmin: false });
      renderServerAudit([], { message: "Auth API недоступен." });
      applyServerModeUi({
        deploymentMode,
        authenticated: false,
        isAdmin: false,
        allowRegistration: false,
        hasAdmin: false,
      });
      if (!silent) {
        pushToast(`Не удалось получить auth-конфиг: ${error.message}`, {
          tone: "error",
          durationMs: 3400,
        });
      }
      return {
        deploymentMode,
        authenticated: false,
        me: null,
        isAdmin: false,
      };
    }
  }

  async function loginServer({ username, password, remember = true } = {}) {
    const safeUsername = String(username || "").trim();
    const safePassword = String(password || "");
    if (!safeUsername || !safePassword) {
      pushToast("Укажите логин и пароль.", { tone: "warning" });
      return false;
    }
    try {
      const payload = await backendClient.login({
        username: safeUsername,
        password: safePassword,
        remember: Boolean(remember),
      });
      const token = String(payload?.token || "").trim();
      if (!token) {
        throw new Error("Сервер не вернул токен сессии.");
      }
      applyRuntimeConfig({
        mode: "backend",
        deploymentMode: String(runtimeConfig.deploymentMode || "").trim().toLowerCase() === "remote_server"
          ? "remote_server"
          : "remote_client",
        authToken: token,
        authUsername: String(payload?.user?.username || safeUsername),
        authRemember: Boolean(remember),
      });
      if (elements.settingsLoginPassword instanceof HTMLInputElement) {
        elements.settingsLoginPassword.value = "";
      }
      pushToast("Вход выполнен.", { tone: "success" });
      await refreshServerAuthState({
        includeUsers: isRemoteServerMode(),
        includeAudit: true,
        silent: false,
      });
      return true;
    } catch (error) {
      pushToast(`Ошибка входа: ${error.message}`, { tone: "error", durationMs: 3400 });
      return false;
    }
  }

  async function registerServerUser({ username, password } = {}) {
    const deploymentMode = resolveDeploymentModeValue(runtimeConfig.deploymentMode);
    if (deploymentMode === "local") {
      pushToast("Регистрация доступна только в удалённом режиме.", { tone: "warning" });
      return false;
    }
    const safeUsername = String(username || "").trim();
    const safePassword = String(password || "");
    if (!safeUsername || !safePassword) {
      pushToast("Укажите логин и пароль для регистрации.", { tone: "warning" });
      return false;
    }
    try {
      await backendClient.registerUser({
        username: safeUsername,
        password: safePassword,
      });
      pushToast("Пользователь зарегистрирован. Выполняем вход...", { tone: "success", durationMs: 2600 });
      return await loginServer({
        username: safeUsername,
        password: safePassword,
        remember: true,
      });
    } catch (error) {
      pushToast(`Ошибка регистрации: ${error.message}`, { tone: "error", durationMs: 3600 });
      return false;
    }
  }

  async function bootstrapServerAdmin({ username, password } = {}) {
    if (!isRemoteServerMode()) {
      pushToast("Bootstrap доступен только в режиме удалённого сервера.", { tone: "warning" });
      return false;
    }
    const safeUsername = String(username || "").trim();
    const safePassword = String(password || "");
    if (!safeUsername || !safePassword) {
      pushToast("Укажите логин и пароль для bootstrap.", { tone: "warning" });
      return false;
    }
    try {
      const payload = await backendClient.bootstrapAdmin({
        username: safeUsername,
        password: safePassword,
        remember: true,
      });
      const token = String(payload?.token || "").trim();
      if (!token) {
        throw new Error("Сервер не вернул токен после bootstrap.");
      }
      applyRuntimeConfig({
        mode: "backend",
        deploymentMode: "remote_server",
        authToken: token,
        authUsername: String(payload?.user?.username || safeUsername),
      });
      if (elements.settingsBootstrapPassword instanceof HTMLInputElement) {
        elements.settingsBootstrapPassword.value = "";
      }
      pushToast("Администратор создан и авторизован.", { tone: "success" });
      await refreshServerAuthState({
        includeUsers: isRemoteServerMode(),
        includeAudit: true,
        silent: false,
      });
      return true;
    } catch (error) {
      pushToast(`Bootstrap не выполнен: ${error.message}`, { tone: "error", durationMs: 3600 });
      return false;
    }
  }

  async function logoutServer() {
    try {
      await backendClient.logout();
    } catch {
      // no-op
    }
    applyRuntimeConfig({
      authToken: "",
      authUsername: "",
    });
    pushToast("Сессия завершена.", { tone: "neutral" });
    await refreshServerAuthState({
      includeUsers: isRemoteServerMode(),
      includeAudit: true,
      silent: true,
    });
  }

  async function createServerUser({
    username,
    password,
    role = "user",
    allowModelsDownload = false,
    allowPluginsDownload = false,
  } = {}) {
    if (!isRemoteServerMode()) {
      pushToast("Управление пользователями доступно только в режиме удалённого сервера.", { tone: "warning" });
      return false;
    }
    const safeUsername = String(username || "").trim();
    const safePassword = String(password || "");
    const safeRole = String(role || "user").trim().toLowerCase() === "admin" ? "admin" : "user";
    const requestedModelsDownload = Boolean(allowModelsDownload);
    const requestedPluginsDownload = Boolean(allowPluginsDownload);
    const grantModelsDownload = safeRole === "admin" ? true : requestedModelsDownload;
    const grantPluginsDownload = safeRole === "admin" ? true : requestedPluginsDownload;
    const permissions = {
      [USER_PERMISSION_MODELS_DOWNLOAD]: grantModelsDownload,
      [LEGACY_USER_PERMISSION_MODELS]: grantModelsDownload,
      [USER_PERMISSION_PLUGINS_DOWNLOAD]: grantPluginsDownload,
      [LEGACY_USER_PERMISSION_PLUGINS]: grantPluginsDownload,
    };
    if (!safeUsername || !safePassword) {
      pushToast("Для создания пользователя нужны логин и пароль.", { tone: "warning" });
      return false;
    }
    try {
      await backendClient.createAdminUser({
        username: safeUsername,
        password: safePassword,
        role: safeRole,
        permissions,
      });
      pushToast(`Пользователь ${safeUsername} создан.`, { tone: "success" });
      await refreshServerAuthState({
        includeUsers: true,
        includeAudit: true,
        silent: false,
      });
      return true;
    } catch (error) {
      pushToast(`Не удалось создать пользователя: ${error.message}`, { tone: "error", durationMs: 3600 });
      return false;
    }
  }

  async function handleServerUserAction(button) {
    if (!isRemoteServerMode()) {
      return;
    }
    const action = String(button?.dataset?.serverUserAction || "").trim().toLowerCase();
    const userId = String(button?.dataset?.userId || "").trim();
    if (!action || !userId) {
      return;
    }
    try {
      if (action === "toggle-status") {
        const currentStatus = String(button.dataset.userStatus || "active").trim().toLowerCase();
        const nextStatus = currentStatus === "blocked" ? "active" : "blocked";
        await backendClient.updateAdminUser(userId, { status: nextStatus });
      } else if (action === "toggle-role") {
        const currentRole = String(button.dataset.userRole || "user").trim().toLowerCase();
        const nextRole = currentRole === "admin" ? "user" : "admin";
        await backendClient.updateAdminUser(userId, { role: nextRole });
      } else if (action === "toggle-permission") {
        const permissionKey = String(button.dataset.permissionKey || "").trim().toLowerCase();
        if (
          permissionKey !== USER_PERMISSION_MODELS_DOWNLOAD
          && permissionKey !== USER_PERMISSION_PLUGINS_DOWNLOAD
        ) {
          return;
        }
        const currentValue = String(button.dataset.permissionValue || "false").trim().toLowerCase() === "true";
        const nextValue = !currentValue;
        const currentUser = serverUsersCache.get(userId);
        const currentPermissions = (
          currentUser?.permissions && typeof currentUser.permissions === "object"
            ? { ...currentUser.permissions }
            : {}
        );
        currentPermissions[permissionKey] = nextValue;
        if (permissionKey === USER_PERMISSION_MODELS_DOWNLOAD) {
          currentPermissions[LEGACY_USER_PERMISSION_MODELS] = nextValue;
        }
        if (permissionKey === USER_PERMISSION_PLUGINS_DOWNLOAD) {
          currentPermissions[LEGACY_USER_PERMISSION_PLUGINS] = nextValue;
        }
        await backendClient.updateAdminUser(userId, {
          permissions: currentPermissions,
        });
      }
      await refreshServerAuthState({
        includeUsers: true,
        includeAudit: true,
        silent: false,
      });
    } catch (error) {
      pushToast(`Не удалось обновить пользователя: ${error.message}`, {
        tone: "error",
        durationMs: 3400,
      });
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
      nextConfig.mode = "backend";
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
      if (runtimeConfig.backendUrl) {
        try {
          const runtimePayloadForBackend = { ...runtimeConfig };
          delete runtimePayloadForBackend.authToken;
          delete runtimePayloadForBackend.authUsername;
          delete runtimePayloadForBackend.authRemember;
          await backendClient.updateSettings({
            runtime_config: runtimePayloadForBackend,
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

      if (runtimeConfig.autoReconnect) {
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
      if (String(runtimeConfig.deploymentMode || "local").trim().toLowerCase() !== "local") {
        await refreshServerAuthState({
          includeUsers: isRemoteServerMode(),
          includeAudit: true,
          silent: true,
        });
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
    void refreshServerAuthState({
      includeUsers: isRemoteServerMode(),
      includeAudit: true,
      silent: true,
    });
  }

  return {
    hydrateSettingsForm,
    collectSettingsForm,
    syncSettingsDirtyState,
    resetSettingsValidation,
    validateSettingsDraft,
    checkBackendConnection,
    refreshServerAuthState,
    refreshServerAuditLog,
    loginServer,
    registerServerUser,
    bootstrapServerAdmin,
    logoutServer,
    createServerUser,
    handleServerUserAction,
    saveSettings,
    onRuntimeConfigApplied,
  };
}
