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
  isBackendRuntimeEnabled,
  syncChatStoreFromBackend,
  appendMessage,
  updateMessageRowContent,
  updateToolRow,
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
  sanitizeSessionTitle,
  persistChatMessage,
  ASSISTANT_PENDING_LABEL,
  composerAttachments,
}) {
  let activeGeneration = null;

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

  function syncState() {
    const rawValue = elements.composerInput?.value || "";
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

    const userMessageText = hasAttachments
      ? `${effectiveText}\n\nВложения:\n${attachmentsSnapshot.map((item, index) => (
        `${index + 1}. ${String(item.name || "file")} (${String(item.kind || "file")})`
      )).join("\n")}`
      : effectiveText;

    ensureSessionForOutgoingMessage(userMessageText);
    appendMessage("user", userMessageText, "", { persist: true });
    if (elements.composerInput) {
      elements.composerInput.value = "";
    }
    composerAttachments.clear();
    syncState();

    const requestSessionId = getActiveChatSessionId() || ensureSessionForOutgoingMessage(userMessageText);
    const savedMood = getChatSessionMood(requestSessionId) || "neutral";

    applyTransientMood(requestSessionId, "waiting", 420);
    if (!requestSessionId) {
      background.setMood("waiting", 420);
    }

    const initialMetaSuffix = runtimeConfig.mode === "backend"
      ? resolveModelMetaSuffix(runtimeConfig.modelId, "модель")
      : "симуляция";

    let streamMetaSuffix = initialMetaSuffix;
    const assistantRow = appendMessage("assistant", "", initialMetaSuffix, {
      persist: false,
      chatId: requestSessionId,
      pending: true,
      pendingLabel: ASSISTANT_PENDING_LABEL,
    });

    const abortController = new AbortController();
    const generationId = Date.now() + Math.random();
    activeGeneration = {
      id: generationId,
      chatId: requestSessionId || "",
      assistantRow,
      abortController,
      latestText: "",
      stoppedByUser: false,
    };
    syncState();

    let latestPartial = "";
    const seenToolInvocations = new Set();
    const toolRowsByInvocationId = new Map();
    let lastInsertedToolRowBeforeAssistant = null;
    let lastInsertedToolRowAfterAssistant = null;

    const hasAssistantVisibleText = () => {
      if (!(assistantRow instanceof HTMLElement)) {
        return false;
      }
      const body = assistantRow.querySelector("[data-message-body]");
      if (!(body instanceof HTMLElement)) {
        return false;
      }
      const pending = assistantRow.dataset.pending === "true" || body.getAttribute("data-pending") === "true";
      if (pending) {
        return false;
      }
      return Boolean(body.textContent?.trim());
    };

    const insertToolRowNearAssistant = (row) => {
      if (!(row instanceof HTMLElement) || !(assistantRow instanceof HTMLElement)) {
        return;
      }
      if (assistantRow.parentNode !== elements.chatStream) {
        return;
      }
      if (hasAssistantVisibleText()) {
        if (
          lastInsertedToolRowAfterAssistant instanceof HTMLElement
          && lastInsertedToolRowAfterAssistant.parentNode === elements.chatStream
        ) {
          if (lastInsertedToolRowAfterAssistant.nextSibling) {
            elements.chatStream.insertBefore(row, lastInsertedToolRowAfterAssistant.nextSibling);
          } else {
            elements.chatStream.appendChild(row);
          }
        } else {
          if (assistantRow.nextSibling) {
            elements.chatStream.insertBefore(row, assistantRow.nextSibling);
          } else {
            elements.chatStream.appendChild(row);
          }
        }
        lastInsertedToolRowAfterAssistant = row;
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
        elements.chatStream.insertBefore(row, assistantRow);
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

    try {
      const reply = await requestAssistantReply(effectiveText, requestSessionId, {
        signal: abortController.signal,
        attachments: attachmentsSnapshot,
        onStatusUpdate: (statusMsg) => {
          if (assistantRow instanceof HTMLElement) {
            updateMessageRowContent(assistantRow, {
              text: "",
              metaSuffix: statusMsg,
              timestamp: new Date(),
              pending: true,
              pendingLabel: ASSISTANT_PENDING_LABEL,
            });
          }
        },
        onModel: (modelLabel) => {
          streamMetaSuffix = resolveModelMetaSuffix(modelLabel, streamMetaSuffix);
          if (assistantRow) {
            const body = assistantRow.querySelector("[data-message-body]");
            const hasPartial = body instanceof HTMLElement && Boolean(body.textContent?.trim());
            updateMessageRowContent(assistantRow, {
              text: hasPartial ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartial,
              pendingLabel: ASSISTANT_PENDING_LABEL,
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

          if (phase === "result" && payload.name === "chat.set_mood" && toolStatus !== "error") {
            const newMood = String(payload.output?.mood || payload.args?.mood || "").trim();
            if (newMood && requestSessionId) {
              setChatSessionMood(requestSessionId, newMood, runtimeConfig.defaultTransitionMs);
            }
          } else if (phase === "result") {
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
          if (activeGeneration && activeGeneration.id === generationId) {
            activeGeneration.latestText = latestPartial;
          }
          if (assistantRow) {
            const hasPartialText = latestPartial.trim().length > 0;
            updateMessageRowContent(assistantRow, {
              text: hasPartialText ? latestPartial : "",
              metaSuffix: streamMetaSuffix,
              timestamp: new Date(),
              pending: !hasPartialText,
              pendingLabel: ASSISTANT_PENDING_LABEL,
            });
          }
          if (requestSessionId && /<think>|<thinking>|\bthink|дум|размыш/i.test(latestPartial)) {
            applyTransientMood(requestSessionId, "thinking", 180);
          }
          elements.chatStream?.scrollTo({
            top: elements.chatStream.scrollHeight,
            behavior: "auto",
          });
        },
      });

      if (reply?.cancelled) {
        applyTransientMood(requestSessionId, getChatSessionMood(requestSessionId) || savedMood, runtimeConfig.defaultTransitionMs);
        if (isBackendRuntimeEnabled()) {
          await syncChatStoreFromBackend({
            preserveActive: true,
            preferredActiveId: requestSessionId,
            silent: true,
          });
        }
        return;
      }

      const finalText = normalizeTextInput(reply.text || latestPartial || "Бэкенд вернул пустой ответ.");
      const finalMetaSuffix = String(reply.metaSuffix || streamMetaSuffix || initialMetaSuffix);
      const generatedChatTitle = sanitizeSessionTitle(String(reply.chatTitle || "").trim(), "");
      if (requestSessionId && generatedChatTitle) {
        renameChatSessionById(requestSessionId, generatedChatTitle);
      }

      const finalToolEvents = Array.isArray(reply.toolEvents) ? reply.toolEvents : [];
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

      if (assistantRow) {
        updateMessageRowContent(assistantRow, {
          text: finalText,
          metaSuffix: finalMetaSuffix,
          timestamp: new Date(),
        });
      }

      const persisted = persistChatMessage({
        chatId: requestSessionId,
        role: "assistant",
        text: finalText,
        metaSuffix: finalMetaSuffix,
        timestamp: new Date().toISOString(),
      });
      if (assistantRow && persisted?.id) {
        assistantRow.dataset.messageId = persisted.id;
      }

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
      } else {
        background.setMood(finalMood || "neutral", runtimeConfig.defaultTransitionMs);
      }
    } finally {
      if (!activeGeneration || activeGeneration.id === generationId) {
        activeGeneration = null;
        syncState();
      }
    }
  }

  return {
    handleSubmit,
    syncState,
    stopActiveGeneration,
    isGenerationActiveForChat,
  };
}
