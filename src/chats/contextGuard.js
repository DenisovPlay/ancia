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
const SUMMARY_BUDGETS = [1200, 980, 760, 560, 420, 300];
const KEEP_TAIL_OPTIONS = [6, 5, 4, 3, 2];
const MAX_SUMMARY_ITEMS = 9;

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

function formatCompactTokens(value) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }
  if (safeValue >= 1000) {
    return `${(safeValue / 1000).toFixed(1)}k`;
  }
  return String(safeValue);
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

function estimateAttachmentTokens(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return 0;
  }
  let total = 0;
  attachments.slice(0, 10).forEach((attachment) => {
    const textContent = normalizeTextInput(String(attachment?.textContent || "")).trim();
    if (textContent) {
      total += estimateTokens(textContent.slice(0, 3500));
      return;
    }
    const kind = String(attachment?.kind || "").trim().toLowerCase();
    if (kind === "image") {
      total += 16;
      return;
    }
    const name = normalizeTextInput(String(attachment?.name || "")).trim();
    if (name) {
      total += estimateTokens(name);
    }
  });
  return total;
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
}) {
  const state = {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    requirements: { ...DEFAULT_REQUIREMENTS },
    modelId: "",
    fetchedAt: 0,
    fetchPromise: null,
    refreshInFlight: false,
    refreshTimer: 0,
    latestDraftText: "",
    latestAttachments: [],
  };

  function applyLoadingState(isLoading) {
    state.refreshInFlight = Boolean(isLoading);
    if (elements.composerContextIndicator instanceof HTMLElement) {
      elements.composerContextIndicator.dataset.loading = state.refreshInFlight ? "true" : "false";
      elements.composerContextIndicator.setAttribute("aria-busy", state.refreshInFlight ? "true" : "false");
    }
  }

  function computeUsage({
    draftText = "",
    attachments = [],
    historyOverride = null,
  } = {}) {
    const historyEntries = normalizeHistoryEntries(
      Array.isArray(historyOverride)
        ? historyOverride
        : getChatHistoryForBackend?.(BACKEND_HISTORY_MAX_MESSAGES) || [],
    );
    const historyTokens = historyEntries.reduce((sum, item) => sum + estimateTokens(item.text), 0);
    const draftTokens = estimateTokens(draftText);
    const attachmentTokens = estimateAttachmentTokens(attachments);
    const systemPromptTokens = Math.max(0, Number(state.requirements.system_prompt_tokens || 0));
    const historyOverheadTokens = Math.max(0, Number(state.requirements.history_overhead_tokens || 0));
    const reserveTokens = Math.max(0, Number(state.requirements.reserve_tokens || 0));
    const baselineTokens = Math.max(64, systemPromptTokens + historyOverheadTokens + reserveTokens);
    const usedTokens = Math.max(1, baselineTokens + historyTokens + draftTokens + attachmentTokens);
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
      historyEntries,
      systemPromptTokens,
      historyOverheadTokens,
      reserveTokens,
      baselineTokens,
    };
  }

  function applyPopoverDetails(usage) {
    if (!(elements.composerContextPopover instanceof HTMLElement)) {
      return;
    }
    if (!runtimeConfig.contextGuardPluginEnabled) {
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
      return;
    }

    elements.composerContextPopover.setAttribute("aria-hidden", "false");
    if (elements.composerContextUsed instanceof HTMLElement) {
      elements.composerContextUsed.textContent = formatExactTokens(usage.usedTokens);
    }
    if (elements.composerContextMax instanceof HTMLElement) {
      elements.composerContextMax.textContent = formatExactTokens(usage.contextWindow);
    }
    if (elements.composerContextHistory instanceof HTMLElement) {
      elements.composerContextHistory.textContent = formatExactTokens(usage.historyTokens);
    }
    if (elements.composerContextSystem instanceof HTMLElement) {
      elements.composerContextSystem.textContent = formatExactTokens(usage.systemPromptTokens);
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
      elements.composerContextIndicator.title = "Context Guard отключён";
      elements.composerContextIndicator.setAttribute("aria-label", "Context Guard отключён");
      elements.composerContextIndicator.setAttribute("aria-busy", "false");
      if (elements.tokenCount instanceof HTMLElement) {
        elements.tokenCount.textContent = "—";
      }
      applyPopoverDetails(usage);
      return;
    }

    const ratioPercent = Math.round(clamp(usage.ratio, 0, 1) * 100);
    const level = usage.ratio >= 1 ? "critical" : usage.ratio >= 0.85 ? "warn" : "ok";
    elements.composerContextIndicator.dataset.level = level;
    elements.composerContextIndicator.dataset.loading = state.refreshInFlight ? "true" : "false";
    elements.composerContextIndicator.setAttribute("aria-busy", state.refreshInFlight ? "true" : "false");
    elements.composerContextRing.style.setProperty("--ctx-ratio", String(ratioPercent));
    elements.composerContextLabel.textContent = state.refreshInFlight ? "sync" : `${ratioPercent}%`;
    elements.composerContextIndicator.title = state.refreshInFlight
      ? `Контекст: ${formatCompactTokens(usage.usedTokens)} / ${formatCompactTokens(usage.contextWindow)} токенов (обновление лимитов...)`
      : `Контекст: ${formatCompactTokens(usage.usedTokens)} / ${formatCompactTokens(usage.contextWindow)} токенов`;
    elements.composerContextIndicator.setAttribute(
      "aria-label",
      `Использование контекста ${ratioPercent}%`,
    );
    if (elements.tokenCount instanceof HTMLElement) {
      elements.tokenCount.textContent = `${formatCompactTokens(usage.usedTokens)} / ${formatCompactTokens(usage.contextWindow)}`;
    }
    applyPopoverDetails(usage);
  }

  function refreshNow() {
    const usage = computeUsage({
      draftText: state.latestDraftText,
      attachments: state.latestAttachments,
    });
    applyIndicator(usage);
    return usage;
  }

  function scheduleRefresh() {
    if (state.refreshTimer) {
      window.clearTimeout(state.refreshTimer);
    }
    state.refreshTimer = window.setTimeout(() => {
      state.refreshTimer = 0;
      void refreshLimits();
    }, CONTEXT_REFRESH_DEBOUNCE_MS);
  }

  async function refreshLimits({ force = false } = {}) {
    if (runtimeConfig.mode !== "backend" || !runtimeConfig.contextGuardPluginEnabled) {
      applyLoadingState(false);
      refreshNow();
      return state.requirements;
    }
    const modelId = String(runtimeConfig.modelId || "").trim().toLowerCase();
    const stale = Date.now() - state.fetchedAt >= CONTEXT_REFRESH_STALE_MS;
    if (!force && !stale && modelId && state.modelId === modelId) {
      applyLoadingState(false);
      return state.requirements;
    }
    if (state.fetchPromise) {
      applyLoadingState(true);
      refreshNow();
      return state.fetchPromise;
    }

    applyLoadingState(true);
    refreshNow();
    state.fetchPromise = (async () => {
      try {
        const payload = await backendClient.getModelContextRequirements(modelId);
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
        const minRequiredWindow = Math.floor(clamp(requirements.min_context_window, 512, modelContextLimit));

        state.contextWindow = configuredContextWindow > 0
          ? configuredContextWindow
          : Math.max(minRequiredWindow, DEFAULT_CONTEXT_WINDOW);
        state.requirements = {
          system_prompt_tokens: Math.max(0, Number(requirements.system_prompt_tokens || 0)),
          history_overhead_tokens: Math.max(0, Number(requirements.history_overhead_tokens || 0)),
          reserve_tokens: Math.max(0, Number(requirements.reserve_tokens || 0)),
          min_context_window: Math.max(0, Number(requirements.min_context_window || 0)),
        };
        state.modelId = modelId;
        state.fetchedAt = Date.now();
      } catch {
        state.modelId = modelId || state.modelId;
      } finally {
        applyLoadingState(false);
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

  function compressHistory({
    draftText = "",
    attachments = [],
  } = {}) {
    const originalHistory = normalizeHistoryEntries(getChatHistoryForBackend?.(BACKEND_HISTORY_MAX_MESSAGES) || []);
    if (originalHistory.length < 4) {
      return null;
    }

    const originalUsage = computeUsage({ draftText, attachments, historyOverride: originalHistory });
    let bestCandidate = null;

    for (const keepTail of KEEP_TAIL_OPTIONS) {
      const tailStartIndex = resolveTailStartIndex(originalHistory, keepTail);
      if (tailStartIndex <= 0 || tailStartIndex >= originalHistory.length) {
        continue;
      }

      const head = originalHistory.slice(0, tailStartIndex);
      const headDialogEntries = head.filter((entry) => entry.role !== "system");
      if (headDialogEntries.length === 0) {
        continue;
      }

      const tailOnlyHistory = buildHistoryCandidate({
        originalHistory,
        tailStartIndex,
        summaryText: "",
      });
      const tailOnlyUsage = computeUsage({ draftText, attachments, historyOverride: tailOnlyHistory });
      if (!bestCandidate || tailOnlyUsage.usedTokens < bestCandidate.usage.usedTokens) {
        bestCandidate = {
          historyOverride: tailOnlyHistory,
          usage: tailOnlyUsage,
          sourceMessages: originalHistory.length,
          targetMessages: tailOnlyHistory.length,
          strategy: "tail-only",
          savedTokens: Math.max(0, originalUsage.usedTokens - tailOnlyUsage.usedTokens),
          resolvedOverflow: tailOnlyUsage.usedTokens <= tailOnlyUsage.contextWindow,
        };
      }

      for (const summaryBudget of SUMMARY_BUDGETS) {
        const summary = buildExtractiveSummary(headDialogEntries, summaryBudget);
        if (!summary) {
          continue;
        }

        const candidateHistory = buildHistoryCandidate({
          originalHistory,
          tailStartIndex,
          summaryText: summary,
        });
        const candidateUsage = computeUsage({
          draftText,
          attachments,
          historyOverride: candidateHistory,
        });

        if (!bestCandidate || candidateUsage.usedTokens < bestCandidate.usage.usedTokens) {
          bestCandidate = {
            historyOverride: candidateHistory,
            usage: candidateUsage,
            sourceMessages: originalHistory.length,
            targetMessages: candidateHistory.length,
            strategy: "extractive-summary",
            savedTokens: Math.max(0, originalUsage.usedTokens - candidateUsage.usedTokens),
            resolvedOverflow: candidateUsage.usedTokens <= candidateUsage.contextWindow,
          };
        }

        if (candidateUsage.usedTokens <= candidateUsage.contextWindow) {
          return bestCandidate;
        }
      }
    }

    if (
      bestCandidate
      && bestCandidate.savedTokens >= 24
      && bestCandidate.usage.usedTokens < originalUsage.usedTokens
    ) {
      return bestCandidate;
    }
    return null;
  }

  async function prepareRequest({
    draftText = "",
    attachments = [],
  } = {}) {
    state.latestDraftText = String(draftText || "");
    state.latestAttachments = Array.isArray(attachments) ? attachments : [];

    await refreshLimits();

    const usage = computeUsage({ draftText, attachments });
    applyIndicator(usage);

    const overflowed = usage.usedTokens > usage.contextWindow;
    if (
      runtimeConfig.mode !== "backend"
      || !runtimeConfig.contextGuardPluginEnabled
      || !runtimeConfig.contextGuardAutoCompress
      || !overflowed
    ) {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
      };
    }

    const candidate = compressHistory({ draftText, attachments });
    if (!candidate || candidate.usage.usedTokens >= usage.usedTokens) {
      return {
        usage,
        overflowed,
        compressed: false,
        historyOverride: null,
      };
    }

    applyIndicator(candidate.usage);

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
    };
  }

  function sync({
    draftText = "",
    attachments = [],
    forceContextRefresh = false,
  } = {}) {
    state.latestDraftText = String(draftText || "");
    state.latestAttachments = Array.isArray(attachments) ? attachments : [];
    if (forceContextRefresh) {
      void refreshLimits({ force: true });
      return refreshNow();
    }
    if (runtimeConfig.mode === "backend" && runtimeConfig.contextGuardPluginEnabled) {
      const modelId = String(runtimeConfig.modelId || "").trim().toLowerCase();
      const stale = Date.now() - state.fetchedAt >= CONTEXT_REFRESH_STALE_MS;
      if ((modelId && modelId !== state.modelId) || stale) {
        scheduleRefresh();
      }
    }
    return refreshNow();
  }

  return {
    sync,
    prepareRequest,
    refreshLimits,
  };
}
