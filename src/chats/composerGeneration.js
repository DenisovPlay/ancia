import { icon } from "../ui/icons.js";
import { normalizeTextInput } from "../ui/messageFormatter.js";

export function createComposerGenerationController({
  elements,
  runtimeConfig,
  backendClient,
  background,
  updateConnectionState,
  BACKEND_STATUS,
  pushToast,
  requestActionConfirm,
  isBackendRuntimeEnabled,
  syncChatStoreFromBackend,
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
  setAssistantGenerationActions,
  normalizeLegacyToolName,
  resolveToolMeta,
  formatToolOutputText,
  requestAssistantReply,
  resolveModelMetaSuffix,
  ensureSessionForOutgoingMessage,
  getActiveChatSessionId,
  getChatSessionMood,
  applyTransientMood,
  setChatSessionMood,
  renameChatSessionById,
  getMessageRecord,
  sanitizeSessionTitle,
  persistChatMessage,
  ASSISTANT_PENDING_LABEL,
  composerAttachments,
  getCurrentRouteState = () => ({ state: "neutral" }),
  contextGuard,
}) {
  let activeGeneration = null;

  function normalizeLoopGuardText(value = "") {
    return normalizeTextInput(String(value || ""))
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function hasRunawayRepetition(text = "") {
    const normalized = normalizeLoopGuardText(text);
    if (!normalized || normalized.length < 180) {
      return false;
    }
    if (/(.{24,120}?)(?:\s+\1){2,}/.test(normalized)) {
      return true;
    }
    const tokens = normalized.split(" ").filter(Boolean);
    for (const width of [8, 12, 16]) {
      if (tokens.length < width * 3) {
        continue;
      }
      const tail = tokens.slice(-width).join(" ");
      const prev = tokens.slice(-width * 2, -width).join(" ");
      const prev2 = tokens.slice(-width * 3, -width * 2).join(" ");
      if (tail && tail === prev && tail === prev2) {
        return true;
      }
    }
    const sentences = normalized.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
    if (sentences.length >= 3) {
      const last = sentences[sentences.length - 1];
      if (last && last.length >= 24 && last === sentences[sentences.length - 2] && last === sentences[sentences.length - 3]) {
        return true;
      }
    }
    return false;
  }

  function buildAntiLoopRetryPrompt(userText = "") {
    const safeUserText = normalizeTextInput(String(userText || "")).trim();
    if (!safeUserText) {
      return "";
    }
    return `${safeUserText}\n\n`
      + "Сформируй ответ заново в режиме anti-loop: без повторяющихся фраз и абзацев, "
      + "без самокопирования, с чёткой структурой и новыми формулировками.";
  }

  function setComposerSubmitMode(mode = "send") {
    if (!(elements.composerSubmit instanceof HTMLButtonElement)) {
      return;
    }
    if (mode === "stop") {
      elements.composerSubmit.innerHTML = icon("stop");
      elements.composerSubmit.setAttribute("aria-label", "Остановить генерацию");
      elements.composerSubmit.setAttribute("title", "Остановить генерацию");
      elements.composerSubmit.classList.add("bg-amber-200");
      elements.composerSubmit.classList.remove("bg-zinc-100");
      return;
    }
    elements.composerSubmit.innerHTML = icon("send");
    elements.composerSubmit.setAttribute("aria-label", "Отправить сообщение");
    elements.composerSubmit.setAttribute("title", "Отправить сообщение");
    elements.composerSubmit.classList.remove("bg-amber-200");
    elements.composerSubmit.classList.add("bg-zinc-100");
  }

  function isGenerationActiveForChat(chatId = getActiveChatSessionId()) {
    if (!activeGeneration) {
      return false;
    }
    const generationChatId = String(activeGeneration.chatId || "");
    const targetChatId = String(chatId || "");
    return generationChatId === targetChatId;
  }

  function isAssistantRowAttached(row) {
    return (
      row instanceof HTMLElement
      && row.isConnected
      && row.parentNode === elements.chatStream
    );
  }

  function getAssistantRowText(row) {
    if (!(row instanceof HTMLElement)) {
      return "";
    }
    const body = row.querySelector("[data-message-body]");
    if (!(body instanceof HTMLElement)) {
      return "";
    }
    return normalizeTextInput(body.textContent || "").trim();
  }

  function getAssistantRowMeta(row) {
    if (!(row instanceof HTMLElement)) {
      return "";
    }
    const meta = row.querySelector("[data-message-meta]");
    if (!(meta instanceof HTMLElement)) {
      return "";
    }
    return normalizeTextInput(meta.textContent || "").trim();
  }

  function findRecoverableAssistantRow(chatId, expectedText) {
    if (!(elements.chatStream instanceof HTMLElement)) {
      return null;
    }
    const targetChatId = String(chatId || "").trim();
    const normalizedExpected = normalizeTextInput(expectedText || "").trim();
    const rows = Array.from(elements.chatStream.querySelectorAll(".message-row[data-role='assistant']"));
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (!(row instanceof HTMLElement)) {
        continue;
      }
      const rowChatId = String(row.dataset.chatId || "").trim();
      if (targetChatId && rowChatId && rowChatId !== targetChatId) {
        continue;
      }
      const body = row.querySelector("[data-message-body]");
      const isPending = row.dataset.pending === "true"
        || (body instanceof HTMLElement && body.getAttribute("data-pending") === "true");
      const rowText = getAssistantRowText(row);
      if (!normalizedExpected) {
        if (isPending) {
          return row;
        }
        continue;
      }
      if (isPending || !rowText) {
        continue;
      }
      if (
        rowText === normalizedExpected
        || rowText.startsWith(normalizedExpected)
        || normalizedExpected.startsWith(rowText)
      ) {
        return row;
      }
    }
    return null;
  }

  function pruneTransientAssistantDuplicates(chatId = getActiveChatSessionId()) {
    if (!(elements.chatStream instanceof HTMLElement)) {
      return;
    }
    const targetChatId = String(chatId || "").trim();
    const rows = Array.from(elements.chatStream.querySelectorAll(".message-row[data-role='assistant']"));
    const persistedTextKeys = new Set();
    const persistedFullKeys = new Set();
    const transientRowsByTextKey = new Map();
    const transientRowsByFullKey = new Map();

    rows.forEach((row) => {
      if (!(row instanceof HTMLElement)) {
        return;
      }
      const rowChatId = String(row.dataset.chatId || "").trim();
      if (targetChatId && rowChatId && rowChatId !== targetChatId) {
        return;
      }
      if (row.dataset.pending === "true") {
        return;
      }
      const text = normalizeTextInput(getAssistantRowText(row)).trim();
      if (!text) {
        return;
      }
      const metaText = normalizeTextInput(getAssistantRowMeta(row)).trim();
      const fullKey = `${text}::${metaText}`;
      const hasMessageId = Boolean(String(row.dataset.messageId || "").trim());
      if (hasMessageId) {
        persistedTextKeys.add(text);
        persistedFullKeys.add(fullKey);
        return;
      }
      const byText = transientRowsByTextKey.get(text);
      if (Array.isArray(byText)) {
        byText.push(row);
      } else {
        transientRowsByTextKey.set(text, [row]);
      }

      const byFull = transientRowsByFullKey.get(fullKey);
      if (Array.isArray(byFull)) {
        byFull.push(row);
      } else {
        transientRowsByFullKey.set(fullKey, [row]);
      }
    });

    const removedRows = new Set();

    transientRowsByFullKey.forEach((rowsForKey, key) => {
      if (!persistedFullKeys.has(key)) {
        return;
      }
      rowsForKey.forEach((row) => {
        row.remove();
        removedRows.add(row);
      });
    });

    transientRowsByTextKey.forEach((rowsForText, textKey) => {
      const candidates = rowsForText.filter((row) => !removedRows.has(row));
      if (candidates.length === 0) {
        return;
      }
      if (persistedTextKeys.has(textKey)) {
        candidates.forEach((row) => row.remove());
        return;
      }
      if (candidates.length > 1) {
        // Оставляем только последнюю transient-строку, чтобы не копить дубли.
        candidates.slice(0, -1).forEach((row) => row.remove());
      }
    });
  }

  function recoverAssistantRowForActiveGeneration() {
    if (!activeGeneration) {
      return null;
    }
    if (isAssistantRowAttached(activeGeneration.assistantRow)) {
      return activeGeneration.assistantRow;
    }

    const activeChatId = String(getActiveChatSessionId() || "");
    const generationChatId = String(activeGeneration.chatId || "");
    if (!generationChatId || generationChatId !== activeChatId) {
      return null;
    }

    const partialText = normalizeTextInput(activeGeneration.latestText || "");
    const hasPartialText = partialText.trim().length > 0;
    const existingRow = findRecoverableAssistantRow(generationChatId, partialText);
    if (existingRow instanceof HTMLElement) {
      activeGeneration.assistantRow = existingRow;
      pruneTransientAssistantDuplicates(generationChatId);
      return existingRow;
    }
    const restoredRow = appendMessage("assistant", hasPartialText ? partialText : "", activeGeneration.latestMetaSuffix || "модель", {
      persist: false,
      chatId: generationChatId,
      pending: !hasPartialText,
      pendingLabel: ASSISTANT_PENDING_LABEL,
      animate: false,
      autoScroll: false,
    });
    if (restoredRow instanceof HTMLElement) {
      activeGeneration.assistantRow = restoredRow;
      pruneTransientAssistantDuplicates(generationChatId);
      return restoredRow;
    }
    return null;
  }

  function resetDetachedActiveGenerationIfNeeded() {
    if (!activeGeneration) {
      return;
    }
    const currentChatId = String(getActiveChatSessionId() || "");
    const generationChatId = String(activeGeneration.chatId || "");
    if (!generationChatId || generationChatId !== currentChatId) {
      return;
    }
    if (recoverAssistantRowForActiveGeneration()) {
      return;
    }

    const generation = activeGeneration;
    activeGeneration = null;
    generation.abortController?.abort();
    contextGuard?.clearPendingAssistantText?.();
    if (runtimeConfig.mode === "backend") {
      void backendClient.stopChatGeneration().catch(() => {});
      if (isBackendRuntimeEnabled()) {
        void syncChatStoreFromBackend({
          preserveActive: true,
          preferredActiveId: generationChatId,
          silent: true,
        });
      }
    }
    updateConnectionState(BACKEND_STATUS.idle, "Генерация сброшена после обновления интерфейса");
  }

  function syncState({ forceContextRefresh = false } = {}) {
    resetDetachedActiveGenerationIfNeeded();
    const rawValue = elements.composerInput?.value || "";
    const attachmentsSnapshot = composerAttachments.hasAny() ? composerAttachments.snapshot() : [];
    contextGuard?.sync({
      draftText: rawValue,
      attachments: attachmentsSnapshot,
      forceContextRefresh,
    });
    const hasText = rawValue.trim().length > 0;
    const hasAttachments = composerAttachments.hasAny();
    const stopMode = isGenerationActiveForChat();
    const canSubmit = stopMode ? true : (hasText || hasAttachments);
    if (elements.composerSubmit) {
      elements.composerSubmit.disabled = !canSubmit;
      elements.composerSubmit.setAttribute("aria-disabled", String(!canSubmit));
      elements.composerSubmit.classList.toggle("opacity-60", !canSubmit);
    }
    if (elements.composerForm instanceof HTMLElement) {
      elements.composerForm.setAttribute("aria-busy", String(stopMode));
    }
    setComposerSubmitMode(stopMode ? "stop" : "send");
  }

  async function stopActiveGeneration({ silent = false } = {}) {
    if (!activeGeneration) {
      return false;
    }
    const generation = activeGeneration;
    activeGeneration = null;
    generation.stoppedByUser = true;

    let stopPromise = Promise.resolve(null);
    if (runtimeConfig.mode === "backend") {
      stopPromise = backendClient.stopChatGeneration();
    }
    generation.abortController?.abort();

    if (generation.assistantRow instanceof HTMLElement) {
      const rowBody = generation.assistantRow.querySelector("[data-message-body]");
      const isPending = generation.assistantRow.dataset.pending === "true";
      const hasText = !isPending && rowBody instanceof HTMLElement && rowBody.textContent?.trim();
      if (!hasText) {
        generation.assistantRow.remove();
      } else {
        const finalStoppedText = generation.latestText || "Генерация остановлена.";
        updateMessageRowContent(generation.assistantRow, {
          text: finalStoppedText,
          metaSuffix: "остановлено",
          timestamp: new Date(),
          streamMode: "",
        });
        if (!generation.assistantRow.dataset.messageId) {
          const persisted = persistChatMessage({
            chatId: generation.assistantRow.dataset.chatId || generation.chatId || getActiveChatSessionId() || "",
            role: "assistant",
            text: finalStoppedText,
            metaSuffix: "остановлено",
            timestamp: new Date().toISOString(),
          });
          if (persisted?.id) {
            generation.assistantRow.dataset.messageId = persisted.id;
          }
        }
      }
    }

    pruneTransientAssistantDuplicates(generation.chatId || getActiveChatSessionId());
    contextGuard?.clearPendingAssistantText?.();
    syncState();
    updateConnectionState(BACKEND_STATUS.idle, "Генерация остановлена");
    if (!silent) {
      pushToast("Генерация остановлена.", { tone: "neutral", durationMs: 1800 });
    }
    if (runtimeConfig.mode === "backend") {
      void stopPromise.catch((error) => {
        if (!silent) {
          pushToast(`Не удалось отправить stop на сервер: ${error.message}`, {
            tone: "warning",
            durationMs: 3200,
          });
        }
      });
    }
    return true;
  }

  async function resolvePermissionGrantsForTurn() {
    const emptyResult = {
      pluginPermissionGrants: [],
      toolPermissionGrants: [],
      domainPermissionGrants: [],
    };
    if (!isBackendRuntimeEnabled() || typeof backendClient.listPluginPermissions !== "function") {
      return emptyResult;
    }
    let permissionsPayload = null;
    try {
      permissionsPayload = await backendClient.listPluginPermissions();
    } catch {
      return emptyResult;
    }

    const pluginPolicyMap = permissionsPayload?.policies && typeof permissionsPayload.policies === "object"
      ? permissionsPayload.policies
      : {};
    const toolPolicyMap = permissionsPayload?.tool_policies && typeof permissionsPayload.tool_policies === "object"
      ? permissionsPayload.tool_policies
      : {};
    const domainPolicyMap = permissionsPayload?.domain_policies && typeof permissionsPayload.domain_policies === "object"
      ? permissionsPayload.domain_policies
      : {};

    const askPluginIds = Object.entries(pluginPolicyMap)
      .filter(([pluginId, policy]) => String(pluginId || "").trim() && String(policy || "").trim().toLowerCase() === "ask")
      .map(([pluginId]) => String(pluginId || "").trim().toLowerCase())
      .filter(Boolean);
    const askToolKeys = Object.entries(toolPolicyMap)
      .filter(([toolKey, policy]) => String(toolKey || "").trim() && String(policy || "").trim().toLowerCase() === "ask")
      .map(([toolKey]) => String(toolKey || "").trim().toLowerCase())
      .filter(Boolean);
    const askDomains = Object.entries(domainPolicyMap)
      .filter(([domainKey, policy]) => String(domainKey || "").trim() && String(policy || "").trim().toLowerCase() === "ask")
      .map(([domainKey]) => String(domainKey || "").trim().toLowerCase())
      .filter(Boolean);

    if (askPluginIds.length === 0 && askToolKeys.length === 0 && askDomains.length === 0) {
      return emptyResult;
    }

    let askPluginNames = [...askPluginIds];
    if (typeof backendClient.listPlugins === "function") {
      try {
        const pluginsPayload = await backendClient.listPlugins();
        const allPlugins = Array.isArray(pluginsPayload?.plugins) ? pluginsPayload.plugins : [];
        const namesById = new Map(
          allPlugins
            .filter((plugin) => plugin && typeof plugin === "object")
            .map((plugin) => [
              String(plugin.id || "").trim().toLowerCase(),
              String(plugin.name || plugin.title || plugin.id || "").trim(),
            ]),
        );
        askPluginNames = askPluginIds.map((pluginId) => namesById.get(pluginId) || pluginId);
      } catch {
        // Ignore plugins list failures and fallback to plugin ids.
      }
    }

    const askToolNameByKey = new Map(
      (Array.isArray(permissionsPayload?.tools) ? permissionsPayload.tools : [])
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const pluginId = String(entry.plugin_id || "").trim().toLowerCase();
          const toolName = String(entry.tool_name || "").trim().toLowerCase();
          const key = String(entry.tool_key || `${pluginId}::${toolName}`).trim().toLowerCase();
          const display = pluginId && toolName ? `${pluginId}/${toolName}` : key;
          return [key, display];
        }),
    );

    const previewList = (items = [], limit = 3) => {
      const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
      const preview = safeItems.slice(0, limit).join(", ");
      const suffix = safeItems.length > limit ? ` и ещё ${safeItems.length - limit}` : "";
      return { preview, suffix };
    };

    const result = { ...emptyResult };
    if (askPluginIds.length > 0) {
      const { preview, suffix } = previewList(askPluginNames);
      const shouldAllowPlugins = await requestActionConfirm(
        `Разрешить плагины со статусом «Спрашивать» для этого запроса: ${preview}${suffix}?`,
        {
          title: "Разрешения плагинов",
          confirmLabel: "Разрешить на запрос",
        },
      );
      if (shouldAllowPlugins) {
        result.pluginPermissionGrants = askPluginIds;
      } else {
        pushToast("Плагины со статусом «Спрашивать» пропущены для этого запроса.", {
          tone: "neutral",
          durationMs: 2200,
        });
      }
    }

    if (askToolKeys.length > 0) {
      const toolDisplayList = askToolKeys.map((toolKey) => askToolNameByKey.get(toolKey) || toolKey);
      const { preview, suffix } = previewList(toolDisplayList);
      const shouldAllowTools = await requestActionConfirm(
        `Разрешить инструменты со статусом «Спрашивать»: ${preview}${suffix}?`,
        {
          title: "Разрешения инструментов",
          confirmLabel: "Разрешить на запрос",
        },
      );
      if (shouldAllowTools) {
        result.toolPermissionGrants = askToolKeys;
      } else {
        pushToast("Инструменты со статусом «Спрашивать» пропущены для этого запроса.", {
          tone: "neutral",
          durationMs: 2200,
        });
      }
    }

    if (askDomains.length > 0) {
      const { preview, suffix } = previewList(askDomains);
      const shouldAllowDomains = await requestActionConfirm(
        `Разрешить домены со статусом «Спрашивать»: ${preview}${suffix}?`,
        {
          title: "Разрешения доменов",
          confirmLabel: "Разрешить на запрос",
        },
      );
      if (shouldAllowDomains) {
        result.domainPermissionGrants = askDomains;
      } else {
        pushToast("Домены со статусом «Спрашивать» пропущены для этого запроса.", {
          tone: "neutral",
          durationMs: 2200,
        });
      }
    }

    return result;
  }

  function buildGenerationActionsMeta({
    userText = "",
    userMessageId = "",
    backendGenerationActions = null,
  } = {}) {
    const safeUserText = normalizeTextInput(String(userText || "")).trim();
    const safeUserMessageId = String(userMessageId || "").trim();
    const backendPayload = backendGenerationActions && typeof backendGenerationActions === "object"
      ? backendGenerationActions
      : {};
    const sourceUserText = normalizeTextInput(String(
      backendPayload.source_user_text
      || backendPayload.sourceUserText
      || safeUserText,
    )).trim();
    const sourceUserMessageId = String(
      backendPayload.source_user_message_id
      || backendPayload.sourceUserMessageId
      || safeUserMessageId,
    ).trim();
    if (!sourceUserText && !sourceUserMessageId) {
      return null;
    }
    return {
      source_user_text: sourceUserText,
      source_user_message_id: sourceUserMessageId,
      allow_retry: false,
      allow_continue: backendPayload.allow_continue === true,
      allow_regenerate: backendPayload.allow_regenerate !== false,
    };
  }

  async function triggerGenerationAction({
    action = "",
    chatId = "",
    messageId = "",
  } = {}) {
    const safeAction = String(action || "").trim().toLowerCase();
    const safeChatId = String(chatId || getActiveChatSessionId() || "").trim();
    const safeMessageId = String(messageId || "").trim();
    if (!safeAction || !safeChatId || !safeMessageId) {
      return false;
    }
    const record = getMessageRecord?.(safeChatId, safeMessageId);
    const message = record?.message && typeof record.message === "object" ? record.message : null;
    if (!message || String(message.role || "").trim().toLowerCase() !== "assistant") {
      return false;
    }

    const meta = message.meta && typeof message.meta === "object" ? message.meta : {};
    const generationActions = meta.generation_actions && typeof meta.generation_actions === "object"
      ? meta.generation_actions
      : (meta.generationActions && typeof meta.generationActions === "object" ? meta.generationActions : {});
    const sourceUserMessageId = String(
      generationActions.source_user_message_id
      || generationActions.sourceUserMessageId
      || "",
    ).trim();
    let sourceUserText = normalizeTextInput(
      String(
        generationActions.source_user_text
        || generationActions.sourceUserText
        || "",
      ),
    ).trim();
    if (!sourceUserText && sourceUserMessageId) {
      const sourceRecord = getMessageRecord?.(safeChatId, sourceUserMessageId);
      sourceUserText = normalizeTextInput(String(sourceRecord?.message?.text || "")).trim();
    }
    if (!sourceUserText) {
      pushToast("Не найден исходный запрос для повторной генерации.", {
        tone: "warning",
        durationMs: 3200,
      });
      return false;
    }

    if (safeAction === "continue") {
      return await handleContinueAction(safeChatId, safeMessageId, sourceUserText, sourceUserMessageId);
    }
    if (safeAction === "regenerate" || safeAction === "retry") {
      // Перегенерация — создаём новое сообщение от пользователя
      if (!(elements.composerInput instanceof HTMLTextAreaElement)) {
        return false;
      }
      elements.composerInput.value = sourceUserText;
      syncState();
      await handleSubmit({ preventDefault() {} });
      return true;
    }

    return false;
  }

  async function handleContinueAction(chatId, assistantMessageId, sourceUserText, sourceUserMessageId) {
    const requestSessionId = String(chatId || getActiveChatSessionId() || "").trim();
    if (!requestSessionId) return false;

    // Находим существующую строку ассистента — именно её будем обновлять
    const existingRow = elements.chatStream?.querySelector(
      `.message-row[data-message-id="${assistantMessageId}"]`,
    );
    if (!(existingRow instanceof HTMLElement)) return false;

    // Убираем кнопки действий и переводим строку в состояние ожидания
    existingRow.querySelectorAll("[data-generation-actions]").forEach((el) => el.remove());

    const savedMood = getChatSessionMood(requestSessionId) || "neutral";
    applyTransientMood(requestSessionId, "waiting", 420);

    const initialMetaSuffix = runtimeConfig.mode === "backend"
      ? resolveModelMetaSuffix(runtimeConfig.modelId, "модель")
      : "симуляция";

    let streamMetaSuffix = initialMetaSuffix;
    let assistantRow = existingRow;

    updateMessageRowContent(assistantRow, {
      text: "",
      metaSuffix: initialMetaSuffix,
      timestamp: new Date(),
      pending: true,
      pendingLabel: ASSISTANT_PENDING_LABEL,
      streamMode: "",
    });

    const abortController = new AbortController();
    const generationId = Date.now() + Math.random();
    activeGeneration = {
      id: generationId,
      chatId: requestSessionId,
      assistantRow,
      abortController,
      latestText: "",
      latestMetaSuffix: streamMetaSuffix,
      stoppedByUser: false,
    };
    syncState();

    let latestPartial = "";
    let latestStreamMode = "";

    const resolveAssistantRow = () => {
      if (isAssistantRowAttached(assistantRow)) return assistantRow;
      return null;
    };

    try {
      const reply = await requestAssistantReply("Продолжи ответ с того места, где остановился.", requestSessionId, {
        signal: abortController.signal,
        attachments: [],
        extraPayloadFields: {
          skip_user_persist: true,
          continue_mode: true,
          continue_from_message_id: assistantMessageId,
        },
        onStatusUpdate: (statusMsg) => {
          if (activeGeneration?.id === generationId) {
            activeGeneration.latestMetaSuffix = statusMsg;
          }
          const row = resolveAssistantRow();
          if (row instanceof HTMLElement) {
            updateMessageRowContent(row, {
              text: "",
              metaSuffix: statusMsg,
              timestamp: new Date(),
              pending: true,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
        },
        onModel: (modelLabel) => {
          streamMetaSuffix = resolveModelMetaSuffix(modelLabel, streamMetaSuffix);
          if (activeGeneration?.id === generationId) {
            activeGeneration.latestMetaSuffix = streamMetaSuffix;
          }
          const row = resolveAssistantRow();
          if (row) {
            const body = row.querySelector("[data-message-body]");
            const hasPartial = body instanceof HTMLElement && Boolean(body.textContent?.trim());
            updateMessageRowContent(row, {
              text: hasPartial ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartial,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
        },
        onPartial: (partialText) => {
          latestPartial = normalizeTextInput(partialText);
          if (activeGeneration?.id === generationId) {
            activeGeneration.latestText = latestPartial;
            activeGeneration.latestMetaSuffix = streamMetaSuffix;
          }
          const row = resolveAssistantRow();
          if (row) {
            const hasPartialText = latestPartial.trim().length > 0;
            updateMessageRowContent(row, {
              text: hasPartialText ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartialText,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
          elements.chatStream?.scrollTo({ top: elements.chatStream.scrollHeight, behavior: "auto" });
        },
      });

      if (reply?.cancelled) {
        applyTransientMood(requestSessionId, getChatSessionMood(requestSessionId) || savedMood, runtimeConfig.defaultTransitionMs);
        syncState({ forceContextRefresh: true });
        return false;
      }

      const finalText = normalizeTextInput(reply.text || latestPartial || "Бэкенд вернул пустой ответ.");
      const finalMetaSuffix = String(reply.metaSuffix || streamMetaSuffix || initialMetaSuffix);
      latestStreamMode = String(reply?.stream?.mode || "").trim().toLowerCase();
      const generationActionsMeta = buildGenerationActionsMeta({
        userText: sourceUserText,
        userMessageId: sourceUserMessageId,
        backendGenerationActions: reply?.generationActions,
      });
      if (activeGeneration?.id === generationId) {
        activeGeneration.latestText = finalText;
        activeGeneration.latestMetaSuffix = finalMetaSuffix;
      }
      const generatedChatTitle = sanitizeSessionTitle(String(reply.chatTitle || "").trim(), "");
      if (requestSessionId && generatedChatTitle) {
        renameChatSessionById(requestSessionId, generatedChatTitle);
      }

      const activeRow = resolveAssistantRow();
      if (activeRow) {
        updateMessageRowContent(activeRow, {
          text: finalText,
          metaSuffix: finalMetaSuffix,
          timestamp: new Date(),
          streamMode: latestStreamMode,
        });
        if (generationActionsMeta) {
          setAssistantGenerationActions?.(activeRow, generationActionsMeta);
        }
      }

      // Обновляем существующую запись в хранилище напрямую (не создаём новое сообщение)
      const assistantPersistMeta = {};
      if (latestStreamMode) assistantPersistMeta.stream = { mode: latestStreamMode };
      if (generationActionsMeta) assistantPersistMeta.generation_actions = generationActionsMeta;

      const existingRecord = getMessageRecord?.(requestSessionId, assistantMessageId);
      if (existingRecord) {
        existingRecord.session.messages[existingRecord.index] = {
          ...existingRecord.message,
          text: finalText,
          metaSuffix: finalMetaSuffix,
          meta: { ...existingRecord.message.meta, ...assistantPersistMeta },
          timestamp: new Date().toISOString(),
        };
      }

      const finalMood = String(reply.mood || "").trim();
      if (requestSessionId) {
        const currentSessionMood = getChatSessionMood(requestSessionId);
        const toolChangedMood = currentSessionMood && currentSessionMood !== savedMood;
        if (!toolChangedMood && finalMood && !["neutral", "waiting", "thinking"].includes(finalMood)) {
          setChatSessionMood(requestSessionId, finalMood, runtimeConfig.defaultTransitionMs);
        } else {
          applyTransientMood(requestSessionId, currentSessionMood || savedMood, runtimeConfig.defaultTransitionMs);
        }
        if (isBackendRuntimeEnabled()) {
          await syncChatStoreFromBackend({ preserveActive: true, preferredActiveId: requestSessionId, silent: true });
        }
        syncState({ forceContextRefresh: true });
      } else {
        background.setMood(finalMood || "neutral", runtimeConfig.defaultTransitionMs);
        syncState({ forceContextRefresh: true });
      }

      return true;
    } finally {
      if (!activeGeneration || activeGeneration.id === generationId) {
        activeGeneration = null;
        if (requestSessionId) {
          pruneTransientAssistantDuplicates(requestSessionId);
        }
        syncState({ forceContextRefresh: true });
      }
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const rawValue = normalizeTextInput(elements.composerInput?.value || "");
    const hasDraft = rawValue.trim().length > 0;
    const hasAttachments = composerAttachments.hasAny();
    const attachmentsSnapshot = hasAttachments ? composerAttachments.snapshot() : [];
    const effectiveText = hasDraft ? rawValue : (hasAttachments ? "Проанализируй вложения пользователя." : "");

    if (activeGeneration) {
      if (!isGenerationActiveForChat() && !hasDraft && !hasAttachments) {
        syncState();
        return;
      }
      await stopActiveGeneration(hasDraft ? { silent: true } : {});
      if (!hasDraft && !hasAttachments) {
        return;
      }
    }

    if (!hasDraft && !hasAttachments) {
      syncState();
      return;
    }

    const userMessageText = effectiveText;
    const requestSessionId = String(
      ensureSessionForOutgoingMessage(userMessageText)
      || getActiveChatSessionId()
      || "",
    );
    const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const userMessageRow = appendMessage("user", userMessageText, "", {
      persist: true,
      chatId: requestSessionId,
      meta: hasAttachments ? { attachments: attachmentsSnapshot } : {},
    });
    const userMessageId = String(userMessageRow?.dataset?.messageId || "").trim();
    if (elements.composerInput) {
      elements.composerInput.value = "";
    }
    composerAttachments.clear();
    syncState();

    const contextPlan = await contextGuard?.prepareRequest({
      draftText: "",
      attachments: attachmentsSnapshot,
    });
    let contextGuardEventPayload = null;
    const historyOverride = Array.isArray(contextPlan?.historyOverride)
      ? contextPlan.historyOverride
      : null;
    if (contextPlan?.compressed && historyOverride) {
      const beforeUsage = contextPlan.previousUsage?.usedTokens || contextPlan.usage?.usedTokens || 0;
      const afterUsage = contextPlan.usage?.usedTokens || 0;
      const usageLimit = contextPlan.usage?.contextWindow || 0;
      const unresolvedOverflow = !Boolean(contextPlan.resolvedOverflow);
      const forceMode = Boolean(contextPlan.forceMode);
      const details = [
        forceMode && !contextPlan?.overflowed
          ? `Контекст сжат по запросу: ${beforeUsage.toLocaleString("ru-RU")} / ${usageLimit.toLocaleString("ru-RU")} токенов.`
          : `Контекст переполнен: ${beforeUsage.toLocaleString("ru-RU")} / ${usageLimit.toLocaleString("ru-RU")} токенов.`,
        `История сжата: ${contextPlan.sourceMessages} -> ${contextPlan.targetMessages} сообщений.`,
        `Экономия: ${(contextPlan.savedTokens || 0).toLocaleString("ru-RU")} токенов.`,
      ];
      if (!unresolvedOverflow) {
        details.push(`После сжатия: ${afterUsage.toLocaleString("ru-RU")} / ${usageLimit.toLocaleString("ru-RU")}.`);
      } else {
        details.push(`После сжатия: ${afterUsage.toLocaleString("ru-RU")} / ${usageLimit.toLocaleString("ru-RU")} (переполнение не снято полностью).`);
      }
      contextGuardEventPayload = {
        name: "context_guard.compress",
        display_name: "Context Guard",
        status: unresolvedOverflow ? "warning" : "ok",
        meta_suffix: "сжатие контекста",
        badge: unresolvedOverflow
          ? {
            label: "переполнение не снято",
            tone: "warning",
          }
          : null,
        args: { query: forceMode ? "ручное сжатие контекста" : "автосжатие контекста" },
        text: details.join("\n"),
      };

      if (unresolvedOverflow) {
        pushToast(
          "Контекст всё ещё переполнен после сжатия. Ответ может быть короче или с потерей деталей.",
          { tone: "warning", durationMs: 3600 },
        );
      }

      if (runtimeConfig.contextGuardShowChatEvents) {
        appendMessage("tool", "context_guard.compress", "сжатие контекста", {
          persist: true,
          chatId: requestSessionId,
          toolPayload: contextGuardEventPayload,
          toolPhase: "result",
        });
      }
    } else if (contextPlan?.overflowed) {
      pushToast(
        "Контекст переполнен, но автосжатие не смогло уменьшить историю.",
        { tone: "warning", durationMs: 3200 },
      );
    }
    const unresolvedContextOverflow = Boolean(contextPlan?.overflowed) && !Boolean(contextPlan?.resolvedOverflow);
    if (unresolvedContextOverflow) {
      appendMessage(
        "assistant",
        "Запрос не отправлен: контекст переполнен даже после всех fallback-стратегий сжатия. "
        + "Сократите сообщение/вложения или увеличьте context window модели.",
        "Context Guard • отправка остановлена",
        {
          persist: true,
          chatId: requestSessionId,
        },
      );
      contextGuard?.clearPendingAssistantText?.();
      syncState({ forceContextRefresh: true });
      return;
    }
    const permissionGrants = await resolvePermissionGrantsForTurn();

    const savedMood = getChatSessionMood(requestSessionId) || "neutral";

    applyTransientMood(requestSessionId, "waiting", 420);
    if (!requestSessionId) {
      background.setMood("waiting", 420);
    }

    const initialMetaSuffix = runtimeConfig.mode === "backend"
      ? resolveModelMetaSuffix(runtimeConfig.modelId, "модель")
      : "симуляция";

    let streamMetaSuffix = initialMetaSuffix;
    let assistantRow = appendMessage("assistant", "", initialMetaSuffix, {
      persist: false,
      chatId: requestSessionId,
      pending: true,
      pendingLabel: ASSISTANT_PENDING_LABEL,
    });

    let abortController = new AbortController();
    const generationId = Date.now() + Math.random();
    activeGeneration = {
      id: generationId,
      chatId: requestSessionId || "",
      assistantRow,
      abortController,
      latestText: "",
      latestMetaSuffix: streamMetaSuffix,
      stoppedByUser: false,
    };
    contextGuard?.setPendingAssistantText?.("");
    syncState();

    let latestPartial = "";
    let latestStreamMode = "";
    let antiLoopAbortTriggered = false;
    let antiLoopAutoRetryUsed = false;
    const seenToolInvocations = new Set();
    const toolRowsByInvocationId = new Map();
    let lastInsertedToolRowBeforeAssistant = null;

    const resolveAssistantRow = () => {
      const recoveredRow = recoverAssistantRowForActiveGeneration();
      if (recoveredRow instanceof HTMLElement) {
        assistantRow = recoveredRow;
        return recoveredRow;
      }
      if (isAssistantRowAttached(assistantRow)) {
        return assistantRow;
      }
      return null;
    };

    const insertToolRowNearAssistant = (row) => {
      const activeRow = resolveAssistantRow();
      if (!(row instanceof HTMLElement) || !(activeRow instanceof HTMLElement)) {
        return;
      }
      if (activeRow.parentNode !== elements.chatStream) {
        return;
      }

      if (
        lastInsertedToolRowBeforeAssistant instanceof HTMLElement
        && lastInsertedToolRowBeforeAssistant.parentNode === elements.chatStream
      ) {
        if (lastInsertedToolRowBeforeAssistant.nextSibling) {
          elements.chatStream.insertBefore(row, lastInsertedToolRowBeforeAssistant.nextSibling);
        } else {
          elements.chatStream.appendChild(row);
        }
      } else {
        elements.chatStream.insertBefore(row, activeRow);
      }
      lastInsertedToolRowBeforeAssistant = row;
    };

    const appendAndInsertToolRow = (payload, phase) => {
      const metaDefault = phase === "start" ? "инструмент • запуск" : "инструмент • ok";
      const row = appendMessage("tool", payload.name, String(payload.meta_suffix || metaDefault), {
        persist: false,
        chatId: requestSessionId,
        toolPayload: payload,
        toolPhase: phase,
      });
      insertToolRowNearAssistant(row);
      return row;
    };

    const runAssistantAttempt = async (requestText, { antiLoopMode = false } = {}) => requestAssistantReply(requestText, requestSessionId, {
      signal: abortController.signal,
      attachments: attachmentsSnapshot,
      historyOverride,
      contextGuardEvent: runtimeConfig.contextGuardShowChatEvents ? contextGuardEventPayload : null,
      pluginPermissionGrants: permissionGrants.pluginPermissionGrants,
      toolPermissionGrants: permissionGrants.toolPermissionGrants,
      domainPermissionGrants: permissionGrants.domainPermissionGrants,
      requestId,
      onStatusUpdate: (statusMsg) => {
          if (activeGeneration && activeGeneration.id === generationId) {
            activeGeneration.latestMetaSuffix = statusMsg;
          }
          const activeRow = resolveAssistantRow();
          if (activeRow instanceof HTMLElement) {
            updateMessageRowContent(activeRow, {
              text: "",
              metaSuffix: statusMsg,
              timestamp: new Date(),
              pending: true,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
        },
        onModel: (modelLabel) => {
          streamMetaSuffix = resolveModelMetaSuffix(modelLabel, streamMetaSuffix);
          if (activeGeneration && activeGeneration.id === generationId) {
            activeGeneration.latestMetaSuffix = streamMetaSuffix;
          }
          const activeRow = resolveAssistantRow();
          if (activeRow) {
            const body = activeRow.querySelector("[data-message-body]");
            const hasPartial = body instanceof HTMLElement && Boolean(body.textContent?.trim());
            updateMessageRowContent(activeRow, {
              text: hasPartial ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartial,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
        },
        onToolEvent: (eventPayload) => {
          const phase = eventPayload?.phase === "start" ? "start" : "result";
          const rawPayload = eventPayload?.payload || {};
          const normalizedToolName = normalizeLegacyToolName(String(rawPayload.name || "").trim());
          const payload = {
            ...rawPayload,
            name: normalizedToolName,
          };
          if (!payload.name || requestSessionId !== getActiveChatSessionId()) {
            return;
          }

          const invId = String(payload.invocation_id || "").trim();
          const toolStatus = String(payload.status || "").toLowerCase();
          const toolMeta = resolveToolMeta(payload.name);

          if (phase === "start") {
            if (invId && seenToolInvocations.has(invId)) {
              return;
            }
            if (invId) {
              seenToolInvocations.add(invId);
            }
            const row = appendAndInsertToolRow(payload, "start");
            if (row && invId) {
              toolRowsByInvocationId.set(invId, row);
            }
            applyTransientMood(requestSessionId, "researching", 220);
          } else if (invId && toolRowsByInvocationId.has(invId)) {
            updateToolRow(toolRowsByInvocationId.get(invId), payload);
            elements.chatStream?.scrollTo({ top: elements.chatStream.scrollHeight, behavior: "auto" });
          } else {
            const row = appendAndInsertToolRow(payload, "result");
            if (row && invId) {
              toolRowsByInvocationId.set(invId, row);
            }
          }

          if (phase === "result" && toolStatus !== "error") {
            const newMood = String(
              payload.output?.mood
              || payload.output?.state
              || payload.args?.mood
              || "",
            ).trim();
            if (newMood && requestSessionId) {
              setChatSessionMood(requestSessionId, newMood, runtimeConfig.defaultTransitionMs);
            }
          }

          const toolResultMood = String(
            payload.output?.mood
            || payload.output?.state
            || payload.args?.mood
            || "",
          ).trim();
          if (phase === "result" && !toolResultMood) {
            applyTransientMood(requestSessionId, "waiting", 220);
          }

          updateConnectionState(
            BACKEND_STATUS.checking,
            phase === "start"
              ? `Вызов: ${toolMeta.displayName}...`
              : `${toolMeta.displayName} (${toolStatus || "ok"})`,
          );
        },
        onPartial: (partialText) => {
          latestPartial = normalizeTextInput(partialText);
          contextGuard?.setPendingAssistantText?.(latestPartial);
          if (activeGeneration && activeGeneration.id === generationId) {
            activeGeneration.latestText = latestPartial;
            activeGeneration.latestMetaSuffix = streamMetaSuffix;
          }
          const activeRow = resolveAssistantRow();
          if (activeRow) {
            const hasPartialText = latestPartial.trim().length > 0;
            updateMessageRowContent(activeRow, {
              text: hasPartialText ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartialText,
              pendingLabel: ASSISTANT_PENDING_LABEL,
              streamMode: "",
            });
          }
          if (requestSessionId && /<think>|<thinking>|\bthink|дум|размыш/i.test(latestPartial)) {
            applyTransientMood(requestSessionId, "thinking", 180);
          }
          elements.chatStream?.scrollTo({
            top: elements.chatStream.scrollHeight,
            behavior: "auto",
          });
          if (!antiLoopMode && !antiLoopAutoRetryUsed && !antiLoopAbortTriggered && hasRunawayRepetition(latestPartial)) {
            antiLoopAbortTriggered = true;
            updateConnectionState(BACKEND_STATUS.checking, "Anti-loop guard: перезапускаем ответ...");
            pushToast("Обнаружено зацикливание ответа. Выполняем авто-перезапуск генерации.", {
              tone: "warning",
              durationMs: 2600,
            });
            const activeRow = resolveAssistantRow();
            if (activeRow) {
              updateMessageRowContent(activeRow, {
                text: latestPartial,
                metaSuffix: `${streamMetaSuffix} • anti-loop`,
                timestamp: new Date(),
                pending: false,
                pendingLabel: ASSISTANT_PENDING_LABEL,
                streamMode: "",
              });
            }
            if (abortController && !abortController.signal.aborted) {
              abortController.abort("ANTI_LOOP_GUARD");
            }
          }
        },
      });

    try {
      let reply = await runAssistantAttempt(effectiveText, { antiLoopMode: false });
      if (reply?.cancelled && antiLoopAbortTriggered && !antiLoopAutoRetryUsed) {
        antiLoopAutoRetryUsed = true;
        antiLoopAbortTriggered = false;
        latestPartial = "";
        contextGuard?.setPendingAssistantText?.("");

        appendAndInsertToolRow({
          name: "generation.loop_guard",
          display_name: "Loop Guard",
          status: "warning",
          meta_suffix: "anti-loop",
          args: { query: "авто-перезапуск генерации" },
          text: "Обнаружен повторяющийся паттерн. Перезапускаем ответ в anti-loop режиме.",
        }, "result");

        const activeRow = resolveAssistantRow();
        if (activeRow) {
          updateMessageRowContent(activeRow, {
            text: "",
            metaSuffix: `${streamMetaSuffix} • anti-loop retry`,
            timestamp: new Date(),
            pending: true,
            pendingLabel: ASSISTANT_PENDING_LABEL,
            streamMode: "",
          });
        }
        abortController = new AbortController();
        if (activeGeneration && activeGeneration.id === generationId) {
          activeGeneration.abortController = abortController;
          activeGeneration.stoppedByUser = false;
        }
        const retryPrompt = buildAntiLoopRetryPrompt(effectiveText);
        reply = await runAssistantAttempt(retryPrompt || effectiveText, { antiLoopMode: true });
      }

      if (reply?.cancelled) {
        if (activeGeneration && activeGeneration.id === generationId) {
          activeGeneration.latestMetaSuffix = "остановлено";
        }
        applyTransientMood(requestSessionId, getChatSessionMood(requestSessionId) || savedMood, runtimeConfig.defaultTransitionMs);
        if (isBackendRuntimeEnabled()) {
          await syncChatStoreFromBackend({
            preserveActive: true,
            preferredActiveId: requestSessionId,
            silent: true,
          });
        }
        syncState({ forceContextRefresh: true });
        return;
      }

      const finalText = normalizeTextInput(reply.text || latestPartial || "Бэкенд вернул пустой ответ.");
      const finalMetaSuffix = String(reply.metaSuffix || streamMetaSuffix || initialMetaSuffix);
      latestStreamMode = String(reply?.stream?.mode || "").trim().toLowerCase();
      const generationActionsMeta = buildGenerationActionsMeta({
        userText: userMessageText,
        userMessageId,
        backendGenerationActions: reply?.generationActions,
      });
      if (activeGeneration && activeGeneration.id === generationId) {
        activeGeneration.latestText = finalText;
        activeGeneration.latestMetaSuffix = finalMetaSuffix;
      }
      const generatedChatTitle = sanitizeSessionTitle(String(reply.chatTitle || "").trim(), "");
      if (requestSessionId && generatedChatTitle) {
        renameChatSessionById(requestSessionId, generatedChatTitle);
      }

      const finalToolEvents = Array.isArray(reply.toolEvents) ? reply.toolEvents : [];
      if (!isBackendRuntimeEnabled()) {
        finalToolEvents.forEach((eventItem) => {
          const toolName = normalizeLegacyToolName(String(eventItem?.name || "tool"));
          const toolDisplayName = String(eventItem?.display_name || resolveToolMeta(toolName).displayName || toolName);
          const toolStatus = String(eventItem?.status || "ok").trim().toLowerCase() || "ok";
          const toolOutput = eventItem?.output && typeof eventItem.output === "object" ? eventItem.output : {};
          const toolText = formatToolOutputText(toolName, toolOutput) || toolName;
          persistChatMessage({
            chatId: requestSessionId,
            role: "tool",
            text: toolText,
            metaSuffix: `инструмент • ${toolStatus}`,
            meta: {
              tool_name: toolName,
              tool_display_name: toolDisplayName,
              status: toolStatus,
              tool_output: toolOutput,
              tool_args: {},
            },
            timestamp: new Date().toISOString(),
          });
        });
      }

      const activeRow = resolveAssistantRow();
      if (activeRow) {
        updateMessageRowContent(activeRow, {
          text: finalText,
          metaSuffix: finalMetaSuffix,
          timestamp: new Date(),
          streamMode: latestStreamMode,
        });
        if (generationActionsMeta) {
          setAssistantGenerationActions?.(activeRow, generationActionsMeta);
        }
      }

      const assistantPersistMeta = {};
      if (latestStreamMode) {
        assistantPersistMeta.stream = { mode: latestStreamMode };
      }
      if (generationActionsMeta) {
        assistantPersistMeta.generation_actions = generationActionsMeta;
      }

      const persisted = persistChatMessage({
        chatId: requestSessionId,
        role: "assistant",
        text: finalText,
        metaSuffix: finalMetaSuffix,
        meta: assistantPersistMeta,
        timestamp: new Date().toISOString(),
      });
      if (activeRow && persisted?.id) {
        activeRow.dataset.messageId = persisted.id;
      }
      pruneTransientAssistantDuplicates(requestSessionId);

      const finalMood = String(reply.mood || "").trim();
      if (requestSessionId) {
        const currentSessionMood = getChatSessionMood(requestSessionId);
        const toolChangedMood = currentSessionMood && currentSessionMood !== savedMood;
        if (!toolChangedMood && finalMood && finalMood !== "neutral" && finalMood !== "waiting" && finalMood !== "thinking") {
          setChatSessionMood(requestSessionId, finalMood, runtimeConfig.defaultTransitionMs);
        } else {
          applyTransientMood(requestSessionId, currentSessionMood || savedMood, runtimeConfig.defaultTransitionMs);
        }
        if (isBackendRuntimeEnabled()) {
          await syncChatStoreFromBackend({
            preserveActive: true,
            preferredActiveId: requestSessionId,
            silent: true,
          });
        }
        syncState({ forceContextRefresh: true });
      } else {
        background.setMood(finalMood || "neutral", runtimeConfig.defaultTransitionMs);
        syncState({ forceContextRefresh: true });
      }
    } finally {
      if (!activeGeneration || activeGeneration.id === generationId) {
        activeGeneration = null;
        contextGuard?.clearPendingAssistantText?.();
        if (requestSessionId) {
          pruneTransientAssistantDuplicates(requestSessionId);
        }
        syncState({ forceContextRefresh: true });
      }
    }
  }

  return {
    handleSubmit,
    triggerGenerationAction,
    syncState,
    stopActiveGeneration,
    isGenerationActiveForChat,
  };
}
