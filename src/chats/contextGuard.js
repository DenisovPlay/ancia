import { normalizeTextInput } from "../ui/messageFormatter.js";
import {
  BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE,
  BACKEND_HISTORY_MAX_MESSAGES,
  BACKEND_HISTORY_MAX_TOTAL_CHARS,
} from "./historyAndPersistence.js";

const DEFAULT_CONTEXT_WINDOW = 8192;
const DEFAULT_REQUIREMENTS = {
  system_prompt_tokens: 0,
  history_overhead_tokens: 48,
  reserve_tokens: 192,
  min_context_window: 1024,
};
const CONTEXT_REFRESH_DEBOUNCE_MS = 320;
const CONTEXT_REFRESH_STALE_MS = 90000;
const CONTEXT_USAGE_DEBOUNCE_MS = 220;
const POPOVER_CLOSE_DELAY_INDICATOR_LEAVE_MS = 1400;
const POPOVER_CLOSE_DELAY_PANEL_LEAVE_MS = 260;
const POPOVER_CLOSE_DELAY_FOCUS_LOST_MS = 180;
const SUMMARY_BUDGETS = [1200, 980, 760, 560, 420, 300];
const KEEP_TAIL_OPTIONS = [6, 5, 4, 3, 2];
const MAX_SUMMARY_ITEMS = 9;
const NEXT_REPLY_MODES = ["auto", "compressed", "full"];

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.max(min, Math.min(max, parsed));
}

function estimateTokens(text) {
  const safeText = normalizeTextInput(String(text || "")).trim();
  if (!safeText) {
    return 0;
  }
  return Math.max(1, Math.ceil(safeText.length / 4));
}

function formatExactTokens(value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  return safeValue.toLocaleString("ru-RU");
}

function normalizeHistoryEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const trimmed = entries
    .slice(-BACKEND_HISTORY_MAX_MESSAGES)
    .map((entry) => {
      const roleRaw = String(entry?.role || "").trim().toLowerCase();
      const role = ["user", "assistant", "system"].includes(roleRaw) ? roleRaw : "";
      if (!role) {
        return null;
      }
      let text = normalizeTextInput(String(entry?.text || "")).trim();
      if (!text) {
        return null;
      }
      if (text.length > BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE) {
        text = `${text.slice(0, BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE - 1).trimEnd()}…`;
      }
      return { role, text };
    })
    .filter(Boolean);

  const compact = [];
  let totalChars = 0;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const item = trimmed[index];
    const projected = totalChars + item.text.length;
    if (projected > BACKEND_HISTORY_MAX_TOTAL_CHARS && compact.length > 0) {
      break;
    }
    totalChars = projected;
    compact.push(item);
  }
  return compact.reverse();
}

function normalizeAttachmentEntries(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .slice(0, 10)
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }
      const kindRaw = String(attachment.kind || "").trim().toLowerCase();
      const kind = ["file", "image", "text", "document", "audio", "video"].includes(kindRaw)
        ? kindRaw
        : "file";
      return {
        id: String(attachment.id || ""),
        name: String(attachment.name || ""),
        kind,
        mimeType: String(attachment.mimeType || ""),
        size: Math.max(0, Number(attachment.size || 0)),
        textContent: String(attachment.textContent || ""),
        dataUrl: String(attachment.dataUrl || ""),
      };
    })
    .filter(Boolean);
}

function normalizePendingAssistantText(text) {
  const normalized = normalizeTextInput(String(text || "")).trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE) {
    return normalized;
  }
  return `${normalized.slice(0, BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE - 1).trimEnd()}…`;
}

function createEmptyUsage(contextWindow = DEFAULT_CONTEXT_WINDOW) {
  const safeWindow = Math.max(512, Math.floor(Number(contextWindow) || DEFAULT_CONTEXT_WINDOW));
  return {
    usedTokens: 0,
    contextWindow: safeWindow,
    ratio: 0,
    remaining: safeWindow,
    historyTokens: 0,
    draftTokens: 0,
    attachmentTokens: 0,
    pendingAssistantTokens: 0,
    systemPromptTokens: 0,
    historyOverheadTokens: 0,
    reserveTokens: 0,
    promptTokens: 0,
    rawUsedTokens: 0,
    exact: false,
    known: false,
    unavailableReason: "tokenizer_unavailable",
    tokenEstimationMode: "",
  };
}

function normalizeExactUsagePayload(rawUsage, contextWindowFallback = DEFAULT_CONTEXT_WINDOW) {
  const source = rawUsage && typeof rawUsage === "object" ? rawUsage : {};
  const contextWindow = Math.max(
    512,
    Math.floor(
      Number(source.context_window ?? source.contextWindow)
      || Number(contextWindowFallback)
      || DEFAULT_CONTEXT_WINDOW,
    ),
  );
  const reserveTokens = Math.max(0, Math.floor(Number(source.reserve_tokens ?? source.reserveTokens) || 0));
  const promptTokens = Math.max(0, Math.floor(Number(source.prompt_tokens ?? source.promptTokens) || 0));
  const pendingAssistantTokens = Math.max(
    0,
    Math.floor(Number(source.pending_assistant_tokens ?? source.pendingAssistantTokens) || 0),
  );
  const rawUsedTokens = Math.max(
    0,
    Math.floor(Number(source.used_tokens ?? source.usedTokens) || (promptTokens + pendingAssistantTokens)),
  );
  const usedTokens = Math.max(
    0,
    Math.floor(Number(source.effective_tokens ?? source.effectiveTokens) || rawUsedTokens),
  );
  const ratio = clamp(
    Number(source.ratio ?? (contextWindow > 0 ? usedTokens / contextWindow : 0)),
    0,
    2,
  );
  const remaining = Math.floor(
    Number(source.remaining_tokens ?? source.remainingTokens ?? (contextWindow - usedTokens)),
  );

  return {
    usedTokens,
    contextWindow,
    ratio,
    remaining,
    historyTokens: Math.max(0, Math.floor(Number(source.history_tokens ?? source.historyTokens) || 0)),
    draftTokens: Math.max(0, Math.floor(Number(source.draft_tokens ?? source.draftTokens) || 0)),
    attachmentTokens: Math.max(0, Math.floor(Number(source.attachment_tokens ?? source.attachmentTokens) || 0)),
    pendingAssistantTokens,
    systemPromptTokens: Math.max(
      0,
      Math.floor(Number(source.system_prompt_tokens ?? source.systemPromptTokens) || 0),
    ),
    historyOverheadTokens: Math.max(
      0,
      Math.floor(Number(source.history_overhead_tokens ?? source.historyOverheadTokens) || 0),
    ),
    reserveTokens,
    promptTokens,
    rawUsedTokens,
    exact: Boolean(source.exact ?? true),
    known: true,
    unavailableReason: "",
    tokenEstimationMode: String(source.token_estimation_mode || source.tokenEstimationMode || ""),
  };
}

function buildUsageSignature(payload) {
  try {
    return JSON.stringify(payload);
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function isTokenizerUnavailableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("tokenizer_unavailable")
    || message.includes("точный подсчёт токенов недоступен");
}

function resolveRoleLabel(role) {
  if (role === "assistant") {
    return "Ассистент";
  }
  if (role === "system") {
    return "Система";
  }
  return "Пользователь";
}

function normalizeSummarySnippet(text, maxChars = 220) {
  let safe = normalizeTextInput(String(text || ""))
    .replace(/\s+/g, " ")
    .replace(/```[\s\S]*?```/g, "[code]")
    .trim();
  if (!safe) {
    return "";
  }
  if (safe.length > maxChars) {
    safe = `${safe.slice(0, maxChars - 1).trimEnd()}…`;
  }
  return safe;
}

function scoreSummaryEntry(entry, index, total) {
  if (!entry || typeof entry !== "object") {
    return -1;
  }
  const text = String(entry.text || "");
  const role = String(entry.role || "");
  const recency = total > 0 ? index / total : 0;
  let score = recency * 32;

  if (role === "user") {
    score += 28;
  } else if (role === "assistant") {
    score += 14;
  }

  if (/\?/.test(text)) {
    score += 12;
  }
  if (/```|`[^`]+`/.test(text)) {
    score += 10;
  }
  if (/ошиб|error|fail|исправ|фикс|bug|warning|todo|сделай|нужно|добав/i.test(text)) {
    score += 14;
  }
  if (/https?:\/\/|\/[\w.-]+\.[a-z]{2,}|\b[a-z0-9_./-]+\.(js|ts|py|json|md|css|html)\b/i.test(text)) {
    score += 8;
  }
  if (/\d/.test(text)) {
    score += 4;
  }
  if (text.length > 240) {
    score += 6;
  }

  return score;
}

function buildExtractiveSummary(headEntries, maxChars) {
  if (!Array.isArray(headEntries) || headEntries.length === 0) {
    return "";
  }

  const entries = headEntries.filter((entry) => entry && entry.role !== "system");
  if (entries.length === 0) {
    return "";
  }

  const selected = [];
  const selectedKeys = new Set();
  const pushEntry = (entry) => {
    if (!entry) {
      return;
    }
    const snippet = normalizeSummarySnippet(entry.text, 220);
    if (!snippet) {
      return;
    }
    const key = `${entry.role}:${snippet.toLowerCase()}`;
    if (selectedKeys.has(key)) {
      return;
    }
    selectedKeys.add(key);
    selected.push({ role: entry.role, snippet });
  };

  const firstUser = entries.find((entry) => entry.role === "user");
  const lastUser = [...entries].reverse().find((entry) => entry.role === "user");
  const lastAssistant = [...entries].reverse().find((entry) => entry.role === "assistant");

  pushEntry(firstUser);
  pushEntry(lastUser);
  pushEntry(lastAssistant);

  const ranked = entries
    .map((entry, index) => ({
      entry,
      score: scoreSummaryEntry(entry, index, entries.length),
    }))
    .sort((a, b) => b.score - a.score);

  for (const candidate of ranked) {
    if (selected.length >= MAX_SUMMARY_ITEMS) {
      break;
    }
    pushEntry(candidate.entry);
  }

  const lines = [
    "Автосжатие истории (Context Guard). Системный промпт не изменялся.",
    "Ключевые фрагменты ранней части диалога:",
  ];

  selected.slice(0, MAX_SUMMARY_ITEMS).forEach((item) => {
    lines.push(`- ${resolveRoleLabel(item.role)}: ${item.snippet}`);
  });

  lines.push("Последние сообщения переданы полностью ниже.");

  const budget = Math.max(220, Math.floor(Number(maxChars) || 0));
  while (lines.length > 3 && lines.join("\n").length > budget) {
    lines.splice(lines.length - 2, 1);
  }

  let summary = lines.join("\n").trim();
  if (summary.length > budget) {
    summary = `${summary.slice(0, budget - 1).trimEnd()}…`;
  }
  return summary;
}

function resolveTailStartIndex(entries, keepTailDialogue) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const required = Math.max(1, Math.floor(Number(keepTailDialogue) || 0));
  let seen = 0;
  for (let index = safeEntries.length - 1; index >= 0; index -= 1) {
    if (safeEntries[index]?.role !== "system") {
      seen += 1;
      if (seen >= required) {
        return index;
      }
    }
  }
  return 0;
}

export function createContextGuardController({
  elements,
  runtimeConfig,
  backendClient,
  getChatHistoryForBackend,
  getActiveChatSessionId,
}) {
  const state = {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    requirements: { ...DEFAULT_REQUIREMENTS },
    modelId: "",
    fetchedAt: 0,
    fetchPromise: null,
    refreshTimer: 0,
    usageRefreshTimer: 0,
    usageFetchPromise: null,
    usageFetchSignature: "",
    usageRequestSeq: 0,
    loadingLimits: false,
    loadingUsage: false,
    usageError: "",
    lastUsageSignature: "",
    latestUsage: createEmptyUsage(DEFAULT_CONTEXT_WINDOW),
    latestDraftText: "",
    latestAttachments: [],
    pendingAssistantText: "",
    forcedHistoryOverrideByChat: new Map(),
    compressionLayersByChat: new Map(),
    nextReplyModeByChat: new Map(),
    actionsBound: false,
    popoverBound: false,
    popoverCloseTimer: 0,
    popoverHoverIndicator: false,
    popoverHoverPanel: false,
    popoverFocusWithin: false,
    popoverPinned: false,
  };

  function clearPopoverCloseTimer() {
    if (!state.popoverCloseTimer) {
      return;
    }
    window.clearTimeout(state.popoverCloseTimer);
    state.popoverCloseTimer = 0;
  }

  function setPopoverOpen(open = false) {
    if (!(elements.composerContextIndicator instanceof HTMLElement)) {
      return;
    }
    elements.composerContextIndicator.dataset.popoverOpen = open ? "true" : "false";
  }

  function isPopoverInteractiveTarget(target) {
    if (!(target instanceof Node)) {
      return false;
    }
    if (!(elements.composerContextIndicator instanceof HTMLElement)
      || !(elements.composerContextPopover instanceof HTMLElement)) {
      return false;
    }
    return elements.composerContextIndicator.contains(target) || elements.composerContextPopover.contains(target);
  }

  function shouldKeepPopoverOpen() {
    if (!(elements.composerContextIndicator instanceof HTMLElement)
      || !(elements.composerContextPopover instanceof HTMLElement)) {
      return false;
    }
    const activeEl = document.activeElement;
    if (activeEl instanceof Node && isPopoverInteractiveTarget(activeEl)) {
      return true;
    }
    if (elements.composerContextIndicator.matches(":hover") || elements.composerContextPopover.matches(":hover")) {
      return true;
    }
    return Boolean(
      state.popoverHoverIndicator
      || state.popoverHoverPanel
      || state.popoverFocusWithin
      || state.popoverPinned,
    );
  }

  function schedulePopoverClose(delayMs = 220) {
    clearPopoverCloseTimer();
    state.popoverCloseTimer = window.setTimeout(() => {
      state.popoverCloseTimer = 0;
      if (shouldKeepPopoverOpen()) {
        return;
      }
      setPopoverOpen(false);
    }, Math.max(0, Number(delayMs) || 0));
  }

  function getActiveChatKey() {
    return String(getActiveChatSessionId?.() || "default").trim() || "default";
  }

  function normalizeNextReplyMode(value) {
    const safeValue = String(value || "").trim().toLowerCase();
    return NEXT_REPLY_MODES.includes(safeValue) ? safeValue : "auto";
  }

  function getNextReplyMode(chatId = getActiveChatKey()) {
    const key = String(chatId || "").trim() || "default";
    return normalizeNextReplyMode(state.nextReplyModeByChat.get(key) || "auto");
  }

  function setNextReplyMode(mode = "auto", chatId = getActiveChatKey()) {
    const key = String(chatId || "").trim() || "default";
    const safeMode = normalizeNextReplyMode(mode);
    if (safeMode === "auto") {
      state.nextReplyModeByChat.delete(key);
    } else {
      state.nextReplyModeByChat.set(key, safeMode);
    }
    return safeMode;
  }

  function cycleNextReplyMode(chatId = getActiveChatKey()) {
    const current = getNextReplyMode(chatId);
    const index = NEXT_REPLY_MODES.indexOf(current);
    const next = NEXT_REPLY_MODES[(index + 1) % NEXT_REPLY_MODES.length];
    return setNextReplyMode(next, chatId);
  }

  function getCompressionLayers(chatId = getActiveChatKey()) {
    const key = String(chatId || "").trim() || "default";
    const payload = state.compressionLayersByChat.get(key);
    return Array.isArray(payload) ? payload : [];
  }

  function setCompressionLayers(chatId, layers) {
    const key = String(chatId || "").trim() || "default";
    const safeLayers = Array.isArray(layers) ? layers : [];
    if (safeLayers.length === 0) {
      state.compressionLayersByChat.delete(key);
      return;
    }
    state.compressionLayersByChat.set(key, safeLayers.slice(-120));
  }

  function clearCompressionLayers(chatId = getActiveChatKey()) {
    const key = String(chatId || "").trim() || "default";
    state.compressionLayersByChat.delete(key);
    state.forcedHistoryOverrideByChat.delete(key);
    state.nextReplyModeByChat.delete(key);
    refreshNow();
  }

  function getCompressionSummary(chatId = getActiveChatKey()) {
    const layers = getCompressionLayers(chatId);
    const totalSavedTokens = layers.reduce(
      (sum, layer) => sum + Math.max(0, Number(layer?.savedTokens || 0)),
      0,
    );
    const lastLayer = layers.length > 0 ? layers[layers.length - 1] : null;
    return {
      layersCount: layers.length,
      totalSavedTokens,
      lastLayer,
      nextReplyMode: getNextReplyMode(chatId),
      hasForcedOverride: state.forcedHistoryOverrideByChat.has(chatId),
    };
  }

  function getNextReplyModeLabel(mode = "auto") {
    if (mode === "compressed") {
      return "сжатая история";
    }
    if (mode === "full") {
      return "полная история";
    }
    return "авто";
  }

  function renderCompressionLayersList(chatId = getActiveChatKey()) {
    if (!(elements.composerContextLayersList instanceof HTMLElement)) {
      return;
    }
    const layers = getCompressionLayers(chatId);
    elements.composerContextLayersList.innerHTML = "";
    if (!Array.isArray(layers) || layers.length === 0) {
      const emptyNode = document.createElement("span");
      emptyNode.className = "composer-context-popover__layers-empty";
      emptyNode.textContent = "Слои пока не созданы";
      elements.composerContextLayersList.append(emptyNode);
      return;
    }

    const safeLayers = [...layers].slice(-6).reverse();
    const fragment = document.createDocumentFragment();
    safeLayers.forEach((layer, index) => {
      const strategy = String(layer?.strategy || "summary").trim();
      const sourceMessages = Math.max(0, Number(layer?.sourceMessages || 0));
      const targetMessages = Math.max(0, Number(layer?.targetMessages || 0));
      const savedTokens = Math.max(0, Number(layer?.savedTokens || 0));
      const unresolved = !Boolean(layer?.resolvedOverflow);
      const stateLabel = unresolved ? "overflow" : "ok";

      const rowNode = document.createElement("span");
      rowNode.className = "composer-context-popover__layer-row";
      rowNode.dataset.layerIndex = String(index);

      const mainNode = document.createElement("span");
      mainNode.className = "composer-context-popover__layer-main";
      mainNode.textContent = `${strategy}: ${sourceMessages} -> ${targetMessages}`;
      rowNode.append(mainNode);

      const sideNode = document.createElement("span");
      sideNode.className = "composer-context-popover__layer-side";
      sideNode.textContent = `${formatExactTokens(savedTokens)} • ${stateLabel}`;
      rowNode.append(sideNode);

      fragment.append(rowNode);
    });
    elements.composerContextLayersList.append(fragment);
  }

  function recordCompressionLayer({
    chatId = getActiveChatKey(),
    strategy = "",
    sourceMessages = 0,
    targetMessages = 0,
    savedTokens = 0,
    resolvedOverflow = false,
    beforeUsage = null,
    afterUsage = null,
    forceMode = false,
  } = {}) {
    const key = String(chatId || "").trim() || "default";
    const layers = getCompressionLayers(key);
    layers.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      strategy: String(strategy || "").trim() || "summary",
      sourceMessages: Math.max(0, Number(sourceMessages || 0)),
      targetMessages: Math.max(0, Number(targetMessages || 0)),
      savedTokens: Math.max(0, Number(savedTokens || 0)),
      resolvedOverflow: Boolean(resolvedOverflow),
      beforeUsage: beforeUsage && typeof beforeUsage === "object" ? normalizeExactUsagePayload(beforeUsage, state.contextWindow) : null,
      afterUsage: afterUsage && typeof afterUsage === "object" ? normalizeExactUsagePayload(afterUsage, state.contextWindow) : null,
      forceMode: Boolean(forceMode),
    });
    setCompressionLayers(key, layers);
  }

  function syncLoadingState() {
    const isLoading = Boolean(state.loadingLimits || state.loadingUsage);
    if (elements.composerContextIndicator instanceof HTMLElement) {
      elements.composerContextIndicator.dataset.loading = isLoading ? "true" : "false";
      elements.composerContextIndicator.setAttribute("aria-busy", isLoading ? "true" : "false");
    }
  }

  function setLoadingState({ limits = null, usage = null } = {}) {
    if (typeof limits === "boolean") {
      state.loadingLimits = limits;
    }
    if (typeof usage === "boolean") {
      state.loadingUsage = usage;
    }
    syncLoadingState();
  }

  function computeFallbackUsage({
    draftText = "",
    attachments = [],
    historyOverride = null,
    pendingAssistantText = state.pendingAssistantText,
  } = {}) {
    const historyEntries = normalizeHistoryEntries(
      Array.isArray(historyOverride)
        ? historyOverride
        : getChatHistoryForBackend?.(BACKEND_HISTORY_MAX_MESSAGES) || [],
    );
    const historyTokens = historyEntries.reduce((sum, item) => sum + estimateTokens(item.text), 0);
    const draftTokens = estimateTokens(draftText);
    const attachmentTokens = normalizeAttachmentEntries(attachments).reduce((sum, attachment) => {
      const textContent = normalizeTextInput(String(attachment?.textContent || "")).trim();
      if (textContent) {
        return sum + estimateTokens(textContent.slice(0, 3500));
      }
      if (attachment?.kind === "image") {
        return sum + 16;
      }
      return sum + estimateTokens(String(attachment?.name || ""));
    }, 0);
    const pendingAssistantTokens = estimateTokens(normalizePendingAssistantText(pendingAssistantText));
    const systemPromptTokens = Math.max(0, Number(state.requirements.system_prompt_tokens || 0));
    const historyOverheadTokens = Math.max(0, Number(state.requirements.history_overhead_tokens || 0));
    const reserveTokens = Math.max(0, Number(state.requirements.reserve_tokens || 0));
    const baselineTokens = Math.max(64, systemPromptTokens + historyOverheadTokens + reserveTokens);
    const usedTokens = Math.max(
      1,
      baselineTokens + historyTokens + draftTokens + attachmentTokens + pendingAssistantTokens,
    );
    const contextWindow = Math.max(512, Math.floor(Number(state.contextWindow) || DEFAULT_CONTEXT_WINDOW));
    const ratio = clamp(usedTokens / contextWindow, 0, 2);
    const remaining = Math.floor(contextWindow - usedTokens);

    return {
      usedTokens,
      contextWindow,
      ratio,
      remaining,
      historyTokens,
      draftTokens,
      attachmentTokens,
      pendingAssistantTokens,
      historyEntries,
      systemPromptTokens,
      historyOverheadTokens,
      reserveTokens,
      baselineTokens,
      exact: false,
      known: true,
      unavailableReason: "",
      tokenEstimationMode: "chars/4",
      promptTokens: 0,
      rawUsedTokens: usedTokens,
    };
  }

  function resolveCurrentUsage() {
    if (
      runtimeConfig.mode === "backend"
      && runtimeConfig.contextGuardPluginEnabled
      && state.latestUsage
      && typeof state.latestUsage === "object"
    ) {
      return state.latestUsage;
    }
    return computeFallbackUsage({
      draftText: state.latestDraftText,
      attachments: state.latestAttachments,
      pendingAssistantText: state.pendingAssistantText,
    });
  }

  function resolveUsageBreakdown(usage) {
    const historyTokens = Math.max(0, Math.floor(Number(usage?.historyTokens) || 0));
    const systemPromptTokens = Math.max(0, Math.floor(Number(usage?.systemPromptTokens) || 0));
    const draftTokens = Math.max(0, Math.floor(Number(usage?.draftTokens) || 0));
    const attachmentTokens = Math.max(0, Math.floor(Number(usage?.attachmentTokens) || 0));
    const pendingAssistantTokens = Math.max(0, Math.floor(Number(usage?.pendingAssistantTokens) || 0));
    const reserveTokens = Math.max(0, Math.floor(Number(usage?.reserveTokens) || 0));
    const promptTokens = Math.max(0, Math.floor(Number(usage?.promptTokens) || 0));
    const serviceTokens = Math.max(
      0,
      promptTokens - (historyTokens + systemPromptTokens + draftTokens + attachmentTokens),
    );
    return {
      historyTokens,
      systemPromptTokens,
      draftAndAttachmentTokens: Math.max(0, draftTokens + attachmentTokens),
      pendingAssistantTokens,
      reserveTokens,
      serviceTokens,
    };
  }

  function applyPopoverDetails(usage) {
    if (!(elements.composerContextPopover instanceof HTMLElement)) {
      return;
    }
    const breakdown = resolveUsageBreakdown(usage);
    const chatId = getActiveChatKey();
    const compressionSummary = getCompressionSummary(chatId);
    if (elements.composerContextLayers instanceof HTMLElement) {
      const baseValue = `${compressionSummary.layersCount}`;
      const savedTokens = Math.max(0, Number(compressionSummary.totalSavedTokens || 0));
      elements.composerContextLayers.textContent = savedTokens > 0
        ? `${baseValue} (${formatExactTokens(savedTokens)})`
        : baseValue;
    }
    if (elements.composerContextCycleMode instanceof HTMLButtonElement) {
      elements.composerContextCycleMode.textContent = `Следующий ответ: ${getNextReplyModeLabel(compressionSummary.nextReplyMode)}`;
    }
    renderCompressionLayersList(chatId);
    if (!runtimeConfig.contextGuardPluginEnabled) {
      state.popoverPinned = false;
      state.popoverHoverIndicator = false;
      state.popoverHoverPanel = false;
      state.popoverFocusWithin = false;
      setPopoverOpen(false);
      elements.composerContextPopover.setAttribute("aria-hidden", "true");
      if (elements.composerContextUsed instanceof HTMLElement) {
        elements.composerContextUsed.textContent = "—";
      }
      if (elements.composerContextMax instanceof HTMLElement) {
        elements.composerContextMax.textContent = "—";
      }
      if (elements.composerContextHistory instanceof HTMLElement) {
        elements.composerContextHistory.textContent = "—";
      }
      if (elements.composerContextSystem instanceof HTMLElement) {
        elements.composerContextSystem.textContent = "—";
      }
      if (elements.composerContextService instanceof HTMLElement) {
        elements.composerContextService.textContent = "—";
      }
      if (elements.composerContextDraft instanceof HTMLElement) {
        elements.composerContextDraft.textContent = "—";
      }
      if (elements.composerContextPending instanceof HTMLElement) {
        elements.composerContextPending.textContent = "—";
      }
      if (elements.composerContextReserve instanceof HTMLElement) {
        elements.composerContextReserve.textContent = "—";
      }
      renderCompressionLayersList(chatId);
      if (elements.composerContextCompressNow instanceof HTMLButtonElement) {
        elements.composerContextCompressNow.disabled = true;
      }
      if (elements.composerContextResetLayers instanceof HTMLButtonElement) {
        elements.composerContextResetLayers.disabled = true;
      }
      if (elements.composerContextCycleMode instanceof HTMLButtonElement) {
        elements.composerContextCycleMode.disabled = true;
      }
      return;
    }

    elements.composerContextPopover.setAttribute("aria-hidden", "false");
    if (elements.composerContextCompressNow instanceof HTMLButtonElement) {
      elements.composerContextCompressNow.disabled = false;
    }
    if (elements.composerContextResetLayers instanceof HTMLButtonElement) {
      elements.composerContextResetLayers.disabled = false;
    }
    if (elements.composerContextCycleMode instanceof HTMLButtonElement) {
      elements.composerContextCycleMode.disabled = false;
    }
    if (elements.composerContextUsed instanceof HTMLElement) {
      elements.composerContextUsed.textContent = usage.known === false ? "—" : formatExactTokens(usage.usedTokens);
    }
    if (elements.composerContextMax instanceof HTMLElement) {
      elements.composerContextMax.textContent = usage.known === false ? "—" : formatExactTokens(usage.contextWindow);
    }
    if (elements.composerContextHistory instanceof HTMLElement) {
      elements.composerContextHistory.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.historyTokens);
    }
    if (elements.composerContextSystem instanceof HTMLElement) {
      elements.composerContextSystem.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.systemPromptTokens);
    }
    if (elements.composerContextService instanceof HTMLElement) {
      elements.composerContextService.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.serviceTokens);
    }
    if (elements.composerContextDraft instanceof HTMLElement) {
      elements.composerContextDraft.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.draftAndAttachmentTokens);
    }
    if (elements.composerContextPending instanceof HTMLElement) {
      elements.composerContextPending.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.pendingAssistantTokens);
    }
    if (elements.composerContextReserve instanceof HTMLElement) {
      elements.composerContextReserve.textContent = usage.known === false ? "—" : formatExactTokens(breakdown.reserveTokens);
    }
  }

  function applyIndicator(usage) {
    if (!(elements.composerContextIndicator instanceof HTMLElement)
      || !(elements.composerContextRing instanceof HTMLElement)
      || !(elements.composerContextLabel instanceof HTMLElement)) {
      return;
    }

    if (!runtimeConfig.contextGuardPluginEnabled) {
      elements.composerContextIndicator.dataset.level = "off";
      elements.composerContextIndicator.dataset.loading = "false";
      elements.composerContextRing.style.setProperty("--ctx-ratio", "0");
      elements.composerContextLabel.textContent = "off";
      elements.composerContextIndicator.setAttribute("aria-busy", "false");
      if (elements.tokenCount instanceof HTMLElement) {
        elements.tokenCount.textContent = "—";
      }
      applyPopoverDetails(usage);
      return;
    }

    if (usage.known === false) {
      const isLoading = Boolean(state.loadingLimits || state.loadingUsage);
      elements.composerContextIndicator.dataset.level = "off";
      elements.composerContextIndicator.dataset.loading = isLoading ? "true" : "false";
      elements.composerContextIndicator.setAttribute("aria-busy", isLoading ? "true" : "false");
      elements.composerContextRing.style.setProperty("--ctx-ratio", "0");
      const unavailableReason = String(usage.unavailableReason || "").trim().toLowerCase();
      const unknownLabel = unavailableReason === "tokenizer_unavailable"
        ? "нет токенизатора"
        : "неизвестно";
      elements.composerContextLabel.textContent = isLoading ? "синхронизация" : unknownLabel;
      if (elements.tokenCount instanceof HTMLElement) {
        elements.tokenCount.textContent = "— / —";
      }
      applyPopoverDetails(usage);
      return;
    }

    const ratioPercent = Math.round(clamp(usage.ratio, 0, 1) * 100);
    const level = usage.ratio >= 1 ? "critical" : usage.ratio >= 0.85 ? "warn" : "ok";
    elements.composerContextIndicator.dataset.level = level;
    const isLoading = Boolean(state.loadingLimits || state.loadingUsage);
    elements.composerContextIndicator.dataset.loading = isLoading ? "true" : "false";
    elements.composerContextIndicator.setAttribute("aria-busy", isLoading ? "true" : "false");
    elements.composerContextRing.style.setProperty("--ctx-ratio", String(ratioPercent));
    elements.composerContextLabel.textContent = isLoading ? "синхронизация" : `${ratioPercent}%`;
    if (elements.tokenCount instanceof HTMLElement) {
      elements.tokenCount.textContent = `${formatExactTokens(usage.usedTokens)} / ${formatExactTokens(usage.contextWindow)}`;
    }
    applyPopoverDetails(usage);
  }

  function refreshNow() {
    const usage = resolveCurrentUsage();
    if (
      usage
      && runtimeConfig.mode === "backend"
      && runtimeConfig.contextGuardPluginEnabled
      && usage.exact !== true
    ) {
      usage.exact = false;
    }
    applyIndicator(usage);
    return usage;
  }

  function scheduleLimitsRefresh() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
    }
    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = 0;
      void refreshLimits();
    }, CONTEXT_REFRESH_DEBOUNCE_MS);
  }

  function scheduleUsageRefresh({ force = false, immediate = false } = {}) {
    if (state.usageRefreshTimer) {
      window.clearTimeout(state.usageRefreshTimer);
      state.usageRefreshTimer = 0;
    }
    if (immediate) {
      void refreshUsage({ force });
      return;
    }
    state.usageRefreshTimer = window.setTimeout(() => {
      state.usageRefreshTimer = 0;
      void refreshUsage({ force });
    }, CONTEXT_USAGE_DEBOUNCE_MS);
  }

  function applyRequirementsFromPayload(payload) {
    const requirements = payload?.context_window_requirements && typeof payload.context_window_requirements === "object"
      ? payload.context_window_requirements
      : {};
    const params = payload?.params && typeof payload.params === "object"
      ? payload.params
      : {};
    const rawModelContextLimit = Number(requirements.model_context_limit);
    const modelContextLimit = Number.isFinite(rawModelContextLimit) && rawModelContextLimit > 0
      ? Math.floor(clamp(rawModelContextLimit, 512, 262144))
      : 262144;
    const rawConfiguredContextWindow = Number(params.context_window);
    const configuredContextWindow = Number.isFinite(rawConfiguredContextWindow) && rawConfiguredContextWindow > 0
      ? Math.floor(clamp(rawConfiguredContextWindow, 256, modelContextLimit))
      : 0;
    const rawUsageWindow = Number(payload?.usage?.context_window ?? payload?.usage?.contextWindow);
    const usageContextWindow = Number.isFinite(rawUsageWindow) && rawUsageWindow > 0
      ? Math.floor(clamp(rawUsageWindow, 256, modelContextLimit))
      : 0;
    const minRequiredWindow = Math.floor(clamp(requirements.min_context_window, 512, modelContextLimit));

    state.contextWindow = usageContextWindow || configuredContextWindow || Math.max(minRequiredWindow, DEFAULT_CONTEXT_WINDOW);
    state.requirements = {
      system_prompt_tokens: Math.max(0, Number(requirements.system_prompt_tokens || state.requirements.system_prompt_tokens || 0)),
      history_overhead_tokens: Math.max(0, Number(requirements.history_overhead_tokens || state.requirements.history_overhead_tokens || 0)),
      reserve_tokens: Math.max(0, Number(requirements.reserve_tokens || state.requirements.reserve_tokens || 0)),
      min_context_window: Math.max(0, Number(requirements.min_context_window || state.requirements.min_context_window || 0)),
    };
  }

  function buildUsageRequestPayload({
    draftText = "",
    attachments = [],
    historyOverride = null,
    pendingAssistantText = state.pendingAssistantText,
    historyVariants = [],
  } = {}) {
    const historyEntries = normalizeHistoryEntries(
      Array.isArray(historyOverride)
        ? historyOverride
        : getChatHistoryForBackend?.(BACKEND_HISTORY_MAX_MESSAGES) || [],
    );
    const attachmentsPayload = normalizeAttachmentEntries(attachments);
    const variantsPayload = Array.isArray(historyVariants)
      ? historyVariants
        .map((variant) => normalizeHistoryEntries(Array.isArray(variant) ? variant : []))
        .filter((variant) => Array.isArray(variant) && variant.length > 0)
      : [];
    const safeModelId = String(runtimeConfig.modelId || state.modelId || "").trim().toLowerCase();
    const safeDraftText = normalizeTextInput(String(draftText || ""));
    const safePendingAssistantText = normalizePendingAssistantText(pendingAssistantText);

    return {
      body: {
        model_id: safeModelId,
        draft_text: safeDraftText,
        pending_assistant_text: safePendingAssistantText,
        history: historyEntries,
        attachments: attachmentsPayload,
        history_variants: variantsPayload,
      },
      signatureSeed: {
        model_id: safeModelId,
        draft_text: safeDraftText,
        pending_assistant_text: safePendingAssistantText,
        history: historyEntries,
        attachments: attachmentsPayload.map((attachment) => ({
          id: attachment.id,
          name: attachment.name,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          size: attachment.size,
          textContent: attachment.textContent.slice(0, 2400),
          dataUrlLen: String(attachment.dataUrl || "").length,
        })),
        history_variants: variantsPayload,
      },
      historyEntries,
      variantsPayload,
    };
  }

  function parseUsageResponse(responsePayload, { applyAsCurrent = true } = {}) {
    applyRequirementsFromPayload(responsePayload);
    const usage = normalizeExactUsagePayload(responsePayload?.usage, state.contextWindow);
    const variants = Array.isArray(responsePayload?.variants)
      ? responsePayload.variants
        .map((variant) => {
          const index = Number(variant?.index);
          if (!Number.isFinite(index) || index < 0) {
            return null;
          }
          return {
            index: Math.floor(index),
            usage: normalizeExactUsagePayload(variant?.usage, usage.contextWindow),
          };
        })
        .filter(Boolean)
      : [];

    if (applyAsCurrent) {
      state.latestUsage = usage;
      state.usageError = "";
    }
    return { usage, variants };
  }

  async function requestExactUsage({
    draftText = "",
    attachments = [],
    historyOverride = null,
    pendingAssistantText = state.pendingAssistantText,
    historyVariants = [],
    force = false,
    applyAsCurrent = true,
  } = {}) {
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.contextGuardPluginEnabled) {
      const usage = computeFallbackUsage({
        draftText,
        attachments,
        historyOverride,
        pendingAssistantText,
      });
      if (applyAsCurrent) {
        state.latestUsage = usage;
      }
      return {
        usage,
        variants: [],
      };
    }
    if (typeof backendClient.getModelContextUsage !== "function") {
      const usage = state.latestUsage?.exact
        ? state.latestUsage
        : createEmptyUsage(state.contextWindow);
      if (applyAsCurrent) {
        state.latestUsage = usage;
      }
      return { usage, variants: [] };
    }

    const requestPayload = buildUsageRequestPayload({
      draftText,
      attachments,
      historyOverride,
      pendingAssistantText,
      historyVariants,
    });
    const signature = buildUsageSignature(requestPayload.signatureSeed);
    const hasVariants = requestPayload.variantsPayload.length > 0;
    if (!force && !hasVariants && signature === state.lastUsageSignature && state.latestUsage?.exact) {
      return {
        usage: state.latestUsage,
        variants: [],
      };
    }

    if (!force && !hasVariants && state.usageFetchPromise && state.usageFetchSignature === signature) {
      return state.usageFetchPromise;
    }

    const requestSeq = state.usageRequestSeq + 1;
    state.usageRequestSeq = requestSeq;
    state.usageFetchSignature = signature;
    setLoadingState({ usage: true });
    refreshNow();

    const requestPromise = (async () => {
      const responsePayload = await backendClient.getModelContextUsage(requestPayload.body, {
        timeoutMs: 45000,
      });
      return parseUsageResponse(responsePayload, { applyAsCurrent });
    })();

    if (!hasVariants) {
      state.usageFetchPromise = requestPromise;
    }

    try {
      const result = await requestPromise;
      if (requestSeq === state.usageRequestSeq) {
        state.lastUsageSignature = signature;
        if (applyAsCurrent && result?.usage) {
          state.latestUsage = result.usage;
        }
      }
      return result;
    } catch (error) {
      if (requestSeq === state.usageRequestSeq) {
        state.usageError = String(error?.message || "Не удалось получить usage контекста");
      }
      if (isTokenizerUnavailableError(error)) {
        throw error;
      }
      if (applyAsCurrent && state.latestUsage?.exact) {
        return {
          usage: state.latestUsage,
          variants: [],
        };
      }
      const fallbackUsage = createEmptyUsage(state.contextWindow);
      if (applyAsCurrent) {
        state.latestUsage = fallbackUsage;
      }
      return {
        usage: fallbackUsage,
        variants: [],
      };
    } finally {
      if (!hasVariants && state.usageFetchPromise === requestPromise) {
        state.usageFetchPromise = null;
      }
      if (requestSeq === state.usageRequestSeq) {
        setLoadingState({ usage: false });
        refreshNow();
      }
    }
  }

  async function refreshUsage({ force = false } = {}) {
    try {
      await requestExactUsage({
        draftText: state.latestDraftText,
        attachments: state.latestAttachments,
        pendingAssistantText: state.pendingAssistantText,
        force,
        applyAsCurrent: true,
      });
    } catch (error) {
      if (isTokenizerUnavailableError(error)) {
        state.latestUsage = createEmptyUsage(state.contextWindow);
      }
    }
    return refreshNow();
  }

  async function refreshLimits({ force = false } = {}) {
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.contextGuardPluginEnabled) {
      setLoadingState({ limits: false, usage: false });
      refreshNow();
      return state.requirements;
    }
    const modelId = String(runtimeConfig.modelId || "").trim().toLowerCase();
    const stale = Date.now() - state.fetchedAt >= CONTEXT_REFRESH_STALE_MS;
    if (!force && !stale && modelId && state.modelId === modelId) {
      setLoadingState({ limits: false });
      return state.requirements;
    }
    if (state.fetchPromise) {
      setLoadingState({ limits: true });
      refreshNow();
      return state.fetchPromise;
    }

    setLoadingState({ limits: true });
    refreshNow();
    state.fetchPromise = (async () => {
      try {
        const payload = await backendClient.getModelContextRequirements(modelId);
        applyRequirementsFromPayload(payload);
        state.modelId = modelId;
        state.fetchedAt = Date.now();
      } catch {
        state.modelId = modelId || state.modelId;
      } finally {
        setLoadingState({ limits: false });
        state.fetchPromise = null;
        refreshNow();
      }
      return state.requirements;
    })();
    return state.fetchPromise;
  }

  function buildHistoryCandidate({ originalHistory, tailStartIndex, summaryText }) {
    const head = originalHistory.slice(0, tailStartIndex);
    const tail = originalHistory.slice(tailStartIndex);
    const preservedSystemHead = head.filter((entry) => entry.role === "system");

    if (!summaryText) {
      return [...preservedSystemHead, ...tail];
    }

    const summaryEntry = {
      role: "assistant",
      text: summaryText,
    };

    return [...preservedSystemHead, summaryEntry, ...tail];
  }

  async function compressHistory({
    draftText = "",
    attachments = [],
    baselineUsage = null,
    force = false,
  } = {}) {
    const originalHistory = normalizeHistoryEntries(getChatHistoryForBackend?.(BACKEND_HISTORY_MAX_MESSAGES) || []);
    if (originalHistory.length < 2) {
      return null;
    }

    const candidates = [];
    const signatureToIndex = new Map();
    const appendCandidate = (candidate) => {
      if (!candidate || !Array.isArray(candidate.historyOverride) || candidate.historyOverride.length === 0) {
        return;
      }
      const signature = buildUsageSignature(candidate.historyOverride);
      if (signatureToIndex.has(signature)) {
        return;
      }
      signatureToIndex.set(signature, candidates.length);
      candidates.push(candidate);
    };

    // ── AI-сжатие: пересказ середины через модель ──────────────────────────
    // Сохраняем последние N сообщений, середину пересказываем через модель.
    if (runtimeConfig.mode === "backend" && typeof backendClient.summarizeHistory === "function") {
      for (const keepTail of [6, 5, 4]) {
        const tailStartIndex = resolveTailStartIndex(originalHistory, keepTail);
        if (tailStartIndex <= 0 || tailStartIndex >= originalHistory.length) {
          continue;
        }
        const headEntries = originalHistory
          .slice(0, tailStartIndex)
          .filter((entry) => entry.role !== "system");
        if (headEntries.length < 1) {
          continue;
        }
        try {
          const resp = await backendClient.summarizeHistory(
            headEntries.map((entry) => ({ role: entry.role, text: entry.text })),
            { maxChars: 900, timeoutMs: 25000 },
          );
          const aiSummary = String(resp?.summary || "").trim();
          if (aiSummary.length >= 40) {
            const summaryBlock = `[Автосжатие: пересказ ${headEntries.length} сообщений]\n${aiSummary}`;
            const candidateHistory = buildHistoryCandidate({ originalHistory, tailStartIndex, summaryText: summaryBlock });
            appendCandidate({
              historyOverride: candidateHistory,
              sourceMessages: originalHistory.length,
              targetMessages: candidateHistory.length,
              strategy: "ai-summary",
            });
            break; // одного AI-варианта достаточно, остальное — fallback
          }
        } catch {
          break; // модель недоступна — переходим к extractive
        }
      }
    }

    // ── Extractive fallback (если AI недоступен или модель ещё не загружена) ─
    for (const keepTail of KEEP_TAIL_OPTIONS) {
      const tailStartIndex = resolveTailStartIndex(originalHistory, keepTail);
      if (tailStartIndex <= 0 || tailStartIndex >= originalHistory.length) {
        continue;
      }
      const headDialogEntries = originalHistory
        .slice(0, tailStartIndex)
        .filter((entry) => entry.role !== "system");
      if (headDialogEntries.length === 0) {
        continue;
      }
      for (const summaryBudget of SUMMARY_BUDGETS) {
        const summary = buildExtractiveSummary(headDialogEntries, summaryBudget);
        if (!summary) {
          continue;
        }
        const candidateHistory = buildHistoryCandidate({ originalHistory, tailStartIndex, summaryText: summary });
        appendCandidate({
          historyOverride: candidateHistory,
          sourceMessages: originalHistory.length,
          targetMessages: candidateHistory.length,
          strategy: "extractive-summary",
        });
      }
    }

    // ── Агрессивный fallback: только хвост ───────────────────────────────────
    for (const keepTail of [3, 2, 1]) {
      const tailStartIndex = resolveTailStartIndex(originalHistory, keepTail);
      if (tailStartIndex <= 0 || tailStartIndex >= originalHistory.length) {
        continue;
      }
      const candidateHistory = buildHistoryCandidate({ originalHistory, tailStartIndex, summaryText: "" });
      appendCandidate({
        historyOverride: candidateHistory,
        sourceMessages: originalHistory.length,
        targetMessages: candidateHistory.length,
        strategy: "tail-only",
      });
    }

    // ── Крайний случай: система + последнее сообщение пользователя ───────────
    const systemHead = originalHistory.filter((entry) => entry.role === "system");
    const lastUser = [...originalHistory].reverse().find((entry) => entry.role === "user");
    if (lastUser) {
      const emergencyHistory = [...systemHead, lastUser];
      appendCandidate({
        historyOverride: emergencyHistory,
        sourceMessages: originalHistory.length,
        targetMessages: emergencyHistory.length,
        strategy: "emergency-last-user",
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    let evaluation = null;
    try {
      evaluation = await requestExactUsage({
        draftText,
        attachments,
        historyOverride: originalHistory,
        pendingAssistantText: "",
        historyVariants: candidates.map((candidate) => candidate.historyOverride),
        force: true,
        applyAsCurrent: false,
      });
    } catch {
      return null;
    }

    const baseUsage = baselineUsage && typeof baselineUsage === "object"
      ? baselineUsage
      : normalizeExactUsagePayload(evaluation?.usage, state.contextWindow);
    const variantsMap = new Map(
      (Array.isArray(evaluation?.variants) ? evaluation.variants : [])
        .map((item) => [Number(item?.index), item?.usage])
        .filter(([index, usage]) => Number.isFinite(index) && usage && typeof usage === "object"),
    );

    let bestCandidate = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const usage = variantsMap.get(index);
      if (!usage) {
        continue;
      }
      const candidate = candidates[index];
      const savedTokens = Math.max(0, Number(baseUsage.usedTokens || 0) - Number(usage.usedTokens || 0));
      const resolvedOverflow = Number(usage.usedTokens || 0) <= Number(usage.contextWindow || 0);
      if (!bestCandidate || Number(usage.usedTokens || 0) < Number(bestCandidate.usage?.usedTokens || Infinity)) {
        bestCandidate = { ...candidate, usage, savedTokens, resolvedOverflow };
      }
      if (resolvedOverflow) {
        break;
      }
    }

    if (!bestCandidate) {
      return null;
    }
    if (!force && bestCandidate.savedTokens < 24) {
      return null;
    }
    if (Number(bestCandidate.usage.usedTokens || 0) >= Number(baseUsage.usedTokens || 0)) {
      return null;
    }
    return bestCandidate;
  }

  async function prepareRequest({
    draftText = "",
    attachments = [],
  } = {}) {
    const chatId = getActiveChatKey();
    const nextReplyMode = getNextReplyMode(chatId);
    state.latestDraftText = String(draftText || "");
    state.latestAttachments = normalizeAttachmentEntries(attachments);
    state.pendingAssistantText = "";

    await refreshLimits();
    let usage = null;
    try {
      const evaluation = await requestExactUsage({
        draftText,
        attachments: state.latestAttachments,
        pendingAssistantText: "",
        force: true,
        applyAsCurrent: true,
      });
      usage = evaluation?.usage || null;
    } catch {
      usage = null;
    }
    if (!usage) {
      usage = refreshNow();
    }
    applyIndicator(usage);

    const overflowed = Number(usage.usedTokens || 0) > Number(usage.contextWindow || 0);
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.contextGuardPluginEnabled) {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
        nextReplyMode,
      };
    }

    if (nextReplyMode === "full") {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
        nextReplyMode,
      };
    }

    const forcedOverride = state.forcedHistoryOverrideByChat.get(chatId);
    if (forcedOverride && Array.isArray(forcedOverride.historyOverride) && forcedOverride.historyOverride.length > 0) {
      try {
        const forcedEvaluation = await requestExactUsage({
          draftText,
          attachments: state.latestAttachments,
          historyOverride: forcedOverride.historyOverride,
          pendingAssistantText: "",
          force: true,
          applyAsCurrent: false,
        });
        const forcedUsage = forcedEvaluation?.usage || null;
        if (forcedUsage && Number(forcedUsage.usedTokens || 0) < Number(usage.usedTokens || 0)) {
          state.latestUsage = forcedUsage;
          applyIndicator(forcedUsage);
          recordCompressionLayer({
            chatId,
            strategy: String(forcedOverride.strategy || "manual-forced"),
            sourceMessages: Number(forcedOverride.sourceMessages || 0),
            targetMessages: Number(forcedOverride.targetMessages || 0),
            savedTokens: Math.max(0, Number(usage.usedTokens || 0) - Number(forcedUsage.usedTokens || 0)),
            resolvedOverflow: Number(forcedUsage.usedTokens || 0) <= Number(forcedUsage.contextWindow || 0),
            beforeUsage: usage,
            afterUsage: forcedUsage,
            forceMode: true,
          });
          state.forcedHistoryOverrideByChat.delete(chatId);
          return {
            usage: forcedUsage,
            previousUsage: usage,
            overflowed,
            compressed: true,
            historyOverride: forcedOverride.historyOverride,
            sourceMessages: Number(forcedOverride.sourceMessages || 0),
            targetMessages: Number(forcedOverride.targetMessages || 0),
            strategy: String(forcedOverride.strategy || "manual-forced"),
            savedTokens: Math.max(0, Number(usage.usedTokens || 0) - Number(forcedUsage.usedTokens || 0)),
            resolvedOverflow: Number(forcedUsage.usedTokens || 0) <= Number(forcedUsage.contextWindow || 0),
            forceMode: true,
            nextReplyMode,
          };
        }
      } catch {
        // ignored
      }
      state.forcedHistoryOverrideByChat.delete(chatId);
    }

    const shouldAttemptCompression = overflowed
      ? Boolean(runtimeConfig.contextGuardAutoCompress)
      : nextReplyMode === "compressed";

    if (!shouldAttemptCompression) {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
        nextReplyMode,
      };
    }

    const candidate = await compressHistory({
      draftText,
      attachments: state.latestAttachments,
      baselineUsage: usage,
      force: true,
    });
    if (!candidate || candidate.usage.usedTokens >= usage.usedTokens) {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
        nextReplyMode,
      };
    }

    state.latestUsage = candidate.usage;
    applyIndicator(candidate.usage);
    recordCompressionLayer({
      chatId,
      strategy: candidate.strategy,
      sourceMessages: candidate.sourceMessages,
      targetMessages: candidate.targetMessages,
      savedTokens: candidate.savedTokens,
      resolvedOverflow: candidate.resolvedOverflow,
      beforeUsage: usage,
      afterUsage: candidate.usage,
      forceMode: !overflowed,
    });

    return {
      usage: candidate.usage,
      previousUsage: usage,
      overflowed,
      compressed: true,
      historyOverride: candidate.historyOverride,
      sourceMessages: candidate.sourceMessages,
      targetMessages: candidate.targetMessages,
      strategy: candidate.strategy,
      savedTokens: candidate.savedTokens,
      resolvedOverflow: candidate.resolvedOverflow,
      forceMode: !overflowed,
      nextReplyMode,
    };
  }

  function sync({
    draftText = "",
    attachments = [],
    forceContextRefresh = false,
  } = {}) {
    state.latestDraftText = String(draftText || "");
    state.latestAttachments = normalizeAttachmentEntries(attachments);
    if (forceContextRefresh) {
      void refreshLimits({ force: true });
      scheduleUsageRefresh({ force: true, immediate: true });
      return refreshNow();
    }
    if (runtimeConfig.mode === "backend" && runtimeConfig.contextGuardPluginEnabled) {
      const modelId = String(runtimeConfig.modelId || "").trim().toLowerCase();
      const stale = Date.now() - state.fetchedAt >= CONTEXT_REFRESH_STALE_MS;
      if ((modelId && modelId !== state.modelId) || stale) {
        scheduleLimitsRefresh();
      }
      scheduleUsageRefresh();
    }
    return refreshNow();
  }

  function setPendingAssistantText(text = "") {
    const normalized = normalizePendingAssistantText(text);
    if (normalized === state.pendingAssistantText) {
      return refreshNow();
    }
    state.pendingAssistantText = normalized;
    if (runtimeConfig.mode === "backend" && runtimeConfig.contextGuardPluginEnabled) {
      scheduleUsageRefresh();
    }
    return refreshNow();
  }

  function clearPendingAssistantText() {
    if (!state.pendingAssistantText) {
      return refreshNow();
    }
    state.pendingAssistantText = "";
    if (runtimeConfig.mode === "backend" && runtimeConfig.contextGuardPluginEnabled) {
      scheduleUsageRefresh({ immediate: true });
    }
    return refreshNow();
  }

  async function compressNow({
    draftText = state.latestDraftText,
    attachments = state.latestAttachments,
  } = {}) {
    const chatId = getActiveChatKey();
    await refreshLimits({ force: true });
    let baselineUsage = null;
    try {
      const baselineEvaluation = await requestExactUsage({
        draftText,
        attachments,
        pendingAssistantText: "",
        force: true,
        applyAsCurrent: true,
      });
      baselineUsage = baselineEvaluation?.usage || null;
    } catch {
      baselineUsage = null;
    }
    if (!baselineUsage) {
      baselineUsage = refreshNow();
    }
    const candidate = await compressHistory({
      draftText,
      attachments,
      baselineUsage,
      force: true,
    });
    if (!candidate || !Array.isArray(candidate.historyOverride) || candidate.historyOverride.length === 0) {
      return {
        ok: false,
        reason: "no_candidate",
        usage: baselineUsage,
      };
    }
    state.forcedHistoryOverrideByChat.set(chatId, {
      historyOverride: candidate.historyOverride,
      strategy: candidate.strategy || "manual-forced",
      sourceMessages: candidate.sourceMessages,
      targetMessages: candidate.targetMessages,
      savedTokens: candidate.savedTokens,
    });
    state.latestUsage = candidate.usage;
    applyIndicator(candidate.usage);
    return {
      ok: true,
      usage: candidate.usage,
      previousUsage: baselineUsage,
      candidate,
    };
  }

  function bindContextActions() {
    if (state.actionsBound) {
      return;
    }
    state.actionsBound = true;

    elements.composerContextCompressNow?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!runtimeConfig.contextGuardPluginEnabled) {
        return;
      }
      await compressNow();
      refreshNow();
    });

    elements.composerContextResetLayers?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearCompressionLayers();
      refreshNow();
    });

    elements.composerContextCycleMode?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleNextReplyMode();
      refreshNow();
    });
  }

  function bindPopoverInteractions() {
    if (state.popoverBound) {
      return;
    }
    if (!(elements.composerContextIndicator instanceof HTMLElement)
      || !(elements.composerContextPopover instanceof HTMLElement)) {
      return;
    }
    state.popoverBound = true;
    setPopoverOpen(false);

    const openPopover = () => {
      clearPopoverCloseTimer();
      setPopoverOpen(true);
    };

    elements.composerContextIndicator.addEventListener("pointerenter", () => {
      state.popoverHoverIndicator = true;
      openPopover();
    });
    elements.composerContextIndicator.addEventListener("pointerleave", (event) => {
      state.popoverHoverIndicator = false;
      if (isPopoverInteractiveTarget(event?.relatedTarget)) {
        return;
      }
      schedulePopoverClose(POPOVER_CLOSE_DELAY_INDICATOR_LEAVE_MS);
    });

    elements.composerContextPopover.addEventListener("pointerenter", () => {
      state.popoverHoverPanel = true;
      openPopover();
    });
    elements.composerContextPopover.addEventListener("pointerleave", (event) => {
      state.popoverHoverPanel = false;
      if (isPopoverInteractiveTarget(event?.relatedTarget)) {
        return;
      }
      schedulePopoverClose(POPOVER_CLOSE_DELAY_PANEL_LEAVE_MS);
    });

    elements.composerContextIndicator.addEventListener("focusin", () => {
      state.popoverFocusWithin = true;
      openPopover();
    });
    elements.composerContextIndicator.addEventListener("focusout", (event) => {
      const relatedTarget = event?.relatedTarget;
      if (isPopoverInteractiveTarget(relatedTarget)) {
        return;
      }
      state.popoverFocusWithin = false;
      schedulePopoverClose(POPOVER_CLOSE_DELAY_FOCUS_LOST_MS);
    });

    elements.composerContextIndicator.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".composer-context-popover__action-btn")) {
        state.popoverPinned = true;
        openPopover();
        return;
      }
      state.popoverPinned = !state.popoverPinned;
      if (state.popoverPinned) {
        openPopover();
      } else {
        schedulePopoverClose(0);
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (isPopoverInteractiveTarget(event.target)) {
        return;
      }
      state.popoverPinned = false;
      schedulePopoverClose(0);
    });

    elements.composerContextIndicator.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      clearPopoverCloseTimer();
      state.popoverPinned = false;
      state.popoverHoverIndicator = false;
      state.popoverHoverPanel = false;
      state.popoverFocusWithin = false;
      setPopoverOpen(false);
      elements.composerContextIndicator.blur();
    });
  }

  bindContextActions();
  bindPopoverInteractions();
  refreshNow();

  return {
    sync,
    prepareRequest,
    refreshLimits,
    setPendingAssistantText,
    clearPendingAssistantText,
    compressNow,
    clearCompressionLayers,
    setNextReplyMode,
    getNextReplyMode,
    cycleNextReplyMode,
    getCompressionSummary,
  };
}
