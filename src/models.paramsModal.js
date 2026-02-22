const MODEL_PARAM_PRESETS = [
  { id: "balanced", label: "Сбалансированный", temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 512, context_window: 4096 },
  { id: "creative", label: "Творческий", temperature: 1.1, top_p: 0.97, top_k: 60, max_tokens: 768, context_window: 4096 },
  { id: "precise", label: "Точный", temperature: 0.15, top_p: 0.7, top_k: 20, max_tokens: 512, context_window: 4096 },
  { id: "fast", label: "Быстрый", temperature: 0.5, top_p: 0.85, top_k: 30, max_tokens: 256, context_window: 2048 },
  { id: "extended", label: "Длинные", temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 2048, context_window: 8192 },
  { id: "code", label: "Код", temperature: 0.2, top_p: 0.75, top_k: 20, max_tokens: 1024, context_window: 8192 },
];
const DEFAULT_MODEL_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  max_tokens: 512,
  context_window: 4096,
};

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
}) {
  const modalElement = document.querySelector("#model-params-modal");
  const modalBody = document.querySelector("#model-params-modal-body");
  const modalTitle = document.querySelector("#mpm-title");
  const closeButton = document.querySelector("#model-params-modal-close");
  const cancelButton = document.querySelector("#model-params-modal-cancel");
  const saveButton = document.querySelector("#model-params-modal-save");

  let modelId = "";
  let eventsBound = false;

  function closeModelParamsModal() {
    if (!modalElement) return;
    modalElement.classList.add("hidden");
    modalElement.setAttribute("aria-hidden", "true");
    modelId = "";
  }

  function openModelParamsModal(model) {
    if (!modalElement || !modalBody) return;
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
        ${buildMpmField("max_tokens", "Max tokens", 16, 4096, 16, initialParams.max_tokens)}
        ${buildMpmField("context_window", "Context window", 256, 32768, 256, initialParams.context_window)}
      </div>`;

    modalBody.querySelectorAll(".mpm-field__range").forEach((rangeElement) => {
      const fieldName = rangeElement.dataset.mpmRange;
      const numberInput = modalBody.querySelector(`[data-mpm="${fieldName}"]`);
      if (!(numberInput instanceof HTMLInputElement)) return;
      rangeElement.addEventListener("input", () => {
        numberInput.value = rangeElement.value;
      });
      numberInput.addEventListener("input", () => {
        rangeElement.value = numberInput.value;
      });
    });

    modalBody.querySelectorAll(".mpm-preset-btn").forEach((presetButton) => {
      presetButton.addEventListener("click", () => {
        const preset = MODEL_PARAM_PRESETS.find((entry) => entry.id === presetButton.dataset.preset);
        if (!preset) return;
        modalBody.querySelectorAll(".mpm-preset-btn").forEach((button) => button.classList.remove("is-active"));
        presetButton.classList.add("is-active");
        const setField = (name, value) => {
          const numberInput = modalBody.querySelector(`[data-mpm="${name}"]`);
          const rangeInput = modalBody.querySelector(`[data-mpm-range="${name}"]`);
          if (numberInput instanceof HTMLInputElement) numberInput.value = String(value);
          if (rangeInput instanceof HTMLInputElement) rangeInput.value = String(value);
        };
        if (preset.temperature !== undefined) setField("temperature", preset.temperature);
        if (preset.top_p !== undefined) setField("top_p", preset.top_p);
        if (preset.top_k !== undefined) setField("top_k", preset.top_k);
        if (preset.max_tokens !== undefined) setField("max_tokens", preset.max_tokens);
        if (preset.context_window !== undefined) setField("context_window", preset.context_window);
      });
    });

    modalElement.classList.remove("hidden");
    modalElement.setAttribute("aria-hidden", "false");
    window.requestAnimationFrame(() => saveButton?.focus());
  }

  async function saveModelParams() {
    if (!modelId || !modalBody) return;
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
    if (temperature !== undefined) params.temperature = temperature;
    const topP = read("top_p");
    if (topP !== undefined) params.top_p = topP;
    const topK = read("top_k");
    if (topK !== undefined) params.top_k = topK;
    const maxTokens = read("max_tokens");
    if (maxTokens !== undefined) params.max_tokens = maxTokens;
    const contextWindow = read("context_window");
    if (contextWindow !== undefined) params.context_window = contextWindow;

    if (!Object.keys(params).length) {
      pushToast("Нет изменённых параметров.", { tone: "neutral", durationMs: 1800 });
      return;
    }

    const currentModelId = modelId;
    try {
      await backendClient.updateModelParams(currentModelId, params);
      pushToast("Параметры модели обновлены.", { tone: "success", durationMs: 2000 });
      closeModelParamsModal();
      await onSaved?.(currentModelId);
    } catch (error) {
      pushToast(`Ошибка: ${error.message}`, { tone: "error", durationMs: 3600 });
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    closeButton?.addEventListener("click", closeModelParamsModal);
    cancelButton?.addEventListener("click", closeModelParamsModal);
    saveButton?.addEventListener("click", () => void saveModelParams());
    modalElement?.querySelector(".model-params-modal__backdrop")?.addEventListener("click", closeModelParamsModal);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modalElement && !modalElement.classList.contains("hidden")) {
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
