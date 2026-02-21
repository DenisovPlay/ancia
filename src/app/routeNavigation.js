export function createRouteNavigationController({
  elements,
  routeButtons,
  normalizeRoute,
  isMotionEnabled,
  routeTransitionMs,
  routeLabelByTarget,
  closeAllMobilePanels,
  getChatFeature,
  getSettingsFeature,
  getModelsFeature,
}) {
  let routeTransitionToken = 0;

  function updateRouteButtons(route) {
    routeButtons.forEach((button) => {
      const isActive = button.dataset.routeTarget === route;
      button.dataset.active = String(isActive);
      button.setAttribute("aria-pressed", String(isActive));
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });

    if (elements.titlebarRouteChip) {
      elements.titlebarRouteChip.textContent = (routeLabelByTarget[route] || route).toLowerCase();
    }
  }

  function applyRoute(route, { animate = true } = {}) {
    getChatFeature()?.closeContextMenu();
    const currentRoute = normalizeRoute(route);
    const previousRouteRaw = document.body.dataset.route;
    const previousRoute = previousRouteRaw ? normalizeRoute(previousRouteRaw) : null;
    const shouldAnimate = animate && isMotionEnabled() && previousRoute && previousRoute !== currentRoute;
    const transitionId = ++routeTransitionToken;
    const isCurrentTransition = () => transitionId === routeTransitionToken;

    document.body.dataset.route = currentRoute;
    updateRouteButtons(currentRoute);

    const setPageVisibility = (element, isVisible) => {
      if (!element) {
        return;
      }
      if (!shouldAnimate) {
        element.classList.remove("route-page-enter", "route-page-leave");
        element.classList.toggle("hidden", !isVisible);
        element.style.display = isVisible ? "" : "none";
        element.setAttribute("aria-hidden", String(!isVisible));
        return;
      }

      if (isVisible) {
        element.classList.remove("hidden", "route-page-leave");
        element.style.display = "";
        element.setAttribute("aria-hidden", "false");
        void element.offsetWidth;
        element.classList.add("route-page-enter");
        window.setTimeout(() => {
          if (!isCurrentTransition()) {
            return;
          }
          element.classList.remove("route-page-enter");
        }, routeTransitionMs);
        return;
      }

      const isLeaving = previousRoute && element.dataset.routePage === previousRoute;
      if (!isLeaving) {
        element.classList.add("hidden");
        element.style.display = "none";
        element.setAttribute("aria-hidden", "true");
        element.classList.remove("route-page-enter", "route-page-leave");
        return;
      }

      element.classList.remove("route-page-enter");
      element.classList.add("route-page-leave");
      window.setTimeout(() => {
        if (!isCurrentTransition()) {
          return;
        }
        element.classList.add("hidden");
        element.style.display = "none";
        element.setAttribute("aria-hidden", "true");
        element.classList.remove("route-page-leave");
      }, routeTransitionMs);
    };

    setPageVisibility(elements.pageChat, currentRoute === "chat");
    setPageVisibility(elements.pageModels, currentRoute === "models");
    setPageVisibility(elements.pagePlugins, currentRoute === "plugins");
    setPageVisibility(elements.pageSettings, currentRoute === "settings");

    if (currentRoute === "settings") {
      getSettingsFeature()?.applyCurrentSection({ animate });
    }
    if (currentRoute === "models") {
      void getModelsFeature()?.reload?.();
    }

    getChatFeature()?.applyContextualBackground({
      transitionMs: animate ? 860 : 0,
      immediate: !animate,
    });
    closeAllMobilePanels();
  }

  function navigateToRoute(route) {
    const nextRoute = normalizeRoute(route);
    const nextHash = `#${nextRoute}`;

    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
      return;
    }

    applyRoute(nextRoute);
  }

  return {
    applyRoute,
    navigateToRoute,
  };
}
