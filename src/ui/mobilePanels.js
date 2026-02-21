const FOCUSABLE_SELECTOR = `
  button:not([disabled]),
  [href],
  input:not([disabled]),
  select:not([disabled]),
  textarea:not([disabled]),
  [tabindex]:not([tabindex="-1"])
`.replace(/\s+/g, " ").trim();

function applyOverlayDialogState(element, isDialog, label) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (isDialog) {
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", label);
    return;
  }

  element.removeAttribute("role");
  element.removeAttribute("aria-modal");
  element.removeAttribute("aria-label");
}

function resolveActiveOverlayPanel({
  leftOverlayOpen,
  rightOverlayOpen,
  pluginOverlayOpen,
  modelOverlayOpen,
  settingsOverlayOpen,
  elements,
}) {
  if (rightOverlayOpen && elements.panelRight) {
    return { id: "panel-right", element: elements.panelRight };
  }
  if (leftOverlayOpen && elements.panelLeft) {
    return { id: "panel-left", element: elements.panelLeft };
  }
  if (pluginOverlayOpen && elements.pluginAside) {
    return { id: "plugin-aside", element: elements.pluginAside };
  }
  if (modelOverlayOpen && elements.modelAside) {
    return { id: "model-aside", element: elements.modelAside };
  }
  if (settingsOverlayOpen && elements.settingsAside) {
    return { id: "settings-aside", element: elements.settingsAside };
  }
  return null;
}

export function createMobilePanelsController({
  elements,
  openPluginAsideButtons,
  openModelAsideButtons,
  openSettingsAsideButtons,
  isLeftPanelDocked,
  isRightPanelDocked,
  isPluginAsideDocked,
  isModelAsideDocked,
  isSettingsAsideDocked,
} = {}) {
  const mobileState = {
    leftOpen: false,
    rightOpen: false,
    pluginAsideOpen: false,
    modelAsideOpen: false,
    settingsAsideOpen: false,
  };

  const overlayState = {
    activePanelId: "",
    restoreFocusEl: null,
  };

  function focusFirstInteractive(container) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const target = container.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
  }

  function syncMobilePanels() {
    const leftDocked = Boolean(typeof isLeftPanelDocked === "function" ? isLeftPanelDocked() : true);
    const rightDocked = Boolean(typeof isRightPanelDocked === "function" ? isRightPanelDocked() : true);
    const pluginAsideDocked = Boolean(typeof isPluginAsideDocked === "function" ? isPluginAsideDocked() : true);
    const modelAsideDocked = Boolean(typeof isModelAsideDocked === "function" ? isModelAsideDocked() : true);
    const settingsAsideDocked = Boolean(typeof isSettingsAsideDocked === "function" ? isSettingsAsideDocked() : true);

    if (leftDocked) {
      mobileState.leftOpen = false;
    }
    if (rightDocked) {
      mobileState.rightOpen = false;
    }
    if (pluginAsideDocked) {
      mobileState.pluginAsideOpen = false;
    }
    if (modelAsideDocked) {
      mobileState.modelAsideOpen = false;
    }
    if (settingsAsideDocked) {
      mobileState.settingsAsideOpen = false;
    }

    const leftOverlayOpen = !leftDocked && mobileState.leftOpen;
    const rightOverlayOpen = !rightDocked && mobileState.rightOpen;
    const pluginOverlayOpen = !pluginAsideDocked && mobileState.pluginAsideOpen;
    const modelOverlayOpen = !modelAsideDocked && mobileState.modelAsideOpen;
    const settingsOverlayOpen = !settingsAsideDocked && mobileState.settingsAsideOpen;

    const showBackdrop = (
      leftOverlayOpen
      || rightOverlayOpen
      || pluginOverlayOpen
      || modelOverlayOpen
      || settingsOverlayOpen
    );

    if (elements.panelBackdrop) {
      elements.panelBackdrop.classList.toggle("pointer-events-none", !showBackdrop);
      elements.panelBackdrop.classList.toggle("opacity-0", !showBackdrop);
      elements.panelBackdrop.classList.toggle("opacity-100", showBackdrop);
      elements.panelBackdrop.setAttribute("aria-hidden", String(!showBackdrop));
    }
    document.body.classList.toggle("panel-overlay-open", showBackdrop);

    elements.panelLeft?.classList.toggle("-translate-x-[112%]", !leftDocked && !mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("translate-x-0", !leftDocked && mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("opacity-0", !leftDocked && !mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("pointer-events-none", !leftDocked && !mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("opacity-100", !leftDocked && mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("pointer-events-auto", !leftDocked && mobileState.leftOpen);
    elements.panelLeft?.classList.toggle("z-40", leftOverlayOpen);
    elements.panelLeft?.classList.toggle("z-10", !leftOverlayOpen);

    elements.panelRight?.classList.toggle("translate-x-[112%]", !rightDocked && !mobileState.rightOpen);
    elements.panelRight?.classList.toggle("translate-x-0", !rightDocked && mobileState.rightOpen);
    elements.panelRight?.classList.toggle("opacity-0", !rightDocked && !mobileState.rightOpen);
    elements.panelRight?.classList.toggle("pointer-events-none", !rightDocked && !mobileState.rightOpen);
    elements.panelRight?.classList.toggle("opacity-100", !rightDocked && mobileState.rightOpen);
    elements.panelRight?.classList.toggle("pointer-events-auto", !rightDocked && mobileState.rightOpen);
    elements.panelRight?.classList.toggle("z-50", rightOverlayOpen);
    elements.panelRight?.classList.toggle("z-10", !rightOverlayOpen);

    elements.pluginAside?.classList.toggle("-translate-x-[112%]", !pluginAsideDocked && !mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("translate-x-0", !pluginAsideDocked && mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("opacity-0", !pluginAsideDocked && !mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("pointer-events-none", !pluginAsideDocked && !mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("opacity-100", !pluginAsideDocked && mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("pointer-events-auto", !pluginAsideDocked && mobileState.pluginAsideOpen);
    elements.pluginAside?.classList.toggle("z-40", pluginOverlayOpen);
    elements.pluginAside?.classList.toggle("z-10", !pluginOverlayOpen);

    elements.modelAside?.classList.toggle("-translate-x-[112%]", !modelAsideDocked && !mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("translate-x-0", !modelAsideDocked && mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("opacity-0", !modelAsideDocked && !mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("pointer-events-none", !modelAsideDocked && !mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("opacity-100", !modelAsideDocked && mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("pointer-events-auto", !modelAsideDocked && mobileState.modelAsideOpen);
    elements.modelAside?.classList.toggle("z-40", modelOverlayOpen);
    elements.modelAside?.classList.toggle("z-10", !modelOverlayOpen);

    elements.settingsAside?.classList.toggle("-translate-x-[112%]", !settingsAsideDocked && !mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("translate-x-0", !settingsAsideDocked && mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("opacity-0", !settingsAsideDocked && !mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("pointer-events-none", !settingsAsideDocked && !mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("opacity-100", !settingsAsideDocked && mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("pointer-events-auto", !settingsAsideDocked && mobileState.settingsAsideOpen);
    elements.settingsAside?.classList.toggle("z-40", settingsOverlayOpen);
    elements.settingsAside?.classList.toggle("z-10", !settingsOverlayOpen);

    applyOverlayDialogState(elements.panelLeft, leftOverlayOpen, "Список диалогов");
    applyOverlayDialogState(elements.panelRight, rightOverlayOpen, "Инспектор");
    applyOverlayDialogState(elements.pluginAside, pluginOverlayOpen, "Категории плагинов");
    applyOverlayDialogState(elements.modelAside, modelOverlayOpen, "Фильтр моделей");
    applyOverlayDialogState(elements.settingsAside, settingsOverlayOpen, "Разделы настроек");

    elements.openLeftPanel?.setAttribute("aria-expanded", String(leftOverlayOpen));
    elements.openRightPanel?.setAttribute("aria-expanded", String(rightOverlayOpen));
    openPluginAsideButtons.forEach((button) => {
      button.setAttribute("aria-expanded", String(pluginOverlayOpen));
    });
    openModelAsideButtons.forEach((button) => {
      button.setAttribute("aria-expanded", String(modelOverlayOpen));
    });
    openSettingsAsideButtons.forEach((button) => {
      button.setAttribute("aria-expanded", String(settingsOverlayOpen));
    });

    const activeOverlay = resolveActiveOverlayPanel({
      leftOverlayOpen,
      rightOverlayOpen,
      pluginOverlayOpen,
      modelOverlayOpen,
      settingsOverlayOpen,
      elements,
    });

    if (!activeOverlay) {
      if (overlayState.activePanelId) {
        const restoreTarget = overlayState.restoreFocusEl;
        overlayState.activePanelId = "";
        overlayState.restoreFocusEl = null;
        if (restoreTarget instanceof HTMLElement) {
          window.requestAnimationFrame(() => {
            restoreTarget.focus({ preventScroll: true });
          });
        }
      }
      return;
    }

    if (overlayState.activePanelId === activeOverlay.id) {
      return;
    }

    overlayState.activePanelId = activeOverlay.id;
    const focused = document.activeElement;
    overlayState.restoreFocusEl = focused instanceof HTMLElement ? focused : null;
    window.requestAnimationFrame(() => {
      focusFirstInteractive(activeOverlay.element);
    });
  }

  function closeAllMobilePanels() {
    mobileState.leftOpen = false;
    mobileState.rightOpen = false;
    mobileState.pluginAsideOpen = false;
    mobileState.modelAsideOpen = false;
    mobileState.settingsAsideOpen = false;
    syncMobilePanels();
  }

  return {
    mobileState,
    syncMobilePanels,
    closeAllMobilePanels,
    focusFirstInteractive,
  };
}
