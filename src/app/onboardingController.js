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
  let isBound = false;
  let onboardingStepIndex = 0;
  let onboardingIsOpen = false;
  let onboardingState = loadOnboardingState();

  const resolveStepCount = () => Math.max(1, onboardingStepPanels.length || ONBOARDING_STEPS_COUNT);

  function hydrateForm() {
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
    return normalizeRuntimeConfig({
      ...runtimeConfig,
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
    getChatFeature()?.closeContextMenu();
    hydrateForm();
    setStep(0, { animate: false });
    closeAllMobilePanels();
    onboardingIsOpen = true;
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
    }

    onboardingState = {
      version: ONBOARDING_VERSION,
      completed: true,
      skipped: Boolean(skipped),
      completedAt: new Date().toISOString(),
      data: skipped
        ? {}
        : {
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
    onboardingState = {
      version: Number(payload.version) || ONBOARDING_VERSION,
      completed: Boolean(payload.completed),
      skipped: Boolean(payload.skipped),
      completedAt: String(payload.completedAt || ""),
      data: typeof payload.data === "object" && payload.data ? payload.data : {},
    };
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
