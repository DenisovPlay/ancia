export function createActionDialogManager({
  overlay,
  dialog,
  title,
  message,
  inputWrap,
  input,
  cancelButton,
  confirmButton,
  isMotionEnabled,
  transitionMs = 260,
} = {}) {
  const state = {
    open: false,
    mode: "confirm",
    resolve: null,
    keydownHandler: null,
    restoreFocusEl: null,
    closeTimerId: null,
    closeToken: 0,
  };

  function hasSupport() {
    return Boolean(
      overlay
        && dialog
        && title
        && message
        && inputWrap
        && input
        && cancelButton
        && confirmButton,
    );
  }

  function finalizeVisualClose(restoreFocusEl = null) {
    if (!hasSupport()) {
      return;
    }

    overlay.classList.remove("is-open", "is-closing");
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");

    if (restoreFocusEl instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        restoreFocusEl.focus({ preventScroll: true });
      });
    }
  }

  function settle(
    result = { confirmed: false, value: null },
    { skipAnimation = false } = {},
  ) {
    if (!hasSupport() || !state.open) {
      return;
    }

    const resolver = state.resolve;
    const keydownHandler = state.keydownHandler;
    const restoreFocusEl = state.restoreFocusEl;

    state.open = false;
    state.mode = "confirm";
    state.resolve = null;
    state.keydownHandler = null;
    state.restoreFocusEl = null;
    const closeToken = ++state.closeToken;

    inputWrap.classList.add("hidden");
    input.value = "";
    input.placeholder = "";
    confirmButton.classList.remove("action-dialog__confirm-danger");

    if (typeof keydownHandler === "function") {
      document.removeEventListener("keydown", keydownHandler);
    }

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }

    const shouldAnimate = Boolean(typeof isMotionEnabled === "function" ? isMotionEnabled() : true) && !skipAnimation;
    if (!shouldAnimate) {
      finalizeVisualClose(restoreFocusEl);
    } else {
      overlay.classList.remove("is-open");
      overlay.classList.add("is-closing");
      overlay.setAttribute("aria-hidden", "true");
      state.closeTimerId = window.setTimeout(() => {
        if (closeToken !== state.closeToken) {
          return;
        }
        state.closeTimerId = null;
        finalizeVisualClose(restoreFocusEl);
      }, transitionMs);
    }

    if (typeof resolver === "function") {
      resolver(result);
    }
  }

  function open({
    mode = "confirm",
    titleText = "Подтверждение",
    messageText = "Подтвердите действие.",
    confirmLabel = "Подтвердить",
    cancelLabel = "Отмена",
    placeholder = "",
    defaultValue = "",
    danger = false,
  } = {}) {
    if (!hasSupport()) {
      return Promise.resolve({
        confirmed: false,
        value: null,
        fallback: true,
      });
    }

    if (state.open) {
      settle({ confirmed: false, value: null }, { skipAnimation: true });
    }

    const safeMode = mode === "prompt" ? "prompt" : "confirm";
    state.open = true;
    state.mode = safeMode;
    state.restoreFocusEl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    title.textContent = String(titleText || "Подтверждение");
    message.textContent = String(messageText || "Подтвердите действие.");
    cancelButton.textContent = String(cancelLabel || "Отмена");
    confirmButton.textContent = String(confirmLabel || "Подтвердить");
    confirmButton.classList.toggle("action-dialog__confirm-danger", Boolean(danger));

    const promptMode = safeMode === "prompt";
    inputWrap.classList.toggle("hidden", !promptMode);
    input.placeholder = String(placeholder || "");
    input.value = String(defaultValue ?? "");

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }

    const openToken = ++state.closeToken;
    overlay.classList.remove("hidden", "is-open", "is-closing");
    overlay.setAttribute("aria-hidden", "false");

    const shouldAnimate = Boolean(typeof isMotionEnabled === "function" ? isMotionEnabled() : true);
    if (shouldAnimate) {
      window.requestAnimationFrame(() => {
        if (!state.open || openToken !== state.closeToken) {
          return;
        }
        overlay.classList.add("is-open");
      });
    } else {
      overlay.classList.add("is-open");
    }

    return new Promise((resolve) => {
      state.resolve = resolve;

      const keydownHandler = (event) => {
        if (!state.open) {
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          settle({ confirmed: false, value: null });
          return;
        }

        if (event.key === "Enter") {
          if (state.mode !== "prompt") {
            event.preventDefault();
            settle({ confirmed: true, value: null });
            return;
          }

          const activeElement = document.activeElement;
          if (!(activeElement instanceof HTMLTextAreaElement)) {
            event.preventDefault();
            settle({
              confirmed: true,
              value: String(input.value || ""),
            });
          }
        }
      };

      state.keydownHandler = keydownHandler;
      document.addEventListener("keydown", keydownHandler);

      window.requestAnimationFrame(() => {
        if (promptMode) {
          input.focus({ preventScroll: true });
          input.select();
        } else {
          confirmButton.focus({ preventScroll: true });
        }
      });
    });
  }

  async function requestConfirm(
    messageText,
    {
      titleText = "Подтверждение",
      confirmLabel = "Подтвердить",
      cancelLabel = "Отмена",
      danger = false,
    } = {},
  ) {
    if (!hasSupport()) {
      if (typeof window.confirm === "function") {
        return window.confirm(String(messageText || "Подтвердите действие."));
      }
      return false;
    }

    const result = await open({
      mode: "confirm",
      titleText,
      messageText: String(messageText || "Подтвердите действие."),
      confirmLabel,
      cancelLabel,
      danger,
    });
    return Boolean(result?.confirmed);
  }

  async function requestText(
    messageText,
    defaultValue = "",
    {
      titleText = "Ввод значения",
      confirmLabel = "Сохранить",
      cancelLabel = "Отмена",
      placeholder = "",
      danger = false,
    } = {},
  ) {
    if (!hasSupport()) {
      if (typeof window.prompt === "function") {
        const fallback = window.prompt(String(messageText || "Введите значение:"), String(defaultValue ?? ""));
        return fallback == null ? null : String(fallback);
      }
      return null;
    }

    const result = await open({
      mode: "prompt",
      titleText,
      messageText: String(messageText || "Введите значение."),
      confirmLabel,
      cancelLabel,
      placeholder,
      defaultValue: String(defaultValue ?? ""),
      danger,
    });

    if (!result?.confirmed) {
      return null;
    }

    return String(result.value ?? "");
  }

  function bind() {
    if (!hasSupport()) {
      return;
    }

    confirmButton.addEventListener("click", () => {
      if (!state.open) {
        return;
      }
      if (state.mode === "prompt") {
        settle({
          confirmed: true,
          value: String(input.value || ""),
        });
        return;
      }
      settle({ confirmed: true, value: null });
    });

    cancelButton.addEventListener("click", () => {
      settle({ confirmed: false, value: null });
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle({ confirmed: false, value: null });
      }
    });
  }

  return {
    bind,
    requestConfirm,
    requestText,
    isOpen: () => Boolean(state.open),
  };
}
