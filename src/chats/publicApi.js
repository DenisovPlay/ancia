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
  function buildMarkdownExport(storePayload = {}) {
    const safeStore = storePayload && typeof storePayload === "object" ? storePayload : {};
    const sessions = Array.isArray(safeStore.sessions) ? safeStore.sessions : [];
    const lines = [
      "<!-- ancia-chat-export:1 -->",
      "# Экспорт чатов Ancia",
      "",
      `_Дата: ${new Date().toISOString()}_`,
      "",
    ];
    const roleLabel = {
      user: "Пользователь",
      assistant: "Ассистент",
      tool: "Инструмент",
      system: "Система",
    };
    sessions.forEach((session) => {
      const chatId = String(session?.id || "").trim();
      const title = String(session?.title || "Новая сессия").trim() || "Новая сессия";
      lines.push(`## Чат: ${title}`);
      if (chatId) {
        lines.push(`\`${chatId}\``);
      }
      lines.push("");
      const messages = Array.isArray(session?.messages) ? session.messages : [];
      messages.forEach((message) => {
        const role = String(message?.role || "assistant").trim().toLowerCase();
        const timestamp = String(message?.timestamp || "").trim();
        const header = `${roleLabel[role] || role}${timestamp ? ` • ${timestamp}` : ""}`;
        lines.push(`### ${header}`);
        const text = String(message?.text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
        if (text) {
          lines.push("```text");
          lines.push(text);
          lines.push("```");
        } else {
          lines.push("_Пусто_");
        }
        lines.push("");
      });
    });
    lines.push("---");
    lines.push("");
    lines.push("```ancia-json");
    lines.push(JSON.stringify(safeStore, null, 2));
    lines.push("```");
    lines.push("");
    return lines.join("\n");
  }

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

  async function exportChats(formatOrOptions = "json", options = {}) {
    const resolvedOptions = formatOrOptions && typeof formatOrOptions === "object"
      ? formatOrOptions
      : options;
    const format = String(
      formatOrOptions && typeof formatOrOptions === "object"
        ? resolvedOptions.format
        : formatOrOptions,
    ).trim().toLowerCase() || "json";
    const chatId = String(resolvedOptions?.chatId || resolvedOptions?.chat_id || "").trim();

    if (isBackendRuntimeEnabled()) {
      return backendClient.exportChats({
        format,
        chatId,
      });
    }
    const storePayloadRaw = exportChatStorePayload();
    const storePayload = typeof storePayloadRaw === "string"
      ? JSON.parse(storePayloadRaw)
      : storePayloadRaw;
    if (chatId) {
      const sessions = Array.isArray(storePayload?.sessions)
        ? storePayload.sessions.filter((session) => String(session?.id || "").trim() === chatId)
        : [];
      const scopedStore = {
        version: Number(storePayload?.version || 1),
        activeSessionId: chatId,
        sessions,
      };
      if (format === "md" || format === "markdown") {
        return {
          format: "md",
          chat_id: chatId,
          content: buildMarkdownExport(scopedStore),
        };
      }
      return {
        format: "json",
        chat_id: chatId,
        store: scopedStore,
      };
    }
    if (format === "md" || format === "markdown") {
      return {
        format: "md",
        content: buildMarkdownExport(storePayload),
      };
    }
    return {
      format: "json",
      store: storePayload,
    };
  }

  async function importChats(payload, options = {}) {
    if (isBackendRuntimeEnabled()) {
      try {
        const response = await backendClient.importChats(payload, options);
        const preferredActiveId = String(response?.store?.activeSessionId || "").trim();
        const applied = tryApplyChatStoreFromMutation(response, {
          preserveActive: false,
          preferredActiveId,
        });
        if (!applied) {
          await syncChatStoreFromBackend({
            preserveActive: false,
            preferredActiveId,
            silent: true,
          });
        }
        return response;
      } catch (error) {
        return {
          error: String(error?.message || "import_failed"),
        };
      }
    }
    try {
      let sourcePayload = payload;
      const payloadFormat = String(payload?.format || "").trim().toLowerCase();
      if (payloadFormat === "md" || payloadFormat === "markdown") {
        const content = String(payload?.content || "");
        const markdownMatch = content.match(/```ancia-json\s+([\s\S]*?)\s+```/i);
        const jsonText = markdownMatch?.[1] ? markdownMatch[1].trim() : content.trim();
        sourcePayload = JSON.parse(jsonText);
      } else if (payload && typeof payload === "object" && payload.store && typeof payload.store === "object") {
        sourcePayload = payload.store;
      }
      return importChatStorePayload(sourcePayload);
    } catch (error) {
      return {
        error: String(error?.message || error),
      };
    }
  }

  async function searchChats(query, options = {}) {
    const safeQuery = String(query || "").trim();
    if (!safeQuery) {
      return {
        query: "",
        results: [],
        count: 0,
      };
    }
    if (isBackendRuntimeEnabled()) {
      try {
        return await backendClient.searchChats(safeQuery, options);
      } catch {
        return {
          query: safeQuery,
          results: [],
          count: 0,
        };
      }
    }
    const sessions = listChatSessions();
    const needle = safeQuery.toLowerCase();
    const results = sessions
      .filter((session) => String(session?.title || "").toLowerCase().includes(needle))
      .map((session) => ({
        chat_id: session.chatId,
        chat_title: session.title,
        message_id: "",
        role: "assistant",
        text: session.title,
        snippet: session.title,
        timestamp: "",
      }));
    return {
      query: safeQuery,
      results,
      count: results.length,
    };
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
    searchChats,
    listChats,
  };
}
