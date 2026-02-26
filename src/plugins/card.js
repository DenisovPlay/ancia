import { icon } from "../ui/icons.js";

export const VALID_PLUGIN_FILTERS = new Set(["all", "installed", "agent", "web", "system"]);
export const VALID_PLUGIN_PERMISSION_POLICIES = new Set(["allow", "ask", "deny"]);
export const PLUGIN_PERMISSION_POLICY_LABELS = {
  allow: "разрешено",
  ask: "спрашивать",
  deny: "запрещено",
};
export const PLUGIN_PERMISSION_POLICY_OPTION_LABELS = {
  allow: "Разрешено",
  ask: "Спрашивать",
  deny: "Запрещено",
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizePluginFilter(filter) {
  const normalized = String(filter || "").trim().toLowerCase();
  return VALID_PLUGIN_FILTERS.has(normalized) ? normalized : "all";
}

export function normalizePluginPermissionPolicy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_PLUGIN_PERMISSION_POLICIES.has(normalized) ? normalized : "allow";
}

function normalizeToolPermissionMap(rawMap, tools = [], fallback = "allow") {
  const source = rawMap && typeof rawMap === "object" ? rawMap : {};
  const safeFallback = normalizePluginPermissionPolicy(fallback);
  const toolSet = new Set(
    (Array.isArray(tools) ? tools : [])
      .map((toolName) => String(toolName || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const normalized = {};
  toolSet.forEach((toolName) => {
    normalized[toolName] = normalizePluginPermissionPolicy(source[toolName], safeFallback);
  });
  return normalized;
}

export function getPluginPermissionPolicyLabel(value, { option = false } = {}) {
  const policy = normalizePluginPermissionPolicy(value);
  if (option) {
    return PLUGIN_PERMISSION_POLICY_OPTION_LABELS[policy] || PLUGIN_PERMISSION_POLICY_OPTION_LABELS.allow;
  }
  return PLUGIN_PERMISSION_POLICY_LABELS[policy] || PLUGIN_PERMISSION_POLICY_LABELS.allow;
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

  const permissionPolicy = normalizePluginPermissionPolicy(rawPlugin.permission_policy || rawPlugin.permissionPolicy);
  const toolPermissionPolicies = normalizeToolPermissionMap(
    rawPlugin.tool_permission_policies || rawPlugin.toolPermissionPolicies,
    tools,
    permissionPolicy,
  );

  return {
    id: fallbackId,
    tool: primaryTool || fallbackId,
    tools,
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
    permissionPolicy,
    toolPermissionPolicies,
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
    ? "border-sky-900/50 bg-sky-950/40 text-sky-400"
    : blockedByAutonomousMode
      ? "border-amber-900/50 bg-amber-950/40 text-amber-400"
      : plugin.effectiveEnabled
        ? "border-emerald-900/50 bg-emerald-950/40 text-emerald-400"
        : "border-zinc-800 bg-zinc-900 text-zinc-400";
  const badgeText = !isInstalled
    ? "доступен"
    : blockedByAutonomousMode
      ? "автономный режим"
      : plugin.enabled
        ? "включен"
        : "выключен";

  const versionText = plugin.version.startsWith("v") ? plugin.version : `v${plugin.version}`;
  const docsUrl = sanitizeExternalUrl(plugin.homepage || plugin.repoUrl);
  const homepageLink = docsUrl
    ? `<a href="${escapeHtml(docsUrl)}" target="_blank" rel="noopener noreferrer" class="text-xs text-zinc-500 hover:text-zinc-300">${plugin.homepage ? "Открыть страницу" : "Открыть репозиторий"}</a>`
    : `<span class="text-xs text-zinc-600">Системный плагин</span>`;

  const canToggle = isInstalled && !plugin.locked;
  const toggleLabel = plugin.enabled ? "Выключить" : "Включить";
  const canUpdate = isInstalled && plugin.allowUpdate !== false;
  const canInstall = !isInstalled && plugin.canInstall;
  const canUninstall = isInstalled && plugin.canUninstall;
  const btnCls = "active:scale-95 duration-300 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800";
  const btnDisabled = "opacity-50 cursor-not-allowed";

  const actionsHtml = !isInstalled
    ? `
      <button
        type="button"
        data-plugin-action="install"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        data-plugin-manifest-url="${escapeHtml(plugin.manifestUrl)}"
        ${canInstall ? "" : "disabled"}
        class="${btnCls} ${canInstall ? "" : btnDisabled}"
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
        class="${btnCls} ${canToggle ? "" : btnDisabled}"
      >
        ${escapeHtml(toggleLabel)}
      </button>
      <button
        type="button"
        data-plugin-action="update"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        ${canUpdate ? "" : "disabled"}
        class="${btnCls} ${canUpdate ? "" : btnDisabled}"
      >
        Обновить
      </button>
      ${canUninstall ? `
      <button
        type="button"
        data-plugin-action="uninstall"
        data-plugin-id="${escapeHtml(plugin.id)}"
        data-plugin-name="${escapeHtml(plugin.title)}"
        class="${btnCls}"
      >
        Удалить
      </button>
      ` : ""}
    `;

  const permissionLabel = getPluginPermissionPolicyLabel(plugin.permissionPolicy, { option: true });
  const toolCount = Array.isArray(plugin.tools) ? plugin.tools.length : 0;
  const permissionSummary = isInstalled
    ? `
      <div class="flex items-center justify-between rounded-md border border-zinc-800/80 bg-zinc-950/40 px-2 py-1.5">
        <span class="text-[10px] uppercase tracking-wide text-zinc-500">Разрешения</span>
        <span class="text-[11px] text-zinc-300">${escapeHtml(permissionLabel)} • ${toolCount} инструментов</span>
      </div>
    `
    : "";
  const permissionsButton = isInstalled
    ? `
      <button
        type="button"
        data-plugin-action="open-permissions"
        data-plugin-id="${escapeHtml(plugin.id)}"
        class="${btnCls}"
      >
        Разрешения
      </button>
    `
    : "";

  return `
    <article
      data-plugin-card
      data-plugin-id="${escapeHtml(plugin.id)}"
      data-plugin-category="${escapeHtml(plugin.category)}"
      data-plugin-keywords="${escapeHtml(keywords)}"
      data-plugin-installed="${String(Boolean(plugin.installed))}"
      data-plugin-enabled="${String(Boolean(plugin.enabled))}"
      class="plugin-card flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5 gap-2.5 transition h-full"
    >
      <div class="flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-zinc-100 leading-snug">${escapeHtml(plugin.title)}</h3>
          ${plugin.subtitle ? `<p class="mt-0.5 text-[11px] text-zinc-500 truncate">${escapeHtml(plugin.subtitle)}</p>` : ""}
        </div>
        <span class="shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusToneClass}">
          ${escapeHtml(badgeText)}
        </span>
      </div>
      <p class="text-xs leading-[1.6] text-zinc-400 line-clamp-2 flex-1">${escapeHtml(plugin.description || plugin.subtitle || plugin.title)}</p>
      ${permissionSummary}
      <div class="flex items-center justify-between gap-2 pt-1">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-[10px] font-mono text-zinc-600">${escapeHtml(versionText)}</span>
          ${homepageLink}
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${permissionsButton}
          ${actionsHtml}
        </div>
      </div>
    </article>
  `;
}
