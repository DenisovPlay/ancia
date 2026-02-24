export function createChatContextMenuController({
  menuElement,
  isMotionEnabled,
  clamp,
  transitionMs,
  canEditMessage,
  pushToast,
  onAction,
}) {
  const CHAT_CONTEXT_MENU_ITEMS = [
    { id: "chat-open", label: "Открыть чат" },
    { id: "chat-rename", label: "Переименовать чат" },
    { id: "chat-duplicate", label: "Дублировать чат" },
    { id: "chat-export", label: "Экспорт чата" },
    { id: "chat-clear", label: "Очистить историю" },
    { divider: true },
    { id: "chat-import", label: "Импорт чатов" },
    { id: "chat-delete", label: "Удалить чат", tone: "danger" },
  ];

  const MESSAGE_CONTEXT_MENU_ITEMS = [
    { id: "message-copy", label: "Копировать текст" },
    { id: "message-quote", label: "Вставить в поле ввода" },
    { id: "message-edit", label: "Редактировать сообщение" },
    { divider: true },
    { id: "message-delete", label: "Удалить сообщение", tone: "danger" },
  ];

  const state = {
    open: false,
    kind: "",
    chatId: "",
    messageId: "",
    closeTimerId: null,
    openRafId: 0,
    transitionToken: 0,
  };

  function getMessageContextMenuItems(chatId, messageId) {
    if (canEditMessage(chatId, messageId)) {
      return MESSAGE_CONTEXT_MENU_ITEMS;
    }
    return MESSAGE_CONTEXT_MENU_ITEMS.filter((item) => item.id !== "message-edit");
  }

  function getSnapshot() {
    return {
      kind: state.kind,
      chatId: state.chatId,
      messageId: state.messageId,
    };
  }

  function finalizeClose({ clearItems = true } = {}) {
    if (!menuElement) {
      return;
    }

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }
    if (state.openRafId) {
      window.cancelAnimationFrame(state.openRafId);
      state.openRafId = 0;
    }

    menuElement.classList.remove("is-open", "is-closing");
    menuElement.classList.add("hidden");
    menuElement.setAttribute("aria-hidden", "true");
    if (clearItems) {
      menuElement.innerHTML = "";
    }
  }

  function close({ immediate = false } = {}) {
    if (!menuElement) {
      return;
    }

    const hasVisibleMenu = state.open
      || menuElement.classList.contains("is-open")
      || menuElement.classList.contains("is-closing");
    if (!hasVisibleMenu) {
      return;
    }

    state.open = false;
    state.kind = "";
    state.chatId = "";
    state.messageId = "";

    const shouldAnimate = isMotionEnabled()
      && !immediate
      && menuElement.classList.contains("is-open");
    if (!shouldAnimate) {
      finalizeClose({ clearItems: true });
      return;
    }

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }
    if (state.openRafId) {
      window.cancelAnimationFrame(state.openRafId);
      state.openRafId = 0;
    }

    const transitionToken = ++state.transitionToken;
    menuElement.classList.remove("is-open");
    menuElement.classList.add("is-closing");
    menuElement.setAttribute("aria-hidden", "true");
    state.closeTimerId = window.setTimeout(() => {
      if (transitionToken !== state.transitionToken) {
        return;
      }
      state.closeTimerId = null;
      finalizeClose({ clearItems: true });
    }, transitionMs);
  }

  function renderItems(items) {
    if (!menuElement) {
      return;
    }
    const fragment = document.createDocumentFragment();
    let menuItemIndex = 0;
    items.forEach((item) => {
      if (item.divider) {
        const divider = document.createElement("div");
        divider.className = "context-menu__divider";
        divider.setAttribute("role", "separator");
        fragment.appendChild(divider);
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-menu__item";
      button.dataset.contextAction = item.id;
      button.style.setProperty("--context-item-index", String(menuItemIndex));
      button.textContent = item.label;
      button.setAttribute("role", "menuitem");
      if (item.tone) {
        button.dataset.tone = item.tone;
      }
      fragment.appendChild(button);
      menuItemIndex += 1;
    });
    menuElement.innerHTML = "";
    menuElement.appendChild(fragment);
  }

  function position(x, y) {
    if (!menuElement) {
      return;
    }

    const margin = 10;
    const rect = menuElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = clamp(x, margin, Math.max(margin, viewportWidth - rect.width - margin));
    const top = clamp(y, margin, Math.max(margin, viewportHeight - rect.height - margin));
    menuElement.style.left = `${left}px`;
    menuElement.style.top = `${top}px`;
  }

  function open({ kind, chatId = "", messageId = "", x = 0, y = 0 }) {
    if (!menuElement) {
      return;
    }

    const isChatMenu = kind === "chat";
    const isMessageMenu = kind === "message";
    if (!isChatMenu && !isMessageMenu) {
      close();
      return;
    }

    state.open = true;
    state.kind = kind;
    state.chatId = chatId;
    state.messageId = messageId;

    if (state.closeTimerId != null) {
      window.clearTimeout(state.closeTimerId);
      state.closeTimerId = null;
    }
    if (state.openRafId) {
      window.cancelAnimationFrame(state.openRafId);
      state.openRafId = 0;
    }

    const menuItems = isChatMenu
      ? CHAT_CONTEXT_MENU_ITEMS
      : getMessageContextMenuItems(chatId, messageId);
    renderItems(menuItems);
    const transitionToken = ++state.transitionToken;
    menuElement.classList.remove("hidden", "is-open", "is-closing");
    menuElement.setAttribute("aria-hidden", "false");
    position(x, y);
    if (!isMotionEnabled()) {
      menuElement.classList.add("is-open");
      return;
    }

    state.openRafId = window.requestAnimationFrame(() => {
      state.openRafId = 0;
      if (!state.open || transitionToken !== state.transitionToken) {
        return;
      }
      menuElement.classList.add("is-open");
    });
  }

  function isOpen() {
    return state.open;
  }

  function bind() {
    menuElement?.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });

    menuElement?.addEventListener("click", async (event) => {
      const actionButton = event.target instanceof Element
        ? event.target.closest("[data-context-action]")
        : null;
      if (!(actionButton instanceof HTMLButtonElement)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const actionId = actionButton.dataset.contextAction || "";
      const snapshot = getSnapshot();
      close();
      try {
        await onAction(actionId, snapshot);
      } catch (error) {
        pushToast(`Сбой выполнения действия: ${error.message}`, { tone: "error", durationMs: 3600 });
      }
    });
  }

  return {
    bind,
    open,
    close,
    isOpen,
    getSnapshot,
  };
}
