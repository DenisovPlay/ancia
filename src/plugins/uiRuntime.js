const TOOL_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{1,127}$/;
const INTERNAL_RUNTIME_KEY = "__anciaPluginUiRuntime";
const EXTERNAL_API_KEY = "AnciaPluginUI";

function normalizeToolName(value) {
  const safe = String(value || "").trim().toLowerCase();
  if (!safe || !TOOL_NAME_PATTERN.test(safe)) {
    return "";
  }
  return safe;
}

function normalizePluginId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRendererInput(input, maybeRenderer) {
  if (typeof input === "string") {
    const toolName = normalizeToolName(input);
    if (!toolName || !maybeRenderer || typeof maybeRenderer !== "object") {
      return null;
    }
    return {
      toolName,
      pluginId: normalizePluginId(maybeRenderer.pluginId),
      renderer: maybeRenderer,
    };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  const toolName = normalizeToolName(input.toolName || input.name);
  if (!toolName) {
    return null;
  }

  return {
    toolName,
    pluginId: normalizePluginId(input.pluginId),
    renderer: input,
  };
}

function createRuntimeState() {
  const toolRendererByName = new Map();
  const listeners = new Set();

  const notify = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ignore plugin UI listener errors.
      }
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("ancia:plugin-ui-updated"));
    }
  };

  const registerToolRenderer = (input, maybeRenderer) => {
    const normalized = normalizeRendererInput(input, maybeRenderer);
    if (!normalized) {
      return false;
    }

    const rendererPayload = normalized.renderer || {};
    const renderer = {
      toolName: normalized.toolName,
      pluginId: normalized.pluginId,
      getQueryPreview: typeof rendererPayload.getQueryPreview === "function"
        ? rendererPayload.getQueryPreview
        : null,
      formatOutput: typeof rendererPayload.formatOutput === "function"
        ? rendererPayload.formatOutput
        : null,
      formatStart: typeof rendererPayload.formatStart === "function"
        ? rendererPayload.formatStart
        : null,
    };

    toolRendererByName.set(normalized.toolName, renderer);
    notify();
    return true;
  };

  const unregisterToolRenderer = (toolName) => {
    const safeToolName = normalizeToolName(toolName);
    if (!safeToolName) {
      return false;
    }
    const removed = toolRendererByName.delete(safeToolName);
    if (removed) {
      notify();
    }
    return removed;
  };

  const getToolRenderer = (toolName) => {
    const safeToolName = normalizeToolName(toolName);
    if (!safeToolName) {
      return null;
    }
    const renderer = toolRendererByName.get(safeToolName);
    return renderer && typeof renderer === "object" ? renderer : null;
  };

  const pruneInactivePluginRenderers = (activePluginIds = []) => {
    const activeSet = new Set(
      (Array.isArray(activePluginIds) ? activePluginIds : [])
        .map((item) => normalizePluginId(item))
        .filter(Boolean),
    );

    let changed = false;
    toolRendererByName.forEach((renderer, toolName) => {
      const pluginId = normalizePluginId(renderer?.pluginId);
      if (!pluginId) {
        return;
      }
      if (!activeSet.has(pluginId)) {
        toolRendererByName.delete(toolName);
        changed = true;
      }
    });

    if (changed) {
      notify();
    }
    return changed;
  };

  const onChange = (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    registerToolRenderer,
    unregisterToolRenderer,
    getToolRenderer,
    pruneInactivePluginRenderers,
    onChange,
  };
}

function ensureRuntime() {
  if (typeof window === "undefined") {
    return createRuntimeState();
  }

  const existing = window[INTERNAL_RUNTIME_KEY];
  if (existing && typeof existing === "object") {
    return existing;
  }

  const runtime = createRuntimeState();
  window[INTERNAL_RUNTIME_KEY] = runtime;
  window[EXTERNAL_API_KEY] = {
    registerToolRenderer: runtime.registerToolRenderer,
    unregisterToolRenderer: runtime.unregisterToolRenderer,
    registerToolUi: runtime.registerToolRenderer,
  };
  return runtime;
}

export function getPluginUiRuntime() {
  return ensureRuntime();
}
