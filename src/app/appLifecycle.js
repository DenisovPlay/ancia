import { bindGlobalShortcuts } from "./globalShortcuts.js";
import { handleResetAllAction } from "./resetController.js";
import { setupTauriTitlebarDragging } from "./titlebarDragging.js";

export function bindAppUiEvents({
  routeButtons,
  navigateToRoute,
  elements,
  requestActionConfirm,
  runtimeConfig,
  backendClient,
  pushToast,
  closeAllMobilePanels,
  actionDialogManager,
  getChatFeature,
  onboardingController,
  normalizeRoute,
  getSettingsFeature,
  applyInterfacePreferences,
  syncMobilePanels,
  applyRoute,
  getRouteFromHash,
  prefersReducedMotionMedia,
}) {
  routeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navigateToRoute(button.dataset.routeTarget);
    });
  });

  elements.settingsResetAll?.addEventListener("click", () => {
    void handleResetAllAction({
      requestActionConfirm,
      runtimeConfig,
      backendClient,
      pushToast,
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!getChatFeature()?.isContextMenuOpen()) {
      return;
    }
    const target = event.target;
    if (elements.contextMenu && target instanceof Node && elements.contextMenu.contains(target)) {
      return;
    }
    getChatFeature()?.closeContextMenu();
  });

  document.addEventListener("scroll", () => {
    if (getChatFeature()?.isContextMenuOpen()) {
      getChatFeature()?.closeContextMenu();
    }
  }, true);

  window.addEventListener("blur", () => {
    getChatFeature()?.closeContextMenu();
  });

  elements.panelBackdrop?.addEventListener("click", closeAllMobilePanels);

  bindGlobalShortcuts({
    actionDialogManager,
    getChatFeature,
    onboardingController,
    normalizeRoute,
    getSettingsFeature,
    navigateToRoute,
    closeAllMobilePanels,
  });

  window.addEventListener("resize", () => {
    getChatFeature()?.closeContextMenu();
    applyInterfacePreferences();
    syncMobilePanels();
  });

  window.addEventListener("hashchange", () => {
    applyRoute(getRouteFromHash());
  });

  if (typeof prefersReducedMotionMedia.addEventListener === "function") {
    prefersReducedMotionMedia.addEventListener("change", () => {
      applyInterfacePreferences();
    });
  } else if (typeof prefersReducedMotionMedia.addListener === "function") {
    prefersReducedMotionMedia.addListener(() => {
      applyInterfacePreferences();
    });
  }
}

export async function runAppStartup({
  elements,
  runtimeConfig,
  BACKEND_STATUS,
  setPreloaderStatus,
  waitForBackendStartup,
  hydrateSettingsFromBackend,
  persistSettingsToBackend,
  getChatFeature,
  updateConnectionState,
  hidePreloader,
  onboardingController,
  getSettingsFeature,
}) {
  await setupTauriTitlebarDragging(elements.titlebar);

  let startupResult = { ready: false, skipped: false };
  if (runtimeConfig.mode === "backend") {
    setPreloaderStatus("Подключение к бэкенду...");
    startupResult = await waitForBackendStartup();

    if (startupResult.ready) {
      await hydrateSettingsFromBackend({ silent: true });
      await persistSettingsToBackend({
        includeRuntime: true,
        includeOnboarding: true,
        autonomousMode: runtimeConfig.autonomousMode,
      });
      await getChatFeature()?.syncChatStoreFromBackend({ preserveActive: true, silent: true });
    }
  } else {
    updateConnectionState(BACKEND_STATUS.idle, "Активен режим симуляции");
    setPreloaderStatus("Запуск в режиме симуляции...");
  }

  await hidePreloader();
  if (onboardingController?.shouldShowOnboarding()) {
    onboardingController.openOnboarding();
  }

  if (runtimeConfig.mode === "backend" && runtimeConfig.autoReconnect && !startupResult.ready) {
    void getSettingsFeature()?.checkBackendConnection();
  }
}
