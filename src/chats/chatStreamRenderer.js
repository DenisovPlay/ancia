import { resolveSeasonalLogoPath } from "../app/seasonalLogo.js";

const CHAT_STREAM_SWITCH_OUT_MS = 110;
const CHAT_STREAM_SWITCH_IN_MS = 210;
const CHAT_HISTORY_STAGGER_MS = 18;
const CHAT_HISTORY_STAGGER_CAP_MS = 180;
const CHAT_HISTORY_ANIMATED_LIMIT = 12;

export function createChatStreamRenderer({
  chatStreamElement,
  isMotionEnabled,
  getActiveChatSession,
  getAppendMessage,
  resolveStoredToolPayload,
}) {
  let transitionToken = 0;

  function renderChatEmptyState() {
    if (!chatStreamElement) {
      return;
    }
    chatStreamElement.innerHTML = "";

    const title = `
  <div data-chat-empty="true" class="w-full h-full flex items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center">
      <img src="${resolveSeasonalLogoPath()}" alt="Ancia" class="h-16 w-16 rounded-xl object-cover opacity-80">
      <div class="flex flex-col gap-1.5">
        <span class="text-xl font-semibold text-zinc-300 tracking-tight">Привет, что у тебя сегодня?</span>
        <span class="text-sm text-zinc-600">Напиши любой вопрос.</span>
      </div>
    </div>
  </div>
  `;

    chatStreamElement.innerHTML = title;
  }

  function renderActiveChatMessages({ animateEntries = false, transition = false } = {}) {
    if (!chatStreamElement) {
      return;
    }

    const nextTransitionToken = ++transitionToken;
    const shouldTransition = Boolean(transition && isMotionEnabled());

    const commitRender = () => {
      if (!chatStreamElement || nextTransitionToken !== transitionToken) {
        return;
      }

      const activeSession = getActiveChatSession();
      chatStreamElement.innerHTML = "";

      if (!activeSession || !Array.isArray(activeSession.messages) || activeSession.messages.length === 0) {
        renderChatEmptyState();
        return;
      }

      const appendMessage = getAppendMessage();
      if (typeof appendMessage !== "function") {
        return;
      }

      activeSession.messages.forEach((message, index) => {
        const shouldAnimateEntry = Boolean(animateEntries && index < CHAT_HISTORY_ANIMATED_LIMIT);
        const storedToolPayload = resolveStoredToolPayload(message);
        appendMessage(message.role, message.text, message.metaSuffix, {
          persist: false,
          animate: shouldAnimateEntry,
          animationDelayMs: shouldAnimateEntry ? Math.min(index * CHAT_HISTORY_STAGGER_MS, CHAT_HISTORY_STAGGER_CAP_MS) : 0,
          autoScroll: false,
          timestamp: message.timestamp,
          messageId: message.id,
          meta: message.meta && typeof message.meta === "object" ? message.meta : {},
          toolPayload: storedToolPayload || undefined,
          toolPhase: "result",
        });
      });

      chatStreamElement.scrollTo({
        top: chatStreamElement.scrollHeight,
        behavior: "auto",
      });
    };

    if (!shouldTransition) {
      chatStreamElement.classList.remove("chat-stream-switch-out", "chat-stream-switch-in");
      commitRender();
      return;
    }

    chatStreamElement.classList.remove("chat-stream-switch-in");
    chatStreamElement.classList.add("chat-stream-switch-out");
    window.setTimeout(() => {
      if (!chatStreamElement || nextTransitionToken !== transitionToken) {
        return;
      }

      commitRender();
      chatStreamElement.classList.remove("chat-stream-switch-out");
      chatStreamElement.classList.add("chat-stream-switch-in");
      window.setTimeout(() => {
        if (!chatStreamElement || nextTransitionToken !== transitionToken) {
          return;
        }
        chatStreamElement.classList.remove("chat-stream-switch-in");
      }, CHAT_STREAM_SWITCH_IN_MS);
    }, CHAT_STREAM_SWITCH_OUT_MS);
  }

  function appendTypingIndicator() {
    if (!chatStreamElement) {
      return null;
    }

    const wrapper = document.createElement("article");
    wrapper.className = `message-row${isMotionEnabled() ? " animate-rise-in" : ""}`;
    wrapper.dataset.role = "assistant";
    wrapper.dataset.typing = "true";

    const card = document.createElement("div");
    card.className = "message-content message-content-assistant";

    const dots = document.createElement("div");
    dots.className = "typing-indicator";
    dots.innerHTML = "<span></span><span></span><span></span>";

    const meta = document.createElement("p");
    meta.className = "message-meta";
    meta.textContent = "печатает...";

    card.append(dots, meta);
    wrapper.append(card);
    chatStreamElement.appendChild(wrapper);
    chatStreamElement.scrollTo({
      top: chatStreamElement.scrollHeight,
      behavior: isMotionEnabled() ? "smooth" : "auto",
    });
    return wrapper;
  }

  return {
    renderChatEmptyState,
    renderActiveChatMessages,
    appendTypingIndicator,
  };
}
