export function createModalOverlayManager({
  overlay,
  isMotionEnabled,
  transitionMs = 200,
} = {}) {
  const state = {
    open: false,
    closeTimerId: null,
    token: 0,
    restoreFocusEl: null,
  };

  function hasSupport() {
    return overlay instanceof HTMLElement;
  }

  function clearCloseTimer() {
    if (state.closeTimerId == null) {
      return;
    }
    window.clearTimeout(state.closeTimerId);
    state.closeTimerId = null;
  }

  function resolveShouldAnimate(skipAnimation = false) {
    if (skipAnimation) {
      return false;
    }
    return Boolean(typeof isMotionEnabled === "function" ? isMotionEnabled() : true);
  }

  function resolveRestoreFocusTarget(focusRestoreEl) {
    if (focusRestoreEl !== undefined) {
      return focusRestoreEl;
    }
    return state.restoreFocusEl;
  }

  function restoreFocus(target) {
    if (!(target instanceof HTMLElement)) {
      return;
    }
    window.requestAnimationFrame(() => {
      try {
        target.focus({ preventScroll: true });
      } catch {
        // Ignore stale or detached focus targets.
      }
    });
  }

  function finalizeClose({
    restoreFocusOnClose = true,
    focusRestoreEl,
  } = {}) {
    if (!hasSupport()) {
      return;
    }

    const restoreTarget = resolveRestoreFocusTarget(focusRestoreEl);
    state.restoreFocusEl = null;
    overlay.classList.remove("is-open", "is-closing");
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");

    if (restoreFocusOnClose) {
      restoreFocus(restoreTarget);
    }
  }

  function open({
    captureFocus = true,
    focusRestoreEl,
  } = {}) {
    if (!hasSupport()) {
      return false;
    }

    clearCloseTimer();
    const openToken = ++state.token;
    state.open = true;
    if (captureFocus) {
      state.restoreFocusEl = focusRestoreEl !== undefined
        ? focusRestoreEl
        : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    } else if (focusRestoreEl !== undefined) {
      state.restoreFocusEl = focusRestoreEl;
    }

    overlay.classList.remove("hidden", "is-open", "is-closing");
    overlay.setAttribute("aria-hidden", "false");

    if (resolveShouldAnimate(false)) {
      window.requestAnimationFrame(() => {
        if (!state.open || openToken !== state.token) {
          return;
        }
        overlay.classList.add("is-open");
      });
    } else {
      overlay.classList.add("is-open");
    }
    return true;
  }

  function close({
    skipAnimation = false,
    restoreFocusOnClose = true,
    focusRestoreEl,
  } = {}) {
    if (!hasSupport()) {
      return false;
    }

    state.open = false;
    const closeToken = ++state.token;
    clearCloseTimer();

    if (!resolveShouldAnimate(skipAnimation)) {
      finalizeClose({ restoreFocusOnClose, focusRestoreEl });
      return true;
    }

    overlay.classList.remove("is-open");
    overlay.classList.add("is-closing");
    overlay.setAttribute("aria-hidden", "true");
    state.closeTimerId = window.setTimeout(() => {
      if (closeToken !== state.token) {
        return;
      }
      state.closeTimerId = null;
      finalizeClose({ restoreFocusOnClose, focusRestoreEl });
    }, transitionMs);
    return true;
  }

  function isOpen() {
    if (!hasSupport()) {
      return false;
    }
    return state.open || overlay.classList.contains("is-open");
  }

  return {
    hasSupport,
    open,
    close,
    isOpen,
  };
}
