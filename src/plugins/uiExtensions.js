const EXTENSION_ATTR = "data-plugin-ui-extension";
const EXTENSION_KEY_ATTR = "data-plugin-ui-extension-key";

function normalizeUrl(urlLike, { backendBaseUrl = "" } = {}) {
  const raw = String(urlLike || "").trim();
  if (!raw) {
    return "";
  }
  const backendOrigin = (() => {
    try {
      return backendBaseUrl ? new URL(String(backendBaseUrl)).origin : "";
    } catch {
      return "";
    }
  })();
  const appOrigin = String(window.location.origin || "").trim();
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  try {
    if (isAbsolute) {
      const absolute = new URL(raw);
      if (!/^https?:$/i.test(String(absolute.protocol || ""))) {
        return "";
      }
      const origin = String(absolute.origin || "");
      if (origin !== backendOrigin && origin !== appOrigin) {
        return "";
      }
      return absolute.toString();
    }
  } catch {
    return "";
  }

  const baseCandidates = [
    String(backendBaseUrl || "").trim(),
    window.location.origin,
  ].filter(Boolean);

  for (const base of baseCandidates) {
    try {
      const resolved = new URL(raw, base);
      return resolved.toString();
    } catch {
      continue;
    }
  }
  return "";
}

function normalizeExtension(item, { backendBaseUrl = "" } = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const pluginId = String(item.plugin_id || item.pluginId || "").trim().toLowerCase();
  const type = String(item.type || "").trim().toLowerCase();
  const load = String(item.load || (type === "script" ? "module" : "style")).trim().toLowerCase();
  const url = normalizeUrl(item.url, { backendBaseUrl });
  if (!pluginId || !url || (type !== "script" && type !== "style")) {
    return null;
  }
  return {
    pluginId,
    type,
    load,
    url,
    key: `${pluginId}:${type}:${url}`,
  };
}

function collectInstalledExtensionKeys() {
  const nodes = [...document.querySelectorAll(`[${EXTENSION_ATTR}='true'][${EXTENSION_KEY_ATTR}]`)];
  const map = new Map();
  nodes.forEach((node) => {
    const key = String(node.getAttribute(EXTENSION_KEY_ATTR) || "").trim();
    if (key) {
      map.set(key, node);
    }
  });
  return map;
}

function createExtensionNode(extension) {
  if (extension.type === "style") {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = extension.url;
    link.setAttribute(EXTENSION_ATTR, "true");
    link.setAttribute(EXTENSION_KEY_ATTR, extension.key);
    link.dataset.pluginId = extension.pluginId;
    return link;
  }

  const script = document.createElement("script");
  const separator = extension.url.includes("?") ? "&" : "?";
  script.src = `${extension.url}${separator}ancia_ui_ext_ts=${Date.now()}`;
  script.async = false;
  if (extension.load === "module") {
    script.type = "module";
  }
  script.setAttribute(EXTENSION_ATTR, "true");
  script.setAttribute(EXTENSION_KEY_ATTR, extension.key);
  script.dataset.pluginId = extension.pluginId;
  return script;
}

export async function syncPluginUiExtensions({
  backendClient,
  pushToast,
  onActivePluginIds,
  onApplied,
} = {}) {
  if (!backendClient || typeof backendClient.listPluginUiExtensions !== "function") {
    return {
      activePluginIds: [],
      added: 0,
      removed: 0,
    };
  }

  let payload;
  try {
    payload = await backendClient.listPluginUiExtensions();
  } catch (error) {
    pushToast?.(`Не удалось загрузить UI-расширения плагинов: ${error.message}`, {
      tone: "warning",
      durationMs: 2800,
    });
    return {
      activePluginIds: [],
      added: 0,
      removed: 0,
    };
  }

  const rawExtensions = Array.isArray(payload?.extensions) ? payload.extensions : [];
  const backendBaseUrl = (
    backendClient && typeof backendClient.getConfig === "function"
      ? String(backendClient.getConfig()?.baseUrl || "").trim()
      : ""
  );
  const nextExtensions = rawExtensions
    .map((item) => normalizeExtension(item, { backendBaseUrl }))
    .filter(Boolean);
  const nextKeys = new Set(nextExtensions.map((item) => item.key));
  const activePluginIds = [...new Set(nextExtensions.map((item) => item.pluginId).filter(Boolean))];
  if (typeof onActivePluginIds === "function") {
    onActivePluginIds(activePluginIds);
  }

  const installed = collectInstalledExtensionKeys();
  let removedCount = 0;
  installed.forEach((node, key) => {
    if (!nextKeys.has(key)) {
      node.remove();
      removedCount += 1;
    }
  });

  // Scripts must re-run after runtime reload/HMR to re-register renderers.
  nextExtensions.forEach((extension) => {
    if (extension.type !== "script") {
      return;
    }
    const existing = installed.get(extension.key);
    if (!(existing instanceof HTMLScriptElement)) {
      return;
    }
    existing.remove();
    installed.delete(extension.key);
    removedCount += 1;
  });

  const appendTarget = document.head || document.documentElement;
  let addedCount = 0;
  nextExtensions.forEach((extension) => {
    if (installed.has(extension.key)) {
      return;
    }
    const node = createExtensionNode(extension);
    appendTarget.append(node);
    addedCount += 1;
  });

  if (typeof onApplied === "function") {
    onApplied({
      activePluginIds,
      added: addedCount,
      removed: removedCount,
      total: nextExtensions.length,
    });
  }

  return {
    activePluginIds,
    added: addedCount,
    removed: removedCount,
    total: nextExtensions.length,
  };
}
