const DEFAULT_TIMEOUT_MS = 12000;

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  return raw.endsWith("/") ? raw : `${raw}/`;
}

function buildEndpoint(baseUrl, path) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) {
    throw new Error("URL бэкенда не настроен.");
  }

  const safePath = String(path || "").replace(/^\//, "");
  return new URL(safePath, normalizedBase).toString();
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function parseSseEvent(rawBlock) {
  const lines = String(rawBlock || "").split(/\r?\n/);
  let event = "message";
  const dataLines = [];

  lines.forEach((line) => {
    if (!line || line.startsWith(":")) {
      return;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      return;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  });

  if (dataLines.length === 0) {
    return null;
  }

  const dataRaw = dataLines.join("\n");
  try {
    return {
      event,
      data: JSON.parse(dataRaw),
    };
  } catch (error) {
    return {
      event,
      data: { raw: dataRaw },
    };
  }
}

function describeErrorPayload(payload) {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return "Неизвестная ошибка сервера";
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message.trim()) {
      return detail.message.trim();
    }
    try {
      return JSON.stringify(detail);
    } catch (error) {
      return "Ошибка сервера";
    }
  }

  try {
    return JSON.stringify(payload);
  } catch (error) {
    return "Ошибка сервера";
  }
}

export class BackendClient {
  constructor(initialConfig = {}) {
    this.config = {
      baseUrl: "",
      apiKey: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      ...initialConfig,
    };
  }

  setConfig(partial = {}) {
    this.config = {
      ...this.config,
      ...partial,
      timeoutMs: Number(partial.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
  }

  getConfig() {
    return { ...this.config };
  }

  createHeaders({ hasBody = false, extra = {} } = {}) {
    const headers = { ...extra };

    if (hasBody) {
      headers["Content-Type"] = "application/json";
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  async request(path, { method = "GET", body, timeoutMs } = {}) {
    const controller = new AbortController();
    const requestTimeout = Number(timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const timer = window.setTimeout(() => controller.abort("timeout"), requestTimeout);
    const hasBody = body !== undefined && body !== null;

    try {
      const response = await fetch(buildEndpoint(this.config.baseUrl, path), {
        method,
        headers: this.createHeaders({ hasBody }),
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const detail = describeErrorPayload(payload);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Превышено время ожидания запроса");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async ping() {
    return this.request("/health", { method: "GET", timeoutMs: 5000 });
  }

  async listModels() {
    return this.request("/models", { method: "GET" });
  }

  async listTools() {
    return this.request("/tools", { method: "GET" });
  }

  async selectModel(selection = {}) {
    const payload = typeof selection === "string"
      ? { model_id: String(selection || "").trim() }
      : {
        model_id: String(selection?.model_id || selection?.modelId || "").trim(),
        load: Boolean(selection?.load),
      };
    return this.request("/models/select", {
      method: "POST",
      body: payload,
    });
  }

  async loadModel(selection = {}) {
    const payload = typeof selection === "string"
      ? { model_id: String(selection || "").trim() }
      : {
        model_id: String(selection?.model_id || selection?.modelId || "").trim(),
      };
    return this.request("/models/load", {
      method: "POST",
      body: payload,
    });
  }

  async unloadModel() {
    return this.request("/models/unload", {
      method: "POST",
      body: {},
    });
  }

  async deleteModelCache(modelId) {
    const safeModelId = encodePathSegment(modelId);
    return this.request(`/models/${safeModelId}/cache`, {
      method: "DELETE",
    });
  }

  async updateModelParams(modelId, payload = {}, { timeoutMs = 30000 } = {}) {
    const safeModelId = encodePathSegment(modelId);
    return this.request(`/models/${safeModelId}/params`, {
      method: "PATCH",
      body: payload || {},
      timeoutMs: Number(timeoutMs || 30000),
    });
  }

  async getModelContextRequirements(modelId = "", { timeoutMs = 20000 } = {}) {
    const safeModelId = String(modelId || "").trim();
    const query = safeModelId
      ? `?model_id=${encodeURIComponent(safeModelId)}`
      : "";
    return this.request(`/models/context-requirements${query}`, {
      method: "GET",
      timeoutMs: Number(timeoutMs || 20000),
    });
  }

  async listPlugins() {
    return this.request("/plugins", { method: "GET" });
  }

  async listPluginRegistry() {
    return this.request("/plugins/registry", { method: "GET" });
  }

  async updatePluginRegistry(payload = {}) {
    return this.request("/plugins/registry", {
      method: "PATCH",
      body: payload || {},
    });
  }

  async installPlugin(payload = {}) {
    return this.request("/plugins/install", {
      method: "POST",
      body: payload || {},
    });
  }

  async uninstallPlugin(pluginId) {
    const safePluginId = encodePathSegment(pluginId);
    return this.request(`/plugins/${safePluginId}/uninstall`, {
      method: "DELETE",
    });
  }

  async enablePlugin(pluginId) {
    const safePluginId = encodePathSegment(pluginId);
    return this.request(`/plugins/${safePluginId}/enable`, {
      method: "POST",
      body: {},
    });
  }

  async disablePlugin(pluginId) {
    const safePluginId = encodePathSegment(pluginId);
    return this.request(`/plugins/${safePluginId}/disable`, {
      method: "POST",
      body: {},
    });
  }

  async updatePlugin(pluginId) {
    const safePluginId = encodePathSegment(pluginId);
    return this.request(`/plugins/${safePluginId}/update`, {
      method: "POST",
      body: {},
    });
  }

  async listPluginUiExtensions() {
    return this.request("/plugins/ui/extensions", { method: "GET" });
  }

  async sendMessage(payload) {
    return this.request("/chat", {
      method: "POST",
      body: payload,
    });
  }

  async getSettings() {
    return this.request("/settings", { method: "GET" });
  }

  async updateSettings(payload) {
    return this.request("/settings", {
      method: "PATCH",
      body: payload || {},
    });
  }

  async resetApp(payload = {}) {
    return this.request("/app/reset", {
      method: "POST",
      body: payload || {},
    });
  }

  async getAppState() {
    return this.request("/app/state", { method: "GET" });
  }

  async inspectLink(url) {
    const safeUrl = String(url || "").trim();
    if (!safeUrl) {
      throw new Error("URL для проверки не указан.");
    }
    return this.request(`/links/inspect?url=${encodeURIComponent(safeUrl)}`, {
      method: "GET",
      timeoutMs: 10000,
    });
  }

  async sendMessageStream(
    payload,
    {
      onStart,
      onToolStart,
      onToolResult,
      onStatus,
      onDelta,
      onDone,
      onError,
      signal,
      timeoutMs = 300000,
    } = {},
  ) {
    const controller = new AbortController();
    const requestTimeout = Number(timeoutMs || 300000);
    const timer = window.setTimeout(() => controller.abort("timeout"), requestTimeout);
    const abortByCaller = () => controller.abort("caller-abort");
    if (signal) {
      if (signal.aborted) {
        const abortError = new Error("REQUEST_ABORTED");
        abortError.code = "ABORTED";
        throw abortError;
      }
      signal.addEventListener("abort", abortByCaller, { once: true });
    }

    try {
      const response = await fetch(buildEndpoint(this.config.baseUrl, "/chat/stream"), {
        method: "POST",
        headers: this.createHeaders({
          hasBody: true,
          extra: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
        }),
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        const payloadError = contentType.includes("application/json")
          ? await response.json()
          : await response.text();
        const detail = describeErrorPayload(payloadError);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }

      if (!response.body) {
        throw new Error("Поток ответа недоступен.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let shouldStopReading = false;
      const dispatchEvent = (block) => {
        const parsed = parseSseEvent(block);
        if (!parsed) {
          return "";
        }
        if (parsed.event === "start") {
          onStart?.(parsed.data || {});
          return "start";
        }
        if (parsed.event === "delta") {
          onDelta?.(parsed.data || {});
          return "delta";
        }
        if (parsed.event === "tool_start") {
          onToolStart?.(parsed.data || {});
          return "tool_start";
        }
        if (parsed.event === "tool_result") {
          onToolResult?.(parsed.data || {});
          return "tool_result";
        }
        if (parsed.event === "status") {
          onStatus?.(parsed.data || {});
          return "status";
        }
        if (parsed.event === "done") {
          onDone?.(parsed.data || {});
          shouldStopReading = true;
          return "done";
        }
        if (parsed.event === "error") {
          onError?.(parsed.data || {});
          shouldStopReading = true;
          return "error";
        }
        return parsed.event;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const normalized = buffer.replace(/\r\n?/g, "\n");
        const blocks = normalized.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          dispatchEvent(block);
          if (shouldStopReading) {
            break;
          }
        }
        if (shouldStopReading) {
          try {
            await reader.cancel();
          } catch {
            // no-op: stream might already be closed.
          }
          break;
        }
      }

      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail && !shouldStopReading) {
        dispatchEvent(tail);
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        if (signal?.aborted) {
          const abortError = new Error("REQUEST_ABORTED");
          abortError.code = "ABORTED";
          throw abortError;
        }
        throw new Error("Превышено время ожидания запроса");
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
      if (signal) {
        signal.removeEventListener("abort", abortByCaller);
      }
    }
  }

  async stopChatGeneration() {
    return this.request("/chat/stop", {
      method: "POST",
      body: {},
      timeoutMs: 8000,
    });
  }

  async listChats() {
    return this.request("/chats", { method: "GET" });
  }

  async createChat(payload) {
    return this.request("/chats", {
      method: "POST",
      body: payload || {},
    });
  }

  async updateChat(chatId, payload) {
    const safeChatId = encodePathSegment(chatId);
    return this.request(`/chats/${safeChatId}`, {
      method: "PATCH",
      body: payload || {},
    });
  }

  async deleteChat(chatId) {
    const safeChatId = encodePathSegment(chatId);
    return this.request(`/chats/${safeChatId}`, {
      method: "DELETE",
    });
  }

  async duplicateChat(chatId, payload) {
    const safeChatId = encodePathSegment(chatId);
    return this.request(`/chats/${safeChatId}/duplicate`, {
      method: "POST",
      body: payload || {},
    });
  }

  async clearChatMessages(chatId) {
    const safeChatId = encodePathSegment(chatId);
    return this.request(`/chats/${safeChatId}/messages`, {
      method: "DELETE",
    });
  }

  async updateMessage(chatId, messageId, payload) {
    const safeChatId = encodePathSegment(chatId);
    const safeMessageId = encodePathSegment(messageId);
    return this.request(`/chats/${safeChatId}/messages/${safeMessageId}`, {
      method: "PATCH",
      body: payload || {},
    });
  }

  async deleteMessage(chatId, messageId) {
    const safeChatId = encodePathSegment(chatId);
    const safeMessageId = encodePathSegment(messageId);
    return this.request(`/chats/${safeChatId}/messages/${safeMessageId}`, {
      method: "DELETE",
    });
  }

  async getChatHistory(chatId, limit = 40) {
    const safeChatId = encodePathSegment(chatId);
    const safeLimit = Number(limit) > 0 ? Number(limit) : 40;
    return this.request(`/chats/${safeChatId}/history?limit=${encodeURIComponent(String(safeLimit))}`, {
      method: "GET",
    });
  }
}
