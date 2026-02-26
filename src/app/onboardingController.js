export function createOnboardingController({
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
  getChatFeature,
  applyRuntimeConfig,
  getSettingsFeature,
  persistSettingsToBackend,
}) {
  const DEPLOYMENT_LOCAL = "local";
  const DEPLOYMENT_REMOTE_CLIENT = "remote_client";
  const DEPLOYMENT_REMOTE_SERVER = "remote_server";
  const DEPLOYMENT_STEP_INDEX = 1;
  const DEFAULT_LOCAL_BACKEND_URL = "http://127.0.0.1:5055";
  let isBound = false;
  let onboardingStepIndex = 0;
  let onboardingIsOpen = false;
  let onboardingHideTimeoutId = null;
  let onboardingState = loadOnboardingState();

  const resolveStepCount = () => Math.max(1, onboardingStepPanels.length || ONBOARDING_STEPS_COUNT);

  function normalizeDeploymentMode(value) {
    const normalized = String(value || DEPLOYMENT_LOCAL).trim().toLowerCase();
    if (normalized === DEPLOYMENT_REMOTE_CLIENT || normalized === DEPLOYMENT_REMOTE_SERVER) {
      return normalized;
    }
    return DEPLOYMENT_LOCAL;
  }

  function getSelectedDeploymentMode() {
    const checked = document.querySelector('input[name="onboarding-deployment-mode"]:checked');
    if (checked instanceof HTMLInputElement) {
      return normalizeDeploymentMode(checked.value);
    }
    return normalizeDeploymentMode(runtimeConfig.deploymentMode);
  }

  function setSelectedDeploymentMode(value) {
    const safeMode = normalizeDeploymentMode(value);
    if (elements.onboardingDeploymentLocal instanceof HTMLInputElement) {
      elements.onboardingDeploymentLocal.checked = safeMode === DEPLOYMENT_LOCAL;
    }
    if (elements.onboardingDeploymentRemoteClient instanceof HTMLInputElement) {
      elements.onboardingDeploymentRemoteClient.checked = safeMode === DEPLOYMENT_REMOTE_CLIENT;
    }
    if (elements.onboardingDeploymentRemoteServer instanceof HTMLInputElement) {
      elements.onboardingDeploymentRemoteServer.checked = safeMode === DEPLOYMENT_REMOTE_SERVER;
    }
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function resolveBackendUrlDraft() {
    const raw = String(elements.onboardingBackendUrl?.value || "").trim();
    if (raw) {
      return raw;
    }
    const fromRuntime = String(runtimeConfig.backendUrl || "").trim();
    if (fromRuntime) {
      return fromRuntime;
    }
    return DEFAULT_LOCAL_BACKEND_URL;
  }

  function hydrateForm() {
    setSelectedDeploymentMode(runtimeConfig.deploymentMode);
    if (elements.onboardingBackendUrl) {
      elements.onboardingBackendUrl.value = String(runtimeConfig.backendUrl || DEFAULT_LOCAL_BACKEND_URL);
      clearFieldValidation(elements.onboardingBackendUrl);
    }
    if (elements.onboardingLanguage) {
      elements.onboardingLanguage.value = runtimeConfig.userLanguage;
    }
    if (elements.onboardingTimezone) {
      elements.onboardingTimezone.value = runtimeConfig.userTimezone;
      clearFieldValidation(elements.onboardingTimezone);
    }
    if (elements.onboardingUserName) {
      elements.onboardingUserName.value = runtimeConfig.userName;
    }
    if (elements.onboardingUserContext) {
      elements.onboardingUserContext.value = runtimeConfig.userContext;
    }
    if (elements.onboardingUiDensity) {
      elements.onboardingUiDensity.value = runtimeConfig.uiDensity;
    }
    if (elements.onboardingUiAnimations) {
      elements.onboardingUiAnimations.checked = runtimeConfig.uiAnimations;
    }
    if (elements.onboardingUiFontScale) {
      elements.onboardingUiFontScale.value = String(runtimeConfig.uiFontScale);
      clearFieldValidation(elements.onboardingUiFontScale);
    }
    if (elements.onboardingBootMood) {
      const hasBootMoodOption = [...elements.onboardingBootMood.options]
        .some((option) => option.value === runtimeConfig.bootMood);
      elements.onboardingBootMood.value = hasBootMoodOption ? runtimeConfig.bootMood : "neutral";
    }
  }

  function collectForm() {
    const selectedDeploymentMode = getSelectedDeploymentMode();
    const backendUrl = resolveBackendUrlDraft();
    return normalizeRuntimeConfig({
      ...runtimeConfig,
      mode: "backend",
      deploymentMode: selectedDeploymentMode,
      backendUrl,
      authToken: selectedDeploymentMode === DEPLOYMENT_LOCAL ? "" : runtimeConfig.authToken,
      authUsername: selectedDeploymentMode === DEPLOYMENT_LOCAL ? "" : runtimeConfig.authUsername,
      serverAllowRegistration: selectedDeploymentMode === DEPLOYMENT_REMOTE_SERVER
        ? Boolean(runtimeConfig.serverAllowRegistration)
        : false,
      userLanguage: elements.onboardingLanguage?.value ?? runtimeConfig.userLanguage,
      userTimezone: elements.onboardingTimezone?.value ?? runtimeConfig.userTimezone,
      userName: elements.onboardingUserName?.value ?? runtimeConfig.userName,
      userContext: elements.onboardingUserContext?.value ?? runtimeConfig.userContext,
      uiDensity: elements.onboardingUiDensity?.value ?? runtimeConfig.uiDensity,
      uiAnimations: elements.onboardingUiAnimations?.checked ?? runtimeConfig.uiAnimations,
      uiFontScale: elements.onboardingUiFontScale?.value ?? runtimeConfig.uiFontScale,
      bootMood: elements.onboardingBootMood?.value ?? runtimeConfig.bootMood,
    });
  }

  function syncStepUI({ animate = true, direction = 1 } = {}) {
    const stepCount = resolveStepCount();
    onboardingStepIndex = clamp(onboardingStepIndex, 0, stepCount - 1);

    onboardingStepPanels.forEach((panel, index) => {
      const isActive = index === onboardingStepIndex;
      panel.classList.remove(
        "onboarding-step-enter-forward",
        "onboarding-step-enter-back",
        "onboarding-step-leave-forward",
        "onboarding-step-leave-back",
      );

      if (isActive) {
        panel.classList.remove("hidden");
        panel.setAttribute("aria-hidden", "false");
      } else {
        panel.classList.add("hidden");
        panel.setAttribute("aria-hidden", "true");
      }

      if (isActive && animate && isMotionEnabled()) {
        const animationClass = direction < 0 ? "onboarding-step-enter-back" : "onboarding-step-enter-forward";
        panel.classList.add(animationClass);
        window.setTimeout(() => {
          panel.classList.remove(animationClass);
        }, 240);
      }
    });

    const isFinalStep = onboardingStepIndex >= stepCount - 1;
    if (elements.onboardingFinish) {
      elements.onboardingFinish.classList.toggle("hidden", !isFinalStep);
    }

    document.querySelectorAll("[data-onboarding-dot]").forEach((dot) => {
      const isActive = Number(dot.dataset.onboardingDot) === onboardingStepIndex;
      dot.dataset.active = isActive ? "true" : "false";
    });
  }

  function setStep(nextStep, { animate = true, direction = 1 } = {}) {
    const stepCount = resolveStepCount();
    const numericStep = Number(nextStep);
    const safeStep = Number.isFinite(numericStep) ? Math.trunc(numericStep) : 0;
    onboardingStepIndex = clamp(safeStep, 0, stepCount - 1);
    syncStepUI({ animate, direction });
    if (onboardingIsOpen) {
      const activePanel = onboardingStepPanels[onboardingStepIndex];
      if (activePanel instanceof HTMLElement) {
        window.requestAnimationFrame(() => {
          focusFirstInteractive(activePanel);
        });
      }
    }
  }

  function validateStep(stepIndex) {
    const lastStepIndex = Math.max(0, resolveStepCount() - 1);
    if (stepIndex === DEPLOYMENT_STEP_INDEX) {
      const deploymentMode = getSelectedDeploymentMode();
      if (
        deploymentMode !== DEPLOYMENT_LOCAL
        && deploymentMode !== DEPLOYMENT_REMOTE_CLIENT
        && deploymentMode !== DEPLOYMENT_REMOTE_SERVER
      ) {
        pushToast("Выберите режим запуска.", { tone: "error" });
        return false;
      }

      const backendUrl = String(elements.onboardingBackendUrl?.value || "").trim();
      if (deploymentMode === DEPLOYMENT_REMOTE_CLIENT && !backendUrl) {
        if (elements.onboardingBackendUrl) {
          elements.onboardingBackendUrl.classList.add("field-invalid");
          elements.onboardingBackendUrl.setAttribute("aria-invalid", "true");
        }
        pushToast("Для удалённого клиента укажите URL сервера.", { tone: "error" });
        return false;
      }
      if (backendUrl && !isHttpUrl(backendUrl)) {
        if (elements.onboardingBackendUrl) {
          elements.onboardingBackendUrl.classList.add("field-invalid");
          elements.onboardingBackendUrl.setAttribute("aria-invalid", "true");
        }
        pushToast("URL бэкенда должен начинаться с http:// или https://.", { tone: "error" });
        return false;
      }
      if (elements.onboardingBackendUrl) {
        clearFieldValidation(elements.onboardingBackendUrl);
      }
    }

    if (stepIndex < lastStepIndex) {
      return true;
    }

    if (elements.onboardingTimezone) {
      const timezone = String(elements.onboardingTimezone.value || "").trim();
      if (!isValidTimezone(timezone)) {
        elements.onboardingTimezone.classList.add("field-invalid");
        elements.onboardingTimezone.setAttribute("aria-invalid", "true");
        pushToast("Укажите корректный часовой пояс, например Europe/Moscow.", { tone: "error" });
        return false;
      }
      clearFieldValidation(elements.onboardingTimezone);
    }

    if (elements.onboardingUiFontScale) {
      const fontScale = Number(elements.onboardingUiFontScale.value);
      const validScale = Number.isFinite(fontScale) && fontScale >= 85 && fontScale <= 120;
      if (!validScale) {
        elements.onboardingUiFontScale.classList.add("field-invalid");
        elements.onboardingUiFontScale.setAttribute("aria-invalid", "true");
        pushToast("Масштаб шрифта должен быть от 85 до 120.", { tone: "error" });
        return false;
      }
      clearFieldValidation(elements.onboardingUiFontScale);
    }

    return true;
  }

  function shouldShowOnboarding() {
    if (!elements.onboardingOverlay || !elements.onboardingForm) {
      return false;
    }
    if (!onboardingState.completed) {
      return true;
    }
    return Number(onboardingState.version || 0) < ONBOARDING_VERSION;
  }

  function isOpen() {
    return onboardingIsOpen;
  }

  function openOnboarding() {
    if (!elements.onboardingOverlay || !elements.onboardingForm) {
      return;
    }
    if (onboardingHideTimeoutId !== null) {
      window.clearTimeout(onboardingHideTimeoutId);
      onboardingHideTimeoutId = null;
    }
    getChatFeature()?.closeContextMenu();
    hydrateForm();
    setStep(0, { animate: false });
    closeAllMobilePanels();
    onboardingIsOpen = true;
    elements.onboardingOverlay.hidden = false;
    elements.onboardingOverlay.classList.add("is-open");
    elements.onboardingOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("onboarding-open");
    const activePanel = onboardingStepPanels[onboardingStepIndex];
    if (activePanel instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        focusFirstInteractive(activePanel);
      });
    }
  }

  function closeOnboarding() {
    if (!elements.onboardingOverlay) {
      return;
    }
    onboardingIsOpen = false;
    elements.onboardingOverlay.classList.remove("is-open");
    elements.onboardingOverlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("onboarding-open");
    if (onboardingHideTimeoutId !== null) {
      window.clearTimeout(onboardingHideTimeoutId);
    }
    onboardingHideTimeoutId = window.setTimeout(() => {
      if (!onboardingIsOpen && elements.onboardingOverlay) {
        elements.onboardingOverlay.hidden = true;
      }
      onboardingHideTimeoutId = null;
    }, 280);
  }

  function finishOnboarding({ skipped = false } = {}) {
    if (!skipped) {
      const finalStep = Math.max(0, resolveStepCount() - 1);
      if (!validateStep(finalStep)) {
        setStep(finalStep, { direction: 1 });
        return false;
      }

      const nextConfig = collectForm();
      applyRuntimeConfig(nextConfig);
      getSettingsFeature()?.hydrateSettingsForm();
      if (nextConfig.mode === "backend" && nextConfig.autoReconnect) {
        void getSettingsFeature()?.checkBackendConnection();
      }
    }

    onboardingState = {
      version: ONBOARDING_VERSION,
      completed: true,
      skipped: Boolean(skipped),
      completedAt: new Date().toISOString(),
      data: skipped
        ? {}
        : {
          deploymentMode: runtimeConfig.deploymentMode,
          backendUrl: runtimeConfig.backendUrl,
          userName: runtimeConfig.userName,
          userLanguage: runtimeConfig.userLanguage,
          uiDensity: runtimeConfig.uiDensity,
          bootMood: runtimeConfig.bootMood,
        },
    };
    persistOnboardingState(onboardingState);
    void persistSettingsToBackend({
      includeRuntime: !skipped,
      includeOnboarding: true,
      autonomousMode: runtimeConfig.autonomousMode,
    });
    closeOnboarding();
    pushToast(
      skipped
        ? "Первичная настройка пропущена. При необходимости её можно запустить позже."
        : "Первичная настройка сохранена.",
      { tone: skipped ? "warning" : "success" },
    );
    return true;
  }

  function getState() {
    return { ...onboardingState };
  }

  function setStateFromBackend(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const incomingState = {
      version: Number(payload.version) || ONBOARDING_VERSION,
      completed: Boolean(payload.completed),
      skipped: Boolean(payload.skipped),
      completedAt: String(payload.completedAt || ""),
      data: typeof payload.data === "object" && payload.data ? payload.data : {},
    };
    incomingState.version = Math.max(
      ONBOARDING_VERSION,
      Number(onboardingState.version) || 0,
      Number(incomingState.version) || 0,
    );

    // Никогда не откатываем completed=true назад в false из-за
    // временно устаревшего/пустого состояния на стороне backend.
    if (onboardingState.completed && !incomingState.completed) {
      incomingState.completed = true;
      incomingState.skipped = Boolean(onboardingState.skipped);
      incomingState.completedAt = String(onboardingState.completedAt || incomingState.completedAt || "");
      if (!incomingState.data || Object.keys(incomingState.data).length === 0) {
        incomingState.data = (
          onboardingState.data && typeof onboardingState.data === "object"
            ? { ...onboardingState.data }
            : {}
        );
      }
    }

    onboardingState = incomingState;
    persistOnboardingState(onboardingState);
  }

  function resetOnboarding() {
    onboardingState = {
      version: ONBOARDING_VERSION,
      completed: false,
      skipped: false,
      completedAt: "",
      data: {},
    };
    persistOnboardingState(onboardingState);
    void persistSettingsToBackend({ includeOnboarding: true });
    openOnboarding();
    return { ...onboardingState };
  }

  function handleKeyDown(event) {
    if (!onboardingIsOpen) {
      return false;
    }
    const lastStepIndex = Math.max(0, resolveStepCount() - 1);
    if (event.key === "Escape") {
      event.preventDefault();
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && onboardingStepIndex < lastStepIndex) {
      const activeElement = document.activeElement;
      const isTextArea = activeElement instanceof HTMLTextAreaElement;
      if (!isTextArea && validateStep(onboardingStepIndex)) {
        event.preventDefault();
        setStep(onboardingStepIndex + 1, { direction: 1 });
      }
      return true;
    }
    return true;
  }

  function bind() {
    if (isBound) {
      return;
    }
    isBound = true;

    elements.onboardingTimezone?.addEventListener("input", () => {
      clearFieldValidation(elements.onboardingTimezone);
    });

    elements.onboardingUiFontScale?.addEventListener("input", () => {
      clearFieldValidation(elements.onboardingUiFontScale);
    });

    elements.onboardingBackendUrl?.addEventListener("input", () => {
      clearFieldValidation(elements.onboardingBackendUrl);
    });

    [
      elements.onboardingDeploymentLocal,
      elements.onboardingDeploymentRemoteClient,
      elements.onboardingDeploymentRemoteServer,
    ].forEach((node) => {
      node?.addEventListener("change", () => {
        const selectedMode = getSelectedDeploymentMode();
        if (
          (selectedMode === DEPLOYMENT_LOCAL || selectedMode === DEPLOYMENT_REMOTE_SERVER)
          && elements.onboardingBackendUrl instanceof HTMLInputElement
          && !String(elements.onboardingBackendUrl.value || "").trim()
        ) {
          elements.onboardingBackendUrl.value = DEFAULT_LOCAL_BACKEND_URL;
        }
      });
    });

    onboardingNextStepButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (!validateStep(onboardingStepIndex)) {
          return;
        }
        const nextStep = Number(button.dataset.onboardingNextStep);
        const safeNextStep = Number.isFinite(nextStep)
          ? Math.trunc(nextStep)
          : onboardingStepIndex + 1;
        const direction = safeNextStep >= onboardingStepIndex ? 1 : -1;
        setStep(safeNextStep, { direction });
      });
    });

    elements.onboardingForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      finishOnboarding({ skipped: false });
    });
  }

  return {
    bind,
    getState,
    setStateFromBackend,
    resetOnboarding,
    shouldShowOnboarding,
    openOnboarding,
    closeOnboarding,
    finishOnboarding,
    hydrateForm,
    isOpen,
    handleKeyDown,
  };
}
