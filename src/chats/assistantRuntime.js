import { normalizeTextInput } from "../ui/messageFormatter.js";

const DRAFT_REPLIES = {
  offline: "Похоже на офлайн-сценарий. Переключаю фон в режим недоступности и продолжаю с локальным контекстом.",
  error: "Понял. Включаю состояние ошибки для визуального сигнала и фиксирую инцидент в контексте.",
  warning: "Есть потенциальный риск. Перевожу интерфейс в предупреждающее состояние до подтверждения действий.",
  planning: "Принято. Начинаю декомпозицию задачи и отмечаю режим планирования.",
  coding: "Вхожу в инженерный цикл: анализ, правки, проверка. Фон переключён в режим кодинга.",
  researching: "Фиксирую исследовательский режим: собираю источники и сопоставляю факты.",
  creative: "Включаю творческий режим. Подготовлю несколько вариаций и выберем лучший вариант.",
  thinking: "Запрос принят. Оставляю состояние размышления до завершения расчётов и проверки файлов.",
  success: "Отлично, операция отмечена как успешная. Переключаю фон в состояние успеха.",
  friendly: "Держу дружелюбный режим. При необходимости могу переключиться в рабочее или аварийное состояние.",
};

export function createChatAssistantRuntime({
  runtimeConfig,
  background,
  backendClient,
  getChatHistoryForBackend,
  getChatSessionById,
  getActiveChatSessionId,
  updateConnectionState,
  BACKEND_STATUS,
  pushToast,
  backendHistoryMaxMessages,
}) {
  function inferMoodFromText(text) {
    const normalized = String(text || "").toLowerCase();

    if (/offline|off-line|нет сети|no network|network down|сервер недоступ|lost connection/i.test(normalized)) {
      return "offline";
    }
    if (/error|ошиб|fail|panic|агресс/i.test(normalized)) {
      return "error";
    }
    if (/warn|warning|риск|опас|осторож|caution/i.test(normalized)) {
      return "warning";
    }
    if (/wait|ожид|think|дума|анализ/i.test(normalized)) {
      return "thinking";
    }
    if (/plan|план|roadmap|этап|шаг/i.test(normalized)) {
      return "planning";
    }
    if (/code|код|refactor|patch|фикс|исправ|bugfix|dev/i.test(normalized)) {
      return "coding";
    }
    if (/research|исслед|поиск|browse|документац|источник|lookup/i.test(normalized)) {
      return "researching";
    }
    if (/idea|креатив|brainstorm|концепт|дизайн/i.test(normalized)) {
      return "creative";
    }
    if (/success|готово|done|ok|отлично/i.test(normalized)) {
      return "success";
    }
    if (/friend|друж|hello|привет|спасибо/i.test(normalized)) {
      return "friendly";
    }

    return "neutral";
  }

  function draftAssistantReply(userText) {
    const mood = inferMoodFromText(userText);
    return {
      text: DRAFT_REPLIES[mood] || "Контекст обновлён. Могу принять состояние от вызова инструмента через botMood API.",
      mood,
    };
  }

  function parseBackendResponse(response, fallbackText) {
    if (typeof response === "string") {
      return {
        text: response,
        mood: inferMoodFromText(response),
        toolEvents: [],
        chatTitle: "",
        model: "",
      };
    }

    const text = response?.reply || response?.message || response?.output || response?.result || fallbackText;
    const mood = String(response?.mood || inferMoodFromText(text || fallbackText)).toLowerCase();
    const chatTitle = String(response?.chat_title || response?.chatTitle || "").trim();
    const model = String(response?.model || response?.model_name || response?.modelLabel || "").trim();
    const toolEvents = Array.isArray(response?.tool_events)
      ? response.tool_events
      : Array.isArray(response?.toolEvents)
        ? response.toolEvents
        : [];
    const stream = response?.stream && typeof response.stream === "object"
      ? response.stream
      : {};

    return {
      text: String(text || fallbackText),
      mood,
      toolEvents,
      chatTitle,
      model,
      stream,
    };
  }

  function resolveModelMetaSuffix(modelValue, fallback = "") {
    const safeModel = String(modelValue || "").trim();
    if (safeModel) {
      return safeModel;
    }
    const safeFallback = String(fallback || "").trim();
    if (safeFallback) {
      return safeFallback;
    }
    return "модель";
  }

  function buildBackendChatPayload(userText, chatId, attachments = []) {
    const activeChatId = String(chatId || getActiveChatSessionId?.() || "");
    const targetChatSession = getChatSessionById(activeChatId);
    const safeAttachments = Array.isArray(attachments)
      ? attachments
        .map((item) => (item && typeof item === "object" ? {
          id: String(item.id || ""),
          name: String(item.name || ""),
          kind: String(item.kind || "file"),
          mimeType: String(item.mimeType || ""),
          size: Number(item.size || 0),
          textContent: String(item.textContent || ""),
          dataUrl: String(item.dataUrl || ""),
        } : null))
        .filter(Boolean)
      : [];

    return {
      message: userText,
      attachments: safeAttachments,
      context: {
        chat_id: activeChatId || "default",
        chat_title: targetChatSession?.title || "",
        mood: background.getCurrentMood().name,
        user: {
          name: runtimeConfig.userName,
          context: runtimeConfig.userContext,
          language: runtimeConfig.userLanguage,
          timezone: runtimeConfig.userTimezone,
        },
        ui: {
          density: runtimeConfig.uiDensity,
          animations: runtimeConfig.uiAnimations,
          modelId: runtimeConfig.modelId,
          // Параметры генерации — источник истины в БД бэкенда (/models/{id}/params).
          // Не отправляем клиентские override, чтобы не перетирать сохранённые значения.
          contextWindow: null,
          maxTokens: null,
          temperature: null,
          topP: null,
          topK: null,
        },
        history: getChatHistoryForBackend(backendHistoryMaxMessages),
      },
    };
  }

  function extractStreamErrorMessage(payload) {
    if (!payload) {
      return "неизвестная ошибка потока";
    }
    if (typeof payload === "string") {
      return payload;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail.trim();
    }
    try {
      return JSON.stringify(payload);
    } catch {
      return "неизвестная ошибка потока";
    }
  }

  async function requestAssistantReply(
    userText,
    chatId = getActiveChatSessionId?.(),
    { onPartial, onToolEvent, onModel, onStatusUpdate, signal, attachments = [] } = {},
  ) {
    let streamedText = "";
    let streamError = "";
    let donePayload = null;

    const resolveIncomingDelta = (incomingText) => {
      const incoming = String(incomingText || "");
      if (!incoming) {
        return "";
      }
      const current = streamedText;
      if (!current) {
        return incoming;
      }
      if (incoming.startsWith(current)) {
        return incoming.slice(current.length);
      }
      // Проверяем только дубликат хвоста. includes() удаляет валидные
      // повторяющиеся токены внутри текста и рвёт слова/фразы в стриме.
      if (current.endsWith(incoming)) {
        return "";
      }
      const maxOverlap = Math.min(current.length, incoming.length);
      for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        if (current.endsWith(incoming.slice(0, overlap))) {
          return incoming.slice(overlap);
        }
      }
      return incoming;
    };

    const appendStreamDelta = (deltaText) => {
      const safeDelta = resolveIncomingDelta(deltaText);
      if (!safeDelta) {
        return;
      }
      streamedText += safeDelta;
      onPartial?.(streamedText);
    };

    if (runtimeConfig.mode !== "backend") {
      const draft = {
        ...draftAssistantReply(userText),
        metaSuffix: "симуляция",
      };
      onPartial?.(draft.text);
      return draft;
    }

    try {
      updateConnectionState(BACKEND_STATUS.checking, "Отправка запроса /chat/stream ...");
      const requestPayload = buildBackendChatPayload(userText, chatId, attachments);

      await backendClient.sendMessageStream(requestPayload, {
        signal,
        onStart: (payload) => {
          const streamModel = String(payload?.model_label || payload?.model || "").trim();
          if (streamModel) {
            onModel?.(streamModel);
          }
          updateConnectionState(BACKEND_STATUS.checking, "Поток ответа запущен...");
        },
        onToolStart: (payload) => {
          onToolEvent?.({
            phase: "start",
            payload: payload || {},
          });
        },
        onToolResult: (payload) => {
          onToolEvent?.({
            phase: "result",
            payload: payload || {},
          });
        },
        onStatus: (payload) => {
          const message = String(payload?.message || "").trim();
          if (message) {
            updateConnectionState(BACKEND_STATUS.checking, message);
            onStatusUpdate?.(message);
          }
        },
        onDelta: (deltaPayload) => {
          const delta = String(deltaPayload?.text || "");
          if (!delta) {
            return;
          }
          appendStreamDelta(delta);
        },
        onDone: (payload) => {
          donePayload = payload || {};
        },
        onError: (payload) => {
          streamError = extractStreamErrorMessage(payload);
        },
      });

      if (streamError) {
        throw new Error(streamError);
      }
      if (!donePayload && !streamedText) {
        throw new Error("Поток ответа завершился без данных (/chat/stream)");
      }

      const finalPayload = donePayload || {
        reply: streamedText,
        mood: inferMoodFromText(streamedText),
        model: "backend-stream",
        stream: {
          mode: "streaming",
          delta_count: streamedText ? 1 : 0,
          delta_chars: streamedText.length,
        },
      };
      const parsed = parseBackendResponse(finalPayload, streamedText || "Бэкенд вернул пустой ответ.");
      if (streamedText && !parsed.text) {
        parsed.text = streamedText;
      }
      const streamMode = String(parsed.stream?.mode || "").trim().toLowerCase();
      if (streamMode && streamMode !== "streaming") {
        updateConnectionState(BACKEND_STATUS.connected, "Ответ получен без токен-стрима");
      } else {
        updateConnectionState(BACKEND_STATUS.connected, "Поток ответа завершён");
      }
      return {
        ...parsed,
        metaSuffix: resolveModelMetaSuffix(parsed.model, runtimeConfig.modelId),
      };
    } catch (error) {
      if (error?.code === "ABORTED" || /REQUEST_ABORTED/.test(String(error?.message || ""))) {
        return {
          text: streamedText,
          mood: "neutral",
          metaSuffix: "остановлено",
          cancelled: true,
        };
      }

      const streamErrorMessage = String(error?.message || "");
      const isStreamTransportIssue = /HTTP \d+/.test(streamErrorMessage)
        || /Поток ответа недоступен/i.test(streamErrorMessage)
        || /\/chat\/stream/i.test(streamErrorMessage)
        || /потоковой генерации/i.test(streamErrorMessage)
        || /stream(?:ing)? generation/i.test(streamErrorMessage)
        || /broken pipe|errno\s*32/i.test(streamErrorMessage);
      if (isStreamTransportIssue) {
        try {
          const payload = await backendClient.sendMessage(buildBackendChatPayload(userText, chatId, attachments));
          const parsed = parseBackendResponse(payload, "Бэкенд вернул пустой ответ.");
          if (Array.isArray(parsed.toolEvents)) {
            parsed.toolEvents.forEach((toolEvent, index) => {
              onToolEvent?.({
                phase: "result",
                payload: {
                  invocation_id: `fallback-${index + 1}`,
                  name: toolEvent?.name || "tool",
                  status: toolEvent?.status || "ok",
                  output: toolEvent?.output || {},
                  text: String(toolEvent?.name || "tool"),
                  meta_suffix: `инструмент • ${String(toolEvent?.status || "ok").toLowerCase()}`,
                },
              });
            });
          }
          updateConnectionState(BACKEND_STATUS.connected, "Ответ получен от бэкенда");
          return {
            ...parsed,
            text: parsed.text || streamedText,
            metaSuffix: resolveModelMetaSuffix(parsed.model, runtimeConfig.modelId),
          };
        } catch (fallbackError) {
          error = fallbackError;
        }
      }

      const detail = String(error?.message || "неизвестная ошибка");
      updateConnectionState(BACKEND_STATUS.error, `Ошибка бэкенда: ${detail}`);
      pushToast(`Бэкенд недоступен: ${detail}`, { tone: "error", durationMs: 3600 });
      return {
        text: `Не удалось получить ответ модели: ${detail}`,
        mood: "error",
        metaSuffix: "ошибка модели",
      };
    }
  }

  return {
    inferMoodFromText,
    resolveModelMetaSuffix,
    requestAssistantReply,
  };
}
