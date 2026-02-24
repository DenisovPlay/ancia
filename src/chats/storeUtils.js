import { normalizeTextInput } from "../ui/messageFormatter.js";

export function createEmptyChatStore(chatStoreVersion) {
  return {
    version: chatStoreVersion,
    activeSessionId: "",
    sessions: [],
  };
}

export function normalizeChatMessage(entry, fallbackIndex = 0) {
  const roleCandidate = String(entry?.role || "").toLowerCase();
  const role = (roleCandidate === "user" || roleCandidate === "assistant" || roleCandidate === "tool")
    ? roleCandidate
    : "assistant";
  const rawText = entry?.text == null ? "" : String(entry.text);
  if (!rawText.trim()) {
    return null;
  }

  const parsedTimestamp = entry?.timestamp ? new Date(entry.timestamp) : null;
  const timestamp = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    ? parsedTimestamp.toISOString()
    : new Date(Date.now() + fallbackIndex).toISOString();

  const meta = entry?.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)
    ? { ...entry.meta }
    : {};

  return {
    id: String(entry?.id || `msg-${fallbackIndex + 1}`),
    role,
    text: normalizeTextInput(rawText),
    metaSuffix: String(entry?.metaSuffix || "").trim(),
    meta,
    timestamp,
  };
}

export function resolveStoredToolPayload(message) {
  if (!message || String(message.role || "").toLowerCase() !== "tool") {
    return null;
  }

  const meta = message.meta && typeof message.meta === "object" ? message.meta : {};
  const name = String(meta.tool_name || meta.toolName || "").trim();
  const displayName = String(meta.tool_display_name || meta.toolDisplayName || "").trim();
  const status = String(meta.status || meta.tool_status || meta.toolStatus || "ok").trim().toLowerCase() || "ok";
  const output = meta.tool_output && typeof meta.tool_output === "object" ? meta.tool_output : (
    meta.toolOutput && typeof meta.toolOutput === "object" ? meta.toolOutput : null
  );
  const args = meta.tool_args && typeof meta.tool_args === "object" ? meta.tool_args : (
    meta.toolArgs && typeof meta.toolArgs === "object" ? meta.toolArgs : {}
  );
  const badge = meta.tool_badge && typeof meta.tool_badge === "object" ? meta.tool_badge : (
    meta.toolBadge && typeof meta.toolBadge === "object" ? meta.toolBadge : null
  );
  if (!name && !output && !Object.keys(args).length) {
    return null;
  }

  return {
    name: name || "tool",
    display_name: displayName || undefined,
    status,
    output: output || undefined,
    args,
    badge: badge || undefined,
    text: normalizeTextInput(String(message.text || "")),
  };
}

export function normalizeChatSession(entry, fallbackIndex = 0) {
  const title = String(entry?.title || "").trim() || `Сессия ${fallbackIndex + 1}`;
  const createdRaw = entry?.createdAt ? new Date(entry.createdAt) : null;
  const updatedRaw = entry?.updatedAt ? new Date(entry.updatedAt) : null;
  const createdAt = createdRaw && !Number.isNaN(createdRaw.getTime())
    ? createdRaw.toISOString()
    : new Date().toISOString();
  const updatedAt = updatedRaw && !Number.isNaN(updatedRaw.getTime())
    ? updatedRaw.toISOString()
    : createdAt;
  const messages = Array.isArray(entry?.messages)
    ? entry.messages
      .map((message, index) => normalizeChatMessage(message, index))
      .filter(Boolean)
    : [];

  return {
    id: String(entry?.id || `chat-${fallbackIndex + 1}`),
    title,
    createdAt,
    updatedAt,
    mood: entry?.mood ? String(entry.mood).trim().toLowerCase() : "",
    messages,
  };
}

export function createDefaultChatStore(chatStoreVersion) {
  const now = Date.now();
  const chat1Created = new Date(now - 3600 * 1000 * 8).toISOString();
  const chat2Created = new Date(now - 3600 * 1000 * 26).toISOString();

  return {
    version: chatStoreVersion,
    activeSessionId: "chat-1",
    sessions: [
      {
        id: "chat-1",
        title: "Оболочка интерфейса и состояния фона",
        createdAt: chat1Created,
        updatedAt: new Date(now - 3600 * 1000 * 6).toISOString(),
        mood: "route_chat",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            text: "Обновил оболочку чата под стиль Ancial и добавил заготовку состояний бота для фоновой анимации.",
            metaSuffix: "",
            timestamp: new Date(now - 3600 * 1000 * 8 + 1000).toISOString(),
          },
          {
            id: "msg-2",
            role: "user",
            text: "Нужно чтобы фон менялся по состоянию: ошибка, ожидание, успех.",
            metaSuffix: "",
            timestamp: new Date(now - 3600 * 1000 * 8 + 4000).toISOString(),
          },
          {
            id: "msg-3",
            role: "tool",
            text: "Вызов инструмента: DuckDuckGO",
            metaSuffix: "инструмент",
            timestamp: new Date(now - 3600 * 1000 * 8 + 7000).toISOString(),
          },
        ],
      },
      {
        id: "chat-2",
        title: "План интеграции Python-бэкенда",
        createdAt: chat2Created,
        updatedAt: chat2Created,
        mood: "",
        messages: [
          {
            id: "msg-1",
            role: "assistant",
            text: "Сессия для планирования интеграции готова. Можем описать API-контракт и этапы.",
            metaSuffix: "черновик",
            timestamp: new Date(now - 3600 * 1000 * 26 + 2000).toISOString(),
          },
        ],
      },
    ],
  };
}

export function normalizeChatStore(raw, { runtimeMode, chatStoreVersion }) {
  const fallback = runtimeMode === "backend"
    ? createEmptyChatStore(chatStoreVersion)
    : createDefaultChatStore(chatStoreVersion);

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map((session, index) => normalizeChatSession(session, index)).filter(Boolean)
    : [];

  if (sessions.length === 0) {
    return fallback;
  }

  const uniqueSessions = [];
  const seenIds = new Set();
  sessions.forEach((session, index) => {
    const sessionId = String(session.id || `chat-${index + 1}`);
    if (seenIds.has(sessionId)) {
      return;
    }
    seenIds.add(sessionId);
    uniqueSessions.push({
      ...session,
      id: sessionId,
    });
  });

  const activeSessionId = String(raw.activeSessionId || "").trim();
  const hasActive = uniqueSessions.some((session) => session.id === activeSessionId);

  return {
    version: chatStoreVersion,
    activeSessionId: hasActive ? activeSessionId : uniqueSessions[0].id,
    sessions: uniqueSessions,
  };
}

export function loadChatStore({ runtimeMode, storageKey, chatStoreVersion }) {
  if (runtimeMode === "backend") {
    return createEmptyChatStore(chatStoreVersion);
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return createDefaultChatStore(chatStoreVersion);
    }
    return normalizeChatStore(JSON.parse(raw), { runtimeMode, chatStoreVersion });
  } catch (error) {
    return createDefaultChatStore(chatStoreVersion);
  }
}

export function persistChatStore({ runtimeMode, storageKey, chatStoreVersion, store }) {
  if (runtimeMode === "backend") {
    return;
  }
  const normalized = normalizeChatStore(store, { runtimeMode, chatStoreVersion });
  window.localStorage.setItem(storageKey, JSON.stringify(normalized));
}

export function syncChatSessionIdSeed(sessionId, currentSeed = 0) {
  const match = /^chat-(\d+)$/.exec(String(sessionId || "").trim());
  if (!match) {
    return currentSeed;
  }
  return Math.max(currentSeed, Number(match[1]));
}
