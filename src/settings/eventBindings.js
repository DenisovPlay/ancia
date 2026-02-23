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

    bindSettingsFieldListeners();
  }

  return {
    bindEvents,
  };
}
