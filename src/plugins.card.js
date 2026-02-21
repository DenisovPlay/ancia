import { icon } from "./ui/icons.js";

export const VALID_PLUGIN_FILTERS = new Set(["all", "installed", "agent", "web", "system"]);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizePluginFilter(filter) {
  const normalized = String(filter || "").trim().toLowerCase();
  return VALID_PLUGIN_FILTERS.has(normalized) ? normalized : "all";
}

export function normalizeBackendPlugin(rawPlugin) {
  if (!rawPlugin || typeof rawPlugin !== "object") {
    return null;
  }

  const tools = Array.isArray(rawPlugin.tools)
    ? rawPlugin.tools.map((tool) => String(tool || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const primaryTool = tools[0] || "";
  const fallbackId = String(rawPlugin.id || primaryTool).trim().toLowerCase();
  if (!fallbackId) {
    return null;
  }

  const backendKeywords = Array.isArray(rawPlugin.keywords)
    ? rawPlugin.keywords.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const allKeywords = [...new Set(backendKeywords)];
  const safeTitle = String(rawPlugin.name || "").trim() || primaryTool;
  const safeSubtitle = String(rawPlugin.subtitle ?? rawPlugin.summary ?? "").trim();
  const safeDescription = String(rawPlugin.description || "").trim();

  return {
    id: fallbackId,
    tool: primaryTool || fallbackId,
    title: safeTitle,
    subtitle: safeSubtitle,
    description: safeDescription || safeSubtitle || safeTitle,
    version: String(rawPlugin.version || "1.0.0").trim() || "1.0.0",
    enabled: rawPlugin.enabled !== false,
    effectiveEnabled: rawPlugin.effective_enabled !== false,
    blockedReason: String(rawPlugin.blocked_reason || "").trim().toLowerCase(),
    installed: rawPlugin.installed !== false,
    locked: rawPlugin.locked === true,
    allowUpdate: rawPlugin.allow_update !== false,
    requiresNetwork: rawPlugin.requires_network === true,
    category: normalizePluginFilter(rawPlugin.category || "system"),
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

export function renderPluginCard(plugin) {
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
      class="plugin-card rounded-3xl border border-zinc-600/30 p-3 flex flex-col h-full"
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
      <div class="flex-grow flex-shrink-0"></div>
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
