export function createSettingsSectionController({
  buttons,
  sections,
  titleNode,
  searchEmptyNode,
  isMotionEnabled,
  transitionMs,
  validSections,
  titlesMap,
  initialSection = "personalization",
}) {
  let currentSection = normalizeSection(initialSection);
  let transitionToken = 0;

  function normalizeSection(section) {
    const normalized = String(section || "").trim().toLowerCase();
    return validSections.has(normalized) ? normalized : "personalization";
  }

  function syncTitle(section) {
    if (!titleNode) {
      return;
    }
    const safeSection = normalizeSection(section);
    titleNode.textContent = titlesMap[safeSection] || titlesMap.personalization;
  }

  function applySection(section, { animate = true } = {}) {
    const nextSection = normalizeSection(section);
    const prevSection = currentSection;
    currentSection = nextSection;
    syncTitle(nextSection);
    const shouldAnimate = animate && isMotionEnabled() && prevSection !== nextSection;
    const localTransitionId = ++transitionToken;
    const isCurrentTransition = () => localTransitionId === transitionToken;

    buttons.forEach((button) => {
      const isActive = button.dataset.settingsSectionTarget === nextSection;
      button.dataset.active = String(isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    sections.forEach((panel) => {
      const isVisible = panel.dataset.settingsSection === nextSection;
      if (!shouldAnimate) {
        panel.classList.remove("settings-section-enter", "settings-section-leave");
        panel.classList.toggle("hidden", !isVisible);
        panel.setAttribute("aria-hidden", String(!isVisible));
        return;
      }

      if (!isVisible) {
        panel.classList.remove("settings-section-enter", "settings-section-leave");
        panel.classList.add("hidden");
        panel.setAttribute("aria-hidden", "true");
        return;
      }

      panel.classList.remove("hidden", "settings-section-leave", "settings-section-enter");
      panel.setAttribute("aria-hidden", "false");
      void panel.offsetWidth;
      panel.classList.add("settings-section-enter");
      window.setTimeout(() => {
        if (!isCurrentTransition()) {
          return;
        }
        panel.classList.remove("settings-section-enter");
      }, transitionMs);
    });
  }

  function applyFilter(query = "") {
    const normalizedQuery = String(query).trim().toLowerCase();
    let visibleCount = 0;

    buttons.forEach((button) => {
      const label = button.textContent?.toLowerCase() || "";
      const isVisible = !normalizedQuery || label.includes(normalizedQuery);
      button.classList.toggle("hidden", !isVisible);
      button.setAttribute("aria-hidden", String(!isVisible));
      if (isVisible) {
        visibleCount += 1;
      }
    });

    if (searchEmptyNode) {
      searchEmptyNode.classList.toggle("hidden", visibleCount > 0);
    }

    if (visibleCount > 0) {
      const activeButtonVisible = buttons.some((button) => (
        button.dataset.settingsSectionTarget === currentSection
        && !button.classList.contains("hidden")
      ));

      if (!activeButtonVisible) {
        const firstVisible = buttons.find((button) => !button.classList.contains("hidden"));
        if (firstVisible) {
          applySection(firstVisible.dataset.settingsSectionTarget, { animate: false });
        }
      }
    }
  }

  return {
    applySection,
    applyFilter,
    getCurrentSection: () => currentSection,
    normalizeSection,
    syncTitle,
  };
}
