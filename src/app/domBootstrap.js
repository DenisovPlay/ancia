import { icon } from "../ui/icons.js";

export function mountPageTemplates({
  chatRoot,
  modelsRoot,
  pluginsRoot,
  settingsRoot,
  chatTemplate,
  modelsTemplate,
  pluginsTemplate,
  settingsTemplate,
}) {
  if (chatRoot) {
    chatRoot.innerHTML = chatTemplate;
  }
  if (modelsRoot) {
    modelsRoot.innerHTML = modelsTemplate;
  }
  if (pluginsRoot) {
    pluginsRoot.innerHTML = pluginsTemplate;
  }
  if (settingsRoot) {
    settingsRoot.innerHTML = settingsTemplate;
  }
}

export function collectDomNodes() {
  const elements = {
    preloader: document.querySelector("#app-preloader"),
    preloaderLabel: document.querySelector("#app-preloader .app-preloader__label"),
    preloaderProgress: document.querySelector("#app-preloader-progress"),
    preloaderRetry: document.querySelector("#app-preloader-retry"),
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
    pageModels: document.querySelector("#page-models"),
    pagePlugins: document.querySelector("#page-plugins"),
    pageSettings: document.querySelector("#page-settings"),
    chatSessionList: document.querySelector("#chat-session-list"),
    chatNewSessionButton: document.querySelector("#chat-new-session-button"),
    chatSessionFilterButton: document.querySelector("#chat-session-filter-button"),
    chatClearSessionButton: document.querySelector("#chat-clear-session-button"),
    chatSessionSearch: document.querySelector("#chat-session-search"),
    chatSessionSearchResults: document.querySelector("#chat-session-search-results"),
    chatImportFileInput: document.querySelector("#chat-import-file-input"),
    chatExportModalOverlay: document.querySelector("#chat-export-modal-overlay"),
    chatExportModalTitle: document.querySelector("#chat-export-modal-title"),
    chatExportModalFormat: document.querySelector("#chat-export-modal-format"),
    chatExportModalCancel: document.querySelector("#chat-export-modal-cancel"),
    chatExportModalConfirm: document.querySelector("#chat-export-modal-confirm"),
    chatHolidayBanner: document.querySelector("#chat-holiday-banner"),
    chatHolidayBannerLogo: document.querySelector("#chat-holiday-banner-logo"),
    chatHolidayBannerTitle: document.querySelector("#chat-holiday-banner-title"),
    chatHolidayBannerBody: document.querySelector("#chat-holiday-banner-body"),
    chatHolidayBannerDismiss: document.querySelector("#chat-holiday-banner-dismiss"),
    openLeftPanel: document.querySelector("#open-left-panel"),
    openRightPanel: document.querySelector("#open-right-panel"),
    panelLeft: document.querySelector("#panel-left"),
    panelRight: document.querySelector("#panel-right"),
    pluginAside: document.querySelector("#plugin-aside"),
    modelAside: document.querySelector("#model-aside"),
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
    composerContextIndicator: document.querySelector("#composer-context-indicator"),
    composerContextRing: document.querySelector("#composer-context-ring"),
    composerContextLabel: document.querySelector("#composer-context-label"),
    composerContextPopover: document.querySelector("#composer-context-popover"),
    composerContextUsed: document.querySelector("#composer-context-used"),
    composerContextMax: document.querySelector("#composer-context-max"),
    composerContextHistory: document.querySelector("#composer-context-history"),
    composerContextSystem: document.querySelector("#composer-context-system"),
    composerContextService: document.querySelector("#composer-context-service"),
    composerContextDraft: document.querySelector("#composer-context-draft"),
    composerContextPending: document.querySelector("#composer-context-pending"),
    composerContextReserve: document.querySelector("#composer-context-reserve"),
    composerContextLayers: document.querySelector("#composer-context-layers"),
    composerContextLayersList: document.querySelector("#composer-context-layers-list"),
    composerContextCompressNow: document.querySelector("#composer-context-compress-now"),
    composerContextResetLayers: document.querySelector("#composer-context-reset-layers"),
    composerContextCycleMode: document.querySelector("#composer-context-cycle-mode"),
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
    settingsDeploymentMode: document.querySelector("#settings-deployment-mode"),
    settingsBackendUrl: document.querySelector("#settings-backend-url"),
    settingsApiKey: document.querySelector("#settings-api-key"),
    settingsTimeoutMs: document.querySelector("#settings-timeout-ms"),
    settingsAutoReconnect: document.querySelector("#settings-auto-reconnect"),
    settingsAutonomousMode: document.querySelector("#settings-autonomous-mode"),
    settingsBootMood: document.querySelector("#settings-boot-mood"),
    settingsDefaultTransition: document.querySelector("#settings-default-transition"),
    settingsContextGuardEnabled: document.querySelector("#settings-context-guard-enabled"),
    settingsContextAutoCompress: document.querySelector("#settings-context-autocompress"),
    settingsContextChatEvents: document.querySelector("#settings-context-chat-events"),
    settingsModelFallbackEnabled: document.querySelector("#settings-model-fallback-enabled"),
    settingsModelFallbackProfile: document.querySelector("#settings-model-fallback-profile"),
    settingsModelScenarioAutoApply: document.querySelector("#settings-model-scenario-autoadjust"),
    settingsModelScenarioProfile: document.querySelector("#settings-model-scenario-profile"),
    settingsServerModeHint: document.querySelector("#settings-server-mode-hint"),
    settingsServerAuthStatusRow: document.querySelector("#settings-server-auth-status-row"),
    settingsServerRegistrationRow: document.querySelector("#settings-server-registration-row"),
    settingsServerBootstrapPanel: document.querySelector("#settings-server-bootstrap-panel"),
    settingsServerSessionPanel: document.querySelector("#settings-server-session-panel"),
    settingsServerUsersPanel: document.querySelector("#settings-server-users-panel"),
    settingsServerAuditPanel: document.querySelector("#settings-server-audit-panel"),
    settingsServerAllowRegistration: document.querySelector("#settings-server-allow-registration"),
    settingsAuthStatus: document.querySelector("#settings-auth-status"),
    settingsAuthUser: document.querySelector("#settings-auth-user"),
    settingsBootstrapUsername: document.querySelector("#settings-bootstrap-username"),
    settingsBootstrapPassword: document.querySelector("#settings-bootstrap-password"),
    settingsBootstrapAdmin: document.querySelector("#settings-bootstrap-admin"),
    settingsLoginUsername: document.querySelector("#settings-login-username"),
    settingsLoginPassword: document.querySelector("#settings-login-password"),
    settingsLoginButton: document.querySelector("#settings-login-button"),
    settingsRegisterButton: document.querySelector("#settings-register-button"),
    settingsLogoutButton: document.querySelector("#settings-logout-button"),
    settingsUsersRefresh: document.querySelector("#settings-users-refresh"),
    settingsUsersList: document.querySelector("#settings-users-list"),
    settingsCreateUserUsername: document.querySelector("#settings-create-user-username"),
    settingsCreateUserPassword: document.querySelector("#settings-create-user-password"),
    settingsCreateUserRole: document.querySelector("#settings-create-user-role"),
    settingsCreateUserModelDownload: document.querySelector("#settings-create-user-model-download"),
    settingsCreateUserPluginDownload: document.querySelector("#settings-create-user-plugin-download"),
    settingsCreateUserButton: document.querySelector("#settings-create-user-button"),
    settingsAuditRefresh: document.querySelector("#settings-audit-refresh"),
    settingsAuditActionPrefix: document.querySelector("#settings-audit-action-prefix"),
    settingsAuditActorUserId: document.querySelector("#settings-audit-actor-user-id"),
    settingsAuditStatus: document.querySelector("#settings-audit-status"),
    settingsAuditLimit: document.querySelector("#settings-audit-limit"),
    settingsAuditMeta: document.querySelector("#settings-audit-meta"),
    settingsAuditList: document.querySelector("#settings-audit-list"),
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
    onboardingDeploymentLocal: document.querySelector("#onboarding-deployment-local"),
    onboardingDeploymentRemoteClient: document.querySelector("#onboarding-deployment-remote-client"),
    onboardingDeploymentRemoteServer: document.querySelector("#onboarding-deployment-remote-server"),
    onboardingBackendUrl: document.querySelector("#onboarding-backend-url"),
    onboardingLanguage: document.querySelector("#onboarding-language"),
    onboardingTimezone: document.querySelector("#onboarding-timezone"),
    onboardingUserName: document.querySelector("#onboarding-user-name"),
    onboardingUserContext: document.querySelector("#onboarding-user-context"),
    onboardingUiDensity: document.querySelector("#onboarding-ui-density"),
    onboardingUiAnimations: document.querySelector("#onboarding-ui-animations"),
    onboardingUiFontScale: document.querySelector("#onboarding-ui-font-scale"),
    onboardingBootMood: document.querySelector("#onboarding-boot-mood"),
    linkOverlay: document.querySelector("#link-overlay"),
    linkOverlayUrl: document.querySelector("#link-overlay-url"),
    linkOverlayFrame: document.querySelector("#link-overlay-frame"),
    linkOverlayFallback: document.querySelector("#link-overlay-fallback"),
    linkOverlayFallbackBtn: document.querySelector("#link-overlay-fallback-btn"),
    linkOverlayOpen: document.querySelector("#link-overlay-open"),
    linkOverlayClose: document.querySelector("#link-overlay-close"),
  };

  return {
    elements,
    routeButtons: [...document.querySelectorAll("[data-route-target]")],
    openPluginAsideButtons: [...document.querySelectorAll("[data-open-plugin-aside]")],
    openModelAsideButtons: [...document.querySelectorAll("[data-open-model-aside]")],
    openSettingsAsideButtons: [...document.querySelectorAll("[data-open-settings-aside]")],
    onboardingStepPanels: [...document.querySelectorAll("[data-onboarding-step]")],
    onboardingNextStepButtons: [...document.querySelectorAll("[data-onboarding-next-step]")],
    validRoutes: new Set(["chat", "models", "plugins", "settings"]),
  };
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    const cls = el.dataset.iconClass || "";
    const tmp = document.createElement("span");
    tmp.innerHTML = icon(name, cls);
    el.replaceWith(tmp.firstElementChild || tmp);
  });
}

export function hydratePrimaryRouteIcons({
  routeButtons,
  routeIconByTarget,
  routeLabelByTarget,
}) {
  routeButtons.forEach((button) => {
    const routeTarget = button.dataset.routeTarget;
    const iconName = routeIconByTarget[routeTarget];
    if (!iconName) {
      return;
    }
    const label = routeLabelByTarget[routeTarget] || routeTarget;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    const labelSpan = button.querySelector(".route-icon__label");
    const svgWrap = document.createElement("span");
    svgWrap.innerHTML = icon(iconName, "ui-icon-nav");
    if (labelSpan) {
      button.insertBefore(svgWrap.firstElementChild, labelSpan);
    } else {
      button.innerHTML = icon(iconName, "ui-icon-nav");
    }
  });
}

export function createRouteHelpers(validRoutes) {
  function normalizeRoute(route) {
    const normalized = String(route || "").trim().toLowerCase().replace(/^#\/?/, "");
    return validRoutes.has(normalized) ? normalized : "chat";
  }

  function getRouteFromHash() {
    return normalizeRoute(window.location.hash);
  }

  return {
    normalizeRoute,
    getRouteFromHash,
  };
}

export function applyPlatformMarker(userAgent = navigator.userAgent) {
  if (/Mac|iPhone|iPad/.test(userAgent)) {
    document.body.dataset.os = "macos";
    return;
  }
  if (/Windows/i.test(userAgent)) {
    document.body.dataset.os = "windows";
    return;
  }
  document.body.dataset.os = "other";
}
