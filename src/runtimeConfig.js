const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const APP_CONFIG_KEY = "ancia.runtime.config.v1";
const APP_ONBOARDING_KEY = "ancia.onboarding.state.v1";

export const ONBOARDING_VERSION = 4;
export const ONBOARDING_STEPS_COUNT = 5;

export const BACKEND_STATUS = {
  idle: "idle",
  checking: "checking",
  connected: "connected",
  error: "error",
};

export const BACKEND_STATUS_LABEL = {
  [BACKEND_STATUS.idle]: "не проверен",
  [BACKEND_STATUS.checking]: "проверка",
  [BACKEND_STATUS.connected]: "подключен",
  [BACKEND_STATUS.error]: "ошибка",
};

export const RUNTIME_MODE_LABEL = {
  mock: "симуляция",
  backend: "сервер",
};

export const DEPLOYMENT_MODE_LABEL = {
  local: "локально",
  remote_client: "удаленный клиент",
  remote_server: "удаленный сервер",
};

export const MOOD_NAME_LABEL = {
  route_chat: "контекст: чаты",
  route_models: "контекст: модели",
  route_plugins: "контекст: маркетплейс",
  route_settings: "контекст: настройки",
  neutral: "нейтрально",
  thinking: "размышление",
  waiting: "ожидание",
  success: "успех",
  friendly: "дружелюбно",
  planning: "планирование",
  coding: "кодинг",
  researching: "исследование",
  warning: "предупреждение",
  offline: "офлайн",
  creative: "креатив",
  error: "ошибка",
  aggression: "агрессия",
};

export const ROUTE_BACKGROUND_STATE = {
  chat: "route_chat",
  models: "route_models",
  plugins: "route_plugins",
  settings: "route_settings",
};

export const ROUTE_ICON_BY_TARGET = {
  chat: "chat",
  models: "models",
  plugins: "plugins",
  settings: "settings",
};

export const ROUTE_LABEL_BY_TARGET = {
  chat: "Чаты",
  models: "Модели",
  plugins: "Плагины",
  settings: "Настройки",
};

export const DEFAULT_MODEL_ID = "qwen2.5-0.5b-instruct-mlx-4bit";

export const MODEL_LABEL_BY_ID = {
  "qwen2.5-0.5b-instruct-mlx-4bit": "Qwen2.5 0.5B",
  "qwen2.5-1.5b-instruct-mlx-4bit": "Qwen2.5 1.5B",
  "qwen2.5-3b-instruct-mlx-4bit": "Qwen2.5 3B",
  "qwen2.5-7b-instruct-mlx-4bit": "Qwen2.5 7B",
  "qwen3-vl-4b-instruct-mlx-4bit": "Qwen3-VL 4B",
  "ministral-3-3b-instruct-mlx-4bit": "Ministral 3 3B",
};

export const DEVICE_PRESET_META = {
  auto: {
    label: "Авто",
    description: "Автоподбор по текущему устройству и балансу скорости/качества.",
    config: {
      modelId: "qwen2.5-0.5b-instruct-mlx-4bit",
      modelContextWindow: 3072,
      modelMaxTokens: 256,
      modelTemperature: 0.25,
      modelTopP: 0.9,
      modelTopK: 40,
      uiDensity: "comfortable",
      uiAnimations: true,
      uiFontScale: 100,
    },
  },
  "apple-silicon-8gb": {
    label: "Apple Silicon 8GB",
    description: "MacBook Air/Pro с 8GB unified memory.",
    config: {
      modelId: "qwen2.5-0.5b-instruct-mlx-4bit",
      modelContextWindow: 2048,
      modelMaxTokens: 192,
      modelTemperature: 0.2,
      modelTopP: 0.9,
      modelTopK: 32,
      uiDensity: "compact",
      uiAnimations: false,
      uiFontScale: 98,
    },
  },
  "apple-silicon-16gb": {
    label: "Apple Silicon 16GB",
    description: "Универсальный профиль для M1/M2/M3 с 16GB.",
    config: {
      modelId: "qwen2.5-3b-instruct-mlx-4bit",
      modelContextWindow: 4096,
      modelMaxTokens: 320,
      modelTemperature: 0.2,
      modelTopP: 0.9,
      modelTopK: 40,
      uiDensity: "comfortable",
      uiAnimations: true,
      uiFontScale: 100,
    },
  },
  "apple-silicon-24gb-plus": {
    label: "Apple Silicon 24GB+",
    description: "Профиль для устройств с запасом памяти и вычислений.",
    config: {
      modelId: "qwen3-vl-4b-instruct-mlx-4bit",
      modelContextWindow: 6144,
      modelMaxTokens: 420,
      modelTemperature: 0.18,
      modelTopP: 0.9,
      modelTopK: 48,
      uiDensity: "comfortable",
      uiAnimations: true,
      uiFontScale: 102,
    },
  },
  "nvidia-6gb": {
    label: "NVIDIA 6GB",
    description: "Профиль для дискретных GPU 6GB VRAM.",
    config: {
      modelId: "qwen2.5-1.5b-instruct-mlx-4bit",
      modelContextWindow: 2048,
      modelMaxTokens: 224,
      modelTemperature: 0.22,
      modelTopP: 0.9,
      modelTopK: 36,
      uiDensity: "compact",
      uiAnimations: false,
      uiFontScale: 98,
    },
  },
  "nvidia-8gb-plus": {
    label: "NVIDIA 8GB+",
    description: "Профиль для GPU 8GB+ с упором на качество.",
    config: {
      modelId: "qwen2.5-7b-instruct-mlx-4bit",
      modelContextWindow: 4096,
      modelMaxTokens: 360,
      modelTemperature: 0.2,
      modelTopP: 0.9,
      modelTopK: 40,
      uiDensity: "comfortable",
      uiAnimations: true,
      uiFontScale: 100,
    },
  },
  "cpu-only": {
    label: "CPU only",
    description: "Стабильность при ограниченных ресурсах.",
    config: {
      modelId: "qwen2.5-0.5b-instruct-mlx-4bit",
      modelContextWindow: 1536,
      modelMaxTokens: 128,
      modelTemperature: 0.15,
      modelTopP: 0.85,
      modelTopK: 24,
      uiDensity: "compact",
      uiAnimations: false,
      uiFontScale: 96,
    },
  },
};

export const DEVICE_PRESET_ORDER = Object.keys(DEVICE_PRESET_META);
const DEVICE_PRESET_KEYS = new Set(DEVICE_PRESET_ORDER);
const UI_FONT_PRESET_ORDER = ["system", "serif", "rounded", "mono", "custom"];
const UI_FONT_PRESET_KEYS = new Set(UI_FONT_PRESET_ORDER);
export const MODEL_FALLBACK_PROFILE_ORDER = ["conservative", "balanced", "aggressive"];
const MODEL_FALLBACK_PROFILE_KEYS = new Set(MODEL_FALLBACK_PROFILE_ORDER);
export const MODEL_SCENARIO_PROFILE_ORDER = ["auto", "fast", "precise", "long_context"];
const MODEL_SCENARIO_PROFILE_KEYS = new Set(MODEL_SCENARIO_PROFILE_ORDER);

export const DEFAULT_RUNTIME_CONFIG = {
  mode: "backend",
  deploymentMode: "local",
  backendUrl: "http://127.0.0.1:5055",
  apiKey: "",
  authToken: "",
  authUsername: "",
  authRemember: true,
  serverAllowRegistration: false,
  timeoutMs: 12000,
  modelId: DEFAULT_MODEL_ID,
  devicePreset: "auto",
  modelContextWindow: null,
  modelMaxTokens: null,
  modelTemperature: null,
  modelTopP: null,
  modelTopK: null,
  autoReconnect: true,
  bootMood: "neutral",
  defaultTransitionMs: 1200,
  userName: "",
  userContext: "",
  userLanguage: "ru",
  userTimezone: DEFAULT_TIMEZONE,
  uiDensity: "comfortable",
  uiAnimations: true,
  uiFontScale: 100,
  uiFontPreset: "system",
  uiFontFamily: "",
  uiShowInspector: true,
  autonomousMode: false,
  modelSupportsVision: false,
  contextGuardPluginEnabled: true,
  contextGuardAutoCompress: true,
  contextGuardShowChatEvents: true,
  modelAutoFallbackEnabled: true,
  modelAutoFallbackProfile: "balanced",
  modelScenarioAutoApply: true,
  modelScenarioProfile: "auto",
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeModelId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_MODEL_ID;
}

export function getModelLabelById(modelId, fallback = "") {
  const normalized = normalizeModelId(modelId);
  return MODEL_LABEL_BY_ID[normalized] || String(fallback || normalized);
}

export function normalizeDevicePreset(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return DEVICE_PRESET_KEYS.has(normalized) ? normalized : "auto";
}

export function normalizeUiFontPreset(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return UI_FONT_PRESET_KEYS.has(normalized) ? normalized : "system";
}

export function normalizeModelFallbackProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MODEL_FALLBACK_PROFILE_KEYS.has(normalized) ? normalized : "balanced";
}

export function normalizeModelScenarioProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return MODEL_SCENARIO_PROFILE_KEYS.has(normalized) ? normalized : "auto";
}

export function getDevicePresetMeta(presetId) {
  const normalized = normalizeDevicePreset(presetId);
  return DEVICE_PRESET_META[normalized] || DEVICE_PRESET_META.auto;
}

export function applyDevicePreset(baseConfig = {}, presetId = "auto", availableModelIds = []) {
  void availableModelIds;
  const safePreset = normalizeDevicePreset(presetId);
  const presetMeta = getDevicePresetMeta(safePreset);
  const presetConfig = presetMeta?.config && typeof presetMeta.config === "object"
    ? presetMeta.config
    : {};
  const selectedModelId = normalizeModelId(baseConfig.modelId || DEFAULT_MODEL_ID);

  return normalizeRuntimeConfig({
    ...(baseConfig || {}),
    ...presetConfig,
    devicePreset: safePreset,
    modelId: selectedModelId,
    modelContextWindow: null,
    modelMaxTokens: null,
    modelTemperature: null,
    modelTopP: null,
    modelTopK: null,
  });
}

export function normalizeRuntimeConfig(partial = {}) {
  const config = {
    ...DEFAULT_RUNTIME_CONFIG,
    ...(partial || {}),
  };

  {
    const safeDeploymentMode = String(config.deploymentMode || "local").trim().toLowerCase();
    config.deploymentMode = (
      safeDeploymentMode === "remote_client" || safeDeploymentMode === "remote_server"
        ? safeDeploymentMode
        : "local"
    );
  }
  // Deployment contour is the single source of truth for runtime behavior.
  // Local/remote client/remote server always use backend mode.
  config.mode = "backend";
  config.backendUrl = String(config.backendUrl || "").trim();
  config.apiKey = String(config.apiKey || "").trim();
  config.authToken = String(config.authToken || "").trim();
  config.authUsername = String(config.authUsername || "").trim();
  config.authRemember = Boolean(config.authRemember ?? true);
  config.serverAllowRegistration = Boolean(config.serverAllowRegistration ?? false);
  config.timeoutMs = clamp(Number(config.timeoutMs || DEFAULT_RUNTIME_CONFIG.timeoutMs), 500, 120000);
  config.modelId = normalizeModelId(config.modelId);
  config.devicePreset = normalizeDevicePreset(config.devicePreset);
  // Источник параметров генерации только в БД бэкенда на странице "Модели".
  config.modelContextWindow = null;
  config.modelMaxTokens = null;
  config.modelTemperature = null;
  config.modelTopP = null;
  config.modelTopK = null;
  config.autoReconnect = Boolean(config.autoReconnect);
  config.bootMood = String(config.bootMood || DEFAULT_RUNTIME_CONFIG.bootMood).toLowerCase();
  config.defaultTransitionMs = clamp(
    Number(config.defaultTransitionMs || DEFAULT_RUNTIME_CONFIG.defaultTransitionMs),
    120,
    12000,
  );
  config.userName = String(config.userName || "").trim();
  config.userContext = String(config.userContext || "").trim();
  config.userLanguage = String(config.userLanguage || "ru").toLowerCase() === "en" ? "en" : "ru";
  config.userTimezone = String(config.userTimezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  config.uiDensity = String(config.uiDensity || "comfortable").toLowerCase() === "compact"
    ? "compact"
    : "comfortable";
  config.uiAnimations = Boolean(config.uiAnimations);
  config.uiFontScale = clamp(Number(config.uiFontScale || 100), 85, 120);
  config.uiFontPreset = normalizeUiFontPreset(config.uiFontPreset);
  config.uiFontFamily = String(config.uiFontFamily || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (config.uiFontPreset !== "custom") {
    config.uiFontFamily = "";
  }
  config.uiShowInspector = Boolean(config.uiShowInspector);
  config.autonomousMode = Boolean(config.autonomousMode);
  config.modelSupportsVision = Boolean(config.modelSupportsVision);
  config.contextGuardPluginEnabled = Boolean(config.contextGuardPluginEnabled ?? true);
  config.contextGuardAutoCompress = Boolean(config.contextGuardAutoCompress ?? true);
  config.contextGuardShowChatEvents = Boolean(config.contextGuardShowChatEvents ?? true);
  config.modelAutoFallbackEnabled = Boolean(config.modelAutoFallbackEnabled ?? true);
  config.modelAutoFallbackProfile = normalizeModelFallbackProfile(config.modelAutoFallbackProfile);
  config.modelScenarioAutoApply = Boolean(config.modelScenarioAutoApply ?? true);
  config.modelScenarioProfile = normalizeModelScenarioProfile(config.modelScenarioProfile);
  return config;
}

export function loadRuntimeConfig() {
  try {
    const raw = window.localStorage.getItem(APP_CONFIG_KEY);
    if (!raw) {
      return normalizeRuntimeConfig();
    }
    return normalizeRuntimeConfig(JSON.parse(raw));
  } catch (error) {
    return normalizeRuntimeConfig();
  }
}

export function persistRuntimeConfig(config) {
  window.localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(normalizeRuntimeConfig(config)));
}

export function loadOnboardingState() {
  const fallback = {
    version: ONBOARDING_VERSION,
    completed: false,
    skipped: false,
    completedAt: "",
    data: {},
  };

  try {
    const raw = window.localStorage.getItem(APP_ONBOARDING_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return {
      version: Number(parsed?.version) || ONBOARDING_VERSION,
      completed: Boolean(parsed?.completed),
      skipped: Boolean(parsed?.skipped),
      completedAt: String(parsed?.completedAt || ""),
      data: typeof parsed?.data === "object" && parsed.data ? parsed.data : {},
    };
  } catch (error) {
    return fallback;
  }
}

export function persistOnboardingState(state) {
  const payload = {
    version: ONBOARDING_VERSION,
    completed: Boolean(state?.completed),
    skipped: Boolean(state?.skipped),
    completedAt: String(state?.completedAt || ""),
    data: typeof state?.data === "object" && state.data ? state.data : {},
  };
  window.localStorage.setItem(APP_ONBOARDING_KEY, JSON.stringify(payload));
}
