export function createLinkOverlayManager({
  overlay,
  urlNode,
  frame,
  fallback,
  fallbackButton,
  openButton,
  closeButton,
  isMotionEnabled,
  openInBrowser,
  inspectLink,
  closeMs = 220,
} = {}) {
  const state = {
    closeTimerId: null,
    closeToken: 0,
    frameLoadHandler: null,
    frameErrorHandler: null,
    fallbackTimerId: null,
    openStartedAt: 0,
    targetUrl: "",
    targetIsCrossOrigin: true,
  };
  const fallbackSubNode = fallback?.querySelector?.(".link-overlay__fallback-sub") || null;
  const defaultFallbackSubText = fallbackSubNode instanceof HTMLElement
    ? String(fallbackSubNode.textContent || "").trim()
    : "";

  function clearFallbackTimer() {
    if (state.fallbackTimerId != null) {
      window.clearTimeout(state.fallbackTimerId);
      state.fallbackTimerId = null;
    }
  }

  function clearFrameHandlers() {
    if (state.frameLoadHandler) {
      frame?.removeEventListener("load", state.frameLoadHandler);
      state.frameLoadHandler = null;
    }
    if (state.frameErrorHandler) {
      frame?.removeEventListener("error", state.frameErrorHandler);
      state.frameErrorHandler = null;
    }
  }

  function resolveFrameHref() {
    if (state.targetIsCrossOrigin) {
      return "__cross_origin__";
    }
    try {
      return String(frame?.contentDocument?.location?.href || "");
    } catch {
      // Cross-origin loaded successfully; content is not readable by this origin.
      return "__cross_origin__";
    }
  }

  function isCrossOriginUrl(url) {
    try {
      const target = new URL(String(url || ""), window.location.href);
      return target.origin !== window.location.origin;
    } catch {
      return true;
    }
  }

  function hasSupport() {
    return Boolean(overlay && urlNode && frame);
  }

  function isOpen() {
    return hasSupport() && overlay.classList.contains("is-open");
  }

  function showFallback(reason = "") {
    if (fallbackSubNode instanceof HTMLElement) {
      fallbackSubNode.textContent = String(reason || "").trim() || defaultFallbackSubText;
    }
    fallback?.classList.remove("hidden");
  }

  function hideFallback() {
    fallback?.classList.add("hidden");
    if (fallbackSubNode instanceof HTMLElement) {
      fallbackSubNode.textContent = defaultFallbackSubText;
    }
  }

  function open(url) {
    if (!hasSupport()) {
      return;
    }

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }
    clearFallbackTimer();
    clearFrameHandlers();

    ++state.closeToken;
    state.openStartedAt = Date.now();
    state.targetUrl = String(url || "");
    state.targetIsCrossOrigin = isCrossOriginUrl(state.targetUrl);
    urlNode.textContent = state.targetUrl;
    hideFallback();

    const openToken = state.closeToken;
    const scheduleFallbackCheck = (delayMs = 1400) => {
      clearFallbackTimer();
      state.fallbackTimerId = window.setTimeout(() => {
        if (openToken !== state.closeToken || !isOpen()) {
          return;
        }
        const href = resolveFrameHref();
        if (href === "" || href === "about:blank") {
          showFallback();
        } else {
          hideFallback();
        }
      }, delayMs);
    };

    const loadHandler = () => {
      if (openToken !== state.closeToken) {
        return;
      }

      const href = resolveFrameHref();
      if (href === "__cross_origin__") {
        clearFallbackTimer();
        hideFallback();
        return;
      }

      if (href === "" || href === "about:blank") {
        // Ignore transient blank loads while navigation is still in progress.
        const elapsed = Date.now() - state.openStartedAt;
        if (elapsed < 900) {
          scheduleFallbackCheck(1200);
          return;
        }
        showFallback();
        return;
      }

      clearFallbackTimer();
      hideFallback();
    };

    const errorHandler = () => {
      if (openToken !== state.closeToken) {
        return;
      }
      clearFallbackTimer();
      showFallback();
    };

    state.frameLoadHandler = loadHandler;
    state.frameErrorHandler = errorHandler;
    frame.addEventListener("load", loadHandler);
    frame.addEventListener("error", errorHandler);
    frame.src = state.targetUrl;
    if (!state.targetIsCrossOrigin) {
      scheduleFallbackCheck(1800);
    }
    if (typeof inspectLink === "function") {
      Promise.resolve(inspectLink(state.targetUrl))
        .then((result) => {
          if (openToken !== state.closeToken || !isOpen() || !result || typeof result !== "object") {
            return;
          }
          const blocked = Boolean(result.blocked);
          if (blocked) {
            clearFallbackTimer();
            showFallback(String(result.reason || "").trim());
          } else {
            hideFallback();
          }
        })
        .catch(() => {
          // Не блокируем UI, если проверка заголовков недоступна.
        });
    }

    overlay.classList.remove("hidden", "is-closing");
    overlay.setAttribute("aria-hidden", "false");

    const shouldAnimate = Boolean(typeof isMotionEnabled === "function" ? isMotionEnabled() : true);
    if (shouldAnimate) {
      window.requestAnimationFrame(() => {
        overlay.classList.add("is-open");
      });
    } else {
      overlay.classList.add("is-open");
    }
  }

  function close() {
    if (!isOpen()) {
      return;
    }

    clearFrameHandlers();
    clearFallbackTimer();
    hideFallback();

    const closeToken = ++state.closeToken;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");

    const shouldAnimate = Boolean(typeof isMotionEnabled === "function" ? isMotionEnabled() : true);
    if (shouldAnimate) {
      overlay.classList.add("is-closing");
      state.closeTimerId = window.setTimeout(() => {
        if (closeToken !== state.closeToken) {
          return;
        }
        state.closeTimerId = null;
        overlay.classList.remove("is-closing");
        overlay.classList.add("hidden");
        frame.src = "";
      }, closeMs);
    } else {
      overlay.classList.remove("is-closing");
      overlay.classList.add("hidden");
      frame.src = "";
    }
  }

  function openCurrentUrlInBrowser() {
    const url = String(urlNode?.textContent || "").trim();
    if (!url) {
      return;
    }
    if (typeof openInBrowser === "function") {
      openInBrowser(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function bind() {
    closeButton?.addEventListener("click", close);
    openButton?.addEventListener("click", openCurrentUrlInBrowser);
    fallbackButton?.addEventListener("click", openCurrentUrlInBrowser);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        event.stopPropagation();
        close();
      }
    });

    document.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor) {
        return;
      }
      const href = anchor.getAttribute("href");
      if (!href || !/^https?:\/\//i.test(href)) {
        return;
      }
      event.preventDefault();
      open(href);
    }, true);
  }

  return {
    bind,
    open,
    close,
    isOpen,
  };
}
