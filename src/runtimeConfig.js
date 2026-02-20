const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const APP_CONFIG_KEY = "ancia.runtime.config.v1";
const APP_ONBOARDING_KEY = "ancia.onboarding.state.v1";

export const ONBOARDING_VERSION = 4;
export const ONBOARDING_STEPS_COUNT = 4;

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

export const MOOD_NAME_LABEL = {
  route_chat: "контекст: чаты",
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
  plugins: "route_plugins",
  settings: "route_settings",
};

export const ROUTE_ICON_BY_TARGET = {
  chat: "chat",
  plugins: "plugins",
  settings: "settings",
};

export const ROUTE_LABEL_BY_TARGET = {
  chat: "Чаты",
  plugins: "Плагины",
  settings: "Настройки",
};

export const MODEL_TIER_META = {
  lite: {
    label: "Lite",
    description: "Лёгкий режим: минимальная нагрузка и расход памяти.",
    targetFps: 38,
    maxPixelRatioCap: 0.96,
    minPixelRatio: 0.62,
  },
  standart: {
    label: "Standart",
    description: "Базовый режим: баланс качества и производительности.",
    targetFps: 46,
    maxPixelRatioCap: 1.16,
    minPixelRatio: 0.72,
  },
  plus: {
    label: "Plus",
    description: "Расширенный режим: выше детализация и нагрузка.",
    targetFps: 58,
    maxPixelRatioCap: 1.32,
    minPixelRatio: 0.82,
  },
};

export const MODEL_TIER_ORDER = ["lite", "standart", "plus"];
const MODEL_TIER_KEYS = new Set(MODEL_TIER_ORDER);
export const DEFAULT_MODEL_ID = "qwen2.5-0.5b-instruct-mlx-4bit";
const MODEL_ID_FALLBACK_BY_TIER = {
  lite: "qwen2.5-0.5b-instruct-mlx-4bit",
  standart: "qwen3-vl-4b-instruct-mlx-4bit",
  plus: "qwen3-vl-4b-instruct-mlx-4bit",
};

export const MODEL_LABEL_BY_ID = {
  "qwen2.5-0.5b-instruct-mlx-4bit": "Qwen2.5 0.5B",
  "qwen2.5-1.5b-instruct-mlx-4bit": "Qwen2.5 1.5B",
  "qwen2.5-3b-instruct-mlx-4bit": "Qwen2.5 3B",
  "qwen2.5-7b-instruct-mlx-4bit": "Qwen2.5 7B",
  "qwen3-vl-4b-instruct-mlx-4bit": "Qwen3-VL 4B",
};

export const DEVICE_PRESET_META = {
  auto: {
    label: "Авто",
    description: "Автоподбор по текущему устройству и балансу скорости/качества.",
    config: {
      modelTier: "lite",
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
      modelTier: "lite",
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
      modelTier: "standart",
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
      modelTier: "plus",
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
      modelTier: "lite",
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
      modelTier: "standart",
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
      modelTier: "lite",
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

export const DEFAULT_RUNTIME_CONFIG = {
  mode: "backend",
  backendUrl: "http://127.0.0.1:5055",
  apiKey: "",
  timeoutMs: 12000,
  modelTier: "lite",
  modelId: DEFAULT_MODEL_ID,
  modelLabel: MODEL_TIER_META.lite.label,
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
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeModelTier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    max: "plus",
    standard: "standart",
  };
  const resolved = aliases[normalized] || normalized;
  if (/^\d+$/.test(normalized)) {
    const index = Number(normalized);
    if (index >= 0 && index < MODEL_TIER_ORDER.length) {
      return MODEL_TIER_ORDER[index];
    }
  }
  return MODEL_TIER_KEYS.has(resolved) ? resolved : "lite";
}

export function normalizeModelId(value, tier = "lite") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return MODEL_ID_FALLBACK_BY_TIER[normalizeModelTier(tier)] || DEFAULT_MODEL_ID;
  }
  return normalized;
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

export function getDevicePresetMeta(presetId) {
  const normalized = normalizeDevicePreset(presetId);
  return DEVICE_PRESET_META[normalized] || DEVICE_PRESET_META.auto;
}

export function applyDevicePreset(baseConfig = {}, presetId = "auto", availableModelIds = []) {
  const safePreset = normalizeDevicePreset(presetId);
  const presetMeta = getDevicePresetMeta(safePreset);
  const presetConfig = presetMeta?.config && typeof presetMeta.config === "object"
    ? presetMeta.config
    : {};
  const availableSet = new Set((availableModelIds || []).map((id) => normalizeModelId(id)));
  const desiredModelId = normalizeModelId(
    presetConfig.modelId,
    presetConfig.modelTier || baseConfig.modelTier || "lite",
  );
  const fallbackTier = normalizeModelTier(presetConfig.modelTier || baseConfig.modelTier || "lite");
  const fallbackModelId = MODEL_ID_FALLBACK_BY_TIER[fallbackTier] || DEFAULT_MODEL_ID;
  const selectedModelId = availableSet.size > 0
    ? (availableSet.has(desiredModelId) ? desiredModelId : (availableSet.has(fallbackModelId) ? fallbackModelId : [...availableSet][0]))
    : desiredModelId;

  return normalizeRuntimeConfig({
    ...(baseConfig || {}),
    ...presetConfig,
    devicePreset: safePreset,
    modelId: selectedModelId,
  });
}

export function getModelTierMeta(tier) {
  const normalized = normalizeModelTier(tier);
  return MODEL_TIER_META[normalized] || MODEL_TIER_META.lite;
}

export function modelTierToRangeIndex(tier) {
  const normalized = normalizeModelTier(tier);
  const index = MODEL_TIER_ORDER.indexOf(normalized);
  return index >= 0 ? index : 0;
}

export function normalizeRuntimeConfig(partial = {}) {
  const normalizeOptionalInt = (value, min, max, fallback = null) => {
    if (value === "" || value == null) {
      return fallback;
    }
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return clamp(parsed, min, max);
  };

  const normalizeOptionalFloat = (value, min, max, fallback = null) => {
    if (value === "" || value == null) {
      return fallback;
    }
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    if (parsed < min || parsed > max) {
      return fallback;
    }
    return parsed;
  };

  const config = {
    ...DEFAULT_RUNTIME_CONFIG,
    ...(partial || {}),
  };

  config.mode = config.mode === "backend" ? "backend" : "mock";
  config.backendUrl = String(config.backendUrl || "").trim();
  config.apiKey = String(config.apiKey || "").trim();
  config.timeoutMs = clamp(Number(config.timeoutMs || DEFAULT_RUNTIME_CONFIG.timeoutMs), 500, 120000);
  config.modelTier = normalizeModelTier(config.modelTier || config.modelLabel);
  config.modelId = normalizeModelId(config.modelId, config.modelTier);
  config.modelLabel = getModelTierMeta(config.modelTier).label;
  config.devicePreset = normalizeDevicePreset(config.devicePreset);
  config.modelContextWindow = normalizeOptionalInt(config.modelContextWindow, 256, 32768, null);
  config.modelMaxTokens = normalizeOptionalInt(config.modelMaxTokens, 16, 4096, null);
  config.modelTemperature = normalizeOptionalFloat(config.modelTemperature, 0, 2, null);
  config.modelTopP = normalizeOptionalFloat(config.modelTopP, 0, 1, null);
  config.modelTopK = normalizeOptionalInt(config.modelTopK, 1, 400, null);
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
