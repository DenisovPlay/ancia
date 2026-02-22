import { normalizeTextInput } from "../ui/messageFormatter.js";
import { ASSISTANT_PENDING_LABEL, ROLE_STYLE_MAP } from "./messageUiCore/constants.js";
import { createMessageContentRenderer } from "./messageUiCore/contentRenderer.js";
import { createToolRenderer } from "./messageUiCore/toolRenderer.js";
import {
  isImageAttachment,
  normalizeAttachment,
} from "./attachmentUtils.js";

export { ASSISTANT_PENDING_LABEL };

export function createChatMessageUi({
  elements,
  isMotionEnabled,
  persistChatMessage,
  getActiveChatSessionId,
  normalizeToolName: normalizeToolNameExternal,
  lookupToolMeta,
  getPluginToolRenderer,
}) {
  const {
    renderMessageBody,
    renderPendingMessageBody,
    resolveMessageMeta,
    normalizeStreamMode,
    applyMetaStreamMode,
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
    getPluginToolRenderer,
    renderMessageBody,
  });

  function buildAttachmentListNode(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }
    const container = document.createElement("div");
    container.className = "message-attachments";
    container.setAttribute("data-message-attachments", "true");

    for (const item of items) {
      const card = document.createElement("section");
      card.className = "message-attachment";

      const preview = document.createElement("div");
      preview.className = "message-attachment__preview";
      if (isImageAttachment(item) && String(item.dataUrl || "").startsWith("data:image/")) {
        const image = document.createElement("img");
        image.className = "message-attachment__image";
        image.src = item.dataUrl;
        image.alt = item.name || "image";
        image.loading = "lazy";
        preview.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "message-attachment__badge";
        const nameParts = String(item.name || "").split(".");
        fallback.textContent = (nameParts.length > 1 ? nameParts.pop()?.slice(0, 4) : item.kind || "") || "file";
        preview.append(fallback);
      }

      const content = document.createElement("div");
      content.className = "message-attachment__content";

      const title = document.createElement("p");
      title.className = "message-attachment__name";
      title.textContent = item.name || "file";

      content.append(title);

      card.append(preview, content);
      container.append(card);
    }

    return container;
  }

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
    const safeMeta = options?.meta && typeof options.meta === "object" && !Array.isArray(options.meta)
      ? { ...options.meta }
      : {};
    const streamMode = normalizeStreamMode(options?.streamMode || safeMeta?.stream?.mode || "");
    const rawAttachments = Array.isArray(safeMeta.attachments) ? safeMeta.attachments : [];
    const messageAttachments = rawAttachments
      .map((item, index) => normalizeAttachment(item, index))
      .filter((item) => item.name || item.id);
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
        const displayText = (resolvedRole === "user" && messageAttachments.length > 0)
          ? text.replace(/\n*вложения:\n[\s\S]*/i, "").trimEnd()
          : text;
        renderMessageBody(body, displayText);
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
      applyMetaStreamMode(meta, resolvedRole === "assistant" && !pending ? streamMode : "");

      card.append(body, meta);

      if (resolvedRole === "user" && messageAttachments.length > 0) {
        const attachmentsList = buildAttachmentListNode(messageAttachments);
        if (attachmentsList) {
          const group = document.createElement("div");
          group.className = "message-attach-group";
          group.append(attachmentsList, card);
          wrapper.append(group);
        } else {
          wrapper.append(card);
        }
      } else {
        wrapper.append(card);
      }
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
        meta: safeMeta,
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
