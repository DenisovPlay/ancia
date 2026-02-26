export function createSettingsEventBindings({
  settingsSaveButtons,
  settingsFields,
  clearFieldValidation,
  syncSettingsDirtyState,
  saveSettings,
  elements,
  resetSettingsValidation,
  collectSettingsForm,
  validateSettingsDraft,
  refreshServerAuthState,
  refreshServerAuditLog,
  loginServer,
  registerServerUser,
  bootstrapServerAdmin,
  logoutServer,
  createServerUser,
  handleServerUserAction,
  pushToast,
  backendClient,
  checkBackendConnection,
  settingsSectionButtons,
  settingsSectionController,
  isSettingsAsideDocked,
  mobileState,
  syncMobilePanels,
  fontController,
}) {
  let eventsBound = false;

  function bindSettingsFieldListeners() {
    settingsFields.forEach((field) => {
      field.addEventListener("input", () => {
        clearFieldValidation(field);
        syncSettingsDirtyState();
      });
      field.addEventListener("change", () => {
        clearFieldValidation(field);
        syncSettingsDirtyState();
      });
    });
  }

  function bindEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    settingsSaveButtons.forEach((button) => {
      button.addEventListener("click", () => {
        void saveSettings();
      });
    });

    elements.settingsTestConnection?.addEventListener("click", async () => {
      resetSettingsValidation();
      const nextConfig = collectSettingsForm();
      const issues = validateSettingsDraft(nextConfig);
      if (issues.length > 0) {
        issues.forEach((issue) => {
          if (issue.field) {
            issue.field.classList.add("field-invalid");
            issue.field.setAttribute("aria-invalid", "true");
          }
        });
        issues[0]?.field?.focus();
        pushToast(issues[0]?.message || "Проверьте поля перед тестом.", { tone: "error" });
        return;
      }

      const previousClientConfig = backendClient.getConfig();
      const connection = await checkBackendConnection(nextConfig);
      backendClient.setConfig(previousClientConfig);
      pushToast(
        connection.connected ? "Сервер отвечает на /health." : "Проверка соединения не прошла.",
        { tone: connection.connected ? "success" : "error", durationMs: 3400 },
      );
    });

    settingsSectionButtons.forEach((button) => {
      button.addEventListener("click", () => {
        settingsSectionController.applySection(button.dataset.settingsSectionTarget);
        if (!isSettingsAsideDocked()) {
          mobileState.settingsAsideOpen = false;
          syncMobilePanels();
        }
      });
    });

    elements.settingsSectionSearch?.addEventListener("input", () => {
      settingsSectionController.applyFilter(elements.settingsSectionSearch?.value || "");
    });

    elements.settingsUiFontPreset?.addEventListener("change", () => {
      fontController.syncControls();
      if (String(elements.settingsUiFontPreset?.value || "").trim().toLowerCase() === "custom") {
        void fontController.loadCatalog({ silent: true });
      }
      syncSettingsDirtyState();
    });

    elements.settingsUiFontRefresh?.addEventListener("click", () => {
      void fontController.loadCatalog({ silent: false }).then(() => {
        syncSettingsDirtyState();
      });
    });

    elements.settingsContextGuardEnabled?.addEventListener("change", () => {
      if (elements.settingsContextAutoCompress instanceof HTMLInputElement) {
        elements.settingsContextAutoCompress.disabled = !Boolean(elements.settingsContextGuardEnabled?.checked);
      }
      if (elements.settingsContextChatEvents instanceof HTMLInputElement) {
        elements.settingsContextChatEvents.disabled = !Boolean(elements.settingsContextGuardEnabled?.checked);
      }
      syncSettingsDirtyState();
    });

    elements.settingsModelFallbackEnabled?.addEventListener("change", () => {
      if (elements.settingsModelFallbackProfile instanceof HTMLSelectElement) {
        elements.settingsModelFallbackProfile.disabled = !Boolean(elements.settingsModelFallbackEnabled?.checked);
      }
      syncSettingsDirtyState();
    });

    elements.settingsModelScenarioAutoApply?.addEventListener("change", () => {
      if (elements.settingsModelScenarioProfile instanceof HTMLSelectElement) {
        elements.settingsModelScenarioProfile.disabled = !Boolean(elements.settingsModelScenarioAutoApply?.checked);
      }
      syncSettingsDirtyState();
    });

    elements.settingsUsersRefresh?.addEventListener("click", () => {
      void refreshServerAuthState?.({ includeUsers: true, includeAudit: true, silent: false });
    });

    elements.settingsAuditRefresh?.addEventListener("click", () => {
      void refreshServerAuditLog?.({ silent: false });
    });

    elements.settingsAuditStatus?.addEventListener("change", () => {
      void refreshServerAuditLog?.({ silent: true });
    });

    elements.settingsAuditLimit?.addEventListener("change", () => {
      void refreshServerAuditLog?.({ silent: true });
    });

    [elements.settingsAuditActionPrefix, elements.settingsAuditActorUserId].forEach((field) => {
      field?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }
        event.preventDefault();
        void refreshServerAuditLog?.({ silent: false });
      });
    });

    elements.settingsLoginButton?.addEventListener("click", () => {
      void loginServer?.({
        username: elements.settingsLoginUsername?.value,
        password: elements.settingsLoginPassword?.value,
        remember: true,
      });
    });

    elements.settingsRegisterButton?.addEventListener("click", () => {
      void registerServerUser?.({
        username: elements.settingsLoginUsername?.value,
        password: elements.settingsLoginPassword?.value,
      });
    });

    elements.settingsBootstrapAdmin?.addEventListener("click", () => {
      void bootstrapServerAdmin?.({
        username: elements.settingsBootstrapUsername?.value,
        password: elements.settingsBootstrapPassword?.value,
      });
    });

    elements.settingsLogoutButton?.addEventListener("click", () => {
      void logoutServer?.();
    });

    elements.settingsCreateUserButton?.addEventListener("click", () => {
      const createTask = createServerUser?.({
        username: elements.settingsCreateUserUsername?.value,
        password: elements.settingsCreateUserPassword?.value,
        role: elements.settingsCreateUserRole?.value,
        allowModelsDownload: elements.settingsCreateUserModelDownload?.checked,
        allowPluginsDownload: elements.settingsCreateUserPluginDownload?.checked,
      });
      if (!createTask || typeof createTask.then !== "function") {
        return;
      }
      void createTask.then((ok) => {
        if (ok && elements.settingsCreateUserPassword instanceof HTMLInputElement) {
          elements.settingsCreateUserPassword.value = "";
        }
        if (ok && elements.settingsCreateUserModelDownload instanceof HTMLInputElement) {
          elements.settingsCreateUserModelDownload.checked = false;
        }
        if (ok && elements.settingsCreateUserPluginDownload instanceof HTMLInputElement) {
          elements.settingsCreateUserPluginDownload.checked = false;
        }
      });
    });

    elements.settingsUsersList?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const actionButton = target.closest("[data-server-user-action]");
      if (!(actionButton instanceof HTMLElement)) {
        return;
      }
      void handleServerUserAction?.(actionButton);
    });

    bindSettingsFieldListeners();
  }

  return {
    bindEvents,
  };
}
