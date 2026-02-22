import {
  BACKEND_STATUS_LABEL,
  RUNTIME_MODE_LABEL,
  MOOD_NAME_LABEL,
  getModelLabelById,
} from "../runtimeConfig.js";

const UI_FONT_STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Times, serif',
  rounded: '"SF Pro Rounded", "Avenir Next Rounded", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};
const DEFAULT_MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export function createRuntimeUiController({
  elements,
  runtimeConfig,
  getBackground,
  prefersReducedMotionMedia,
  BACKEND_STATUS,
}) {
  const connectionState = {
    status: BACKEND_STATUS.idle,
    message: "Сервер не проверялся",
    checkedAt: null,
    health: null,
  };

  function isMotionEnabled() {
    return runtimeConfig.uiAnimations && !prefersReducedMotionMedia.matches;
  }

  function updateMoodUI(mood) {
    const fallbackLabel = MOOD_NAME_LABEL[mood.name] || mood.name;
    const label = mood.label || fallbackLabel;
    document.body.dataset.mood = mood.name;

    if (elements.moodIndicator) {
      const dot = '<span class="state-dot"></span>';
      elements.moodIndicator.innerHTML = `${dot}${label}`;
    }

    if (elements.moodDescription) {
      elements.moodDescription.textContent = mood.description;
    }

    if (elements.inspectorMood) {
      elements.inspectorMood.textContent = fallbackLabel;
    }
  }

  function updateRenderStats({ frameMs, pixelRatio, targetFrameMs }) {
    if (elements.frameBudget) {
      elements.frameBudget.textContent = `${Math.round(frameMs)}ms / ${Math.round(targetFrameMs)}ms`;
    }
    if (elements.renderQuality) {
      elements.renderQuality.textContent = `адаптивный x${pixelRatio.toFixed(2)}`;
    }
  }

  function updateRuntimeBadges() {
    const modeLabel = RUNTIME_MODE_LABEL[runtimeConfig.mode] || runtimeConfig.mode;
    const modelLabel = getModelLabelById(runtimeConfig.modelId, runtimeConfig.modelId);

    if (elements.runtimeMode) {
      elements.runtimeMode.textContent = modeLabel;
    }
    if (elements.runtimeModelLabel) {
      elements.runtimeModelLabel.textContent = modelLabel;
    }
    if (elements.titlebarBackendChip) {
      const connectionLabel = BACKEND_STATUS_LABEL[connectionState.status] || BACKEND_STATUS_LABEL[BACKEND_STATUS.idle];
      elements.titlebarBackendChip.textContent = runtimeConfig.mode === "backend"
        ? `${modeLabel} • ${connectionLabel}`
        : modeLabel;
      const chipPalette = runtimeConfig.mode === "backend"
        ? connectionState.status === BACKEND_STATUS.connected
          ? "border-emerald-900/50 bg-emerald-950/40 text-emerald-400"
          : connectionState.status === BACKEND_STATUS.error
            ? "border-red-900/50 bg-red-950/40 text-red-400"
            : connectionState.status === BACKEND_STATUS.checking
              ? "border-amber-900/50 bg-amber-950/40 text-amber-400"
              : "border-zinc-800 bg-zinc-900 text-zinc-400"
        : "border-zinc-800 bg-zinc-900 text-zinc-400";
      elements.titlebarBackendChip.className = `rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${chipPalette}`;
    }
  }

  function updateConnectionState(status, message, healthPayload = undefined) {
    connectionState.status = status;
    connectionState.message = String(message || "");
    connectionState.checkedAt = new Date();
    if (healthPayload !== undefined) {
      connectionState.health = healthPayload || null;
    }

    const badgeText = BACKEND_STATUS_LABEL[status] || BACKEND_STATUS_LABEL[BACKEND_STATUS.idle];

    if (elements.backendStatus) {
      elements.backendStatus.textContent = badgeText;
    }
    if (elements.settingsConnectionBadge) {
      elements.settingsConnectionBadge.textContent = badgeText;
      const badgePalette = status === BACKEND_STATUS.connected
        ? "border-emerald-900/50 bg-emerald-950/40 text-emerald-400"
        : status === BACKEND_STATUS.error
          ? "border-red-900/50 bg-red-950/40 text-red-400"
          : status === BACKEND_STATUS.checking
            ? "border-amber-900/50 bg-amber-950/40 text-amber-400"
            : "border-zinc-800 bg-zinc-900 text-zinc-400";
      elements.settingsConnectionBadge.className = `rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${badgePalette}`;
    }
    if (elements.settingsConnectionMeta) {
      const ts = connectionState.checkedAt
        ? new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(connectionState.checkedAt)
        : "--:--:--";
      elements.settingsConnectionMeta.textContent = `${connectionState.message || "Состояние неизвестно"} • ${ts}`;
    }

    updateRuntimeBadges();
  }

  function applyInterfacePreferences() {
    const fontPreset = String(runtimeConfig.uiFontPreset || "system").trim().toLowerCase();
    const customFontFamily = String(runtimeConfig.uiFontFamily || "").trim();
    const baseFontStack = UI_FONT_STACKS[fontPreset] || UI_FONT_STACKS.system;
    const resolvedFontStack = fontPreset === "custom" && customFontFamily
      ? `${customFontFamily}, ${UI_FONT_STACKS.system}`
      : baseFontStack;

    document.body.dataset.uiDensity = runtimeConfig.uiDensity;
    document.body.dataset.uiFontPreset = fontPreset;
    const uiMotionEnabled = runtimeConfig.uiAnimations && !prefersReducedMotionMedia.matches;
    const backgroundMotionEnabled = true;
    document.body.classList.toggle("reduce-motion", !uiMotionEnabled);
    document.documentElement.style.setProperty("--app-font-stack", resolvedFontStack);
    document.documentElement.style.setProperty(
      "--app-mono-font-stack",
      fontPreset === "mono" ? UI_FONT_STACKS.mono : DEFAULT_MONO_FONT_STACK,
    );
    const background = typeof getBackground === "function" ? getBackground() : null;
    if (background) {
      background.setPerformanceProfile();
      background.setMotionEnabled(backgroundMotionEnabled);
    }

    const baseFontSize = 16 * (runtimeConfig.uiFontScale / 100);
    document.documentElement.style.fontSize = `${baseFontSize.toFixed(2)}px`;

    if (elements.panelRight) {
      if (window.innerWidth >= 1536) {
        elements.panelRight.style.display = runtimeConfig.uiShowInspector ? "" : "none";
      } else {
        elements.panelRight.style.display = "";
      }
    }

    if (elements.composerAttachButton) {
      elements.composerAttachButton.classList.toggle("hidden", !runtimeConfig.modelSupportsVision);
    }
  }

  return {
    connectionState,
    isMotionEnabled,
    updateMoodUI,
    updateRenderStats,
    updateRuntimeBadges,
    updateConnectionState,
    applyInterfacePreferences,
  };
}
