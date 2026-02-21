import { normalizeTextInput } from "../ui/messageFormatter.js";

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fallback below
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

export function createChatContextMenuActions({
  getDefaultContext,
  pushToast,
  getChatSessionButtons,
  setActiveChatSession,
  getChatSessionById,
  requestActionText,
  sanitizeSessionTitle,
  isBackendRuntimeEnabled,
  runBackendChatMutation,
  backendClient,
  renameChatSessionById,
  duplicateChatSessionById,
  tryApplyChatStoreFromMutation,
  syncChatStoreFromBackend,
  clearChatMessagesById,
  deleteChatSessionById,
  getMessageRecord,
  elements,
  syncComposerState,
  canEditMessageInUI,
  editMessageById,
  requestActionConfirm,
  deleteMessageById,
}) {
  async function executeContextMenuAction(actionId, context = {}) {
    const defaults = getDefaultContext?.() || {};
    const chatId = String(context.chatId ?? defaults.chatId ?? "").trim();
    const messageId = String(context.messageId ?? defaults.messageId ?? "").trim();
    const isChatAction = String(actionId || "").startsWith("chat-");
    const isMessageAction = String(actionId || "").startsWith("message-");

    if (isChatAction && !chatId) {
      pushToast("Не удалось определить чат для действия.", { tone: "error", durationMs: 3200 });
      return;
    }
    if (isMessageAction && (!chatId || !messageId)) {
      pushToast("Не удалось определить сообщение для действия.", { tone: "error", durationMs: 3200 });
      return;
    }

    if (actionId === "chat-open") {
      const targetButton = getChatSessionButtons().find((button) => button.dataset.sessionId === chatId) || null;
      if (targetButton) {
        setActiveChatSession(targetButton);
      }
      return;
    }

    if (actionId === "chat-rename") {
      const session = getChatSessionById(chatId);
      const promptBaseTitle = session?.title || chatId;
      const nextTitle = await requestActionText("Введите новое название чата.", promptBaseTitle, {
        title: "Переименование чата",
        confirmLabel: "Сохранить",
        placeholder: "Название чата",
      });
      if (nextTitle == null) {
        return;
      }
      const safeTitle = sanitizeSessionTitle(nextTitle, promptBaseTitle);
      if (isBackendRuntimeEnabled()) {
        try {
          await runBackendChatMutation(
            () => backendClient.updateChat(chatId, { title: safeTitle }),
            { preserveActive: true, preferredActiveId: chatId },
          );
          pushToast("Чат переименован.", { tone: "success" });
        } catch (error) {
          const localRenamed = renameChatSessionById(chatId, safeTitle);
          if (localRenamed) {
            pushToast(`Сервер недоступен, чат переименован локально: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось переименовать чат: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      if (!session) {
        pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
        return;
      }

      const renamed = renameChatSessionById(chatId, safeTitle);
      if (renamed) {
        pushToast("Чат переименован.", { tone: "success" });
      }
      return;
    }

    if (actionId === "chat-duplicate") {
      if (isBackendRuntimeEnabled()) {
        try {
          const response = await backendClient.duplicateChat(chatId, {});
          const duplicatedId = String(response?.chat?.id || "").trim();
          const applied = tryApplyChatStoreFromMutation(response, {
            preserveActive: false,
            preferredActiveId: duplicatedId,
          });
          if (!applied) {
            await syncChatStoreFromBackend({
              preserveActive: false,
              preferredActiveId: duplicatedId,
              silent: true,
            });
          }
          const duplicatedTitle = String(response?.chat?.title || "дубликат");
          pushToast(`Создан дубликат «${duplicatedTitle}».`, { tone: "success" });
        } catch (error) {
          const duplicated = duplicateChatSessionById(chatId);
          if (duplicated) {
            pushToast(`Сервер недоступен, создан локальный дубликат: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось дублировать чат: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      const duplicated = duplicateChatSessionById(chatId);
      if (duplicated) {
        pushToast(`Создан дубликат «${duplicated.title}».`, { tone: "success" });
      }
      return;
    }

    if (actionId === "chat-clear") {
      const session = getChatSessionById(chatId);
      const sessionLabel = session?.title || chatId;
      const allow = await requestActionConfirm(`Очистить историю чата «${sessionLabel}»?`, {
        title: "Очистка истории",
        confirmLabel: "Очистить",
        danger: true,
      });
      if (!allow) {
        return;
      }

      if (isBackendRuntimeEnabled()) {
        try {
          await runBackendChatMutation(
            () => backendClient.clearChatMessages(chatId),
            { preserveActive: true, preferredActiveId: chatId },
          );
          pushToast("История чата очищена.", { tone: "success" });
        } catch (error) {
          const cleared = clearChatMessagesById(chatId);
          if (cleared) {
            pushToast(`Сервер недоступен, чат очищен локально: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось очистить чат: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      if (!session) {
        pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
        return;
      }

      const cleared = clearChatMessagesById(chatId);
      if (cleared) {
        pushToast("История чата очищена.", { tone: "success" });
      }
      return;
    }

    if (actionId === "chat-delete") {
      const session = getChatSessionById(chatId);
      const sessionLabel = session?.title || chatId;
      const allow = await requestActionConfirm(`Удалить чат «${sessionLabel}»?`, {
        title: "Удаление чата",
        confirmLabel: "Удалить",
        danger: true,
      });
      if (!allow) {
        return;
      }

      if (isBackendRuntimeEnabled()) {
        try {
          await runBackendChatMutation(
            () => backendClient.deleteChat(chatId),
            { preserveActive: false, preferredActiveId: "" },
          );
          pushToast("Чат удалён.", { tone: "success" });
        } catch (error) {
          const deleted = deleteChatSessionById(chatId);
          if (deleted) {
            pushToast(`Сервер недоступен, чат удалён локально: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось удалить чат: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      if (!session) {
        pushToast("Чат не найден в локальном хранилище.", { tone: "error", durationMs: 3200 });
        return;
      }

      const deleted = deleteChatSessionById(chatId);
      if (deleted) {
        pushToast("Чат удалён.", { tone: "success" });
      }
      return;
    }

    if (actionId === "message-copy") {
      const record = getMessageRecord(chatId, messageId);
      if (!record) {
        pushToast("Сообщение не найдено.", { tone: "error", durationMs: 3200 });
        return;
      }
      const copied = await copyTextToClipboard(record.message.text);
      pushToast(copied ? "Текст сообщения скопирован." : "Не удалось скопировать сообщение.", {
        tone: copied ? "success" : "error",
      });
      return;
    }

    if (actionId === "message-quote") {
      const record = getMessageRecord(chatId, messageId);
      if (!record || !elements.composerInput) {
        pushToast("Сообщение не найдено для цитирования.", { tone: "error", durationMs: 3200 });
        return;
      }
      const prefix = elements.composerInput.value.trim() ? `${elements.composerInput.value.trim()}\n\n` : "";
      const quoted = normalizeTextInput(record.message.text)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      elements.composerInput.value = `${prefix}${quoted}`;
      elements.composerInput.focus();
      syncComposerState();
      pushToast("Сообщение добавлено в поле ввода.", { tone: "success" });
      return;
    }

    if (actionId === "message-edit") {
      if (!canEditMessageInUI(chatId, messageId)) {
        pushToast("Редактирование доступно только для сообщений пользователя.", {
          tone: "warning",
          durationMs: 3200,
        });
        return;
      }

      const record = getMessageRecord(chatId, messageId);
      const currentText = record?.message?.text || "";
      const nextText = await requestActionText("Измените текст сообщения.", currentText, {
        title: "Редактирование сообщения",
        confirmLabel: "Сохранить",
        placeholder: "Текст сообщения",
      });
      if (nextText == null) {
        return;
      }

      if (!String(nextText).trim()) {
        pushToast("Текст сообщения не может быть пустым.", { tone: "error", durationMs: 3200 });
        return;
      }

      if (isBackendRuntimeEnabled()) {
        try {
          await runBackendChatMutation(
            () => backendClient.updateMessage(chatId, messageId, { text: nextText }),
            { preserveActive: true, preferredActiveId: chatId },
          );
          pushToast("Сообщение обновлено.", { tone: "success" });
        } catch (error) {
          const edited = editMessageById(chatId, messageId, nextText);
          if (edited) {
            pushToast(`Сервер недоступен, сообщение изменено локально: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось обновить сообщение: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      if (!record) {
        pushToast("Сообщение не найдено в локальном хранилище.", { tone: "error", durationMs: 3200 });
        return;
      }

      const edited = editMessageById(chatId, messageId, nextText);
      if (edited) {
        pushToast("Сообщение обновлено.", { tone: "success" });
      }
      return;
    }

    if (actionId === "message-delete") {
      const record = getMessageRecord(chatId, messageId);
      const allow = await requestActionConfirm("Удалить это сообщение?", {
        title: "Удаление сообщения",
        confirmLabel: "Удалить",
        danger: true,
      });
      if (!allow) {
        return;
      }

      if (isBackendRuntimeEnabled()) {
        try {
          await runBackendChatMutation(
            () => backendClient.deleteMessage(chatId, messageId),
            { preserveActive: true, preferredActiveId: chatId },
          );
          pushToast("Сообщение удалено.", { tone: "success" });
        } catch (error) {
          const deleted = deleteMessageById(chatId, messageId);
          if (deleted) {
            pushToast(`Сервер недоступен, сообщение удалено локально: ${error.message}`, {
              tone: "warning",
              durationMs: 4200,
            });
          } else {
            pushToast(`Не удалось удалить сообщение: ${error.message}`, { tone: "error", durationMs: 3600 });
          }
        }
        return;
      }

      if (!record) {
        pushToast("Сообщение не найдено в локальном хранилище.", { tone: "error", durationMs: 3200 });
        return;
      }

      const deleted = deleteMessageById(chatId, messageId);
      if (deleted) {
        pushToast("Сообщение удалено.", { tone: "success" });
      }
      return;
    }

    pushToast("Действие меню пока не поддерживается.", { tone: "warning", durationMs: 2600 });
  }

  return {
    executeContextMenuAction,
  };
}
