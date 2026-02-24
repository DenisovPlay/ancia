import { createModalOverlayManager } from "../ui/modalOverlayManager.js";

const MODEL_PARAM_PRESETS = [
  { id: "balanced", label: "Сбалансированный", temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 512, context_window: 4096 },
  { id: "creative", label: "Творческий", temperature: 1.1, top_p: 0.97, top_k: 60, max_tokens: 1024, context_window: 6144 },
  { id: "precise", label: "Точный", temperature: 0.15, top_p: 0.7, top_k: 20, max_tokens: 512, context_window: 4096 },
  { id: "fast", label: "Быстрый", temperature: 0.5, top_p: 0.85, top_k: 30, max_tokens: 256, context_window: 2048 },
  { id: "extended", label: "Длинные", temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 3072, context_window: 16384 },
  { id: "code", label: "Код", temperature: 0.2, top_p: 0.75, top_k: 20, max_tokens: 2048, context_window: 12288 },
];
const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  max_tokens: 768,
  context_window: 8192,
};
const MAX_CONTEXT_WINDOW_LIMIT = 262144;
const MAX_TOKENS_LIMIT = 131072;

function clampNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.max(min, Math.min(max, parsed));
}

function buildMpmField(name, label, min, max, step, value) {
  return `
    <div class="mpm-field">
      <div class="mpm-field__header">
        <span class="mpm-field__label">${label}</span>
        <input type="number" class="mpm-field__num" data-mpm="${name}" min="${min}" max="${max}" step="${step}" value="${value}">
      </div>
      <input type="range" class="mpm-field__range" data-mpm-range="${name}" min="${min}" max="${max}" step="${step}" value="${value}">
    </div>`;
}

export function createModelParamsController({
  backendClient,
  pushToast,
  onSaved,
  isMotionEnabled,
}) {
  const modalElement = document.querySelector("#model-params-modal");
  const modalBody = document.querySelector("#model-params-modal-body");
  const modalTitle = document.querySelector("#mpm-title");
  const closeButton = document.querySelector("#model-params-modal-close");
  const cancelButton = document.querySelector("#model-params-modal-cancel");
  const saveButton = document.querySelector("#model-params-modal-save");
  const modalOverlay = createModalOverlayManager({
    overlay: modalElement,
    isMotionEnabled,
    transitionMs: 200,
  });

  let modelId = "";
  let eventsBound = false;
  let saveInFlight = false;
  let currentContextWindowMax = MAX_CONTEXT_WINDOW_LIMIT;
  let currentMaxTokensMax = MAX_TOKENS_LIMIT;

  function closeModelParamsModal({ skipAnimation = false } = {}) {
    if (!modalOverlay.hasSupport()) {
      return;
    }
    modelId = "";
    modalOverlay.close({ skipAnimation });
  }

  function openModelParamsModal(model) {
    if (!modalOverlay.hasSupport() || !modalBody) {
      return;
    }
    if (modalOverlay.isOpen()) {
      modalOverlay.close({ skipAnimation: true, restoreFocusOnClose: false });
    }

    modelId = model.id;
    const sourceParams = model?.params && typeof model.params === "object"
      ? model.params
      : {};
    const resolveParam = (key) => {
      const parsed = Number(sourceParams[key]);
      return Number.isFinite(parsed) ? parsed : DEFAULT_MODEL_PARAMS[key];
    };
    const initialParams = {
      temperature: resolveParam("temperature"),
      top_p: resolveParam("top_p"),
      top_k: resolveParam("top_k"),
      max_tokens: resolveParam("max_tokens"),
      context_window: resolveParam("context_window"),
    };
    const modelMaxContext = Number(model?.maxContext);
    const contextWindowMaxRaw = Number.isFinite(modelMaxContext) && modelMaxContext > 0
      ? clampNumber(modelMaxContext, 256, MAX_CONTEXT_WINDOW_LIMIT)
      : 65536;
    const contextWindowMax = Math.floor(contextWindowMaxRaw);
    const maxTokensMax = Math.floor(clampNumber(contextWindowMax, 16, MAX_TOKENS_LIMIT));
    currentContextWindowMax = contextWindowMax;
    currentMaxTokensMax = maxTokensMax;
    const initialContextWindow = Math.floor(clampNumber(initialParams.context_window, 256, contextWindowMax));
    const initialMaxTokens = Math.floor(clampNumber(initialParams.max_tokens, 16, maxTokensMax));
    if (modalTitle) {
      modalTitle.textContent = `${model.label} — параметры`;
    }

    const presetsHtml = MODEL_PARAM_PRESETS
      .map((preset) => `<button type="button" class="mpm-preset-btn" data-preset="${preset.id}">${preset.label}</button>`)
      .join("");

    modalBody.innerHTML = `
      <p class="text-[10px] uppercase tracking-[0.12em] text-zinc-600 mb-3">Готовые пресеты</p>
      <div class="mpm-presets">${presetsHtml}</div>
      <div class="mpm-fields">
        ${buildMpmField("temperature", "Temperature", 0, 2, 0.05, initialParams.temperature)}
        ${buildMpmField("top_p", "Top-p", 0, 1, 0.05, initialParams.top_p)}
        ${buildMpmField("top_k", "Top-k", 1, 400, 1, initialParams.top_k)}
        ${buildMpmField("max_tokens", "Max tokens", 16, maxTokensMax, 16, initialMaxTokens)}
        ${buildMpmField("context_window", "Context window", 256, contextWindowMax, 256, initialContextWindow)}
      </div>`;

    const maxTokensNumberInput = modalBody.querySelector('[data-mpm="max_tokens"]');
    const maxTokensRangeInput = modalBody.querySelector('[data-mpm-range="max_tokens"]');
    const contextWindowNumberInput = modalBody.querySelector('[data-mpm="context_window"]');
    const contextWindowRangeInput = modalBody.querySelector('[data-mpm-range="context_window"]');

    const syncMaxTokensCap = ({ clampCurrent = true } = {}) => {
      const rawContextWindow = Number(
        contextWindowNumberInput instanceof HTMLInputElement
          ? contextWindowNumberInput.value
          : contextWindowRangeInput instanceof HTMLInputElement
            ? contextWindowRangeInput.value
            : initialContextWindow,
      );
      const safeContextWindow = Number.isFinite(rawContextWindow)
        ? Math.floor(clampNumber(rawContextWindow, 256, contextWindowMax))
        : initialContextWindow;
      const dynamicMaxTokensLimit = Math.floor(clampNumber(safeContextWindow, 16, maxTokensMax));
      if (maxTokensNumberInput instanceof HTMLInputElement) {
        maxTokensNumberInput.max = String(dynamicMaxTokensLimit);
      }
      if (maxTokensRangeInput instanceof HTMLInputElement) {
        maxTokensRangeInput.max = String(dynamicMaxTokensLimit);
      }
      if (!clampCurrent) {
        return dynamicMaxTokensLimit;
      }
      const rawMaxTokens = Number(
        maxTokensNumberInput instanceof HTMLInputElement
          ? maxTokensNumberInput.value
          : maxTokensRangeInput instanceof HTMLInputElement
            ? maxTokensRangeInput.value
            : initialMaxTokens,
      );
      const safeMaxTokens = Number.isFinite(rawMaxTokens)
        ? Math.floor(clampNumber(rawMaxTokens, 16, dynamicMaxTokensLimit))
        : Math.min(initialMaxTokens, dynamicMaxTokensLimit);
      if (maxTokensNumberInput instanceof HTMLInputElement) {
        maxTokensNumberInput.value = String(safeMaxTokens);
      }
      if (maxTokensRangeInput instanceof HTMLInputElement) {
        maxTokensRangeInput.value = String(safeMaxTokens);
      }
      return dynamicMaxTokensLimit;
    };

    syncMaxTokensCap({ clampCurrent: true });

    modalBody.querySelectorAll(".mpm-field__range").forEach((rangeElement) => {
      const fieldName = rangeElement.dataset.mpmRange;
      const numberInput = modalBody.querySelector(`[data-mpm="${fieldName}"]`);
      if (!(numberInput instanceof HTMLInputElement)) return;
      rangeElement.addEventListener("input", () => {
        numberInput.value = rangeElement.value;
        if (fieldName === "context_window" || fieldName === "max_tokens") {
          syncMaxTokensCap({ clampCurrent: true });
        }
      });
      numberInput.addEventListener("input", () => {
        rangeElement.value = numberInput.value;
        if (fieldName === "context_window" || fieldName === "max_tokens") {
          syncMaxTokensCap({ clampCurrent: true });
        }
      });
    });

    modalBody.querySelectorAll(".mpm-preset-btn").forEach((presetButton) => {
      presetButton.addEventListener("click", () => {
        const preset = MODEL_PARAM_PRESETS.find((entry) => entry.id === presetButton.dataset.preset);
        if (!preset) return;
        modalBody.querySelectorAll(".mpm-preset-btn").forEach((button) => button.classList.remove("is-active"));
        presetButton.classList.add("is-active");
        const setField = (name, value) => {
          const clampedValue = name === "max_tokens"
            ? clampNumber(value, 16, maxTokensMax)
            : name === "context_window"
              ? clampNumber(value, 256, contextWindowMax)
              : value;
          const numberInput = modalBody.querySelector(`[data-mpm="${name}"]`);
          const rangeInput = modalBody.querySelector(`[data-mpm-range="${name}"]`);
          if (numberInput instanceof HTMLInputElement) numberInput.value = String(clampedValue);
          if (rangeInput instanceof HTMLInputElement) rangeInput.value = String(clampedValue);
        };
        if (preset.temperature !== undefined) setField("temperature", preset.temperature);
        if (preset.top_p !== undefined) setField("top_p", preset.top_p);
        if (preset.top_k !== undefined) setField("top_k", preset.top_k);
        if (preset.max_tokens !== undefined) setField("max_tokens", preset.max_tokens);
        if (preset.context_window !== undefined) setField("context_window", preset.context_window);
        syncMaxTokensCap({ clampCurrent: true });
      });
    });

    modalOverlay.open({ captureFocus: true });
    requestAnimationFrame(() => {
      saveButton?.focus();
    });
  }

  async function saveModelParams() {
    if (!modelId || !modalBody || saveInFlight) return;
    const read = (name) => {
      const rawValue = (modalBody.querySelector(`[data-mpm="${name}"]`)?.value ?? "").trim();
      if (rawValue === "") {
        return undefined;
      }
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const params = {};
    const temperature = read("temperature");
    if (temperature !== undefined) params.temperature = clampNumber(temperature, 0, 2);
    const topP = read("top_p");
    if (topP !== undefined) params.top_p = clampNumber(topP, 0, 1);
    const topK = read("top_k");
    if (topK !== undefined) params.top_k = Math.floor(clampNumber(topK, 1, 400));
    const contextWindowRaw = read("context_window");
    const contextWindow = contextWindowRaw !== undefined
      ? Math.floor(clampNumber(contextWindowRaw, 256, currentContextWindowMax))
      : undefined;
    if (contextWindow !== undefined) params.context_window = contextWindow;
    const maxTokensRaw = read("max_tokens");
    const maxTokensLimit = Math.floor(clampNumber(contextWindow ?? currentMaxTokensMax, 16, currentMaxTokensMax));
    const maxTokens = maxTokensRaw !== undefined
      ? Math.floor(clampNumber(maxTokensRaw, 16, maxTokensLimit))
      : undefined;
    if (maxTokens !== undefined) params.max_tokens = maxTokens;

    if (!Object.keys(params).length) {
      pushToast("Нет изменённых параметров.", { tone: "neutral", durationMs: 1800 });
      return;
    }

    const currentModelId = modelId;
    saveInFlight = true;
    if (saveButton instanceof HTMLButtonElement) {
      saveButton.disabled = true;
    }
    try {
      await backendClient.updateModelParams(currentModelId, params, { timeoutMs: 45000 });
      pushToast("Параметры модели обновлены.", { tone: "success", durationMs: 2000 });
      closeModelParamsModal();
      void Promise.resolve(onSaved?.(currentModelId)).catch((error) => {
        pushToast(`Параметры сохранены, но UI обновился не полностью: ${error.message}`, {
          tone: "warning",
          durationMs: 3200,
        });
      });
    } catch (error) {
      pushToast(`Ошибка: ${error.message}`, { tone: "error", durationMs: 3600 });
    } finally {
      saveInFlight = false;
      if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = false;
      }
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    closeButton?.addEventListener("click", closeModelParamsModal);
    cancelButton?.addEventListener("click", closeModelParamsModal);
    saveButton?.addEventListener("click", () => void saveModelParams());
    modalElement?.addEventListener("click", (event) => {
      if (event.target === modalElement) {
        closeModelParamsModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modalOverlay.isOpen()) {
        event.preventDefault();
        closeModelParamsModal();
      }
    });
  }

  return {
    bindEvents,
    openModelParamsModal,
    closeModelParamsModal,
  };
}
