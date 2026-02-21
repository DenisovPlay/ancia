export function bindPanelOpenActions({
  elements,
  openPluginAsideButtons,
  openModelAsideButtons,
  openSettingsAsideButtons,
  mobileState,
  syncMobilePanels,
}) {
  const applyPanelState = (partial) => {
    Object.assign(mobileState, {
      leftOpen: false,
      rightOpen: false,
      pluginAsideOpen: false,
      modelAsideOpen: false,
      settingsAsideOpen: false,
      ...partial,
    });
    syncMobilePanels();
  };

  elements.openLeftPanel?.addEventListener("click", () => {
    applyPanelState({ leftOpen: true });
  });

  elements.openRightPanel?.addEventListener("click", () => {
    applyPanelState({ rightOpen: true });
  });

  openPluginAsideButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyPanelState({ pluginAsideOpen: true });
    });
  });

  openModelAsideButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyPanelState({ modelAsideOpen: true });
    });
  });

  openSettingsAsideButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyPanelState({ settingsAsideOpen: true });
    });
  });
}
