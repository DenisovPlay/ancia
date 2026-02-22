import "./style.css";
import { StatefulLiquidBackground } from "./background.js";
import { chatPageTemplate, createChatFeature } from "./chats.js";
import { createModelsFeature, modelsPageTemplate } from "./models.js";
import { createPluginsFeature, pluginsPageTemplate } from "./plugins.js";
import { syncPluginUiExtensions as syncPluginUiExtensionsRuntime } from "./plugins.uiExtensions.js";
import { getPluginUiRuntime } from "./plugins.uiRuntime.js";
import {
  BACKEND_STATUS,
  ROUTE_BACKGROUND_STATE,
  ROUTE_ICON_BY_TARGET,
  ROUTE_LABEL_BY_TARGET,
  ONBOARDING_VERSION,
  ONBOARDING_STEPS_COUNT,
  clamp,
  normalizeModelId,
  getModelLabelById,
  normalizeRuntimeConfig,
  loadRuntimeConfig,
  persistRuntimeConfig,
  loadOnboardingState,
  persistOnboardingState,
} from "./runtimeConfig.js";
import { createSettingsFeature, settingsPageTemplate } from "./settings.js";
import { BackendClient } from "./services/backendClient.js";
import { createActionDialogManager } from "./ui/actionDialogManager.js";
import { createLinkOverlayManager } from "./ui/linkOverlayManager.js";
import { createMobilePanelsController } from "./ui/mobilePanels.js";
import { createToastManager } from "./ui/toastManager.js";
import {
  hidePreloader as hidePreloaderOverlay,
  updatePreloaderStatus,
  waitForBackendStartup as waitForBackendStartupFlow,
} from "./app/backendStartup.js";
import { createRouteNavigationController } from "./app/routeNavigation.js";
import { createOnboardingController } from "./app/onboardingController.js";
import { bindPanelOpenActions } from "./app/panelBindings.js";
import { installRuntimeApis, startTokenCounter } from "./app/runtimeApis.js";
import { createRuntimeUiController } from "./app/runtimeUiController.js";
import { createRuntimeConfigController } from "./app/runtimeConfigController.js";
import { clearFieldValidation, isValidTimezone } from "./app/formValidation.js";
import { bindAppUiEvents, runAppStartup } from "./app/appLifecycle.js";
import {
  mountPageTemplates,
  collectDomNodes,
  hydratePrimaryRouteIcons,
  hydrateIcons,
  createRouteHelpers,
  applyPlatformMarker,
} from "./app/domBootstrap.js";

const ROUTE_TRANSITION_MS = 180;
const PRELOADER_MIN_MS = 320;
const PRELOADER_BACKEND_TIMEOUT_MS = 60000;
const PRELOADER_BACKEND_POLL_MS = 800;
const prefersReducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

mountPageTemplates({
  chatRoot: document.querySelector("#page-chat"),
  modelsRoot: document.querySelector("#page-models"),
  pluginsRoot: document.querySelector("#page-plugins"),
  settingsRoot: document.querySelector("#page-settings"),
  chatTemplate: chatPageTemplate,
  modelsTemplate: modelsPageTemplate,
  pluginsTemplate: pluginsPageTemplate,
  settingsTemplate: settingsPageTemplate,
});

const preloaderStartMs = performance.now();

const formatTokenCount = (value) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
};

const {
  elements,
  routeButtons,
  openPluginAsideButtons,
  openModelAsideButtons,
  openSettingsAsideButtons,
  onboardingStepPanels,
  onboardingNextStepButtons,
  validRoutes,
} = collectDomNodes();
const { normalizeRoute, getRouteFromHash } = createRouteHelpers(validRoutes);
applyPlatformMarker();
hydratePrimaryRouteIcons({
  routeButtons,
  routeIconByTarget: ROUTE_ICON_BY_TARGET,
  routeLabelByTarget: ROUTE_LABEL_BY_TARGET,
});
hydrateIcons();

const setPreloaderStatus = (message, progressPercent = null) => {
  updatePreloaderStatus(
    elements.preloaderLabel,
    message,
    elements.preloaderProgress,
    progressPercent,
  );
};

async function waitForBackendStartup() {
  return waitForBackendStartupFlow({
    runtimeConfig,
    backendClient,
    updateConnectionState,
    setPreloaderStatus,
    BACKEND_STATUS,
    timeoutMs: PRELOADER_BACKEND_TIMEOUT_MS,
    pollMs: PRELOADER_BACKEND_POLL_MS,
  });
}

function hidePreloader() {
  return hidePreloaderOverlay({
    preloaderNode: elements.preloader,
    preloaderStartMs,
    minVisibleMs: PRELOADER_MIN_MS,
  });
}

const isLeftPanelDocked = () => window.innerWidth >= 1280;
const isRightPanelDocked = () => window.innerWidth >= 1536;
const isPluginAsideDocked = () => window.innerWidth >= 1280;
const isModelAsideDocked = () => window.innerWidth >= 1280;
const isSettingsAsideDocked = () => window.innerWidth >= 1280;
const {
  mobileState,
  syncMobilePanels,
  closeAllMobilePanels,
  focusFirstInteractive,
} = createMobilePanelsController({
  elements,
  openPluginAsideButtons,
  openModelAsideButtons,
  openSettingsAsideButtons,
  isLeftPanelDocked,
  isRightPanelDocked,
  isPluginAsideDocked,
  isModelAsideDocked,
  isSettingsAsideDocked,
});

const runtimeConfig = loadRuntimeConfig();
const pluginUiRuntime = getPluginUiRuntime();
const backendClient = new BackendClient({
  baseUrl: runtimeConfig.backendUrl,
  apiKey: runtimeConfig.apiKey,
  timeoutMs: runtimeConfig.timeoutMs,
});
let chatFeature = null;
let modelsFeature = null;
let settingsFeature = null;
let pluginsFeature = null;
let onboardingController = null;
let background = null;

const runtimeUi = createRuntimeUiController({
  elements,
  runtimeConfig,
  getBackground: () => background,
  prefersReducedMotionMedia,
  BACKEND_STATUS,
});
const connectionState = runtimeUi.connectionState;
const isMotionEnabled = () => runtimeUi.isMotionEnabled();
const updateConnectionState = (...args) => runtimeUi.updateConnectionState(...args);
const updateRuntimeBadges = () => runtimeUi.updateRuntimeBadges();
const applyInterfacePreferences = () => runtimeUi.applyInterfacePreferences();

const toastManager = createToastManager({
  region: elements.toastRegion,
  clampFn: clamp,
});
const pushToast = (message, options = {}) => {
  toastManager.pushToast(message, options);
};

const actionDialogManager = createActionDialogManager({
  overlay: elements.actionDialogOverlay,
  dialog: elements.actionDialog,
  title: elements.actionDialogTitle,
  message: elements.actionDialogMessage,
  inputWrap: elements.actionDialogInputWrap,
  input: elements.actionDialogInput,
  cancelButton: elements.actionDialogCancel,
  confirmButton: elements.actionDialogConfirm,
  isMotionEnabled,
});
actionDialogManager.bind();

const requestActionConfirm = (...args) => actionDialogManager.requestConfirm(...args);
const requestActionText = (...args) => actionDialogManager.requestText(...args);

const openUrlInBrowser = (url) => {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
    window.__TAURI_INTERNALS__?.invoke?.("open_in_browser", { url })
      ?? window.__TAURI__?.core?.invoke?.("open_in_browser", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const linkOverlayManager = createLinkOverlayManager({
  overlay: elements.linkOverlay,
  urlNode: elements.linkOverlayUrl,
  frame: elements.linkOverlayFrame,
  fallback: elements.linkOverlayFallback,
  fallbackButton: elements.linkOverlayFallbackBtn,
  openButton: elements.linkOverlayOpen,
  closeButton: elements.linkOverlayClose,
  isMotionEnabled,
  openInBrowser: openUrlInBrowser,
  inspectLink: (url) => backendClient.inspectLink(url),
});
linkOverlayManager.bind();

const runtimeConfigController = createRuntimeConfigController({
  runtimeConfig,
  normalizeRuntimeConfig,
  persistRuntimeConfig,
  backendClient,
  updateRuntimeBadges,
  applyInterfacePreferences,
  getSettingsFeature: () => settingsFeature,
  getPluginsFeature: () => pluginsFeature,
  getOnboardingController: () => onboardingController,
  loadOnboardingState,
  pushToast,
});
const applyRuntimeConfig = (...args) => runtimeConfigController.applyRuntimeConfig(...args);
const hydrateSettingsFromBackend = (...args) => runtimeConfigController.hydrateSettingsFromBackend(...args);
const persistSettingsToBackend = (...args) => runtimeConfigController.persistSettingsToBackend(...args);

background = new StatefulLiquidBackground(elements.canvas, {
  onMoodChange: runtimeUi.updateMoodUI,
  onStats: runtimeUi.updateRenderStats,
});
background.mount();
const initialRouteMood = ROUTE_BACKGROUND_STATE[normalizeRoute(getRouteFromHash())] || runtimeConfig.bootMood || "neutral";
background.applyMoodInstant(background.hasMood(initialRouteMood) ? initialRouteMood : "neutral");
updateRuntimeBadges();
applyInterfacePreferences();
setPreloaderStatus("Загрузка интерфейса...");
updateConnectionState(BACKEND_STATUS.idle, "Сервер не проверялся");

settingsFeature = createSettingsFeature({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
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
  syncPluginUiExtensions: () => syncPluginUiExtensionsRuntime({
    backendClient,
    pushToast,
    onActivePluginIds: (pluginIds) => {
      pluginUiRuntime.pruneInactivePluginRenderers(pluginIds);
    },
  }),
});

modelsFeature = createModelsFeature({
  runtimeConfig,
  backendClient,
  applyRuntimeConfig,
  normalizeModelId,
  getModelLabelById,
  pushToast,
  isMotionEnabled,
});

chatFeature = createChatFeature({
  elements,
  runtimeConfig,
  backendClient,
  getPluginToolRenderer: (toolName) => pluginUiRuntime.getToolRenderer(toolName),
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

const routeController = createRouteNavigationController({
  elements,
  routeButtons,
  normalizeRoute,
  isMotionEnabled,
  routeTransitionMs: ROUTE_TRANSITION_MS,
  routeLabelByTarget: ROUTE_LABEL_BY_TARGET,
  closeAllMobilePanels,
  getChatFeature: () => chatFeature,
  getSettingsFeature: () => settingsFeature,
  getModelsFeature: () => modelsFeature,
});
const applyRoute = (route, options) => routeController.applyRoute(route, options);
const navigateToRoute = (route) => routeController.navigateToRoute(route);
onboardingController = createOnboardingController({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
  loadOnboardingState,
  persistOnboardingState,
  ONBOARDING_VERSION,
  ONBOARDING_STEPS_COUNT,
  onboardingStepPanels,
  onboardingNextStepButtons,
  clamp,
  isMotionEnabled,
  clearFieldValidation,
  isValidTimezone,
  pushToast,
  closeAllMobilePanels,
  focusFirstInteractive,
  getChatFeature: () => chatFeature,
  applyRuntimeConfig,
  getSettingsFeature: () => settingsFeature,
  persistSettingsToBackend,
});
onboardingController.bind();

bindPanelOpenActions({
  elements,
  openPluginAsideButtons,
  openModelAsideButtons,
  openSettingsAsideButtons,
  mobileState,
  syncMobilePanels,
});

bindAppUiEvents({
  routeButtons,
  navigateToRoute,
  elements,
  requestActionConfirm,
  runtimeConfig,
  backendClient,
  pushToast,
  closeAllMobilePanels,
  actionDialogManager,
  getChatFeature: () => chatFeature,
  onboardingController,
  normalizeRoute,
  getSettingsFeature: () => settingsFeature,
  applyInterfacePreferences,
  syncMobilePanels,
  applyRoute,
  getRouteFromHash,
  prefersReducedMotionMedia,
});
chatFeature?.initialize();
modelsFeature?.initialize();
settingsFeature?.initialize();
pluginsFeature?.initialize();
pluginUiRuntime.onChange(() => {
  chatFeature?.rerenderMessages?.();
});
syncMobilePanels();
applyRoute(getRouteFromHash(), { animate: false });

const startupPromise = runAppStartup({
  elements,
  runtimeConfig,
  BACKEND_STATUS,
  setPreloaderStatus,
  waitForBackendStartup,
  hydrateSettingsFromBackend,
  persistSettingsToBackend,
  getChatFeature: () => chatFeature,
  updateConnectionState,
  hidePreloader,
  onboardingController,
  getSettingsFeature: () => settingsFeature,
});

void startupPromise.finally(() => {
  void syncPluginUiExtensionsRuntime({
    backendClient,
    pushToast: null,
    onActivePluginIds: (pluginIds) => {
      pluginUiRuntime.pruneInactivePluginRenderers(pluginIds);
    },
  });
});

startTokenCounter({
  tokenNode: elements.tokenCount,
  formatValue: formatTokenCount,
});

installRuntimeApis({
  runtimeConfig,
  background,
  getChatFeature: () => chatFeature,
  applyRuntimeConfig,
  getSettingsFeature: () => settingsFeature,
  persistSettingsToBackend,
  navigateToRoute,
  onboardingController,
  loadOnboardingState,
});
