export function bindGlobalShortcuts({
  actionDialogManager,
  getChatFeature,
  onboardingController,
  normalizeRoute,
  getSettingsFeature,
  navigateToRoute,
  closeAllMobilePanels,
}) {
  document.addEventListener("keydown", (event) => {
    if (actionDialogManager.isOpen()) {
      return;
    }

    if (getChatFeature()?.isContextMenuOpen() && event.key === "Escape") {
      event.preventDefault();
      getChatFeature()?.closeContextMenu();
      return;
    }

    if (onboardingController?.handleKeyDown(event)) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      if (normalizeRoute(document.body.dataset.route) === "settings") {
        event.preventDefault();
        void getSettingsFeature()?.saveSettings();
        return;
      }
    }

    const activeElement = document.activeElement;
    const isTypingTarget = activeElement instanceof HTMLElement
      && (activeElement.matches("input, textarea, select, [contenteditable='true']"));
    if (!isTypingTarget && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === "1") {
        event.preventDefault();
        navigateToRoute("chat");
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        navigateToRoute("models");
        return;
      }
      if (event.key === "3") {
        event.preventDefault();
        navigateToRoute("plugins");
        return;
      }
      if (event.key === "4") {
        event.preventDefault();
        navigateToRoute("settings");
        return;
      }
    }

    if (event.key === "Escape") {
      closeAllMobilePanels();
    }
  });
}
