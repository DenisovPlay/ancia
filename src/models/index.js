import { normalizeModelCardPayload, renderModelCard, sortModels } from "./card.js";
import { createModelParamsController } from "./paramsModal.js";
import { modelsPageTemplate } from "./template.js";

const VALID_MODEL_FILTERS = new Set(["all", "installed"]);

export { modelsPageTemplate };

function formatBytes(value) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue) || safeValue < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = safeValue;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatEta(secondsValue) {
  const safeSeconds = Math.max(0, Math.floor(Number(secondsValue) || 0));
  if (!safeSeconds) return "";
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const minutesRest = minutes % 60;
  if (hours < 24) return `${hours}h ${String(minutesRest).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  const hoursRest = hours % 24;
  return `${days}d ${hoursRest}h`;
}

function buildDownloadMeta(startup) {
  const details = startup && typeof startup === "object" && startup.details && typeof startup.details === "object"
    ? startup.details
    : {};
  const totalBytes = Number(details.download_total_bytes);
  const downloadedBytes = Number(details.download_downloaded_bytes);
  const speedBytesPerSecond = Number(details.download_speed_bytes_per_second);
  const etaSeconds = Number(details.download_eta_seconds);

  if (Number.isFinite(totalBytes) && totalBytes > 0 && Number.isFinite(downloadedBytes)) {
    const safeDone = Math.max(0, Math.min(totalBytes, downloadedBytes));
    const chunks = [`Скачано: ${formatBytes(safeDone)} / ${formatBytes(totalBytes)}`];
    if (Number.isFinite(speedBytesPerSecond) && speedBytesPerSecond > 0) {
      chunks.push(`${formatBytes(speedBytesPerSecond)}/с`);
    }
    if (Number.isFinite(etaSeconds) && etaSeconds > 0) {
      const etaLabel = formatEta(etaSeconds);
      if (etaLabel) {
        chunks.push(`ETA ${etaLabel}`);
      }
    }
    return chunks.join(" · ");
  }

  const filesToDownload = Number(details.download_files_to_download);
  if (Number.isFinite(filesToDownload) && filesToDownload > 0) {
    return `Файлов к скачиванию: ${Math.floor(filesToDownload)}`;
  }
  return "";
}

export function createModelsFeature({
  runtimeConfig,
  backendClient,
  applyRuntimeConfig,
  normalizeModelId,
  getModelLabelById,
  pushToast,
  isMotionEnabled,
  getChatFeature,
}) {
  const gridNode = document.querySelector("#models-grid");
  const emptyStateNode = document.querySelector("#models-empty-state");
  const installedCountNode = document.querySelector("#models-installed-count");
  const catalogCountNode = document.querySelector("#models-catalog-count");
  const runtimeBannerNode = document.querySelector("#models-runtime-banner");
  const runtimeStatusNode = document.querySelector("#models-runtime-status");
  const runtimeMetaNode = document.querySelector("#models-runtime-meta");
  const runtimeBadgeNode = document.querySelector("#models-runtime-badge");
  const runtimeProgressNode = document.querySelector("#models-runtime-progress");
  const searchInput = document.querySelector("#model-search-input");
  const allFilterButtons = [...document.querySelectorAll("[data-model-filter]")];
  const refreshButton = document.querySelector("[data-models-action='refresh']");
  const refreshCatalogButton = document.querySelector("[data-models-action='refresh-catalog']");

  let payloadState = null;
  let loading = false;
  let pollTimer = 0;
  let activeFilter = "all";
  let searchQuery = "";

  function clearPollTimer() {
    if (!pollTimer) return;
    window.clearTimeout(pollTimer);
    pollTimer = 0;
  }

  function schedulePollIfNeeded() {
    clearPollTimer();
    const startupStatus = String(payloadState?.startup?.status || "").trim().toLowerCase();
    const hasLoadingCard = Array.isArray(payloadState?.models) && payloadState.models.some((model) => model?.loading);
    if (startupStatus === "loading" || startupStatus === "booting" || hasLoadingCard) {
      pollTimer = window.setTimeout(() => {
        void loadModels({ silent: true });
      }, 900);
    }
  }

  function getNormalizedModels() {
    if (!Array.isArray(payloadState?.models)) return [];
    return sortModels(
      payloadState.models
        .map(normalizeModelCardPayload)
        .filter((model) => model && model.supportsTools),
    );
  }

  function findModelById(modelId) {
    const needle = String(modelId || "").trim().toLowerCase();
    return needle ? getNormalizedModels().find((model) => model.id === needle) ?? null : null;
  }

  function setFilter(filterValue) {
    if (!VALID_MODEL_FILTERS.has(filterValue)) return;
    activeFilter = filterValue;
    allFilterButtons.forEach((button) => {
      const isActive = button.dataset.modelFilter === filterValue;
      button.setAttribute("aria-pressed", String(isActive));
      button.setAttribute("data-active", String(isActive));
    });
    applyFilters();
  }

  function applyFilters() {
    if (!(gridNode instanceof HTMLElement)) return;

    const cards = [...gridNode.querySelectorAll("[data-model-card]")];
    const needle = searchQuery.toLowerCase();
    let visibleCount = 0;

    cards.forEach((card) => {
      const installed = card.dataset.modelInstalled === "true";
      const keywords = String(card.dataset.modelKeywords || "");
      const matchFilter = activeFilter === "all" || (activeFilter === "installed" && installed);
      const matchSearch = !needle || keywords.includes(needle);
      const visible = matchFilter && matchSearch;
      card.classList.toggle("hidden", !visible);
      if (visible) {
        visibleCount += 1;
      }
    });

    if (emptyStateNode instanceof HTMLElement) {
      emptyStateNode.classList.toggle("hidden", visibleCount > 0 || cards.length === 0);
    }
  }

  function updateRuntimeBanner() {
    const startup = payloadState?.startup || {};
    const status = String(startup.status || "idle").trim().toLowerCase();
    const stage = String(startup.stage || "").trim().toLowerCase();
    const message = String(startup.message || "").trim();
    const progress = Math.max(
      0,
      Math.min(100, Number(payloadState?.startup_progress_percent ?? startup.details?.progress_percent ?? 0)),
    );

    const showBanner = status === "loading" || status === "booting";
    runtimeBannerNode?.classList.toggle("hidden", !showBanner);
    if (!showBanner) return;

    const stageMessages = {
      loading_model: "Загружаем выбранную модель…",
      checking_gpu_memory: "Проверяем память устройства…",
      environment_check: "Проверяем окружение Python / MLX…",
      ready: "Модель готова.",
      unloaded: "Модель пока не загружена.",
    };

    if (runtimeStatusNode) {
      runtimeStatusNode.textContent = message || stageMessages[stage] || "Ожидаем статус…";
    }

    const selected = payloadState?.selected_model || runtimeConfig.modelId || "";
    const loaded = payloadState?.loaded_model || "";
    if (runtimeMetaNode) {
      const selectedLabel = getModelLabelById(selected, selected || "не выбрана");
      const loadedLabel = loaded ? getModelLabelById(loaded, loaded) : "не загружена";
      const downloadMeta = buildDownloadMeta(startup);
      runtimeMetaNode.textContent = downloadMeta
        ? `Выбрана: ${selectedLabel} · Загружена: ${loadedLabel} · ${downloadMeta}`
        : `Выбрана: ${selectedLabel} · Загружена: ${loadedLabel}`;
    }

    if (runtimeBadgeNode) {
      runtimeBadgeNode.textContent = status;
    }
    if (runtimeProgressNode) {
      runtimeProgressNode.style.width = `${progress}%`;
    }
  }

  function render() {
    const models = getNormalizedModels();

    if (gridNode instanceof HTMLElement) {
      gridNode.innerHTML = models.map(renderModelCard).join("");
    }

    const installedModels = models.filter((model) => model.cache.cached || model.loaded || model.loading);
    if (installedCountNode) {
      installedCountNode.textContent = String(installedModels.length);
    }
    if (catalogCountNode) {
      catalogCountNode.textContent = `${models.length} в каталоге`;
    }

    updateRuntimeBanner();
    applyFilters();
    schedulePollIfNeeded();
  }

  async function loadModels({ silent = false } = {}) {
    if (loading) return false;
    loading = true;

    try {
      const payload = await backendClient.listModels();
      payloadState = payload && typeof payload === "object" ? payload : {};

      const selectedModelId = normalizeModelId(payloadState?.selected_model || runtimeConfig.modelId);
      const selectedModel = findModelById(selectedModelId);
      const runtimeVisionAvailable = payloadState?.runtime
        && typeof payloadState.runtime.vision_runtime_available === "boolean"
        ? Boolean(payloadState.runtime.vision_runtime_available)
        : true;
      applyRuntimeConfig({
        modelId: selectedModelId,
        modelSupportsVision: Boolean(selectedModel?.supportsVision && runtimeVisionAvailable),
      });

      render();
      return true;
    } catch (error) {
      if (!silent) {
        pushToast(`Не удалось загрузить список моделей: ${error.message}`, { tone: "error", durationMs: 3600 });
      }
      return false;
    } finally {
      loading = false;
    }
  }

  const modelParamsController = createModelParamsController({
    backendClient,
    pushToast,
    isMotionEnabled,
    onSaved: async () => {
      await loadModels({ silent: true });
      getChatFeature?.()?.syncComposerState?.({ forceContextRefresh: true });
    },
  });

  async function handleModelAction(action, modelId) {
    const model = findModelById(modelId);
    if (!model) return;

    try {
      if (action === "select") {
        await backendClient.selectModel({ model_id: model.id });
        const runtimeVisionAvailable = payloadState?.runtime
          && typeof payloadState.runtime.vision_runtime_available === "boolean"
          ? Boolean(payloadState.runtime.vision_runtime_available)
          : true;
        applyRuntimeConfig({ modelId: model.id, modelSupportsVision: Boolean(model.supportsVision && runtimeVisionAvailable) });
        await loadModels({ silent: true });
        pushToast("Модель выбрана.", { tone: "success", durationMs: 2000 });
        return;
      }

      if (action === "load") {
        await backendClient.loadModel({ model_id: model.id });
        const runtimeVisionAvailable = payloadState?.runtime
          && typeof payloadState.runtime.vision_runtime_available === "boolean"
          ? Boolean(payloadState.runtime.vision_runtime_available)
          : true;
        applyRuntimeConfig({ modelId: model.id, modelSupportsVision: Boolean(model.supportsVision && runtimeVisionAvailable) });
        await loadModels({ silent: true });
        pushToast(model.cache.cached ? "Запускаем модель…" : "Скачиваем и запускаем модель…", {
          tone: "neutral",
          durationMs: 2200,
        });
        return;
      }

      if (action === "unload") {
        await backendClient.unloadModel();
        applyRuntimeConfig({ modelSupportsVision: false });
        await loadModels({ silent: true });
        pushToast("Модель выгружена.", { tone: "success", durationMs: 2000 });
        return;
      }

      if (action === "delete-cache") {
        await backendClient.deleteModelCache(model.id);
        pushToast("Кэш модели удалён.", { tone: "success", durationMs: 2200 });
        await loadModels({ silent: true });
        return;
      }

      if (action === "open-params") {
        modelParamsController.openModelParamsModal(model);
      }
    } catch (error) {
      pushToast(`Ошибка: ${error.message}`, { tone: "error", durationMs: 3600 });
    }
  }

  function bindEvents() {
    modelParamsController.bindEvents();

    refreshButton?.addEventListener("click", () => {
      void loadModels({ silent: false });
    });

    refreshCatalogButton?.addEventListener("click", async () => {
      if (!refreshCatalogButton) return;
      refreshCatalogButton.disabled = true;
      try {
        const result = await backendClient.request("/models/catalog/refresh", { method: "POST" });
        const added = result?.added ?? 0;
        pushToast(added > 0 ? `Найдено новых: ${added}` : "Новых моделей не найдено", {
          tone: "success",
          durationMs: 3000,
        });
        if (result?.models_payload) {
          await loadModels({ silent: true });
        }
      } catch (error) {
        pushToast(`Ошибка обновления: ${error.message}`, { tone: "error", durationMs: 3600 });
      } finally {
        refreshCatalogButton.disabled = false;
      }
    });

    searchInput?.addEventListener("input", () => {
      searchQuery = String(searchInput.value || "").trim().toLowerCase();
      applyFilters();
    });

    allFilterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const filterValue = String(button.dataset.modelFilter || "");
        setFilter(filterValue);
      });
    });

    gridNode?.addEventListener("click", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest("[data-model-action]") : null;
      if (!(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement)) return;
      const card = target.closest("[data-model-card]");
      const action = String(target.dataset.modelAction || "").trim();
      const modelId = card instanceof HTMLElement ? String(card.dataset.modelId || "").trim().toLowerCase() : "";
      if (!action || !modelId) return;
      void handleModelAction(action, modelId);
    });

    setFilter("all");
  }

  function initialize() {
    bindEvents();
    void loadModels({ silent: true });
  }

  return {
    initialize,
    reload: () => loadModels({ silent: false }),
  };
}
