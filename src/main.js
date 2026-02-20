import "./style.css";
import { StatefulLiquidBackground } from "./background.js";
import { chatPageTemplate, createChatFeature } from "./chats.js";
import { createPluginsFeature, pluginsPageTemplate } from "./plugins.js";
import {
  BACKEND_STATUS,
  BACKEND_STATUS_LABEL,
  RUNTIME_MODE_LABEL,
  MOOD_NAME_LABEL,
  ROUTE_BACKGROUND_STATE,
  ROUTE_ICON_BY_TARGET,
  ROUTE_LABEL_BY_TARGET,
  MODEL_TIER_ORDER,
  DEVICE_PRESET_META,
  DEVICE_PRESET_ORDER,
  ONBOARDING_VERSION,
  ONBOARDING_STEPS_COUNT,
  clamp,
  normalizeModelTier,
  normalizeModelId,
  getModelLabelById,
  normalizeDevicePreset,
  getDevicePresetMeta,
  applyDevicePreset,
  getModelTierMeta,
  modelTierToRangeIndex,
  normalizeRuntimeConfig,
  loadRuntimeConfig,
  persistRuntimeConfig,
  loadOnboardingState,
  persistOnboardingState,
} from "./runtimeConfig.js";
import { createSettingsFeature, settingsPageTemplate } from "./settings.js";
import { BackendClient } from "./services/backendClient.js";
import { icon } from "./ui/icons.js";

const ROUTE_TRANSITION_MS = 180;
const PRELOADER_MIN_MS = 320;
const PRELOADER_BACKEND_TIMEOUT_MS = 60000;
const PRELOADER_BACKEND_POLL_MS = 800;
const ACTION_DIALOG_TRANSITION_MS = 260;
const prefersReducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
const UI_FONT_STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Times New Roman", Times, serif',
  rounded: '"SF Pro Rounded", "Avenir Next Rounded", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};
const DEFAULT_MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const pageChatRoot = document.querySelector("#page-chat");
const pagePluginsRoot = document.querySelector("#page-plugins");
const pageSettingsRoot = document.querySelector("#page-settings");

if (pageChatRoot) {
  pageChatRoot.innerHTML = chatPageTemplate;
}

if (pagePluginsRoot) {
  pagePluginsRoot.innerHTML = pluginsPageTemplate;
}

if (pageSettingsRoot) {
  pageSettingsRoot.innerHTML = settingsPageTemplate;
}

const preloaderStartMs = performance.now();

const formatTokenCount = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
};

const elements = {
  preloader: document.querySelector("#app-preloader"),
  preloaderLabel: document.querySelector("#app-preloader .app-preloader__label"),
  contextMenu: document.querySelector("#context-menu"),
  actionDialogOverlay: document.querySelector("#action-dialog-overlay"),
  actionDialog: document.querySelector("#action-dialog"),
  actionDialogTitle: document.querySelector("#action-dialog-title"),
  actionDialogMessage: document.querySelector("#action-dialog-message"),
  actionDialogInputWrap: document.querySelector("#action-dialog-input-wrap"),
  actionDialogInput: document.querySelector("#action-dialog-input"),
  actionDialogCancel: document.querySelector("#action-dialog-cancel"),
  actionDialogConfirm: document.querySelector("#action-dialog-confirm"),
  toastRegion: document.querySelector("#ui-toast-region"),
  canvas: document.querySelector("#liquid-canvas"),
  titlebar: document.querySelector("#titlebar"),
  titlebarRouteChip: document.querySelector("#titlebar-route-chip"),
  titlebarBackendChip: document.querySelector("#titlebar-backend-chip"),
  pageChat: document.querySelector("#page-chat"),
  pagePlugins: document.querySelector("#page-plugins"),
  pageSettings: document.querySelector("#page-settings"),
  chatSessionList: document.querySelector("#chat-session-list"),
  chatNewSessionButton: document.querySelector("#chat-new-session-button"),
  chatSessionFilterButton: document.querySelector("#chat-session-filter-button"),
  chatClearSessionButton: document.querySelector("#chat-clear-session-button"),
  openLeftPanel: document.querySelector("#open-left-panel"),
  openRightPanel: document.querySelector("#open-right-panel"),
  panelLeft: document.querySelector("#panel-left"),
  panelRight: document.querySelector("#panel-right"),
  pluginAside: document.querySelector("#plugin-aside"),
  pluginSearchInput: document.querySelector("#plugin-search-input"),
  pluginEmptyState: document.querySelector("#plugin-empty-state"),
  settingsAside: document.querySelector("#settings-aside"),
  settingsSectionTitle: document.querySelector("#settings-section-title"),
  settingsSectionSearch: document.querySelector("#settings-section-search"),
  settingsSectionSearchEmpty: document.querySelector("#settings-section-search-empty"),
  settingsDirtyBadge: document.querySelector("#settings-dirty-badge"),
  panelBackdrop: document.querySelector("#panel-backdrop"),
  composerForm: document.querySelector("#composer-form"),
  composerInput: document.querySelector("#composer-input"),
  composerAttachButton: document.querySelector("#composer-attach-button"),
  composerAttachmentsInput: document.querySelector("#composer-attachments-input"),
  composerAttachmentsList: document.querySelector("#composer-attachments-list"),
  composerSubmit: document.querySelector("#composer-submit"),
  chatStream: document.querySelector("#chat-stream"),
  tokenCount: document.querySelector("#token-count"),
  moodIndicator: document.querySelector("#mood-indicator"),
  moodDescription: document.querySelector("#mood-description"),
  inspectorMood: document.querySelector("#inspector-mood"),
  renderQuality: document.querySelector("#render-quality"),
  frameBudget: document.querySelector("#frame-budget"),
  backendStatus: document.querySelector("#backend-status"),
  runtimeMode: document.querySelector("#runtime-mode"),
  runtimeModelLabel: document.querySelector("#runtime-model-label"),
  settingsRuntimeMode: document.querySelector("#settings-runtime-mode"),
  settingsBackendUrl: document.querySelector("#settings-backend-url"),
  settingsApiKey: document.querySelector("#settings-api-key"),
  settingsTimeoutMs: document.querySelector("#settings-timeout-ms"),
  settingsModelTier: document.querySelector("#settings-model-tier"),
  settingsModelTierLabel: document.querySelector("#settings-model-tier-label"),
  settingsModelTierMeta: document.querySelector("#settings-model-tier-meta"),
  settingsModelId: document.querySelector("#settings-model-id"),
  settingsModelIdMeta: document.querySelector("#settings-model-id-meta"),
  settingsDevicePreset: document.querySelector("#settings-device-preset"),
  settingsDevicePresetMeta: document.querySelector("#settings-device-preset-meta"),
  settingsApplyDevicePreset: document.querySelector("#settings-apply-device-preset"),
  settingsModelContextWindow: document.querySelector("#settings-model-context-window"),
  settingsModelMaxTokens: document.querySelector("#settings-model-max-tokens"),
  settingsModelTemperature: document.querySelector("#settings-model-temperature"),
  settingsModelTopP: document.querySelector("#settings-model-top-p"),
  settingsModelTopK: document.querySelector("#settings-model-top-k"),
  settingsAutoReconnect: document.querySelector("#settings-auto-reconnect"),
  settingsAutonomousMode: document.querySelector("#settings-autonomous-mode"),
  settingsBootMood: document.querySelector("#settings-boot-mood"),
  settingsDefaultTransition: document.querySelector("#settings-default-transition"),
  settingsUserName: document.querySelector("#settings-user-name"),
  settingsUserContext: document.querySelector("#settings-user-context"),
  settingsUserLanguage: document.querySelector("#settings-user-language"),
  settingsUserTimezone: document.querySelector("#settings-user-timezone"),
  settingsUiDensity: document.querySelector("#settings-ui-density"),
  settingsUiAnimations: document.querySelector("#settings-ui-animations"),
  settingsUiFontScale: document.querySelector("#settings-ui-font-scale"),
  settingsUiFontPreset: document.querySelector("#settings-ui-font-preset"),
  settingsUiFontFamily: document.querySelector("#settings-ui-font-family"),
  settingsUiFontRefresh: document.querySelector("#settings-ui-font-refresh"),
  settingsUiFontMeta: document.querySelector("#settings-ui-font-meta"),
  settingsUiShowInspector: document.querySelector("#settings-ui-show-inspector"),
  settingsTestConnection: document.querySelector("#settings-test-connection"),
  settingsSaveConfig: document.querySelector("#settings-save-config"),
  settingsConnectionBadge: document.querySelector("#settings-connection-badge"),
  settingsConnectionMeta: document.querySelector("#settings-connection-meta"),
  settingsResetAll: document.querySelector("#settings-reset-all"),
  onboardingOverlay: document.querySelector("#onboarding-overlay"),
  onboardingForm: document.querySelector("#onboarding-form"),
  onboardingFinish: document.querySelector("#onboarding-finish"),
  onboardingLanguage: document.querySelector("#onboarding-language"),
  onboardingTimezone: document.querySelector("#onboarding-timezone"),
  onboardingUserName: document.querySelector("#onboarding-user-name"),
  onboardingUserContext: document.querySelector("#onboarding-user-context"),
  onboardingModelTier: document.querySelector("#onboarding-model-tier"),
  onboardingModelTierLabel: document.querySelector("#onboarding-model-tier-label"),
  onboardingModelTierMeta: document.querySelector("#onboarding-model-tier-meta"),
  onboardingUiDensity: document.querySelector("#onboarding-ui-density"),
  onboardingUiAnimations: document.querySelector("#onboarding-ui-animations"),
  onboardingUiFontScale: document.querySelector("#onboarding-ui-font-scale"),
  onboardingBootMood: document.querySelector("#onboarding-boot-mood"),
};
const routeButtons = [...document.querySelectorAll("[data-route-target]")];
const openPluginAsideButtons = [...document.querySelectorAll("[data-open-plugin-aside]")];
const openSettingsAsideButtons = [...document.querySelectorAll("[data-open-settings-aside]")];
const onboardingStepPanels = [...document.querySelectorAll("[data-onboarding-step]")];
const onboardingNextStepButtons = [...document.querySelectorAll("[data-onboarding-next-step]")];
const validRoutes = new Set(["chat", "plugins", "settings"]);
let routeTransitionToken = 0;
let onboardingStepIndex = 0;
let onboardingIsOpen = false;

const actionDialogState = {
  open: false,
  mode: "confirm",
  resolve: null,
  keydownHandler: null,
  restoreFocusEl: null,
  closeTimerId: null,
  closeToken: 0,
};

function hydratePrimaryRouteIcons() {
  routeButtons.forEach((button) => {
    const routeTarget = button.dataset.routeTarget;
    const iconName = ROUTE_ICON_BY_TARGET[routeTarget];
    if (!iconName) {
      return;
    }
    const label = ROUTE_LABEL_BY_TARGET[routeTarget] || routeTarget;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    // Вставляем SVG-иконку перед label-спаном (не заменяем весь innerHTML)
    const labelSpan = button.querySelector(".route-icon__label");
    const svgEl = document.createElement("span");
      svgEl.innerHTML = icon(iconName, "ui-icon-nav");
      if (labelSpan) {
      button.insertBefore(svgEl.firstElementChild, labelSpan);
    } else {
      button.innerHTML = icon(iconName, "ui-icon-nav");
    }
  });
}

const isMacOS = /Mac|iPhone|iPad/.test(navigator.userAgent);
if (isMacOS) {
  document.body.dataset.os = "macos";
}
hydratePrimaryRouteIcons();

function isMotionEnabled() {
  return runtimeConfig.uiAnimations && !prefersReducedMotionMedia.matches;
}

const TOAST_TONE_TITLE = {
  success: "Готово",
  error: "Ошибка",
  warning: "Внимание",
  neutral: "Статус",
};

let toastSeq = 0;
function pushToast(message, { tone = "neutral", durationMs = 2800 } = {}) {
  if (!elements.toastRegion || !message) {
    return;
  }

  const id = ++toastSeq;
  const toast = document.createElement("article");
  toast.className = "toast-item";
  toast.dataset.toastId = String(id);
  toast.dataset.tone = tone;
  toast.setAttribute("role", tone === "error" ? "alert" : "status");

  const title = document.createElement("p");
  title.className = "toast-item__title";
  title.textContent = TOAST_TONE_TITLE[tone] || TOAST_TONE_TITLE.neutral;

  const body = document.createElement("p");
  body.className = "toast-item__body";
  body.textContent = String(message);

  toast.append(title, body);
  elements.toastRegion.appendChild(toast);

  const removeToast = () => {
    toast.classList.add("toast-item-leave");
    window.setTimeout(() => {
      toast.remove();
    }, 170);
  };

  window.setTimeout(removeToast, clamp(Number(durationMs) || 2800, 1000, 10000));
}

function hasActionDialogSupport() {
  return Boolean(
    elements.actionDialogOverlay
      && elements.actionDialog
      && elements.actionDialogTitle
      && elements.actionDialogMessage
      && elements.actionDialogInputWrap
      && elements.actionDialogInput
      && elements.actionDialogCancel
      && elements.actionDialogConfirm,
  );
}

function finalizeActionDialogVisualClose(restoreFocusEl = null) {
  if (!hasActionDialogSupport()) {
    return;
  }

  elements.actionDialogOverlay.classList.remove("is-open", "is-closing");
  elements.actionDialogOverlay.classList.add("hidden");
  elements.actionDialogOverlay.setAttribute("aria-hidden", "true");

  if (restoreFocusEl instanceof HTMLElement) {
    window.requestAnimationFrame(() => {
      restoreFocusEl.focus({ preventScroll: true });
    });
  }
}

function settleActionDialog(
  result = { confirmed: false, value: null },
  { skipAnimation = false } = {},
) {
  if (!hasActionDialogSupport() || !actionDialogState.open) {
    return;
  }

  const resolver = actionDialogState.resolve;
  const keydownHandler = actionDialogState.keydownHandler;
  const restoreFocusEl = actionDialogState.restoreFocusEl;

  actionDialogState.open = false;
  actionDialogState.mode = "confirm";
  actionDialogState.resolve = null;
  actionDialogState.keydownHandler = null;
  actionDialogState.restoreFocusEl = null;
  const closeToken = ++actionDialogState.closeToken;

  elements.actionDialogInputWrap.classList.add("hidden");
  elements.actionDialogInput.value = "";
  elements.actionDialogInput.placeholder = "";
  elements.actionDialogConfirm.classList.remove("action-dialog__confirm-danger");

  if (typeof keydownHandler === "function") {
    document.removeEventListener("keydown", keydownHandler);
  }

  if (actionDialogState.closeTimerId != null) {
    window.clearTimeout(actionDialogState.closeTimerId);
    actionDialogState.closeTimerId = null;
  }

  const shouldAnimate = isMotionEnabled() && !skipAnimation;
  if (!shouldAnimate) {
    finalizeActionDialogVisualClose(restoreFocusEl);
  } else {
    elements.actionDialogOverlay.classList.remove("is-open");
    elements.actionDialogOverlay.classList.add("is-closing");
    elements.actionDialogOverlay.setAttribute("aria-hidden", "true");
    actionDialogState.closeTimerId = window.setTimeout(() => {
      if (closeToken !== actionDialogState.closeToken) {
        return;
      }
      actionDialogState.closeTimerId = null;
      finalizeActionDialogVisualClose(restoreFocusEl);
    }, ACTION_DIALOG_TRANSITION_MS);
  }

  if (typeof resolver === "function") {
    resolver(result);
  }
}

function openActionDialog({
  mode = "confirm",
  title = "Подтверждение",
  message = "Подтвердите действие.",
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  placeholder = "",
  defaultValue = "",
  danger = false,
} = {}) {
  if (!hasActionDialogSupport()) {
    return Promise.resolve({
      confirmed: false,
      value: null,
      fallback: true,
    });
  }

  if (actionDialogState.open) {
    settleActionDialog({ confirmed: false, value: null }, { skipAnimation: true });
  }

  const safeMode = mode === "prompt" ? "prompt" : "confirm";
  actionDialogState.open = true;
  actionDialogState.mode = safeMode;
  actionDialogState.restoreFocusEl = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  elements.actionDialogTitle.textContent = String(title || "Подтверждение");
  elements.actionDialogMessage.textContent = String(message || "Подтвердите действие.");
  elements.actionDialogCancel.textContent = String(cancelLabel || "Отмена");
  elements.actionDialogConfirm.textContent = String(confirmLabel || "Подтвердить");
  elements.actionDialogConfirm.classList.toggle("action-dialog__confirm-danger", Boolean(danger));

  const promptMode = safeMode === "prompt";
  elements.actionDialogInputWrap.classList.toggle("hidden", !promptMode);
  elements.actionDialogInput.placeholder = String(placeholder || "");
  elements.actionDialogInput.value = String(defaultValue ?? "");

  if (actionDialogState.closeTimerId != null) {
    window.clearTimeout(actionDialogState.closeTimerId);
    actionDialogState.closeTimerId = null;
  }
  const openToken = ++actionDialogState.closeToken;
  elements.actionDialogOverlay.classList.remove("hidden", "is-open", "is-closing");
  elements.actionDialogOverlay.setAttribute("aria-hidden", "false");
  if (isMotionEnabled()) {
    window.requestAnimationFrame(() => {
      if (!actionDialogState.open || openToken !== actionDialogState.closeToken) {
        return;
      }
      elements.actionDialogOverlay.classList.add("is-open");
    });
  } else {
    elements.actionDialogOverlay.classList.add("is-open");
  }

  return new Promise((resolve) => {
    actionDialogState.resolve = resolve;

    const keydownHandler = (event) => {
      if (!actionDialogState.open) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        settleActionDialog({ confirmed: false, value: null });
        return;
      }

      if (event.key === "Enter") {
        if (actionDialogState.mode !== "prompt") {
          event.preventDefault();
          settleActionDialog({ confirmed: true, value: null });
          return;
        }

        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLTextAreaElement)) {
          event.preventDefault();
          settleActionDialog({
            confirmed: true,
            value: String(elements.actionDialogInput.value || ""),
          });
        }
      }
    };

    actionDialogState.keydownHandler = keydownHandler;
    document.addEventListener("keydown", keydownHandler);

    window.requestAnimationFrame(() => {
      if (promptMode) {
        elements.actionDialogInput.focus({ preventScroll: true });
        elements.actionDialogInput.select();
      } else {
        elements.actionDialogConfirm.focus({ preventScroll: true });
      }
    });
  });
}

async function requestActionConfirm(
  message,
  {
    title = "Подтверждение",
    confirmLabel = "Подтвердить",
    cancelLabel = "Отмена",
    danger = false,
  } = {},
) {
  if (!hasActionDialogSupport()) {
    if (typeof window.confirm === "function") {
      return window.confirm(String(message || "Подтвердите действие."));
    }
    return false;
  }

  const result = await openActionDialog({
    mode: "confirm",
    title,
    message: String(message || "Подтвердите действие."),
    confirmLabel,
    cancelLabel,
    danger,
  });
  return Boolean(result?.confirmed);
}

async function requestActionText(
  message,
  defaultValue = "",
  {
    title = "Ввод значения",
    confirmLabel = "Сохранить",
    cancelLabel = "Отмена",
    placeholder = "",
    danger = false,
  } = {},
) {
  if (!hasActionDialogSupport()) {
    if (typeof window.prompt === "function") {
      const fallback = window.prompt(String(message || "Введите значение:"), String(defaultValue ?? ""));
      return fallback == null ? null : String(fallback);
    }
    return null;
  }

  const result = await openActionDialog({
    mode: "prompt",
    title,
    message: String(message || "Введите значение."),
    confirmLabel,
    cancelLabel,
    placeholder,
    defaultValue: String(defaultValue ?? ""),
    danger,
  });

  if (!result?.confirmed) {
    return null;
  }

  return String(result.value ?? "");
}

function setPreloaderStatus(message) {
  if (!elements.preloaderLabel) {
    return;
  }
  elements.preloaderLabel.textContent = String(message || "Загрузка...");
}

function resolveBackendStartupState(healthPayload) {
  const startup = healthPayload && typeof healthPayload === "object" ? healthPayload.startup : null;
  const autonomousMode = Boolean(
    healthPayload?.policy?.autonomous_mode
    || healthPayload?.autonomous_mode,
  );
  const status = String(startup?.status || "").trim().toLowerCase() || "loading";
  const stage = String(startup?.stage || "").trim().toLowerCase();
  const startupMessage = String(startup?.message || "").trim();

  const stageLabel = stage === "environment_check"
    ? "Проверка окружения Python/MLX..."
    : stage === "checking_gpu_memory"
      ? "Проверка доступной GPU/unified памяти..."
      : stage === "loading_model"
        ? "Загрузка модели Standart..."
        : stage === "ready"
          ? "Модель готова."
          : stage === "error"
            ? "Ошибка запуска модели."
            : "Запуск серверного модуля...";

  return {
    status,
    stage,
    message: `${startupMessage || stageLabel}${autonomousMode ? " • Автономный режим" : ""}`,
    autonomousMode,
  };
}

async function waitForBackendStartup() {
  if (runtimeConfig.mode !== "backend") {
    return { ready: false, skipped: true };
  }
  if (!runtimeConfig.backendUrl) {
    const errorMessage = "Не задан URL бэкенда.";
    updateConnectionState(BACKEND_STATUS.error, errorMessage);
    setPreloaderStatus(errorMessage);
    return { ready: false, error: errorMessage };
  }

  const startedAt = performance.now();
  let lastError = "";

  while (performance.now() - startedAt < PRELOADER_BACKEND_TIMEOUT_MS) {
    try {
      const health = await backendClient.ping();
      const startup = resolveBackendStartupState(health);
      setPreloaderStatus(startup.message);

      if (startup.status === "error") {
        updateConnectionState(BACKEND_STATUS.error, startup.message, health);
        return { ready: false, error: startup.message, health };
      }

      if (startup.status === "ready") {
        updateConnectionState(BACKEND_STATUS.connected, "Бэкенд доступен, модель готова", health);
        return { ready: true, health };
      }

      updateConnectionState(BACKEND_STATUS.checking, startup.message, health);
    } catch (error) {
      lastError = error?.message ? String(error.message) : "сервер не отвечает";
      updateConnectionState(BACKEND_STATUS.checking, `Ожидаем запуск бэкенда: ${lastError}`);
      setPreloaderStatus("Ожидаем запуск бэкенда...");
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, PRELOADER_BACKEND_POLL_MS);
    });
  }

  const timeoutMessage = lastError
    ? `Сервер недоступен: ${lastError}`
    : "Сервер не успел запуститься вовремя.";
  updateConnectionState(BACKEND_STATUS.error, timeoutMessage);
  setPreloaderStatus(timeoutMessage);
  return { ready: false, error: timeoutMessage };
}

function hidePreloader() {
  return new Promise((resolve) => {
    if (!elements.preloader) {
      resolve();
      return;
    }

    const elapsed = performance.now() - preloaderStartMs;
    const waitMs = Math.max(0, PRELOADER_MIN_MS - elapsed);

    window.setTimeout(() => {
      document.body.classList.add("app-ready");
      window.setTimeout(() => {
        elements.preloader?.remove();
        resolve();
      }, 240);
    }, waitMs);
  });
}

async function setupTauriTitlebarDragging() {
  if (!elements.titlebar || !("__TAURI_INTERNALS__" in window)) {
    return;
  }

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    elements.titlebar.addEventListener("mousedown", async (event) => {
      if (event.button !== 0) {
        return;
      }

      const rawTarget = event.target;
      const target =
        rawTarget instanceof Element
          ? rawTarget
          : rawTarget instanceof Node
            ? rawTarget.parentElement
            : null;

      // Keep interactive controls clickable if they are ever placed into titlebar.
      if (target?.closest("button, a, input, textarea, select, [data-no-drag], .no-drag")) {
        return;
      }

      event.preventDefault();
      try {
        await appWindow.startDragging();
      } catch (dragError) {
        // Ignore transient platform errors and keep CSS drag-region as fallback.
      }
    });
  } catch (error) {
    // Ignore: browser mode or missing Tauri bridge.
  }
}

const isLeftPanelDocked = () => window.innerWidth >= 1280;
const isRightPanelDocked = () => window.innerWidth >= 1536;
const isPluginAsideDocked = () => window.innerWidth >= 1280;
const isSettingsAsideDocked = () => window.innerWidth >= 1280;

function normalizeRoute(route) {
  const normalized = String(route || "").trim().toLowerCase().replace(/^#\/?/, "");
  return validRoutes.has(normalized) ? normalized : "chat";
}

function getRouteFromHash() {
  return normalizeRoute(window.location.hash);
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

const runtimeConfig = loadRuntimeConfig();
let onboardingState = loadOnboardingState();
const backendClient = new BackendClient({
  baseUrl: runtimeConfig.backendUrl,
  apiKey: runtimeConfig.apiKey,
  timeoutMs: runtimeConfig.timeoutMs,
});
let chatFeature = null;
let settingsFeature = null;
let pluginsFeature = null;

const connectionState = {
  status: BACKEND_STATUS.idle,
  message: "Сервер не проверялся",
  checkedAt: null,
  health: null,
};

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
      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
      : status === BACKEND_STATUS.error
        ? "border-red-500/30 bg-red-500/15 text-red-300"
        : status === BACKEND_STATUS.checking
          ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
          : "border-zinc-600/30 bg-zinc-800/70 text-zinc-300";
    elements.settingsConnectionBadge.className = `rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.14em] ${badgePalette}`;
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

function updateRuntimeBadges() {
  const modeLabel = RUNTIME_MODE_LABEL[runtimeConfig.mode] || runtimeConfig.mode;
  const modelTierMeta = getModelTierMeta(runtimeConfig.modelTier);
  const modelLabel = getModelLabelById(runtimeConfig.modelId, modelTierMeta.label);

  if (elements.runtimeMode) {
    elements.runtimeMode.textContent = modeLabel;
  }
  if (elements.runtimeModelLabel) {
    elements.runtimeModelLabel.textContent = `${modelLabel} • ${modelTierMeta.label}`;
  }
  if (elements.titlebarBackendChip) {
    const connectionLabel = BACKEND_STATUS_LABEL[connectionState.status] || BACKEND_STATUS_LABEL[BACKEND_STATUS.idle];
    elements.titlebarBackendChip.textContent = runtimeConfig.mode === "backend"
      ? `${modeLabel} • ${connectionLabel}`
      : modeLabel;
    const chipPalette = runtimeConfig.mode === "backend"
      ? connectionState.status === BACKEND_STATUS.connected
        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
        : connectionState.status === BACKEND_STATUS.error
          ? "border-red-500/30 bg-red-500/15 text-red-300"
          : connectionState.status === BACKEND_STATUS.checking
            ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
            : "border-zinc-600/30 bg-zinc-900/55 text-zinc-300"
      : "border-zinc-600/30 bg-zinc-900/55 text-zinc-300";
    elements.titlebarBackendChip.className = `rounded-full border px-2 py-1 ${chipPalette}`;
  }
}

function syncOnboardingModelTierPreview(tierLike) {
  const tier = normalizeModelTier(tierLike ?? runtimeConfig.modelTier);
  const tierMeta = getModelTierMeta(tier);
  const tierIndex = modelTierToRangeIndex(tier);
  const tierPercent = (tierIndex / Math.max(1, MODEL_TIER_ORDER.length - 1)) * 100;

  if (elements.onboardingModelTier instanceof HTMLInputElement) {
    elements.onboardingModelTier.value = String(tierIndex);
    elements.onboardingModelTier.style.setProperty("--tier-progress", `${tierPercent.toFixed(1)}%`);
  }
  if (elements.onboardingModelTierLabel) {
    elements.onboardingModelTierLabel.textContent = tierMeta.label;
  }
  if (elements.onboardingModelTierMeta) {
    elements.onboardingModelTierMeta.textContent = tierMeta.description;
  }
}

function hydrateOnboardingForm() {
  if (elements.onboardingLanguage) {
    elements.onboardingLanguage.value = runtimeConfig.userLanguage;
  }
  if (elements.onboardingTimezone) {
    elements.onboardingTimezone.value = runtimeConfig.userTimezone;
    clearFieldValidation(elements.onboardingTimezone);
  }
  if (elements.onboardingUserName) {
    elements.onboardingUserName.value = runtimeConfig.userName;
  }
  if (elements.onboardingUserContext) {
    elements.onboardingUserContext.value = runtimeConfig.userContext;
  }
  syncOnboardingModelTierPreview(runtimeConfig.modelTier);
  if (elements.onboardingUiDensity) {
    elements.onboardingUiDensity.value = runtimeConfig.uiDensity;
  }
  if (elements.onboardingUiAnimations) {
    elements.onboardingUiAnimations.checked = runtimeConfig.uiAnimations;
  }
  if (elements.onboardingUiFontScale) {
    elements.onboardingUiFontScale.value = String(runtimeConfig.uiFontScale);
    clearFieldValidation(elements.onboardingUiFontScale);
  }
  if (elements.onboardingBootMood) {
    const hasBootMoodOption = [...elements.onboardingBootMood.options]
      .some((option) => option.value === runtimeConfig.bootMood);
    elements.onboardingBootMood.value = hasBootMoodOption ? runtimeConfig.bootMood : "neutral";
  }
}

function collectOnboardingForm() {
  return normalizeRuntimeConfig({
    ...runtimeConfig,
    userLanguage: elements.onboardingLanguage?.value ?? runtimeConfig.userLanguage,
    userTimezone: elements.onboardingTimezone?.value ?? runtimeConfig.userTimezone,
    userName: elements.onboardingUserName?.value ?? runtimeConfig.userName,
    userContext: elements.onboardingUserContext?.value ?? runtimeConfig.userContext,
    modelTier: elements.onboardingModelTier?.value ?? runtimeConfig.modelTier,
    uiDensity: elements.onboardingUiDensity?.value ?? runtimeConfig.uiDensity,
    uiAnimations: elements.onboardingUiAnimations?.checked ?? runtimeConfig.uiAnimations,
    uiFontScale: elements.onboardingUiFontScale?.value ?? runtimeConfig.uiFontScale,
    bootMood: elements.onboardingBootMood?.value ?? runtimeConfig.bootMood,
  });
}

function syncOnboardingStepUI({ animate = true, direction = 1, previousStep = null } = {}) {
  const stepCount = Math.max(1, onboardingStepPanels.length || ONBOARDING_STEPS_COUNT);
  onboardingStepIndex = clamp(onboardingStepIndex, 0, stepCount - 1);

  onboardingStepPanels.forEach((panel, index) => {
    const isActive = index === onboardingStepIndex;
    panel.classList.remove(
      "onboarding-step-enter-forward",
      "onboarding-step-enter-back",
      "onboarding-step-leave-forward",
      "onboarding-step-leave-back",
    );

    if (isActive) {
      panel.classList.remove("hidden");
      panel.setAttribute("aria-hidden", "false");
    } else {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
    }

    if (isActive && animate && isMotionEnabled()) {
      const animationClass = direction < 0 ? "onboarding-step-enter-back" : "onboarding-step-enter-forward";
      panel.classList.add(animationClass);
      window.setTimeout(() => {
        panel.classList.remove(animationClass);
      }, 240);
    }
  });

  const isFinalStep = onboardingStepIndex >= stepCount - 1;
  if (elements.onboardingFinish) {
    elements.onboardingFinish.classList.toggle("hidden", !isFinalStep);
  }

  document.querySelectorAll("[data-onboarding-dot]").forEach((dot) => {
    const active = Number(dot.dataset.onboardingDot) === onboardingStepIndex;
    dot.dataset.active = active ? "true" : "false";
  });
}

function setOnboardingStep(nextStep, { animate = true, direction = 1 } = {}) {
  const stepCount = Math.max(1, onboardingStepPanels.length || ONBOARDING_STEPS_COUNT);
  const numericStep = Number(nextStep);
  const safeStep = Number.isFinite(numericStep) ? Math.trunc(numericStep) : 0;
  onboardingStepIndex = clamp(safeStep, 0, stepCount - 1);
  syncOnboardingStepUI({ animate, direction });
  if (onboardingIsOpen) {
    const activePanel = onboardingStepPanels[onboardingStepIndex];
    if (activePanel instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        focusFirstInteractive(activePanel);
      });
    }
  }
}

function validateOnboardingStep(stepIndex) {
  const lastStepIndex = Math.max(0, (onboardingStepPanels.length || ONBOARDING_STEPS_COUNT) - 1);
  if (stepIndex < lastStepIndex) {
    return true;
  }

  if (elements.onboardingTimezone) {
    const timezone = String(elements.onboardingTimezone?.value || "").trim();
    if (!isValidTimezone(timezone)) {
      if (elements.onboardingTimezone) {
        elements.onboardingTimezone.classList.add("field-invalid");
        elements.onboardingTimezone.setAttribute("aria-invalid", "true");
      }
      pushToast("Укажите корректный часовой пояс, например Europe/Moscow.", { tone: "error" });
      return false;
    }
    clearFieldValidation(elements.onboardingTimezone);
  }

  if (elements.onboardingUiFontScale) {
    const fontScale = Number(elements.onboardingUiFontScale?.value);
    const validScale = Number.isFinite(fontScale) && fontScale >= 85 && fontScale <= 120;
    if (!validScale) {
      if (elements.onboardingUiFontScale) {
        elements.onboardingUiFontScale.classList.add("field-invalid");
        elements.onboardingUiFontScale.setAttribute("aria-invalid", "true");
      }
      pushToast("Масштаб шрифта должен быть от 85 до 120.", { tone: "error" });
      return false;
    }
    clearFieldValidation(elements.onboardingUiFontScale);
  }

  return true;
}

function shouldShowOnboarding() {
  if (!elements.onboardingOverlay || !elements.onboardingForm) {
    return false;
  }
  if (!onboardingState.completed) {
    return true;
  }
  return Number(onboardingState.version || 0) < ONBOARDING_VERSION;
}

function openOnboarding() {
  if (!elements.onboardingOverlay || !elements.onboardingForm) {
    return;
  }
  chatFeature?.closeContextMenu();
  hydrateOnboardingForm();
  setOnboardingStep(0, { animate: false });
  closeAllMobilePanels();
  onboardingIsOpen = true;
  elements.onboardingOverlay.classList.add("is-open");
  elements.onboardingOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("onboarding-open");
  const activePanel = onboardingStepPanels[onboardingStepIndex];
  if (activePanel instanceof HTMLElement) {
    window.requestAnimationFrame(() => {
      focusFirstInteractive(activePanel);
    });
  }
}

function closeOnboarding() {
  if (!elements.onboardingOverlay) {
    return;
  }
  onboardingIsOpen = false;
  elements.onboardingOverlay.classList.remove("is-open");
  elements.onboardingOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("onboarding-open");
}

function finishOnboarding({ skipped = false } = {}) {
  if (!skipped) {
    const finalStep = Math.max(0, (onboardingStepPanels.length || ONBOARDING_STEPS_COUNT) - 1);
    if (!validateOnboardingStep(finalStep)) {
      setOnboardingStep(finalStep, { direction: 1 });
      return false;
    }

    const nextConfig = collectOnboardingForm();
    applyRuntimeConfig(nextConfig);
    settingsFeature?.hydrateSettingsForm();
  }

  onboardingState = {
    version: ONBOARDING_VERSION,
    completed: true,
    skipped: Boolean(skipped),
    completedAt: new Date().toISOString(),
    data: skipped
      ? {}
      : {
        userName: runtimeConfig.userName,
        userLanguage: runtimeConfig.userLanguage,
        modelTier: runtimeConfig.modelTier,
        uiDensity: runtimeConfig.uiDensity,
        bootMood: runtimeConfig.bootMood,
      },
  };
  persistOnboardingState(onboardingState);
  void persistSettingsToBackend({
    includeRuntime: !skipped,
    includeOnboarding: true,
    autonomousMode: runtimeConfig.autonomousMode,
  });
  closeOnboarding();
  pushToast(
    skipped
      ? "Первичная настройка пропущена. При необходимости её можно запустить позже."
      : "Первичная настройка сохранена.",
    { tone: skipped ? "warning" : "success" },
  );
  return true;
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
  background.setPerformanceProfile(runtimeConfig.modelTier);
  background.setMotionEnabled(backgroundMotionEnabled);

  const baseFontSize = 16 * (runtimeConfig.uiFontScale / 100);
  document.documentElement.style.fontSize = `${baseFontSize.toFixed(2)}px`;

  if (elements.panelRight) {
    if (window.innerWidth >= 1536) {
      elements.panelRight.style.display = runtimeConfig.uiShowInspector ? "" : "none";
    } else {
      elements.panelRight.style.display = "";
    }
  }
}

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
  settingsFeature?.onRuntimeConfigApplied();
  if (previousConfig.autonomousMode !== runtimeConfig.autonomousMode) {
    void pluginsFeature?.reload?.();
  }
  if (onboardingIsOpen) {
    hydrateOnboardingForm();
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
        onboardingState = {
          version: Number(onboardingFromBackend.version) || ONBOARDING_VERSION,
          completed: Boolean(onboardingFromBackend.completed),
          skipped: Boolean(onboardingFromBackend.skipped),
          completedAt: String(onboardingFromBackend.completedAt || ""),
          data: typeof onboardingFromBackend.data === "object" && onboardingFromBackend.data
            ? onboardingFromBackend.data
            : {},
        };
        persistOnboardingState(onboardingState);
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
    payload.onboarding_state = { ...onboardingState };
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

function clearBrowserStorage() {
  try {
    window.localStorage.clear();
  } catch (error) {
    // noop
  }
  try {
    window.sessionStorage.clear();
  } catch (error) {
    // noop
  }

  const cookies = document.cookie ? document.cookie.split(";") : [];
  cookies.forEach((entry) => {
    const cookieName = String(entry.split("=")[0] || "").trim();
    if (!cookieName) {
      return;
    }
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${location.hostname}`;
  });

  if (window.indexedDB && typeof window.indexedDB.databases === "function") {
    void window.indexedDB.databases().then((dbList) => {
      (dbList || []).forEach((dbInfo) => {
        const dbName = String(dbInfo?.name || "").trim();
        if (dbName) {
          window.indexedDB.deleteDatabase(dbName);
        }
      });
    }).catch(() => {
      // noop
    });
  }
}

async function handleResetAllAction() {
  const confirmed = await requestActionConfirm(
    "Сбросить все данные приложения? Будут удалены чаты, настройки, локальные данные браузера и состояние плагинов.",
    {
      title: "Сброс приложения",
      confirmLabel: "Сбросить всё",
      cancelLabel: "Отмена",
      danger: true,
    },
  );
  if (!confirmed) {
    return;
  }

  let backendResetOk = false;
  if (runtimeConfig.mode === "backend" && runtimeConfig.backendUrl) {
    try {
      await backendClient.resetApp({ reset_onboarding: true });
      backendResetOk = true;
    } catch (error) {
      pushToast(`Сброс в бэкенде не выполнен: ${error.message}`, {
        tone: "error",
        durationMs: 4200,
      });
    }
  }

  clearBrowserStorage();
  pushToast(
    backendResetOk
      ? "Данные приложения сброшены. Перезапускаем интерфейс..."
      : "Локальные данные очищены. Перезапускаем интерфейс...",
    { tone: backendResetOk ? "success" : "warning", durationMs: 2200 },
  );
  window.setTimeout(() => {
    window.location.reload();
  }, 220);
}

function clearFieldValidation(field) {
  if (!field) {
    return;
  }
  field.classList.remove("field-invalid");
  field.removeAttribute("aria-invalid");
}

function isValidTimezone(timezone) {
  const normalized = String(timezone || "").trim();
  if (!normalized) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: normalized });
    return true;
  } catch (error) {
    return false;
  }
}

const background = new StatefulLiquidBackground(elements.canvas, {
  onMoodChange: updateMoodUI,
  onStats: updateRenderStats,
});
background.mount();
const initialRouteMood = ROUTE_BACKGROUND_STATE[normalizeRoute(getRouteFromHash())] || runtimeConfig.bootMood || "neutral";
background.applyMoodInstant(background.hasMood(initialRouteMood) ? initialRouteMood : "neutral");
updateRuntimeBadges();
applyInterfacePreferences();
setPreloaderStatus("Загрузка интерфейса...");
updateConnectionState(BACKEND_STATUS.idle, "Сервер не проверялся");

const mobileState = {
  leftOpen: false,
  rightOpen: false,
  pluginAsideOpen: false,
  settingsAsideOpen: false,
};

const overlayState = {
  activePanelId: "",
  restoreFocusEl: null,
};

const FOCUSABLE_SELECTOR = `
  button:not([disabled]),
  [href],
  input:not([disabled]),
  select:not([disabled]),
  textarea:not([disabled]),
  [tabindex]:not([tabindex="-1"])
`.replace(/\s+/g, " ").trim();

function focusFirstInteractive(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const target = container.querySelector(FOCUSABLE_SELECTOR);
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true });
  }
}

function applyOverlayDialogState(element, isDialog, label) {
  if (!element) {
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

function resolveActiveOverlayPanel(leftOverlayOpen, rightOverlayOpen, pluginOverlayOpen, settingsOverlayOpen) {
  if (rightOverlayOpen && elements.panelRight) {
    return { id: "panel-right", element: elements.panelRight };
  }
  if (leftOverlayOpen && elements.panelLeft) {
    return { id: "panel-left", element: elements.panelLeft };
  }
  if (pluginOverlayOpen && elements.pluginAside) {
    return { id: "plugin-aside", element: elements.pluginAside };
  }
  if (settingsOverlayOpen && elements.settingsAside) {
    return { id: "settings-aside", element: elements.settingsAside };
  }
  return null;
}

function syncMobilePanels() {
  const leftDocked = isLeftPanelDocked();
  const rightDocked = isRightPanelDocked();
  const pluginAsideDocked = isPluginAsideDocked();
  const settingsAsideDocked = isSettingsAsideDocked();

  if (leftDocked) {
    mobileState.leftOpen = false;
  }
  if (rightDocked) {
    mobileState.rightOpen = false;
  }
  if (pluginAsideDocked) {
    mobileState.pluginAsideOpen = false;
  }
  if (settingsAsideDocked) {
    mobileState.settingsAsideOpen = false;
  }

  const leftOverlayOpen = !leftDocked && mobileState.leftOpen;
  const rightOverlayOpen = !rightDocked && mobileState.rightOpen;
  const pluginOverlayOpen = !pluginAsideDocked && mobileState.pluginAsideOpen;
  const settingsOverlayOpen = !settingsAsideDocked && mobileState.settingsAsideOpen;

  const showBackdrop = (
    leftOverlayOpen
    || rightOverlayOpen
    || pluginOverlayOpen
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
  applyOverlayDialogState(elements.settingsAside, settingsOverlayOpen, "Разделы настроек");

  elements.openLeftPanel?.setAttribute("aria-expanded", String(leftOverlayOpen));
  elements.openRightPanel?.setAttribute("aria-expanded", String(rightOverlayOpen));
  openPluginAsideButtons.forEach((button) => {
    button.setAttribute("aria-expanded", String(pluginOverlayOpen));
  });
  openSettingsAsideButtons.forEach((button) => {
    button.setAttribute("aria-expanded", String(settingsOverlayOpen));
  });

  const activeOverlay = resolveActiveOverlayPanel(
    leftOverlayOpen,
    rightOverlayOpen,
    pluginOverlayOpen,
    settingsOverlayOpen,
  );

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
  mobileState.settingsAsideOpen = false;
  syncMobilePanels();
}

settingsFeature = createSettingsFeature({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
  normalizeModelTier,
  normalizeModelId,
  getModelLabelById,
  getModelTierMeta,
  modelTierToRangeIndex,
  modelTierOrder: MODEL_TIER_ORDER,
  devicePresetMeta: DEVICE_PRESET_META,
  devicePresetOrder: DEVICE_PRESET_ORDER,
  normalizeDevicePreset,
  getDevicePresetMeta,
  applyDevicePreset,
  isMotionEnabled,
  pushToast,
  backendClient,
  updateConnectionState,
  BACKEND_STATUS,
  applyRuntimeConfig,
  getChatFeature: () => chatFeature,
  isSettingsAsideDocked,
  mobileState,
  syncMobilePanels,
  clearFieldValidation,
  isValidTimezone,
});

pluginsFeature = createPluginsFeature({
  elements,
  pushToast,
  backendClient,
});

chatFeature = createChatFeature({
  elements,
  runtimeConfig,
  backendClient,
  background,
  normalizeRoute,
  getRouteFromHash,
  clamp,
  isMotionEnabled,
  pushToast,
  requestActionConfirm,
  requestActionText,
  updateConnectionState,
  BACKEND_STATUS,
  routeBackgroundState: ROUTE_BACKGROUND_STATE,
  mobileState,
  syncMobilePanels,
  isLeftPanelDocked,
});

function updateRouteButtons(route) {
  routeButtons.forEach((button) => {
    const isActive = button.dataset.routeTarget === route;
    button.dataset.active = String(isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });

  if (elements.titlebarRouteChip) {
    elements.titlebarRouteChip.textContent = (ROUTE_LABEL_BY_TARGET[route] || route).toLowerCase();
  }
}

function applyRoute(route, { animate = true } = {}) {
  chatFeature?.closeContextMenu();
  const currentRoute = normalizeRoute(route);
  const previousRouteRaw = document.body.dataset.route;
  const previousRoute = previousRouteRaw ? normalizeRoute(previousRouteRaw) : null;
  const shouldAnimate = animate && isMotionEnabled() && previousRoute && previousRoute !== currentRoute;
  const transitionId = ++routeTransitionToken;
  const isCurrentTransition = () => transitionId === routeTransitionToken;

  document.body.dataset.route = currentRoute;
  updateRouteButtons(currentRoute);

  const setPageVisibility = (element, isVisible) => {
    if (!element) {
      return;
    }
    if (!shouldAnimate) {
      element.classList.remove("route-page-enter", "route-page-leave");
      element.classList.toggle("hidden", !isVisible);
      element.style.display = isVisible ? "" : "none";
      element.setAttribute("aria-hidden", String(!isVisible));
      return;
    }

    if (isVisible) {
      element.classList.remove("hidden", "route-page-leave");
      element.style.display = "";
      element.setAttribute("aria-hidden", "false");
      void element.offsetWidth;
      element.classList.add("route-page-enter");
      window.setTimeout(() => {
        if (!isCurrentTransition()) {
          return;
        }
        element.classList.remove("route-page-enter");
      }, ROUTE_TRANSITION_MS);
      return;
    }

    const isLeaving = previousRoute && element.dataset.routePage === previousRoute;
    if (!isLeaving) {
      element.classList.add("hidden");
      element.style.display = "none";
      element.setAttribute("aria-hidden", "true");
      element.classList.remove("route-page-enter", "route-page-leave");
      return;
    }

    element.classList.remove("route-page-enter");
    element.classList.add("route-page-leave");
    window.setTimeout(() => {
      if (!isCurrentTransition()) {
        return;
      }
      element.classList.add("hidden");
      element.style.display = "none";
      element.setAttribute("aria-hidden", "true");
      element.classList.remove("route-page-leave");
    }, ROUTE_TRANSITION_MS);
  };

  setPageVisibility(elements.pageChat, currentRoute === "chat");
  setPageVisibility(elements.pagePlugins, currentRoute === "plugins");
  setPageVisibility(elements.pageSettings, currentRoute === "settings");

  if (currentRoute === "settings") {
    settingsFeature?.applyCurrentSection({ animate });
  }

  chatFeature?.applyContextualBackground({
    transitionMs: animate ? 860 : 0,
    immediate: !animate,
  });
  closeAllMobilePanels();
}

function navigateToRoute(route) {
  const nextRoute = normalizeRoute(route);
  const nextHash = `#${nextRoute}`;

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }

  applyRoute(nextRoute);
}

elements.openLeftPanel?.addEventListener("click", () => {
  mobileState.leftOpen = true;
  mobileState.rightOpen = false;
  mobileState.pluginAsideOpen = false;
  mobileState.settingsAsideOpen = false;
  syncMobilePanels();
});

elements.openRightPanel?.addEventListener("click", () => {
  mobileState.rightOpen = true;
  mobileState.leftOpen = false;
  mobileState.pluginAsideOpen = false;
  mobileState.settingsAsideOpen = false;
  syncMobilePanels();
});

openPluginAsideButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mobileState.pluginAsideOpen = true;
    mobileState.leftOpen = false;
    mobileState.rightOpen = false;
    mobileState.settingsAsideOpen = false;
    syncMobilePanels();
  });
});

openSettingsAsideButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mobileState.settingsAsideOpen = true;
    mobileState.leftOpen = false;
    mobileState.rightOpen = false;
    mobileState.pluginAsideOpen = false;
    syncMobilePanels();
  });
});

routeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    navigateToRoute(button.dataset.routeTarget);
  });
});

elements.settingsResetAll?.addEventListener("click", () => {
  void handleResetAllAction();
});

elements.onboardingModelTier?.addEventListener("input", () => {
  syncOnboardingModelTierPreview(elements.onboardingModelTier?.value);
});

elements.onboardingTimezone?.addEventListener("input", () => {
  clearFieldValidation(elements.onboardingTimezone);
});

elements.onboardingUiFontScale?.addEventListener("input", () => {
  clearFieldValidation(elements.onboardingUiFontScale);
});

onboardingNextStepButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!validateOnboardingStep(onboardingStepIndex)) {
      return;
    }
    const nextStep = Number(button.dataset.onboardingNextStep);
    const safeNextStep = Number.isFinite(nextStep)
      ? Math.trunc(nextStep)
      : onboardingStepIndex + 1;
    const direction = safeNextStep >= onboardingStepIndex ? 1 : -1;
    setOnboardingStep(safeNextStep, { direction });
  });
});

elements.onboardingForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  finishOnboarding({ skipped: false });
});


elements.actionDialogConfirm?.addEventListener("click", () => {
  if (!actionDialogState.open) {
    return;
  }
  if (actionDialogState.mode === "prompt") {
    settleActionDialog({
      confirmed: true,
      value: String(elements.actionDialogInput?.value || ""),
    });
    return;
  }
  settleActionDialog({
    confirmed: true,
    value: null,
  });
});

elements.actionDialogCancel?.addEventListener("click", () => {
  settleActionDialog({
    confirmed: false,
    value: null,
  });
});

elements.actionDialogOverlay?.addEventListener("click", (event) => {
  if (event.target === elements.actionDialogOverlay) {
    settleActionDialog({
      confirmed: false,
      value: null,
    });
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!chatFeature?.isContextMenuOpen()) {
    return;
  }
  const target = event.target;
  if (elements.contextMenu && target instanceof Node && elements.contextMenu.contains(target)) {
    return;
  }
  chatFeature.closeContextMenu();
});

document.addEventListener("scroll", () => {
  if (chatFeature?.isContextMenuOpen()) {
    chatFeature.closeContextMenu();
  }
}, true);

window.addEventListener("blur", () => {
  chatFeature?.closeContextMenu();
});

elements.panelBackdrop?.addEventListener("click", closeAllMobilePanels);
document.addEventListener("keydown", (event) => {
  if (actionDialogState.open) {
    return;
  }

  if (chatFeature?.isContextMenuOpen() && event.key === "Escape") {
    event.preventDefault();
    chatFeature.closeContextMenu();
    return;
  }

  if (onboardingIsOpen) {
    const lastOnboardingStep = Math.max(0, (onboardingStepPanels.length || ONBOARDING_STEPS_COUNT) - 1);
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && onboardingStepIndex < lastOnboardingStep) {
      const activeElement = document.activeElement;
      const isTextArea = activeElement instanceof HTMLTextAreaElement;
      if (!isTextArea && validateOnboardingStep(onboardingStepIndex)) {
        event.preventDefault();
        setOnboardingStep(onboardingStepIndex + 1, { direction: 1 });
      }
    }
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    if (normalizeRoute(document.body.dataset.route) === "settings") {
      event.preventDefault();
      void settingsFeature?.saveSettings();
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
      navigateToRoute("plugins");
      return;
    }
    if (event.key === "3") {
      event.preventDefault();
      navigateToRoute("settings");
      return;
    }
  }

  if (event.key === "Escape") {
    closeAllMobilePanels();
  }
});
window.addEventListener("resize", () => {
  chatFeature?.closeContextMenu();
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
chatFeature?.initialize();
settingsFeature?.initialize();
pluginsFeature?.initialize();
syncMobilePanels();
applyRoute(getRouteFromHash(), { animate: false });

void (async () => {
  await setupTauriTitlebarDragging();

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
      await chatFeature?.syncChatStoreFromBackend({ preserveActive: true, silent: true });
    }
  } else {
    updateConnectionState(BACKEND_STATUS.idle, "Активен режим симуляции");
    setPreloaderStatus("Запуск в режиме симуляции...");
  }

  await hidePreloader();
  if (shouldShowOnboarding()) {
    openOnboarding();
  }

  if (runtimeConfig.mode === "backend" && runtimeConfig.autoReconnect && !startupResult.ready) {
    void settingsFeature?.checkBackendConnection();
  }
})();


let tokenCount = 18200;
window.setInterval(() => {
  const drift = Math.floor(Math.random() * 61) - 10;
  tokenCount = Math.max(1000, tokenCount + drift);
  elements.tokenCount.textContent = formatTokenCount(tokenCount);
}, 3200);

window.botMood = {
  getState() {
    return background.getCurrentMood();
  },
  getStates() {
    return background.getStates();
  },
  setState(name, transitionMs = DEFAULT_TRANSITION_MS) {
    const normalizedMood = chatFeature?.normalizeBackgroundStateName(name) || "neutral";
    const activeChatId = chatFeature?.getActiveChatId();
    if (chatFeature?.getCurrentRouteState() === "chat" && activeChatId) {
      chatFeature.setChatSessionMood(activeChatId, normalizedMood, transitionMs);
      return normalizedMood;
    }
    background.setMood(normalizedMood, transitionMs);
    return normalizedMood;
  },
  registerState(name, config) {
    return background.registerMood(name, config);
  },
  setImmediate(name) {
    const normalizedMood = chatFeature?.normalizeBackgroundStateName(name) || "neutral";
    const activeChatId = chatFeature?.getActiveChatId();
    if (chatFeature?.getCurrentRouteState() === "chat" && activeChatId) {
      chatFeature.setChatSessionMood(activeChatId, normalizedMood, 0, {
        immediate: true,
      });
      return normalizedMood;
    }
    background.applyMoodInstant(normalizedMood);
    return normalizedMood;
  },
  setChatState(sessionId, name, transitionMs = DEFAULT_TRANSITION_MS, applyIfActive = true) {
    return chatFeature?.setChatSessionMood(
      sessionId,
      name,
      transitionMs,
      { applyIfActive: Boolean(applyIfActive) },
    ) || null;
  },
  clearChatState(sessionId, transitionMs = DEFAULT_TRANSITION_MS) {
    chatFeature?.clearChatSessionMood(sessionId, transitionMs);
  },
  getChatState(sessionId) {
    return chatFeature?.getChatSessionMood(sessionId) || null;
  },
  getActiveChatId() {
    return chatFeature?.getActiveChatId() || null;
  },
  getContextState() {
    return chatFeature?.resolveContextBackgroundMood() || "neutral";
  },
  getRenderStats() {
    return {
      frameMs: background.frameDeltaAverage,
      pixelRatio: background.currentPixelRatio,
      targetFrameMs: background.frameBudgetMs,
    };
  },
};

window.chatRuntime = {
  setBotState(state, transitionMs = runtimeConfig.defaultTransitionMs) {
    return window.botMood.setState(state, transitionMs);
  },
  setCurrentChatState(state, transitionMs = runtimeConfig.defaultTransitionMs) {
    return chatFeature?.setCurrentChatState(state, transitionMs) || null;
  },
  setChatState(chatId, state, transitionMs = runtimeConfig.defaultTransitionMs, applyIfActive = true) {
    return chatFeature?.setChatSessionMood(
      chatId,
      state,
      transitionMs,
      { applyIfActive: Boolean(applyIfActive) },
    ) || null;
  },
  clearCurrentChatState(transitionMs = runtimeConfig.defaultTransitionMs) {
    chatFeature?.clearCurrentChatState(transitionMs);
  },
  clearChatState(chatId, transitionMs = runtimeConfig.defaultTransitionMs) {
    chatFeature?.clearChatSessionMood(chatId, transitionMs);
  },
  async clearActiveChatHistory() {
    return chatFeature ? chatFeature.clearActiveChatHistory() : false;
  },
  async clearChat(chatId) {
    return chatFeature ? chatFeature.clearChat(chatId) : false;
  },
  async deleteChat(chatId) {
    return chatFeature ? chatFeature.deleteChat(chatId) : false;
  },
  async duplicateChat(chatId) {
    return chatFeature ? chatFeature.duplicateChat(chatId) : null;
  },
  async renameActiveChat(title) {
    return chatFeature ? chatFeature.renameActiveChat(title) : null;
  },
  async renameChat(chatId, title) {
    return chatFeature ? chatFeature.renameChat(chatId, title) : null;
  },
  async editMessage(messageId, text, chatId = chatFeature?.getActiveChatId()) {
    return chatFeature ? chatFeature.editMessage(messageId, text, chatId) : false;
  },
  async deleteMessage(messageId, chatId = chatFeature?.getActiveChatId()) {
    return chatFeature ? chatFeature.deleteMessage(messageId, chatId) : false;
  },
  exportChats() {
    return chatFeature?.exportChats() || "";
  },
  importChats(payload) {
    return chatFeature?.importChats(payload) || { error: "chat feature unavailable" };
  },
  getActiveChatId() {
    return chatFeature?.getActiveChatId() || null;
  },
  getChatState(chatId) {
    return chatFeature?.getChatSessionMood(chatId) || null;
  },
  listChats() {
    return chatFeature?.listChats() || [];
  },
  listChatStates() {
    return chatFeature?.listChatStates() || [];
  },
  markThinking() {
    return window.botMood.setState("thinking", 800);
  },
  markSuccess() {
    return window.botMood.setState("success", 1000);
  },
  markError() {
    return window.botMood.setState("error", 900);
  },
  getConfig() {
    return { ...runtimeConfig };
  },
  setConfig(partial) {
    applyRuntimeConfig(partial || {});
    settingsFeature?.hydrateSettingsForm();
    void persistSettingsToBackend({
      includeRuntime: true,
      autonomousMode: runtimeConfig.autonomousMode,
    });
    return { ...runtimeConfig };
  },
  async pingBackend() {
    const result = await settingsFeature?.checkBackendConnection();
    return Boolean(result?.connected);
  },
  goTo(route) {
    navigateToRoute(route);
  },
  openOnboarding() {
    openOnboarding();
    return true;
  },
  completeOnboarding(skipped = false) {
    return finishOnboarding({ skipped: Boolean(skipped) });
  },
  getOnboardingState() {
    return { ...onboardingState };
  },
  resetOnboarding() {
    onboardingState = {
      version: ONBOARDING_VERSION,
      completed: false,
      skipped: false,
      completedAt: "",
      data: {},
    };
    persistOnboardingState(onboardingState);
    void persistSettingsToBackend({ includeOnboarding: true });
    openOnboarding();
    return { ...onboardingState };
  },
};
