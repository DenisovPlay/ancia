function clampPreloaderProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

async function invokeTauriCommand(commandName) {
  if (typeof window.__TAURI_INTERNALS__?.invoke === "function") {
    return window.__TAURI_INTERNALS__.invoke(commandName);
  }
  if (typeof window.__TAURI__?.core?.invoke === "function") {
    return window.__TAURI__.core.invoke(commandName);
  }
  throw new Error("TAURI_INVOKE_UNAVAILABLE");
}

function isLocalDesktopBackendUrl(urlValue) {
  const raw = String(urlValue || "").trim();
  if (!raw) {
    return false;
  }
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    const port = String(parsed.port || "");
    if (!isLoopbackHost(host)) {
      return false;
    }
    return !port || /^\d+$/.test(port);
  } catch {
    return false;
  }
}

function normalizeBackendOrigin(urlValue) {
  try {
    const parsed = new URL(String(urlValue || "").trim());
    const protocol = String(parsed.protocol || "").toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return "";
    }
    return `${protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

function resolveDesktopBackendBaseUrl(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }
  const host = String(snapshot.host || "").trim().toLowerCase();
  const port = Number(snapshot.port);
  if (!isLoopbackHost(host)) {
    return "";
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    return "";
  }
  return `http://${host}:${port}`;
}

function applyDesktopBackendEndpoint({ snapshot, runtimeConfig, backendClient }) {
  const targetBaseUrl = resolveDesktopBackendBaseUrl(snapshot);
  if (!targetBaseUrl) {
    return null;
  }
  const currentOrigin = normalizeBackendOrigin(runtimeConfig.backendUrl);
  const targetOrigin = normalizeBackendOrigin(targetBaseUrl);
  if (!targetOrigin) {
    return null;
  }
  const changed = currentOrigin !== targetOrigin;
  if (changed) {
    runtimeConfig.backendUrl = targetBaseUrl;
    backendClient.setConfig({ baseUrl: targetBaseUrl });
  }
  return { baseUrl: targetBaseUrl, changed };
}

async function readDesktopBackendStartupSnapshot({ enabled = false } = {}) {
  if (!enabled) {
    return null;
  }
  try {
    const payload = await invokeTauriCommand("backend_startup_snapshot");
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const status = String(payload.status || "").trim().toLowerCase();
    const message = String(payload.message || "").trim();
    const host = String(payload.host || "").trim();
    const port = Number(payload.port);
    return {
      status: status || "idle",
      message,
      host,
      port: Number.isFinite(port) ? port : null,
    };
  } catch {
    return null;
  }
}

export function updatePreloaderStatus(labelNode, message, progressNode = null, progressPercent = null) {
  if (!labelNode) {
    return;
  }
  labelNode.textContent = String(message || "Загрузка...");
  if (progressNode instanceof HTMLElement) {
    const progress = clampPreloaderProgress(progressPercent);
    if (progress === null) {
      progressNode.dataset.mode = "indeterminate";
      progressNode.style.width = "34%";
      return;
    }
    progressNode.dataset.mode = "determinate";
    progressNode.style.width = `${Math.max(4, progress)}%`;
  }
}

export function resolveBackendStartupState(healthPayload) {
  const startup = healthPayload && typeof healthPayload === "object" ? healthPayload.startup : null;
  const serviceName = String(healthPayload?.service || "").trim().toLowerCase();
  const hasStartupPayload = Boolean(startup && typeof startup === "object");
  if (!hasStartupPayload && serviceName !== "ancia-local-backend") {
    return {
      status: "error",
      stage: "error",
      message: "На этом адресе отвечает другой сервис, а не локальный backend Ancia.",
      progressPercent: 100,
      autonomousMode: false,
    };
  }
  const autonomousMode = Boolean(
    healthPayload?.policy?.autonomous_mode
    || healthPayload?.autonomous_mode,
  );
  const status = String(startup?.status || "").trim().toLowerCase() || "loading";
  const stage = String(startup?.stage || "").trim().toLowerCase();
  const startupMessage = String(startup?.message || "").trim();
  const rawProgress = Number(startup?.details?.progress_percent);

  const stageLabel = stage === "environment_check"
    ? "Проверка окружения Python/MLX..."
    : stage === "checking_gpu_memory"
      ? "Проверка доступной GPU/unified памяти..."
      : stage === "loading_model"
        ? "Загрузка выбранной модели..."
        : stage === "unloaded"
          ? "Модель пока не загружена. Запустится при первом запросе."
          : stage === "ready"
            ? "Модель готова."
            : stage === "error"
            ? "Ошибка запуска модели."
              : "Запуск серверного модуля...";

  let progressPercent = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(100, rawProgress))
    : (stage === "environment_check"
      ? 24
      : stage === "checking_gpu_memory"
        ? 42
        : stage === "loading_model"
          ? 66
          : stage === "unloaded"
            ? 76
            : stage === "ready"
              ? 100
              : stage === "error"
                ? 100
                : 14);
  if (status === "ready") {
    progressPercent = 100;
  }

  return {
    status,
    stage,
    message: `${startupMessage || stageLabel}${autonomousMode ? " • Автономный режим" : ""}`,
    progressPercent,
    autonomousMode,
  };
}

export async function waitForBackendStartup({
  runtimeConfig,
  backendClient,
  updateConnectionState,
  setPreloaderStatus,
  BACKEND_STATUS,
  timeoutMs,
  pollMs,
}) {
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
  const canQueryDesktopStartup = isLocalDesktopBackendUrl(runtimeConfig.backendUrl);

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const health = await backendClient.ping();
      const startup = resolveBackendStartupState(health);
      setPreloaderStatus(startup.message, startup.progressPercent);

      if (startup.status === "error") {
        const desktopStartup = await readDesktopBackendStartupSnapshot({ enabled: canQueryDesktopStartup });
        const endpointUpdate = applyDesktopBackendEndpoint({
          snapshot: desktopStartup,
          runtimeConfig,
          backendClient,
        });
        if (endpointUpdate?.changed) {
          updateConnectionState(
            BACKEND_STATUS.checking,
            `Найден локальный backend на ${endpointUpdate.baseUrl}. Переподключаемся...`,
          );
          setPreloaderStatus("Переподключаемся к локальному backend...", 78);
          continue;
        }
        updateConnectionState(BACKEND_STATUS.error, startup.message, health);
        return { ready: false, error: startup.message, health };
      }

      if (startup.status === "ready" || startup.status === "idle") {
        const connectedMessage = startup.status === "ready"
          ? "Бэкенд доступен, модель готова"
          : "Бэкенд доступен, модель загрузится при первом сообщении";
        updateConnectionState(BACKEND_STATUS.connected, connectedMessage, health);
        setPreloaderStatus("Бэкенд готов. Открываем интерфейс...", 100);
        return { ready: true, health, modelReady: startup.status === "ready" };
      }

      updateConnectionState(BACKEND_STATUS.checking, startup.message, health);
    } catch (error) {
      lastError = error?.message ? String(error.message) : "сервер не отвечает";
      const desktopStartup = await readDesktopBackendStartupSnapshot({ enabled: canQueryDesktopStartup });
      const endpointUpdate = applyDesktopBackendEndpoint({
        snapshot: desktopStartup,
        runtimeConfig,
        backendClient,
      });
      if (endpointUpdate?.changed) {
        updateConnectionState(BACKEND_STATUS.checking, `Пробуем локальный backend на ${endpointUpdate.baseUrl}...`);
      }
      if (desktopStartup?.status === "error" && desktopStartup.message) {
        updateConnectionState(BACKEND_STATUS.error, desktopStartup.message);
        setPreloaderStatus(desktopStartup.message, 100);
        return { ready: false, error: desktopStartup.message, startup: desktopStartup };
      }
      if (desktopStartup?.status === "ready") {
        const readyMessage = desktopStartup.message || "Локальный backend запущен. Проверяем соединение...";
        updateConnectionState(BACKEND_STATUS.checking, readyMessage);
        setPreloaderStatus(readyMessage, 90);
      } else if (desktopStartup?.status === "starting" && desktopStartup.message) {
        updateConnectionState(BACKEND_STATUS.checking, desktopStartup.message);
        setPreloaderStatus(desktopStartup.message, null);
      } else {
        updateConnectionState(BACKEND_STATUS.checking, `Ожидаем запуск бэкенда: ${lastError}`);
        setPreloaderStatus("Ожидаем запуск бэкенда...", null);
      }
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, pollMs);
    });
  }

  const timeoutMessage = lastError
    ? `Сервер недоступен: ${lastError}`
    : "Сервер не успел запуститься вовремя.";
  updateConnectionState(BACKEND_STATUS.error, timeoutMessage);
  setPreloaderStatus(timeoutMessage, 100);
  return { ready: false, error: timeoutMessage };
}

export function hidePreloader({ preloaderNode, preloaderStartMs, minVisibleMs }) {
  return new Promise((resolve) => {
    if (!preloaderNode) {
      resolve();
      return;
    }

    const elapsed = performance.now() - preloaderStartMs;
    const waitMs = Math.max(0, minVisibleMs - elapsed);

    window.setTimeout(() => {
      document.body.classList.add("app-ready");
      window.setTimeout(() => {
        preloaderNode.remove();
        resolve();
      }, 240);
    }, waitMs);
  });
}
