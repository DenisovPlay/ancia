import { createModalOverlayManager } from "../ui/modalOverlayManager.js";
import { createPluginActions } from "./actions.js";
import {
  getPluginPermissionPolicyLabel,
  normalizeBackendPlugin,
  normalizePluginFilter,
  normalizePluginPermissionPolicy,
  renderPluginCard,
} from "./card.js";
import { pluginsPageTemplate } from "./template.js";

export { pluginsPageTemplate };

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDomainDefaultPolicy(value) {
  const safe = String(value || "").trim().toLowerCase();
  if (safe === "deny") {
    return "deny";
  }
  return "allow";
}

export function createPluginsFeature({
  elements,
  pushToast,
  backendClient,
  syncPluginUiExtensions,
  isMotionEnabled = () => true,
}) {
  const pluginFilterButtons = [...document.querySelectorAll("[data-plugin-filter]")];
  const pluginGrid = document.querySelector("#plugins-grid");
  const pluginReloadButton = document.querySelector("[data-plugins-action='refresh']");
  const installedCountNode = document.querySelector("#plugins-installed-count");
  const updatesCountNode = document.querySelector("#plugins-updates-count");
  const autonomousBannerNode = document.querySelector("#plugins-autonomous-banner");
  const permissionsSummaryNode = document.querySelector("#plugins-permissions-summary");
  const permissionBulkButtons = [...document.querySelectorAll("[data-plugin-permission-bulk]")];
  const domainPanelNode = document.querySelector("#plugins-domain-panel");
  const domainInputNode = document.querySelector("#plugins-domain-input");
  const domainPolicyNode = document.querySelector("#plugins-domain-policy");
  const domainDefaultPolicyNode = document.querySelector("#plugins-domain-default-policy");
  const domainAddButton = document.querySelector("#plugins-domain-add");
  const domainAllowListNode = document.querySelector("#plugins-domain-list-allow");
  const domainDenyListNode = document.querySelector("#plugins-domain-list-deny");
  const domainAskListNode = document.querySelector("#plugins-domain-list-ask");
  const permissionsCenterOpenButton = document.querySelector("[data-plugins-action='open-permissions-center']");
  const permissionsCenterModalNode = document.querySelector("#plugins-permissions-center-modal");
  const permissionsCenterModalCloseButton = document.querySelector("#plugins-permissions-center-modal-close");
  const permissionsCenterModalDoneButton = document.querySelector("#plugins-permissions-center-modal-done");
  const permissionsModalNode = document.querySelector("#plugin-permissions-modal");
  const permissionsModalTitleNode = document.querySelector("#plugin-permissions-modal-title");
  const permissionsModalBodyNode = document.querySelector("#plugin-permissions-modal-body");
  const permissionsModalCloseButton = document.querySelector("#plugin-permissions-modal-close");
  const permissionsModalCancelButton = document.querySelector("#plugin-permissions-modal-cancel");
  const permissionsModalSaveButton = document.querySelector("#plugin-permissions-modal-save");

  const permissionsCenterModalOverlay = createModalOverlayManager({
    overlay: permissionsCenterModalNode,
    isMotionEnabled,
    transitionMs: 200,
  });
  const permissionsModalOverlay = createModalOverlayManager({
    overlay: permissionsModalNode,
    isMotionEnabled,
    transitionMs: 200,
  });

  const permissionsCenterModalState = {
    open: false,
    keydownHandler: null,
  };
  const modalState = {
    open: false,
    pluginId: "",
    saveInFlight: false,
    keydownHandler: null,
  };

  let activePluginFilter = "all";
  let eventsBound = false;
  let loadingPlugins = false;
  let plugins = [];
  let autonomousMode = false;
  let bulkPermissionInFlight = false;
  let pluginPermissionPolicies = {};
  let toolPermissionPolicies = {};
  let domainPermissionPolicies = {};
  let domainDefaultPolicy = "allow";
  let toolCatalog = [];

  function findPluginById(pluginIdRaw) {
    const pluginId = String(pluginIdRaw || "").trim().toLowerCase();
    if (!pluginId) {
      return null;
    }
    return plugins.find((plugin) => String(plugin?.id || "").trim().toLowerCase() === pluginId) || null;
  }

  function countPolicies(map = {}) {
    const counts = { allow: 0, ask: 0, deny: 0 };
    Object.values(map || {}).forEach((policyRaw) => {
      const policy = normalizePluginPermissionPolicy(policyRaw);
      counts[policy] += 1;
    });
    return counts;
  }

  function updateStats() {
    const installedPlugins = plugins.filter((plugin) => plugin.installed !== false);
    if (installedCountNode) {
      installedCountNode.textContent = String(installedPlugins.length);
    }
    if (updatesCountNode) {
      const updatableCount = installedPlugins.filter((plugin) => plugin.allowUpdate).length;
      updatesCountNode.textContent = `${updatableCount} доступно к обновлению`;
    }
    updatePermissionsCenter();
  }

  function updatePermissionsCenter() {
    const installedPlugins = plugins.filter((plugin) => plugin.installed !== false);
    const pluginCounts = {
      allow: 0,
      ask: 0,
      deny: 0,
    };
    installedPlugins.forEach((plugin) => {
      const policy = normalizePluginPermissionPolicy(
        pluginPermissionPolicies?.[plugin.id]
        || plugin.permissionPolicy,
      );
      pluginCounts[policy] += 1;
    });
    const toolCounts = countPolicies(
      toolCatalog.reduce((acc, toolItem) => {
        const pluginId = String(toolItem?.plugin_id || "").trim().toLowerCase();
        const toolName = String(toolItem?.tool_name || "").trim().toLowerCase();
        const key = String(toolItem?.tool_key || `${pluginId}::${toolName}`).trim().toLowerCase();
        if (!key) {
          return acc;
        }
        const pluginFallback = normalizePluginPermissionPolicy(pluginPermissionPolicies?.[pluginId] || "allow");
        acc[key] = normalizePluginPermissionPolicy(
          toolPermissionPolicies?.[key] || pluginFallback,
        );
        return acc;
      }, {}),
    );
    const domainCounts = countPolicies(domainPermissionPolicies);
    const unknownDomainLabel = domainDefaultPolicy === "deny"
      ? "неизвестные: блокировать"
      : "неизвестные: разрешать";

    if (permissionsSummaryNode) {
      permissionsSummaryNode.textContent = [
        `Плагины ${pluginCounts.allow}/${pluginCounts.ask}/${pluginCounts.deny}`,
        `Инструменты ${toolCounts.allow}/${toolCounts.ask}/${toolCounts.deny}`,
        `Домены ${domainCounts.allow}/${domainCounts.ask}/${domainCounts.deny}`,
        unknownDomainLabel,
      ].join(" • ");
    }
    const disableBulk = loadingPlugins || bulkPermissionInFlight || installedPlugins.length === 0;
    permissionBulkButtons.forEach((button) => {
      button.disabled = disableBulk;
      button.classList.toggle("opacity-60", disableBulk);
      button.setAttribute("aria-disabled", String(disableBulk));
    });

    const disableDomainControls = loadingPlugins || bulkPermissionInFlight;
    if (domainAddButton instanceof HTMLButtonElement) {
      domainAddButton.disabled = disableDomainControls;
      domainAddButton.classList.toggle("opacity-60", disableDomainControls);
    }
    if (domainInputNode instanceof HTMLInputElement) {
      domainInputNode.disabled = disableDomainControls;
    }
    if (domainPolicyNode instanceof HTMLSelectElement) {
      domainPolicyNode.disabled = disableDomainControls;
    }
    if (domainDefaultPolicyNode instanceof HTMLSelectElement) {
      domainDefaultPolicyNode.disabled = disableDomainControls;
      domainDefaultPolicyNode.value = domainDefaultPolicy;
    }
  }

  function renderDomainGroup(node, domains, emptyText) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const sortedDomains = [...domains].sort((left, right) => left.localeCompare(right, "ru"));
    if (sortedDomains.length === 0) {
      node.innerHTML = `<div class="rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-xs text-zinc-500">${escapeHtml(emptyText)}</div>`;
      return;
    }
    node.innerHTML = sortedDomains.map((domain) => {
      const policy = normalizePluginPermissionPolicy(domainPermissionPolicies?.[domain]);
      return `
        <div class="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
          <span class="truncate font-mono text-[11px] text-zinc-300">${escapeHtml(domain)}</span>
          <div class="flex items-center gap-1.5">
            <select data-plugin-action="domain-permission" data-domain="${escapeHtml(domain)}" class="h-7 rounded-md border border-zinc-800 bg-zinc-950 px-1.5 text-[11px] text-zinc-300">
              <option value="allow" ${policy === "allow" ? "selected" : ""}>${getPluginPermissionPolicyLabel("allow", { option: true })}</option>
              <option value="deny" ${policy === "deny" ? "selected" : ""}>${getPluginPermissionPolicyLabel("deny", { option: true })}</option>
              <option value="ask" ${policy === "ask" ? "selected" : ""}>С подтверждением</option>
            </select>
            <button type="button" data-plugin-action="domain-remove" data-domain="${escapeHtml(domain)}" class="icon-button active:scale-95 duration-300 h-7 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-[11px] text-zinc-300 hover:bg-zinc-800">Удалить</button>
          </div>
        </div>
      `;
    }).join("\n");
    node.querySelectorAll("select[data-plugin-action='domain-permission']").forEach((control) => {
      if (!(control instanceof HTMLSelectElement)) {
        return;
      }
      control.dataset.previousValue = String(control.value || "allow").trim().toLowerCase();
    });
  }

  function renderDomainPermissions() {
    const grouped = {
      allow: [],
      deny: [],
      ask: [],
    };
    Object.entries(domainPermissionPolicies || {}).forEach(([domainRaw, policyRaw]) => {
      const domain = String(domainRaw || "").trim().toLowerCase();
      if (!domain) {
        return;
      }
      const policy = normalizePluginPermissionPolicy(policyRaw);
      grouped[policy].push(domain);
    });
    renderDomainGroup(domainAllowListNode, grouped.allow, "Разрешённых доменов пока нет");
    renderDomainGroup(domainDenyListNode, grouped.deny, "Запрещённых доменов пока нет");
    renderDomainGroup(domainAskListNode, grouped.ask, "Доменов с подтверждением пока нет");
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
        <article class="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center text-sm text-zinc-500 md:col-span-2 2xl:col-span-3">
          Загружаем плагины...
        </article>
      `;
      renderDomainPermissions();
      applyPluginFilters();
      return;
    }

    if (plugins.length === 0) {
      pluginGrid.innerHTML = "";
      renderDomainPermissions();
      applyPluginFilters();
      return;
    }

    pluginGrid.innerHTML = plugins.map(renderPluginCard).join("\n");
    renderDomainPermissions();
    applyPluginFilters();
  }

  function hasPermissionsCenterModalSupport() {
    return Boolean(
      permissionsCenterModalOverlay.hasSupport()
      && permissionsCenterModalCloseButton instanceof HTMLButtonElement
      && permissionsCenterModalDoneButton instanceof HTMLButtonElement,
    );
  }

  function closePermissionsCenterModal({ skipAnimation = false } = {}) {
    if (!permissionsCenterModalState.open) {
      return;
    }
    permissionsCenterModalState.open = false;
    if (typeof permissionsCenterModalState.keydownHandler === "function") {
      document.removeEventListener("keydown", permissionsCenterModalState.keydownHandler);
      permissionsCenterModalState.keydownHandler = null;
    }
    permissionsCenterModalOverlay.close({ skipAnimation });
  }

  function openPermissionsCenterModal() {
    if (!hasPermissionsCenterModalSupport()) {
      pushToast("Окно центра разрешений недоступно.", {
        tone: "warning",
        durationMs: 2400,
      });
      return;
    }
    if (permissionsCenterModalState.open) {
      return;
    }
    if (modalState.open) {
      closePluginPermissionsModal({ skipAnimation: true });
    }

    permissionsCenterModalState.open = true;
    permissionsCenterModalOverlay.open({ captureFocus: true });

    const onKeyDown = (event) => {
      if (!permissionsCenterModalState.open) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closePermissionsCenterModal();
      }
    };
    permissionsCenterModalState.keydownHandler = onKeyDown;
    document.addEventListener("keydown", onKeyDown);

    window.requestAnimationFrame(() => {
      const firstBulkButton = permissionBulkButtons.find(
        (button) => button instanceof HTMLButtonElement && !button.disabled,
      );
      if (firstBulkButton instanceof HTMLElement) {
        firstBulkButton.focus({ preventScroll: true });
        return;
      }
      if (domainInputNode instanceof HTMLElement) {
        domainInputNode.focus({ preventScroll: true });
      }
    });
  }

  function hasPermissionsModalSupport() {
    return Boolean(
      permissionsModalOverlay.hasSupport()
      && permissionsModalBodyNode instanceof HTMLElement
      && permissionsModalTitleNode instanceof HTMLElement
      && permissionsModalSaveButton instanceof HTMLButtonElement
      && permissionsModalCancelButton instanceof HTMLButtonElement
      && permissionsModalCloseButton instanceof HTMLButtonElement,
    );
  }

  function renderPluginPermissionsModalContent(plugin) {
    if (!hasPermissionsModalSupport() || !plugin) {
      return;
    }
    permissionsModalTitleNode.textContent = `Разрешения: ${plugin.title}`;
    const currentPluginPolicy = normalizePluginPermissionPolicy(plugin.permissionPolicy);
    const tools = Array.isArray(plugin.tools) ? plugin.tools : [];
    permissionsModalBodyNode.innerHTML = `
      <div class="grid gap-3">
        <label class="grid gap-1">
          <span class="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Политика плагина</span>
          <select data-plugin-modal-field="plugin-policy" class="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200 outline-none focus:border-zinc-600">
            <option value="allow" ${currentPluginPolicy === "allow" ? "selected" : ""}>${getPluginPermissionPolicyLabel("allow", { option: true })}</option>
            <option value="ask" ${currentPluginPolicy === "ask" ? "selected" : ""}>${getPluginPermissionPolicyLabel("ask", { option: true })}</option>
            <option value="deny" ${currentPluginPolicy === "deny" ? "selected" : ""}>${getPluginPermissionPolicyLabel("deny", { option: true })}</option>
          </select>
        </label>
        <div class="grid gap-1.5">
          <p class="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Инструменты</p>
          ${tools.length === 0
            ? "<div class=\"rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 text-xs text-zinc-500\">У плагина нет инструментов.</div>"
            : tools.map((toolNameRaw) => {
              const toolName = String(toolNameRaw || "").trim().toLowerCase();
              const toolPolicy = normalizePluginPermissionPolicy(
                plugin.toolPermissionPolicies?.[toolName] || currentPluginPolicy,
              );
              return `
                <label class="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
                  <span class="truncate font-mono text-xs text-zinc-300">${escapeHtml(toolName)}</span>
                  <select data-plugin-modal-field="tool-policy" data-tool-name="${escapeHtml(toolName)}" class="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-300 outline-none focus:border-zinc-600">
                    <option value="allow" ${toolPolicy === "allow" ? "selected" : ""}>${getPluginPermissionPolicyLabel("allow", { option: true })}</option>
                    <option value="ask" ${toolPolicy === "ask" ? "selected" : ""}>${getPluginPermissionPolicyLabel("ask", { option: true })}</option>
                    <option value="deny" ${toolPolicy === "deny" ? "selected" : ""}>${getPluginPermissionPolicyLabel("deny", { option: true })}</option>
                  </select>
                </label>
              `;
            }).join("\n")
          }
        </div>
      </div>
    `;
  }

  function closePluginPermissionsModal({ skipAnimation = false } = {}) {
    if (!modalState.open) {
      return;
    }
    modalState.open = false;
    modalState.pluginId = "";
    modalState.saveInFlight = false;
    if (typeof modalState.keydownHandler === "function") {
      document.removeEventListener("keydown", modalState.keydownHandler);
      modalState.keydownHandler = null;
    }
    permissionsModalOverlay.close({ skipAnimation });
  }

  function openPluginPermissionsModal(pluginIdRaw) {
    const pluginId = String(pluginIdRaw || "").trim().toLowerCase();
    const plugin = findPluginById(pluginId);
    if (!plugin) {
      pushToast("Плагин не найден.", { tone: "error", durationMs: 2200 });
      return;
    }
    if (!hasPermissionsModalSupport()) {
      pushToast("Окно разрешений недоступно.", { tone: "warning", durationMs: 2400 });
      return;
    }
    if (permissionsCenterModalState.open) {
      closePermissionsCenterModal({ skipAnimation: true });
    }
    if (modalState.open) {
      closePluginPermissionsModal({ skipAnimation: true });
    }
    modalState.open = true;
    modalState.pluginId = pluginId;
    modalState.saveInFlight = false;
    renderPluginPermissionsModalContent(plugin);
    permissionsModalOverlay.open({ captureFocus: true });
    const onKeyDown = (event) => {
      if (!modalState.open) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closePluginPermissionsModal();
      }
    };
    modalState.keydownHandler = onKeyDown;
    document.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      const firstInput = permissionsModalBodyNode?.querySelector("select");
      if (firstInput instanceof HTMLElement) {
        firstInput.focus({ preventScroll: true });
      }
    });
  }

  async function savePluginPermissionsModal() {
    if (!modalState.open || modalState.saveInFlight) {
      return;
    }
    const plugin = findPluginById(modalState.pluginId);
    if (!plugin || !(permissionsModalBodyNode instanceof HTMLElement)) {
      closePluginPermissionsModal();
      return;
    }
    const pluginId = String(plugin.id || "").trim().toLowerCase();
    if (!pluginId) {
      closePluginPermissionsModal();
      return;
    }

    const pluginPolicyControl = permissionsModalBodyNode.querySelector("[data-plugin-modal-field='plugin-policy']");
    if (!(pluginPolicyControl instanceof HTMLSelectElement)) {
      return;
    }
    const currentPluginPolicy = normalizePluginPermissionPolicy(plugin.permissionPolicy);
    const nextPluginPolicy = normalizePluginPermissionPolicy(pluginPolicyControl.value);

    const toolUpdates = {};
    permissionsModalBodyNode.querySelectorAll("[data-plugin-modal-field='tool-policy']").forEach((node) => {
      if (!(node instanceof HTMLSelectElement)) {
        return;
      }
      const toolName = String(node.dataset.toolName || "").trim().toLowerCase();
      if (!toolName) {
        return;
      }
      const currentToolPolicy = normalizePluginPermissionPolicy(
        plugin.toolPermissionPolicies?.[toolName] || currentPluginPolicy,
      );
      const nextToolPolicy = normalizePluginPermissionPolicy(node.value);
      if (currentToolPolicy !== nextToolPolicy) {
        toolUpdates[`${pluginId}::${toolName}`] = nextToolPolicy;
      }
    });

    const hasPluginPolicyChange = nextPluginPolicy !== currentPluginPolicy;
    if (!hasPluginPolicyChange && Object.keys(toolUpdates).length === 0) {
      closePluginPermissionsModal();
      return;
    }

    const payload = {};
    if (hasPluginPolicyChange) {
      payload.plugin_id = pluginId;
      payload.policy = nextPluginPolicy;
    }
    if (Object.keys(toolUpdates).length > 0) {
      payload.tool_policies = toolUpdates;
    }

    modalState.saveInFlight = true;
    if (permissionsModalSaveButton instanceof HTMLButtonElement) {
      permissionsModalSaveButton.disabled = true;
    }
    try {
      await backendClient.updatePluginPermissions(payload);
      pushToast(`Разрешения плагина «${plugin.title}» обновлены.`, {
        tone: "success",
        durationMs: 2400,
      });
      closePluginPermissionsModal();
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось сохранить разрешения: ${error.message}`, {
        tone: "error",
        durationMs: 3600,
      });
    } finally {
      modalState.saveInFlight = false;
      if (permissionsModalSaveButton instanceof HTMLButtonElement) {
        permissionsModalSaveButton.disabled = false;
      }
    }
  }

  async function loadPlugins() {
    if (loadingPlugins) {
      return;
    }

    loadingPlugins = true;
    renderPluginGrid();

    try {
      const [installedPayload, registryPayload, permissionsPayload] = await Promise.all([
        backendClient.listPlugins(),
        backendClient.listPluginRegistry().catch(() => null),
        backendClient.listPluginPermissions().catch(() => null),
      ]);

      autonomousMode = Boolean(installedPayload?.autonomous_mode ?? registryPayload?.autonomous_mode);
      domainDefaultPolicy = normalizeDomainDefaultPolicy(
        permissionsPayload?.domain_default_policy
        || permissionsPayload?.default_domain_policy
        || installedPayload?.plugin_domain_default_policy
        || "allow",
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
      pluginPermissionPolicies = permissionsPayload?.policies && typeof permissionsPayload.policies === "object"
        ? Object.fromEntries(
          Object.entries(permissionsPayload.policies)
            .map(([pluginId, policy]) => [
              String(pluginId || "").trim().toLowerCase(),
              normalizePluginPermissionPolicy(policy),
            ]),
        )
        : installedPayload?.plugin_permission_policies && typeof installedPayload.plugin_permission_policies === "object"
          ? Object.fromEntries(
            Object.entries(installedPayload.plugin_permission_policies)
              .map(([pluginId, policy]) => [
                String(pluginId || "").trim().toLowerCase(),
                normalizePluginPermissionPolicy(policy),
              ]),
          )
          : {};
      toolPermissionPolicies = permissionsPayload?.tool_policies && typeof permissionsPayload.tool_policies === "object"
        ? Object.fromEntries(
          Object.entries(permissionsPayload.tool_policies)
            .map(([toolKey, policy]) => [
              String(toolKey || "").trim().toLowerCase(),
              normalizePluginPermissionPolicy(policy),
            ]),
        )
        : installedPayload?.plugin_tool_permission_policies && typeof installedPayload.plugin_tool_permission_policies === "object"
          ? Object.fromEntries(
            Object.entries(installedPayload.plugin_tool_permission_policies)
              .map(([toolKey, policy]) => [
                String(toolKey || "").trim().toLowerCase(),
                normalizePluginPermissionPolicy(policy),
              ]),
          )
          : {};
      domainPermissionPolicies = permissionsPayload?.domain_policies && typeof permissionsPayload.domain_policies === "object"
        ? Object.fromEntries(
          Object.entries(permissionsPayload.domain_policies)
            .map(([domainKey, policy]) => [
              String(domainKey || "").trim().toLowerCase(),
              normalizePluginPermissionPolicy(policy),
            ]),
        )
        : installedPayload?.plugin_domain_permission_policies && typeof installedPayload.plugin_domain_permission_policies === "object"
          ? Object.fromEntries(
            Object.entries(installedPayload.plugin_domain_permission_policies)
              .map(([domainKey, policy]) => [
                String(domainKey || "").trim().toLowerCase(),
                normalizePluginPermissionPolicy(policy),
              ]),
          )
          : {};
      toolCatalog = Array.isArray(permissionsPayload?.tools)
        ? permissionsPayload.tools
          .map((toolItem) => {
            if (!toolItem || typeof toolItem !== "object") {
              return null;
            }
            const pluginId = String(toolItem.plugin_id || "").trim().toLowerCase();
            const toolName = String(toolItem.tool_name || "").trim().toLowerCase();
            const toolKey = String(toolItem.tool_key || `${pluginId}::${toolName}`).trim().toLowerCase();
            if (!pluginId || !toolName || !toolKey) {
              return null;
            }
            return {
              plugin_id: pluginId,
              tool_name: toolName,
              tool_key: toolKey,
            };
          })
          .filter(Boolean)
        : [];
      plugins = [...byId.values()].map((plugin) => {
        const pluginId = String(plugin.id || "").trim().toLowerCase();
        const nextPluginPolicy = normalizePluginPermissionPolicy(
          pluginPermissionPolicies?.[pluginId]
          || plugin.permissionPolicy,
        );
        const nextToolPolicies = {};
        (Array.isArray(plugin.tools) ? plugin.tools : []).forEach((toolNameRaw) => {
          const toolName = String(toolNameRaw || "").trim().toLowerCase();
          const toolKey = `${pluginId}::${toolName}`;
          nextToolPolicies[toolName] = normalizePluginPermissionPolicy(
            toolPermissionPolicies?.[toolKey]
            || plugin.toolPermissionPolicies?.[toolName]
            || nextPluginPolicy,
          );
        });
        return {
          ...plugin,
          permissionPolicy: nextPluginPolicy,
          toolPermissionPolicies: nextToolPolicies,
        };
      });

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

      if (typeof syncPluginUiExtensions === "function") {
        await syncPluginUiExtensions();
      }

      if (modalState.open) {
        const currentPlugin = findPluginById(modalState.pluginId);
        if (currentPlugin) {
          renderPluginPermissionsModalContent(currentPlugin);
        } else {
          closePluginPermissionsModal({ skipAnimation: true });
        }
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

  async function applyBulkPermission(policyValue) {
    const policy = normalizePluginPermissionPolicy(policyValue);
    const installedPluginIds = plugins
      .filter((plugin) => plugin.installed !== false)
      .map((plugin) => String(plugin.id || "").trim().toLowerCase())
      .filter(Boolean);
    if (installedPluginIds.length === 0 || bulkPermissionInFlight) {
      return;
    }
    bulkPermissionInFlight = true;
    updatePermissionsCenter();
    try {
      const policiesPayload = {};
      installedPluginIds.forEach((pluginId) => {
        policiesPayload[pluginId] = policy;
      });
      await backendClient.updatePluginPermissions({
        policies: policiesPayload,
      });
      pushToast(`Разрешения обновлены: ${getPluginPermissionPolicyLabel(policy)} для ${installedPluginIds.length} плагинов.`, {
        tone: "success",
        durationMs: 2600,
      });
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось применить массовые разрешения: ${error.message}`, {
        tone: "error",
        durationMs: 3600,
      });
    } finally {
      bulkPermissionInFlight = false;
      updatePermissionsCenter();
    }
  }

  async function applyDomainDefaultPolicy(policyRaw) {
    const policy = normalizeDomainDefaultPolicy(policyRaw);
    if (policy === domainDefaultPolicy) {
      return;
    }
    try {
      await backendClient.updatePluginPermissions({
        domain_default_policy: policy,
      });
      pushToast(`Неизвестные домены: ${policy === "deny" ? "блокировать" : "разрешать"}.`, {
        tone: "success",
        durationMs: 2200,
      });
      domainDefaultPolicy = policy;
      updatePermissionsCenter();
      await loadPlugins();
    } catch (error) {
      pushToast(`Не удалось обновить правило по умолчанию: ${error.message}`, {
        tone: "error",
        durationMs: 3400,
      });
      if (domainDefaultPolicyNode instanceof HTMLSelectElement) {
        domainDefaultPolicyNode.value = domainDefaultPolicy;
      }
    }
  }

  async function applyDomainPolicy(domainRaw, policyRaw, { remove = false } = {}) {
    const domain = String(domainRaw || "").trim().toLowerCase();
    if (!domain) {
      return false;
    }
    const policy = normalizePluginPermissionPolicy(policyRaw);
    try {
      if (remove) {
        await backendClient.updatePluginPermissions({
          domain,
          remove_domain_policy: true,
        });
        pushToast(`Домен ${domain} удалён из правил.`, {
          tone: "success",
          durationMs: 2200,
        });
      } else {
        await backendClient.updatePluginPermissions({
          domain,
          domain_policy: policy,
        });
        pushToast(`Домен ${domain}: ${getPluginPermissionPolicyLabel(policy)}.`, {
          tone: "success",
          durationMs: 2200,
        });
      }
      await loadPlugins();
      return true;
    } catch (error) {
      pushToast(`Не удалось обновить правило домена: ${error.message}`, {
        tone: "error",
        durationMs: 3400,
      });
      return false;
    }
  }

  async function addDomainPolicyFromControls() {
    const domain = String(domainInputNode?.value || "").trim().toLowerCase();
    if (!domain) {
      pushToast("Введите домен для правила.", { tone: "warning", durationMs: 2200 });
      return;
    }
    const policy = normalizePluginPermissionPolicy(domainPolicyNode?.value || "allow");
    const ok = await applyDomainPolicy(domain, policy, { remove: false });
    if (ok && domainInputNode instanceof HTMLInputElement) {
      domainInputNode.value = "";
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
    permissionsCenterOpenButton?.addEventListener("click", () => {
      openPermissionsCenterModal();
    });

    permissionBulkButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const policy = String(button.dataset.pluginPermissionBulk || "").trim().toLowerCase();
        void applyBulkPermission(policy);
      });
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
      if (updateButton instanceof HTMLButtonElement) {
        await pluginActions.handlePluginUpdate(updateButton);
        return;
      }

      const openPermissionsButton = target.closest("[data-plugin-action='open-permissions']");
      if (openPermissionsButton instanceof HTMLButtonElement) {
        const pluginId = String(openPermissionsButton.dataset.pluginId || "").trim().toLowerCase();
        openPluginPermissionsModal(pluginId);
      }
    });

    domainPanelNode?.addEventListener("change", async (event) => {
      const target = event.target;
      if (target === domainDefaultPolicyNode) {
        await applyDomainDefaultPolicy(domainDefaultPolicyNode?.value || "allow");
        return;
      }
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      const domainControl = target.closest("select[data-plugin-action='domain-permission']");
      if (!(domainControl instanceof HTMLSelectElement)) {
        return;
      }
      const domain = String(domainControl.dataset.domain || "").trim().toLowerCase();
      const nextPolicy = normalizePluginPermissionPolicy(domainControl.value);
      const previousValue = normalizePluginPermissionPolicy(domainControl.dataset.previousValue || "allow");
      domainControl.disabled = true;
      const ok = await applyDomainPolicy(domain, nextPolicy, { remove: false });
      if (!ok) {
        domainControl.value = previousValue;
      } else {
        domainControl.dataset.previousValue = nextPolicy;
      }
      domainControl.disabled = false;
    });

    domainPanelNode?.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-plugin-action='domain-remove']")
        : null;
      if (!(target instanceof HTMLButtonElement)) {
        return;
      }
      const domain = String(target.dataset.domain || "").trim().toLowerCase();
      void applyDomainPolicy(domain, "deny", { remove: true });
    });

    domainAddButton?.addEventListener("click", () => {
      void addDomainPolicyFromControls();
    });
    domainInputNode?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      void addDomainPolicyFromControls();
    });

    permissionsModalCloseButton?.addEventListener("click", () => {
      closePluginPermissionsModal();
    });
    permissionsModalCancelButton?.addEventListener("click", () => {
      closePluginPermissionsModal();
    });
    permissionsModalSaveButton?.addEventListener("click", () => {
      void savePluginPermissionsModal();
    });
    permissionsModalNode?.addEventListener("click", (event) => {
      if (event.target === permissionsModalNode) {
        closePluginPermissionsModal();
      }
    });
    permissionsCenterModalCloseButton?.addEventListener("click", () => {
      closePermissionsCenterModal();
    });
    permissionsCenterModalDoneButton?.addEventListener("click", () => {
      closePermissionsCenterModal();
    });
    permissionsCenterModalNode?.addEventListener("click", (event) => {
      if (event.target === permissionsCenterModalNode) {
        closePermissionsCenterModal();
      }
    });
  }

  function initialize() {
    bindEvents();
    updateStats();
    renderPluginGrid();
    updatePermissionsCenter();
    void loadPlugins();
  }

  return {
    initialize,
    applyPluginFilters,
    reload: loadPlugins,
  };
}
