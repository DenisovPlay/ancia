import { normalizeTextInput, renderMessageHtml, typesetMathInElement } from "../../ui/messageFormatter.js";
import { ASSISTANT_PENDING_LABEL, ROLE_STYLE_MAP, getClockTime } from "./constants.js";

export function createMessageContentRenderer() {
  const mathTypesetDebounceByNode = new WeakMap();

  function normalizeStreamMode() {
    return "";
  }

  function applyMetaStreamMode(metaNode) {
    if (!(metaNode instanceof HTMLElement)) {
      return;
    }
    delete metaNode.dataset.streamMode;
    delete metaNode.dataset.streamLabel;
  }

  function scheduleMathTypeset(container) {
    if (!(container instanceof HTMLElement)) {
      return;
    }
    const previous = mathTypesetDebounceByNode.get(container);
    if (previous) {
      window.clearTimeout(previous);
    }
    const timer = window.setTimeout(() => {
      mathTypesetDebounceByNode.delete(container);
      void typesetMathInElement(container);
    }, 60);
    mathTypesetDebounceByNode.set(container, timer);
  }

  function renderMessageBody(body, text) {
    if (!(body instanceof HTMLElement)) {
      return;
    }
    body.innerHTML = renderMessageHtml(normalizeTextInput(text));
    scheduleMathTypeset(body);
  }

  function renderPendingMessageBody(body, label = ASSISTANT_PENDING_LABEL) {
    if (!(body instanceof HTMLElement)) {
      return;
    }
    body.innerHTML = "";

    const pending = document.createElement("span");
    pending.className = "message-pending";
    pending.setAttribute("role", "status");
    pending.setAttribute("aria-live", "polite");

    const orb = document.createElement("span");
    orb.className = "message-pending__orb";
    orb.setAttribute("aria-hidden", "true");

    const orbCore = document.createElement("span");
    orbCore.className = "message-pending__core";
    orb.append(orbCore);

    const pendingLabel = document.createElement("span");
    pendingLabel.className = "message-pending__label";
    pendingLabel.textContent = String(label || ASSISTANT_PENDING_LABEL).trim() || ASSISTANT_PENDING_LABEL;

    pending.append(orb, pendingLabel);
    body.append(pending);
  }

  function resolveMessageMeta(roleStyle, metaSuffix, timestamp) {
    const metaParts = [];
    if (roleStyle.metaPrefix && roleStyle.metaPrefix.trim()) {
      metaParts.push(roleStyle.metaPrefix.trim());
    }
    if (metaSuffix && String(metaSuffix).trim()) {
      metaParts.push(String(metaSuffix).trim());
    }
    if (metaParts.length === 0) {
      return "";
    }
    return `${metaParts.join(" • ")} • ${getClockTime(timestamp)}`;
  }

  function updateMessageRowContent(wrapper, {
    text = "",
    metaSuffix = "",
    timestamp = new Date(),
    pending = false,
    pendingLabel = ASSISTANT_PENDING_LABEL,
    streamMode = "",
  } = {}) {
    if (!(wrapper instanceof HTMLElement)) {
      return;
    }
    const role = String(wrapper.dataset.role || "assistant");
    const roleStyle = ROLE_STYLE_MAP[role] || ROLE_STYLE_MAP.assistant;

    const body = wrapper.querySelector("[data-message-body]");
    if (body instanceof HTMLElement) {
      if (pending) {
        wrapper.dataset.pending = "true";
        body.setAttribute("data-pending", "true");
        renderPendingMessageBody(body, pendingLabel);
      } else {
        delete wrapper.dataset.pending;
        body.removeAttribute("data-pending");
        renderMessageBody(body, text);
      }
    }

    const metaText = resolveMessageMeta(roleStyle, metaSuffix, timestamp);
    const metaNode = wrapper.querySelector("[data-message-meta]");
    if (metaNode instanceof HTMLElement) {
      if (!metaText) {
        metaNode.classList.add("hidden");
        metaNode.textContent = "";
        applyMetaStreamMode(metaNode, "");
      } else {
        metaNode.classList.remove("hidden");
        metaNode.textContent = metaText;
        applyMetaStreamMode(metaNode, pending ? "" : streamMode);
      }
    }
  }

  return {
    renderMessageBody,
    renderPendingMessageBody,
    resolveMessageMeta,
    normalizeStreamMode,
    applyMetaStreamMode,
    updateMessageRowContent,
  };
}
