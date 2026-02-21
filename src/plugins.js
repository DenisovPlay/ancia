import { createPluginActions } from "./plugins.actions.js";
import {
  normalizeBackendPlugin,
  normalizePluginFilter,
  renderPluginCard,
} from "./plugins.card.js";
import { pluginsPageTemplate } from "./plugins.template.js";

export { pluginsPageTemplate };

export function createPluginsFeature({
  elements,
  pushToast,
  backendClient,
}) {
  const pluginFilterButtons = [...document.querySelectorAll("[data-plugin-filter]")];
  const pluginGrid = document.querySelector("#plugins-grid");
  const pluginReloadButton = document.querySelector("[data-plugin-action='reload']");
  const installedCountNode = document.querySelector("#plugins-installed-count");
  const updatesCountNode = document.querySelector("#plugins-updates-count");
  const autonomousBannerNode = document.querySelector("#plugins-autonomous-banner");

  let activePluginFilter = "all";
  let eventsBound = false;
  let loadingPlugins = false;
  let plugins = [];
  let autonomousMode = false;

  function updateStats() {
    const installedPlugins = plugins.filter((plugin) => plugin.installed !== false);
    if (installedCountNode) {
      installedCountNode.textContent = String(installedPlugins.length);
    }
    if (updatesCountNode) {
      const updatableCount = installedPlugins.filter((plugin) => plugin.allowUpdate).length;
      updatesCountNode.textContent = `${updatableCount} доступно к обновлению`;
    }
  }

  function applyPluginFilters() {
    const pluginCards = pluginGrid ? [...pluginGrid.querySelectorAll("[data-plugin-card]")] : [];
    const searchTerm = String(elements.pluginSearchInput?.value || "").trim().toLowerCase();
    let visibleCards = 0;

    const effectiveFilter = autonomousMode ? "installed" : activePluginFilter;

    pluginCards.forEach((card) => {
      const cardCategory = normalizePluginFilter(card.dataset.pluginCategory);
      const cardKeywords = String(card.dataset.pluginKeywords || "").toLowerCase();
      const cardText = card.textContent?.toLowerCase() || "";
      const installed = String(card.dataset.pluginInstalled || "").toLowerCase() === "true";
      const matchFilter = effectiveFilter === "all"
        ? true
        : effectiveFilter === "installed"
          ? installed
          : cardCategory === effectiveFilter;
      const matchSearch = !searchTerm || cardKeywords.includes(searchTerm) || cardText.includes(searchTerm);
      const shouldShow = matchFilter && matchSearch && (!autonomousMode || installed);

      card.classList.toggle("hidden", !shouldShow);
      card.setAttribute("aria-hidden", String(!shouldShow));
      if (shouldShow) {
        visibleCards += 1;
      }
    });

    pluginFilterButtons.forEach((button) => {
      const filter = normalizePluginFilter(button.dataset.pluginFilter);
      const isActive = filter === effectiveFilter;
      button.dataset.active = String(isActive);
      button.setAttribute("aria-pressed", String(isActive));
      const blockedByAutonomous = autonomousMode && filter !== "installed" && filter !== "all";
      button.classList.toggle("opacity-60", blockedByAutonomous);
      button.setAttribute("aria-disabled", String(blockedByAutonomous));
    });

    if (autonomousBannerNode) {
      autonomousBannerNode.classList.toggle("hidden", !autonomousMode);
    }

    if (elements.pluginEmptyState) {
      elements.pluginEmptyState.classList.toggle("hidden", visibleCards > 0 || loadingPlugins);
    }
  }

  function renderPluginGrid() {
    if (!pluginGrid) {
      return;
    }

    if (loadingPlugins) {
      pluginGrid.innerHTML = `
        <article class="rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400 md:col-span-2 2xl:col-span-3">
          Загружаем плагины...
        </article>
      `;
      applyPluginFilters();
      return;
    }

    if (plugins.length === 0) {
      pluginGrid.innerHTML = "";
      applyPluginFilters();
      return;
    }

    pluginGrid.innerHTML = plugins.map(renderPluginCard).join("\n");
    applyPluginFilters();
  }

  async function loadPlugins() {
    if (loadingPlugins) {
      return;
    }

    loadingPlugins = true;
    renderPluginGrid();

    try {
      const [installedPayload, registryPayload] = await Promise.all([
        backendClient.listPlugins(),
        backendClient.listPluginRegistry().catch(() => null),
      ]);

      autonomousMode = Boolean(installedPayload?.autonomous_mode ?? registryPayload?.autonomous_mode);

      const sourceItems = Array.isArray(registryPayload?.plugins) && registryPayload.plugins.length > 0
        ? registryPayload.plugins
        : (Array.isArray(installedPayload?.plugins) ? installedPayload.plugins : []);

      const nextPlugins = sourceItems
        .map(normalizeBackendPlugin)
        .filter(Boolean);

      const byId = new Map();
      nextPlugins.forEach((plugin) => {
        byId.set(plugin.id, plugin);
      });
      plugins = [...byId.values()];

      const registryError = String(registryPayload?.registry_error || "").trim();
      if (registryError && !autonomousMode) {
        pushToast(`Реестр плагинов недоступен: ${registryError}`, {
          tone: "warning",
          durationMs: 3200,
        });
      }

      if (autonomousMode) {
        activePluginFilter = "installed";
      }
    } catch (error) {
      pushToast(`Не удалось получить плагины с сервера: ${error.message}`, {
        tone: "warning",
        durationMs: 3200,
      });
    } finally {
      loadingPlugins = false;
      updateStats();
      renderPluginGrid();
    }
  }

  const pluginActions = createPluginActions({
    backendClient,
    pushToast,
    reloadPlugins: loadPlugins,
  });

  function bindEvents() {
    if (eventsBound) {
      return;
    }
    eventsBound = true;

    pluginFilterButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const nextFilter = normalizePluginFilter(button.dataset.pluginFilter);
        if (autonomousMode && nextFilter !== "installed" && nextFilter !== "all") {
          return;
        }
        activePluginFilter = nextFilter;
        applyPluginFilters();
      });
    });

    elements.pluginSearchInput?.addEventListener("input", () => {
      applyPluginFilters();
    });

    pluginReloadButton?.addEventListener("click", async () => {
      await loadPlugins();
      pushToast("Список плагинов обновлен.", { tone: "success" });
    });

    pluginGrid?.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const installButton = target.closest("[data-plugin-action='install']");
      if (installButton instanceof HTMLButtonElement) {
        await pluginActions.handlePluginInstall(installButton);
        return;
      }

      const uninstallButton = target.closest("[data-plugin-action='uninstall']");
      if (uninstallButton instanceof HTMLButtonElement) {
        await pluginActions.handlePluginUninstall(uninstallButton);
        return;
      }

      const toggleButton = target.closest("[data-plugin-action='toggle']");
      if (toggleButton instanceof HTMLButtonElement) {
        await pluginActions.handlePluginToggle(toggleButton);
        return;
      }

      const updateButton = target.closest("[data-plugin-action='update']");
      if (!(updateButton instanceof HTMLButtonElement)) {
        return;
      }
      await pluginActions.handlePluginUpdate(updateButton);
    });
  }

  function initialize() {
    bindEvents();
    updateStats();
    renderPluginGrid();
    void loadPlugins();
  }

  return {
    initialize,
    applyPluginFilters,
    reload: loadPlugins,
  };
}
