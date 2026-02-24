import { resolveSeasonalState } from "../app/seasonalLogo.js";

const HOLIDAY_BANNER_DISMISS_KEY = "ancia.chat.holiday-banner.dismissed.v1";
const HOLIDAY_BANNER_HIDE_MS = 260;

function readDismissedHolidayInstance() {
  try {
    return String(window.localStorage.getItem(HOLIDAY_BANNER_DISMISS_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeDismissedHolidayInstance(instanceId) {
  try {
    const normalized = String(instanceId || "").trim();
    if (!normalized) {
      window.localStorage.removeItem(HOLIDAY_BANNER_DISMISS_KEY);
      return;
    }
    window.localStorage.setItem(HOLIDAY_BANNER_DISMISS_KEY, normalized);
  } catch {
    // Ignore storage write failures.
  }
}

export function createChatHolidayBannerController({ elements }) {
  let initialized = false;
  let activeHolidayInstanceId = "";
  let hideTimer = 0;

  function clearHideTimer() {
    if (!hideTimer) {
      return;
    }
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  function shouldReduceMotion() {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function hideBanner({ immediate = false } = {}) {
    if (!(elements.chatHolidayBanner instanceof HTMLElement)) {
      return;
    }
    clearHideTimer();
    const hideImmediately = immediate || shouldReduceMotion();
    if (hideImmediately) {
      elements.chatHolidayBanner.classList.remove("is-visible", "is-hiding");
      elements.chatHolidayBanner.classList.add("hidden");
      delete elements.chatHolidayBanner.dataset.holidayInstanceId;
      return;
    }

    if (elements.chatHolidayBanner.classList.contains("hidden")) {
      elements.chatHolidayBanner.classList.remove("is-visible", "is-hiding");
      delete elements.chatHolidayBanner.dataset.holidayInstanceId;
      return;
    }

    elements.chatHolidayBanner.classList.remove("is-visible");
    elements.chatHolidayBanner.classList.add("is-hiding");
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      elements.chatHolidayBanner.classList.add("hidden");
      elements.chatHolidayBanner.classList.remove("is-hiding");
      delete elements.chatHolidayBanner.dataset.holidayInstanceId;
    }, HOLIDAY_BANNER_HIDE_MS);
  }

  function revealBanner() {
    if (!(elements.chatHolidayBanner instanceof HTMLElement)) {
      return;
    }

    elements.chatHolidayBanner.classList.remove("hidden", "is-hiding");
    if (shouldReduceMotion()) {
      elements.chatHolidayBanner.classList.add("is-visible");
      return;
    }

    elements.chatHolidayBanner.classList.remove("is-visible");
    void elements.chatHolidayBanner.offsetWidth;
    elements.chatHolidayBanner.classList.add("is-visible");
  }

  function showBanner(state) {
    if (!(elements.chatHolidayBanner instanceof HTMLElement)) {
      return;
    }

    clearHideTimer();
    elements.chatHolidayBanner.classList.remove("is-hiding");
    elements.chatHolidayBanner.classList.remove("hidden");
    elements.chatHolidayBanner.classList.remove("is-visible");

    if (elements.chatHolidayBannerLogo instanceof HTMLImageElement) {
      elements.chatHolidayBannerLogo.src = String(state.logoPath || "/ancia.png");
    }
    if (elements.chatHolidayBannerTitle instanceof HTMLElement) {
      elements.chatHolidayBannerTitle.textContent = String(state.greeting || "С праздником!");
    }
    if (elements.chatHolidayBannerBody instanceof HTMLElement) {
      elements.chatHolidayBannerBody.textContent = String(state.description || "");
    }

    elements.chatHolidayBanner.dataset.holidayInstanceId = String(state.holidayInstanceId || "").trim();
    revealBanner();
  }

  function sync(date = new Date()) {
    const state = resolveSeasonalState(date);
    activeHolidayInstanceId = String(state.holidayInstanceId || "").trim();
    const dismissedInstance = readDismissedHolidayInstance();
    const shouldShow = Boolean(state.active && activeHolidayInstanceId && dismissedInstance !== activeHolidayInstanceId);

    if (!shouldShow) {
      hideBanner();
      return state;
    }

    showBanner(state);
    return state;
  }

  function dismissActiveHoliday() {
    const fallbackInstanceId = elements.chatHolidayBanner instanceof HTMLElement
      ? String(elements.chatHolidayBanner.dataset.holidayInstanceId || "").trim()
      : "";
    const targetInstanceId = String(activeHolidayInstanceId || fallbackInstanceId).trim();
    if (targetInstanceId) {
      writeDismissedHolidayInstance(targetInstanceId);
    }
    hideBanner();
  }

  function handleDismissClick(event) {
    event.preventDefault();
    dismissActiveHoliday();
  }

  function handleVisibilityChange() {
    if (document.visibilityState !== "visible") {
      return;
    }
    sync();
  }

  function initialize() {
    if (initialized) {
      sync();
      return;
    }
    initialized = true;
    elements.chatHolidayBannerDismiss?.addEventListener("click", handleDismissClick);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    sync();
  }

  return {
    initialize,
    sync,
    dismissActiveHoliday,
  };
}
