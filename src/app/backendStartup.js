export function updatePreloaderStatus(labelNode, message) {
  if (!labelNode) {
    return;
  }
  labelNode.textContent = String(message || "Загрузка...");
}

export function resolveBackendStartupState(healthPayload) {
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
        ? "Загрузка выбранной модели..."
        : stage === "unloaded"
          ? "Модель пока не загружена. Запустится при первом запросе."
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

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const health = await backendClient.ping();
      const startup = resolveBackendStartupState(health);
      setPreloaderStatus(startup.message);

      if (startup.status === "error") {
        updateConnectionState(BACKEND_STATUS.error, startup.message, health);
        return { ready: false, error: startup.message, health };
      }

      if (startup.status === "ready" || startup.status === "idle") {
        const connectedMessage = startup.status === "ready"
          ? "Бэкенд доступен, модель готова"
          : "Бэкенд доступен, модель загрузится при первом сообщении";
        updateConnectionState(BACKEND_STATUS.connected, connectedMessage, health);
        return { ready: true, health, modelReady: startup.status === "ready" };
      }

      updateConnectionState(BACKEND_STATUS.checking, startup.message, health);
    } catch (error) {
      lastError = error?.message ? String(error.message) : "сервер не отвечает";
      updateConnectionState(BACKEND_STATUS.checking, `Ожидаем запуск бэкенда: ${lastError}`);
      setPreloaderStatus("Ожидаем запуск бэкенда...");
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, pollMs);
    });
  }

  const timeoutMessage = lastError
    ? `Сервер недоступен: ${lastError}`
    : "Сервер не успел запуститься вовремя.";
  updateConnectionState(BACKEND_STATUS.error, timeoutMessage);
  setPreloaderStatus(timeoutMessage);
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
