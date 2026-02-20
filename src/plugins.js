import { icon } from "./ui/icons.js";

export const pluginsPageTemplate = `
  <aside
    id="plugin-aside"
    class="page-aside glass-panel fixed inset-y-0 left-0 z-10 flex w-[84vw] max-w-[290px] -translate-x-[112%] flex-col p-3 pt-10 opacity-0 pointer-events-none transition-transform duration-300 xl:relative xl:z-10 xl:h-full xl:min-h-0 xl:w-full xl:max-w-full xl:translate-x-0 xl:opacity-100 xl:pointer-events-auto xl:pt-3"
  >
    <input
      id="plugin-search-input"
      type="search"
      aria-label="Поиск плагина"
      placeholder="Поиск плагина"
      class="rounded-3xl border border-zinc-600/30 bg-transparent p-3 text-sm text-zinc-100 outline-none transition focus:border-zinc-500/60"
    />
    <div class="mt-3 space-y-2">
      <button type="button" data-plugin-filter="all" data-active="true" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("categories", "ui-icon-lg")}<span>Все категории</span></span>
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("check", "ui-icon-lg")}<span>Установленные</span></span>
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("developer", "ui-icon-lg")}<span>Инструменты агента</span></span>
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("chat", "ui-icon-lg")}<span>Веб и браузинг</span></span>
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="flex items-center gap-3 p-3 active:scale-95 w-full rounded-3xl border border-zinc-600/30 p-3 text-left text-sm transition aria-pressed:bg-zinc-700/80 aria-pressed:font-bold">
        <span class="icon-button justify-start">${icon("settings", "ui-icon-lg")}<span>Системные интеграции</span></span>
      </button>
    </div>
    <div class="flex-grow"></div>
    <div class="mt-3 rounded-3xl border border-zinc-600/30 p-3">
      <p class="text-xs text-zinc-300">Установлено</p>
      <p id="plugins-installed-count" class="mt-1 text-2xl font-semibold text-zinc-100">0</p>
      <p id="plugins-updates-count" class="text-xs text-zinc-500">0 доступно к обновлению</p>
    </div>
  </aside>

  <main class="page-main glass-panel flex h-full min-h-0 flex-col overflow-hidden p-3 sm:p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-zinc-400">Плагины</p>
        <h1 class="text-lg font-semibold text-zinc-100 sm:text-xl">Маркетплейс плагинов</h1>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          data-open-plugin-aside
          aria-label="Категории"
          aria-controls="plugin-aside"
          aria-expanded="false"
          title="Категории"
          class="icon-button active:scale-95 h-9 w-9 rounded-full border border-zinc-600/30 bg-zinc-900/60 text-zinc-200 transition hover:bg-zinc-700/80 xl:hidden"
        >
          ${icon("categories")}
        </button>
        <button
          type="button"
          data-plugin-action="reload"
          class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-700/80"
        >
          ${icon("refresh")}
          <span>Обновить список</span>
        </button>
      </div>
    </div>

    <div class="mb-3 flex flex-wrap gap-3 xl:hidden">
      <button type="button" data-plugin-filter="all" data-active="true" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Все
      </button>
      <button type="button" data-plugin-filter="installed" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Установленные
      </button>
      <button type="button" data-plugin-filter="agent" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Агент
      </button>
      <button type="button" data-plugin-filter="web" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Веб
      </button>
      <button type="button" data-plugin-filter="system" data-active="false" class="route-pill active:scale-95 rounded-full border px-3 py-1 text-xs transition">
        Система
      </button>
    </div>

    <article id="plugins-autonomous-banner" class="hidden mb-3 rounded-3xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      Включён автономный режим: внешние запросы отключены. Показаны только установленные плагины.
    </article>

    <section id="plugins-grid" class="chat-scroll grid flex-1 min-h-0 auto-rows-max gap-3 overflow-auto pb-2 md:grid-cols-2 2xl:grid-cols-3">
      <article class="rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400 md:col-span-2 2xl:col-span-3">
        Загружаем плагины...
      </article>
    </section>
    <article id="plugin-empty-state" class="hidden mt-3 rounded-3xl border border-zinc-600/30 bg-zinc-900/60 p-5 text-center text-sm text-zinc-400">
      Ничего не найдено. Попробуйте другой запрос или сбросьте фильтр.
    </article>
  </main>
`;

const VALID_PLUGIN_FILTERS = new Set(["all", "installed", "agent", "web", "system"]);
const MARKETPLACE_TOOLS = new Set([
  "web.search.duckduckgo",
  "web.visit.website",
  "system.time",
  "chat.set_mood",
]);

const TOOL_DEFAULT_CATEGORY = {
  "web.search.duckduckgo": "web",
  "web.visit.website": "web",
  "system.time": "system",
  "chat.set_mood": "agent",
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePluginFilter(filter) {
  const normalized = String(filter || "").trim().toLowerCase();
  return VALID_PLUGIN_FILTERS.has(normalized) ? normalized : "all";
}

function normalizeBackendPlugin(rawPlugin) {
  if (!rawPlugin || typeof rawPlugin !== "object") {
    return null;
  }
  const tools = Array.isArray(rawPlugin.tools)
    ? rawPlugin.tools.map((tool) => String(tool || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const primaryTool = tools.find((tool) => MARKETPLACE_TOOLS.has(tool)) || tools[0] || "";
  const fallbackId = String(rawPlugin.id || primaryTool).trim().toLowerCase();
  if (!fallbackId) {
    return null;
  }

  const backendKeywords = Array.isArray(rawPlugin.keywords)
    ? rawPlugin.keywords.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const allKeywords = [...new Set(backendKeywords)];
  const safeTitle = String(rawPlugin.name || "").trim() || primaryTool;
  const safeSubtitle = String(rawPlugin.subtitle || rawPlugin.summary || "").trim();
  const safeDescription = String(rawPlugin.description || "").trim();

  return {
    id: fallbackId,
    tool: primaryTool || fallbackId,
    title: safeTitle,
    subtitle: safeSubtitle || safeDescription || safeTitle,
    description: safeDescription || safeSubtitle || safeTitle,
    version: String(rawPlugin.version || "1.0.0").trim() || "1.0.0",
    enabled: rawPlugin.enabled !== false,
    effectiveEnabled: rawPlugin.effective_enabled !== false,
    blockedReason: String(rawPlugin.blocked_reason || "").trim().toLowerCase(),
    installed: rawPlugin.installed !== false,
    locked: rawPlugin.locked === true,
    allowUpdate: rawPlugin.allow_update !== false,
    requiresNetwork: rawPlugin.requires_network === true,
    category: normalizePluginFilter(rawPlugin.category || TOOL_DEFAULT_CATEGORY[primaryTool] || "system"),
    homepage: String(rawPlugin.homepage || "").trim(),
    manifestUrl: String(rawPlugin.manifest_url || rawPlugin.manifestUrl || "").trim(),
    repoUrl: String(rawPlugin.repo_url || rawPlugin.repoUrl || "").trim(),
    source: String(rawPlugin.source || (rawPlugin.installed === false ? "registry" : "unknown")).trim().toLowerCase(),
    canInstall: rawPlugin.can_install === true || (rawPlugin.installed === false && Boolean(rawPlugin.manifest_url || rawPlugin.manifestUrl)),
    canUninstall: rawPlugin.can_uninstall === true,
    installable: rawPlugin.installable === true || Boolean(rawPlugin.manifest_url || rawPlugin.manifestUrl),
    registry: rawPlugin.registry === true,
    keywords: allKeywords,
  };
}

function renderPluginCard(plugin) {
  const keywords = [plugin.title, plugin.subtitle, plugin.description, ...plugin.keywords]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const isInstalled = plugin.installed !== false;
  const blockedByAutonomousMode = plugin.blockedReason === "autonomous_mode";
  const statusToneClass = !isInstalled
    ? "border-sky-500/35 bg-sky-500/15 text-sky-300"
    : blockedByAutonomousMode
      ? "border-amber-500/35 bg-amber-500/15 text-amber-300"
      : plugin.effectiveEnabled
        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
        : "border-zinc-500/30 bg-zinc-800/70 text-zinc-300";
  const badgeText = !isInstalled
    ? "доступен"
    : blockedByAutonomousMode
      ? "автономный режим"
      : plugin.enabled
        ? "включен"
        : "выключен";
  const versionText = plugin.version.startsWith("v") ? plugin.version : `v${plugin.version}`;
  const docsUrl = plugin.homepage || plugin.repoUrl;
  const homepageLink = docsUrl
    ? `<a href="${escapeHtml(docsUrl)}" target="_blank" rel="noreferrer" class="text-xs text-zinc-500 hover:text-zinc-300 transition">${plugin.homepage ? "Открыть страницу" : "Открыть репозиторий"}</a>`
    : `<span class="text-xs text-zinc-500">Системный плагин</span>`;
  const canToggle = isInstalled && !plugin.locked;
  const toggleLabel = plugin.enabled ? "Выключить" : "Включить";
  const canUpdate = isInstalled && plugin.allowUpdate !== false;
  const canInstall = !isInstalled && plugin.canInstall;
  const canUninstall = isInstalled && plugin.canUninstall;

  const actionsHtml = !isInstalled
    ? `
      <button
        type="button"
        data-plugin-action="install"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        data-plugin-manifest-url="${escapeHtml(plugin.manifestUrl)}"
        ${canInstall ? "" : "disabled"}
        class="active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700/80 ${canInstall ? "" : "opacity-60 cursor-not-allowed"}"
      >
        Установить
      </button>
    `
    : `
      <button
        type="button"
        data-plugin-action="toggle"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        data-plugin-enabled="${String(Boolean(plugin.enabled))}"
        ${canToggle ? "" : "disabled"}
        class="active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700/80 ${canToggle ? "" : "opacity-60 cursor-not-allowed"}"
      >
        ${escapeHtml(toggleLabel)}
      </button>
      <button
        type="button"
        data-plugin-action="update"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        ${canUpdate ? "" : "disabled"}
        class="active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700/80 ${canUpdate ? "" : "opacity-60 cursor-not-allowed"}"
      >
        Обновить
      </button>
      ${canUninstall ? `
      <button
        type="button"
        data-plugin-action="uninstall"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        class="active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700/80"
      >
        Удалить
      </button>
      ` : ""}
    `;

  return `
    <article
      data-plugin-card
      data-plugin-id="${escapeHtml(plugin.id)}"
      data-plugin-category="${escapeHtml(plugin.category)}"
      data-plugin-keywords="${escapeHtml(keywords)}"
      data-plugin-installed="${String(Boolean(plugin.installed))}"
      data-plugin-enabled="${String(Boolean(plugin.enabled))}"
      class="plugin-card rounded-3xl border border-zinc-600/30 p-3"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-zinc-100">${escapeHtml(plugin.title)}</h3>
          <p class="mt-1 text-xs text-zinc-400">${escapeHtml(plugin.subtitle)}</p>
        </div>
        <span class="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${statusToneClass}">
          ${escapeHtml(badgeText)}
        </span>
      </div>
      <p class="mt-3 text-sm leading-6 text-zinc-300">${escapeHtml(plugin.description)}</p>
      <div class="mt-3 flex items-center justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-xs text-zinc-500">${escapeHtml(versionText)}</span>
          ${homepageLink}
        </div>
        <div class="flex items-center gap-2">
          ${actionsHtml}
        </div>
      </div>
    </article>
  `;
}

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
      const updatable = installedPlugins.filter((plugin) => plugin.allowUpdate).length;
      updatesCountNode.textContent = `${updatable} доступно к обновлению`;
    }
  }

  function applyPluginFilters() {
    const pluginCards = pluginGrid
      ? [...pluginGrid.querySelectorAll("[data-plugin-card]")]
      : [];
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
      autonomousMode = Boolean(
        installedPayload?.autonomous_mode
        ?? registryPayload?.autonomous_mode,
      );
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

  async function handlePluginToggle(button) {
    const pluginId = String(button.dataset.pluginId || "").trim();
    const pluginName = String(button.dataset.pluginName || "плагин").trim();
    const enabledNow = String(button.dataset.pluginEnabled || "").toLowerCase() === "true";
    if (!pluginId) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const previousText = button.textContent || (enabledNow ? "Выключить" : "Включить");
    button.textContent = enabledNow ? "Выключение..." : "Включение...";
    try {
      if (enabledNow) {
        await backendClient.disablePlugin(pluginId);
      } else {
        await backendClient.enablePlugin(pluginId);
      }
      pushToast(
        enabledNow
          ? `Плагин «${pluginName}» выключен.`
          : `Плагин «${pluginName}» включен.`,
        { tone: "success" },
      );
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось изменить «${pluginName}»: ${error.message}`, {
        tone: "error",
        durationMs: 3600,
      });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = previousText;
    }
  }

  async function handlePluginInstall(button) {
    const pluginId = String(button.dataset.pluginId || "").trim();
    const pluginName = String(button.dataset.pluginName || "плагин").trim();
    const manifestUrl = String(button.dataset.pluginManifestUrl || "").trim();
    if (!pluginId) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const previousText = button.textContent || "Установить";
    button.textContent = "Установка...";
    try {
      const payload = manifestUrl
        ? { id: pluginId, manifest_url: manifestUrl }
        : { id: pluginId };
      await backendClient.installPlugin(payload);
      pushToast(`Плагин «${pluginName}» установлен.`, { tone: "success" });
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось установить «${pluginName}»: ${error.message}`, {
        tone: "error",
        durationMs: 3800,
      });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = previousText;
    }
  }

  async function handlePluginUninstall(button) {
    const pluginId = String(button.dataset.pluginId || "").trim();
    const pluginName = String(button.dataset.pluginName || "плагин").trim();
    if (!pluginId) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const previousText = button.textContent || "Удалить";
    button.textContent = "Удаление...";
    try {
      await backendClient.uninstallPlugin(pluginId);
      pushToast(`Плагин «${pluginName}» удален.`, { tone: "success" });
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось удалить «${pluginName}»: ${error.message}`, {
        tone: "error",
        durationMs: 3800,
      });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = previousText;
    }
  }

  async function handlePluginUpdate(button) {
    const pluginId = String(button.dataset.pluginId || "").trim();
    const pluginName = String(button.dataset.pluginName || "плагин").trim();
    if (!pluginId) {
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const previousText = button.textContent || "Обновить";
    button.textContent = "Обновление...";
    try {
      await backendClient.updatePlugin(pluginId);
      pushToast(`Плагин «${pluginName}» обновлен.`, { tone: "success" });
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось обновить «${pluginName}»: ${error.message}`, {
        tone: "error",
        durationMs: 3600,
      });
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.textContent = previousText;
    }
  }

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
        await handlePluginInstall(installButton);
        return;
      }
      const uninstallButton = target.closest("[data-plugin-action='uninstall']");
      if (uninstallButton instanceof HTMLButtonElement) {
        await handlePluginUninstall(uninstallButton);
        return;
      }
      const toggleButton = target.closest("[data-plugin-action='toggle']");
      if (toggleButton instanceof HTMLButtonElement) {
        await handlePluginToggle(toggleButton);
        return;
      }
      const updateButton = target.closest("[data-plugin-action='update']");
      if (!(updateButton instanceof HTMLButtonElement)) {
        return;
      }
      await handlePluginUpdate(updateButton);
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
