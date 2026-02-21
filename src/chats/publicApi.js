export function createChatPublicApi({
  backendClient,
  getActiveChatId,
  getChatSessionById,
  isBackendRuntimeEnabled,
  runBackendChatMutation,
  clearActiveChatMessages,
  clearChatMessagesById,
  deleteChatSessionById,
  duplicateChatSessionById,
  renameChatSessionById,
  editMessageById,
  deleteMessageById,
  sanitizeSessionTitle,
  tryApplyChatStoreFromMutation,
  syncChatStoreFromBackend,
  exportChatStorePayload,
  importChatStorePayload,
  listChatSessions,
}) {
  async function clearActiveChatHistory() {
    const chatId = getActiveChatId();
    if (!chatId) {
      return false;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.clearChatMessages(chatId),
          { preserveActive: true, preferredActiveId: chatId },
        );
        return true;
      } catch {
        return false;
      }
    }

    return clearActiveChatMessages();
  }

  async function clearChat(chatId) {
    const targetChatId = chatId || getActiveChatId();
    if (!targetChatId) {
      return false;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.clearChatMessages(targetChatId),
          { preserveActive: true, preferredActiveId: targetChatId },
        );
        return true;
      } catch {
        return false;
      }
    }

    return clearChatMessagesById(targetChatId);
  }

  async function deleteChat(chatId) {
    const targetChatId = chatId || getActiveChatId();
    if (!targetChatId) {
      return false;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.deleteChat(targetChatId),
          { preserveActive: false, preferredActiveId: "" },
        );
        return true;
      } catch {
        return false;
      }
    }

    return deleteChatSessionById(targetChatId);
  }

  async function duplicateChat(chatId) {
    const targetChatId = chatId || getActiveChatId();
    if (!targetChatId) {
      return null;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        const response = await backendClient.duplicateChat(targetChatId, {});
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

        return response?.chat || null;
      } catch {
        return null;
      }
    }

    return duplicateChatSessionById(targetChatId);
  }

  async function renameChat(chatId, title) {
    const targetChatId = chatId || getActiveChatId();
    if (!targetChatId) {
      return null;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        const safeTitle = sanitizeSessionTitle(title, getChatSessionById(targetChatId)?.title || "Новая сессия");
        const response = await runBackendChatMutation(
          () => backendClient.updateChat(targetChatId, { title: safeTitle }),
          { preserveActive: true, preferredActiveId: targetChatId },
        );
        return response?.chat?.title || safeTitle;
      } catch {
        return null;
      }
    }

    return renameChatSessionById(targetChatId, title);
  }

  async function renameActiveChat(title) {
    const activeChatId = getActiveChatId();
    if (!activeChatId) {
      return null;
    }
    return renameChat(activeChatId, title);
  }

  async function editMessage(messageId, text, chatId = getActiveChatId()) {
    if (!chatId || !messageId) {
      return false;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.updateMessage(chatId, messageId, { text }),
          { preserveActive: true, preferredActiveId: chatId },
        );
        return true;
      } catch {
        return false;
      }
    }

    return editMessageById(chatId, messageId, text);
  }

  async function deleteMessage(messageId, chatId = getActiveChatId()) {
    if (!chatId || !messageId) {
      return false;
    }

    if (isBackendRuntimeEnabled()) {
      try {
        await runBackendChatMutation(
          () => backendClient.deleteMessage(chatId, messageId),
          { preserveActive: true, preferredActiveId: chatId },
        );
        return true;
      } catch {
        return false;
      }
    }

    return deleteMessageById(chatId, messageId);
  }

  function exportChats() {
    return exportChatStorePayload();
  }

  function importChats(payload) {
    try {
      return importChatStorePayload(payload);
    } catch (error) {
      return {
        error: String(error?.message || error),
      };
    }
  }

  function listChats() {
    return listChatSessions();
  }

  return {
    clearActiveChatHistory,
    clearChat,
    deleteChat,
    duplicateChat,
    renameActiveChat,
    renameChat,
    editMessage,
    deleteMessage,
    exportChats,
    importChats,
    listChats,
  };
}
