export function createChatToolCatalog({
  runtimeMode,
  backendClient,
  pushToast,
  getStreamRenderer,
  rerenderMessages,
}) {
  const toolMetaByName = new Map();
  const toolNameByDisplayName = new Map();
  const TOOL_ICON_BY_CATEGORY = {
    web: "search-web",
    system: "clock",
    agent: "mood",
  };

  function isBackendRuntimeEnabled() {
    return runtimeMode === "backend";
  }

  function normalizeToolName(rawName = "") {
    const safeName = String(rawName || "").trim();
    if (!safeName) {
      return "";
    }
    const lowered = safeName.toLowerCase();
    if (toolMetaByName.has(lowered)) {
      return lowered;
    }
    const displayMapped = toolNameByDisplayName.get(lowered);
    if (displayMapped) {
      return displayMapped;
    }
    const shortName = lowered.split(":")[0]?.trim() || "";
    if (shortName && toolMetaByName.has(shortName)) {
      return shortName;
    }
    const shortDisplayMapped = toolNameByDisplayName.get(shortName);
    if (shortDisplayMapped) {
      return shortDisplayMapped;
    }
    return lowered;
  }

  function lookupToolMeta(normalizedToolName = "", rawToolName = "") {
    const normalized = String(normalizedToolName || "").trim().toLowerCase();
    const raw = String(rawToolName || "").trim();
    const payload = toolMetaByName.get(normalized);
    if (payload) {
      return payload;
    }
    return {
      name: normalized || raw.toLowerCase(),
      displayName: raw || normalized || "Инструмент",
      subtitle: "",
      category: "",
      iconKey: "plugins",
    };
  }

  async function refreshToolCatalog({ silent = true } = {}) {
    if (!isBackendRuntimeEnabled()) {
      toolMetaByName.clear();
      toolNameByDisplayName.clear();
      return false;
    }
    try {
      const payload = await backendClient.listTools();
      const tools = Array.isArray(payload?.tools) ? payload.tools : [];
      toolMetaByName.clear();
      toolNameByDisplayName.clear();
      tools.forEach((item) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const name = String(item.name || "").trim().toLowerCase();
        if (!name) {
          return;
        }
        const displayName = String(item.display_name || item.displayName || name).trim() || name;
        const category = String(item.category || "").trim().toLowerCase();
        const iconKey = String(TOOL_ICON_BY_CATEGORY[category] || "plugins");
        toolMetaByName.set(name, {
          name,
          displayName,
          subtitle: String(item.subtitle || "").trim(),
          category,
          iconKey,
        });
        toolNameByDisplayName.set(displayName.toLowerCase(), name);
      });
      if (getStreamRenderer()) {
        rerenderMessages();
      }
      return true;
    } catch (error) {
      if (!silent) {
        pushToast(`Не удалось получить список инструментов: ${error.message}`, {
          tone: "warning",
          durationMs: 2600,
        });
      }
      return false;
    }
  }

  return {
    normalizeToolName,
    lookupToolMeta,
    refreshToolCatalog,
  };
}
