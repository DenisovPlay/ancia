import { createSettingsSectionController } from "./sectionController.js";
import { createSettingsFontController } from "./fontController.js";
import { createSettingsRuntimeController } from "./runtimeController.js";
import { createSettingsEventBindings } from "./eventBindings.js";

const VALID_SETTINGS_SECTIONS = new Set(["personalization", "interface", "developer", "about"]);
const SETTINGS_SECTION_TITLE = {
  personalization: "Персонализация",
  interface: "Интерфейс",
  developer: "Для разработчиков",
  about: "О приложении",
};
const SETTINGS_SECTION_TRANSITION_MS = 190;
const SYSTEM_FONT_FALLBACK_CANDIDATES = [
  "SF Pro Text",
  "SF Pro Display",
  "SF Pro Rounded",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Avenir Next",
  "Avenir",
  "Gill Sans",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
  "Segoe UI",
  "Segoe UI Variable",
  "Calibri",
  "Candara",
  "Corbel",
  "Cambria",
  "Constantia",
  "Georgia",
  "Times New Roman",
  "Palatino",
  "Iowan Old Style",
  "Menlo",
  "Monaco",
  "Consolas",
  "Cascadia Mono",
  "Courier New",
  "Lucida Console",
  "JetBrains Mono",
  "Fira Code",
  "Fira Mono",
  "Source Code Pro",
  "IBM Plex Sans",
  "IBM Plex Serif",
  "IBM Plex Mono",
  "Noto Sans",
  "Noto Serif",
  "Noto Sans Mono",
  "Roboto",
  "Roboto Slab",
  "Ubuntu",
  "Ubuntu Mono",
  "Cantarell",
  "DejaVu Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Liberation Serif",
  "Liberation Mono",
  "PT Sans",
  "PT Serif",
  "Open Sans",
  "Lato",
  "Inter",
  "Source Sans 3",
  "Baskerville",
  "Didot",
  "Charter",
  "Comic Sans MS",
];

export function createSettingsFeature({
  elements,
  runtimeConfig,
  normalizeRuntimeConfig,
  isMotionEnabled,
  pushToast,
  backendClient,
  updateConnectionState,
  BACKEND_STATUS,
  applyRuntimeConfig,
  getChatFeature,
  isSettingsAsideDocked,
  mobileState,
  syncMobilePanels,
  clearFieldValidation,
  isValidTimezone,
}) {
  const settingsSectionButtons = [...document.querySelectorAll("[data-settings-section-target]")];
  const settingsSections = [...document.querySelectorAll("[data-settings-section]")];
  const settingsSaveButtons = [elements.settingsSaveConfig].filter(Boolean);
  const settingsFields = [
    elements.settingsRuntimeMode,
    elements.settingsBackendUrl,
    elements.settingsApiKey,
    elements.settingsTimeoutMs,
    elements.settingsAutoReconnect,
    elements.settingsAutonomousMode,
    elements.settingsContextGuardEnabled,
    elements.settingsContextAutoCompress,
    elements.settingsContextChatEvents,
    elements.settingsBootMood,
    elements.settingsDefaultTransition,
    elements.settingsUserName,
    elements.settingsUserContext,
    elements.settingsUserLanguage,
    elements.settingsUserTimezone,
    elements.settingsUiDensity,
    elements.settingsUiAnimations,
    elements.settingsUiFontScale,
    elements.settingsUiFontPreset,
    elements.settingsUiFontFamily,
    elements.settingsUiShowInspector,
  ].filter(Boolean);

  const settingsSectionController = createSettingsSectionController({
    buttons: settingsSectionButtons,
    sections: settingsSections,
    titleNode: elements.settingsSectionTitle,
    searchEmptyNode: elements.settingsSectionSearchEmpty,
    isMotionEnabled,
    transitionMs: SETTINGS_SECTION_TRANSITION_MS,
    validSections: VALID_SETTINGS_SECTIONS,
    titlesMap: SETTINGS_SECTION_TITLE,
    initialSection: "personalization",
  });

  const fontController = createSettingsFontController({
    elements,
    runtimeConfig,
    pushToast,
    fontCandidates: SYSTEM_FONT_FALLBACK_CANDIDATES,
  });

  const settingsRuntimeController = createSettingsRuntimeController({
    elements,
    runtimeConfig,
    normalizeRuntimeConfig,
    settingsSaveButtons,
    fontController,
    clearFieldValidation,
    isValidTimezone,
    backendClient,
    updateConnectionState,
    BACKEND_STATUS,
    applyRuntimeConfig,
    getChatFeature,
    pushToast,
  });

  const settingsEventBindings = createSettingsEventBindings({
    settingsSaveButtons,
    settingsFields,
    clearFieldValidation,
    syncSettingsDirtyState: settingsRuntimeController.syncSettingsDirtyState,
    saveSettings: settingsRuntimeController.saveSettings,
    elements,
    resetSettingsValidation: settingsRuntimeController.resetSettingsValidation,
    collectSettingsForm: settingsRuntimeController.collectSettingsForm,
    validateSettingsDraft: settingsRuntimeController.validateSettingsDraft,
    pushToast,
    backendClient,
    checkBackendConnection: settingsRuntimeController.checkBackendConnection,
    settingsSectionButtons,
    settingsSectionController,
    isSettingsAsideDocked,
    mobileState,
    syncMobilePanels,
    fontController,
  });

  function initialize() {
    fontController.renderOptions(runtimeConfig.uiFontFamily);
    settingsEventBindings.bindEvents();
    settingsRuntimeController.hydrateSettingsForm();
    void fontController.loadCatalog({ silent: true }).then(() => {
      settingsRuntimeController.hydrateSettingsForm();
      settingsRuntimeController.syncSettingsDirtyState();
    });
    settingsSectionController.applySection(settingsSectionController.getCurrentSection(), { animate: false });
    settingsSectionController.applyFilter(elements.settingsSectionSearch?.value || "");
    settingsRuntimeController.syncSettingsDirtyState();
  }

  function applyCurrentSection({ animate = true } = {}) {
    settingsSectionController.applySection(settingsSectionController.getCurrentSection(), { animate });
  }

  return {
    initialize,
    hydrateSettingsForm: settingsRuntimeController.hydrateSettingsForm,
    collectSettingsForm: settingsRuntimeController.collectSettingsForm,
    syncSettingsDirtyState: settingsRuntimeController.syncSettingsDirtyState,
    applySettingsSection: settingsSectionController.applySection,
    applyCurrentSection,
    applySettingsSectionFilter: settingsSectionController.applyFilter,
    checkBackendConnection: settingsRuntimeController.checkBackendConnection,
    saveSettings: settingsRuntimeController.saveSettings,
    onRuntimeConfigApplied: settingsRuntimeController.onRuntimeConfigApplied,
  };
}
