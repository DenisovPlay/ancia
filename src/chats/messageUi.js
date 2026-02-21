import { normalizeTextInput } from "../ui/messageFormatter.js";
import { ASSISTANT_PENDING_LABEL, ROLE_STYLE_MAP } from "./messageUiCore/constants.js";
import { createMessageContentRenderer } from "./messageUiCore/contentRenderer.js";
import { createToolRenderer } from "./messageUiCore/toolRenderer.js";

export { ASSISTANT_PENDING_LABEL };

export function createChatMessageUi({
  elements,
  isMotionEnabled,
  persistChatMessage,
  getActiveChatSessionId,
  normalizeToolName: normalizeToolNameExternal,
  lookupToolMeta,
}) {
  const {
    renderMessageBody,
    renderPendingMessageBody,
    resolveMessageMeta,
    updateMessageRowContent,
  } = createMessageContentRenderer();
  const {
    normalizeLegacyToolName,
    resolveToolMeta,
    formatToolOutputText,
    buildToolCardInto,
    updateToolRow,
  } = createToolRenderer({
    normalizeToolName: normalizeToolNameExternal,
    lookupToolMeta,
    renderMessageBody,
  });

  function appendMessage(role, text, metaSuffix = "", options = {}) {
    if (!elements?.chatStream) {
      return null;
    }
    const emptyState = elements.chatStream.querySelector("[data-chat-empty='true']");
    if (emptyState instanceof HTMLElement) {
      emptyState.remove();
    } else if (!elements.chatStream.querySelector(".message-row")) {
      // Fallback for legacy empty-state markup without data attribute.
      elements.chatStream.innerHTML = "";
    }

    const persist = Boolean(options?.persist);
    const animate = options?.animate !== false;
    const autoScroll = options?.autoScroll !== false;
    const animationDelayMs = Math.max(0, Number(options?.animationDelayMs || 0));
    const activeChatId = String(getActiveChatSessionId?.() || "");
    const chatId = String(options?.chatId || activeChatId || "");
    const timestamp = options?.timestamp ? new Date(options.timestamp) : new Date();
    const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
    const resolvedRole = role in ROLE_STYLE_MAP ? role : "assistant";
    const pending = Boolean(options?.pending && resolvedRole === "assistant");
    const pendingLabel = String(options?.pendingLabel || ASSISTANT_PENDING_LABEL);
    const roleStyle = ROLE_STYLE_MAP[resolvedRole] || ROLE_STYLE_MAP.assistant;
    let messageId = String(options?.messageId || "").trim();

    const wrapper = document.createElement("article");
    const shouldAnimate = Boolean(isMotionEnabled?.() && animate);
    wrapper.className = `message-row${shouldAnimate ? " animate-rise-in" : ""}`;
    if (shouldAnimate && animationDelayMs > 0) {
      wrapper.style.animationDelay = `${animationDelayMs}ms`;
    }
    wrapper.dataset.role = resolvedRole;
    if (pending) {
      wrapper.dataset.pending = "true";
    }
    if (chatId) {
      wrapper.dataset.chatId = chatId;
    }

    if (resolvedRole === "tool") {
      const payload = options.toolPayload;
      if (payload) {
        buildToolCardInto(wrapper, payload, options.toolPhase || "result");
      } else {
        const rawText = String(text || "").trim();
        const [titleLine, ...detailLines] = rawText.split("\n");
        const rawToolName = String(titleLine || "").replace(/^вызов( инструмента)?\s*[:\-]?\s*/i, "").trim() || rawText || "Инструмент";
        const toolName = normalizeLegacyToolName(rawToolName);
        const detailsText = normalizeTextInput(detailLines.join("\n")).trim();
        const fallbackArgs = {};
        const genericColonMatch = rawToolName.match(/^([^:]+)\s*:\s*(.+)$/);
        if (genericColonMatch?.[2]) {
          const value = genericColonMatch[2].trim();
          if (/^https?:\/\//i.test(value)) {
            fallbackArgs.url = value;
          } else if (value) {
            fallbackArgs.query = value;
          }
        }
        buildToolCardInto(wrapper, {
          name: toolName,
          status: "ok",
          args: fallbackArgs,
          text: detailsText || rawText,
        }, "result");
      }

      const meta = document.createElement("p");
      meta.className = "message-meta";
      meta.setAttribute("data-message-meta", "true");
      const metaText = resolveMessageMeta(roleStyle, metaSuffix, safeTimestamp);
      if (!metaText) {
        meta.classList.add("hidden");
      } else {
        meta.textContent = metaText;
      }
      wrapper.append(meta);
    } else {
      const card = document.createElement("div");
      card.className = roleStyle.contentClass;

      const body = document.createElement("div");
      body.className = "message-body text-sm leading-6 text-zinc-100";
      body.setAttribute("data-message-body", "true");
      if (pending) {
        body.setAttribute("data-pending", "true");
        renderPendingMessageBody(body, pendingLabel);
      } else {
        renderMessageBody(body, text);
      }

      const meta = document.createElement("p");
      meta.className = "message-meta";
      meta.setAttribute("data-message-meta", "true");
      const metaText = resolveMessageMeta(roleStyle, metaSuffix, safeTimestamp);
      if (!metaText) {
        meta.classList.add("hidden");
      } else {
        meta.textContent = metaText;
      }

      card.append(body, meta);
      wrapper.append(card);
    }

    elements.chatStream.appendChild(wrapper);
    if (autoScroll) {
      elements.chatStream.scrollTo({
        top: elements.chatStream.scrollHeight,
        behavior: isMotionEnabled?.() ? "smooth" : "auto",
      });
    }

    if (persist && typeof persistChatMessage === "function") {
      const persisted = persistChatMessage({
        chatId,
        role: wrapper.dataset.role,
        text,
        metaSuffix,
        timestamp: safeTimestamp.toISOString(),
      });
      messageId = persisted?.id || messageId;
    }

    if (messageId) {
      wrapper.dataset.messageId = messageId;
    }

    return wrapper;
  }

  return {
    ASSISTANT_PENDING_LABEL,
    appendMessage,
    updateMessageRowContent,
    updateToolRow,
    normalizeLegacyToolName,
    resolveToolMeta,
    formatToolOutputText,
  };
}
