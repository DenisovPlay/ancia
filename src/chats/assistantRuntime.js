import { normalizeTextInput } from "../ui/messageFormatter.js";
import {
  BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE,
  BACKEND_HISTORY_MAX_MESSAGES,
  BACKEND_HISTORY_MAX_TOTAL_CHARS,
} from "./historyAndPersistence.js";

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
        generationActions: null,
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
    const generationActions = response?.generation_actions && typeof response.generation_actions === "object"
      ? response.generation_actions
      : (response?.generationActions && typeof response.generationActions === "object"
        ? response.generationActions
        : null);

    return {
      text: String(text || fallbackText),
      mood,
      toolEvents,
      chatTitle,
      model,
      stream,
      generationActions,
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

  function normalizeHistoryOverrideEntries(entries = [], limit = backendHistoryMaxMessages) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return [];
    }
    const safeLimit = Math.max(
      2,
      Math.min(
        BACKEND_HISTORY_MAX_MESSAGES,
        Number(limit) || backendHistoryMaxMessages || BACKEND_HISTORY_MAX_MESSAGES,
      ),
    );
    const trimmed = entries
      .slice(-safeLimit)
      .map((entry) => {
        const roleRaw = String(entry?.role || "").trim().toLowerCase();
        const role = ["user", "assistant", "system"].includes(roleRaw) ? roleRaw : "";
        if (!role) {
          return null;
        }
        let text = normalizeTextInput(String(entry?.text || "")).trim();
        if (!text) {
          return null;
        }
        if (text.length > BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE) {
          text = `${text.slice(0, BACKEND_HISTORY_MAX_CHARS_PER_MESSAGE - 1).trimEnd()}…`;
        }
        return {
          role,
          text,
          timestamp: entry?.timestamp || null,
        };
      })
      .filter(Boolean);

    const compact = [];
    let totalChars = 0;
    for (let index = trimmed.length - 1; index >= 0; index -= 1) {
      const item = trimmed[index];
      const projectedTotal = totalChars + item.text.length;
      if (projectedTotal > BACKEND_HISTORY_MAX_TOTAL_CHARS && compact.length > 0) {
        break;
      }
      totalChars = projectedTotal;
      compact.push(item);
    }
    return compact.reverse();
  }

  function buildBackendChatPayload(
    userText,
    chatId,
    attachments = [],
    {
      historyOverride = null,
      contextGuardEvent = null,
      pluginPermissionGrants = [],
      toolPermissionGrants = [],
      domainPermissionGrants = [],
      requestId = "",
    } = {},
  ) {
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

    const sanitizedHistoryOverride = normalizeHistoryOverrideEntries(historyOverride, backendHistoryMaxMessages);
    const normalizedUserText = normalizeTextInput(String(userText || "")).trim();
    const historyOverrideEnabled = sanitizedHistoryOverride.length > 0;
    let historyPayload = historyOverrideEnabled ? [...sanitizedHistoryOverride] : [];
    if (historyPayload.length > 0) {
      const tail = historyPayload[historyPayload.length - 1];
      const tailText = normalizeTextInput(String(tail?.text || "")).trim();
      if (String(tail?.role || "").trim().toLowerCase() === "user" && tailText === normalizedUserText) {
        historyPayload = historyPayload.slice(0, -1);
      }
    }
    const contextGuardEventPayload = contextGuardEvent && typeof contextGuardEvent === "object"
      ? {
        name: String(contextGuardEvent.name || "").trim() || "context_guard.compress",
        display_name: String(contextGuardEvent.display_name || contextGuardEvent.displayName || "").trim() || "Context Guard",
        status: String(contextGuardEvent.status || "ok").trim().toLowerCase() || "ok",
        meta_suffix: String(contextGuardEvent.meta_suffix || contextGuardEvent.metaSuffix || "").trim()
          || "сжатие контекста",
        text: String(contextGuardEvent.text || "").trim(),
        args: contextGuardEvent.args && typeof contextGuardEvent.args === "object" ? { ...contextGuardEvent.args } : {},
        badge: contextGuardEvent.badge && typeof contextGuardEvent.badge === "object"
          ? {
            label: String(contextGuardEvent.badge.label || "").trim(),
            tone: String(contextGuardEvent.badge.tone || "neutral").trim().toLowerCase() || "neutral",
          }
          : null,
      }
      : {};
    const pluginPermissionGrantsPayload = Array.isArray(pluginPermissionGrants)
      ? pluginPermissionGrants
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
      : [];
    const toolPermissionGrantsPayload = Array.isArray(toolPermissionGrants)
      ? toolPermissionGrants
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
      : [];
    const domainPermissionGrantsPayload = Array.isArray(domainPermissionGrants)
      ? domainPermissionGrants
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
      : [];
    const safeRequestId = String(requestId || "").trim();

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
        plugin_permission_grants: pluginPermissionGrantsPayload,
        tool_permission_grants: toolPermissionGrantsPayload,
        domain_permission_grants: domainPermissionGrantsPayload,
        request_id: safeRequestId,
        history_override_enabled: historyOverrideEnabled,
        context_guard_event: contextGuardEventPayload,
        history: historyPayload,
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

  function normalizeModelFallbackProfile(value) {
    const safeValue = String(value || "").trim().toLowerCase();
    if (safeValue === "conservative" || safeValue === "aggressive") {
      return safeValue;
    }
    return "balanced";
  }

  function normalizeModelScenarioProfile(value) {
    const safeValue = String(value || "").trim().toLowerCase();
    if (safeValue === "fast" || safeValue === "precise" || safeValue === "long_context") {
      return safeValue;
    }
    return "auto";
  }

  const MODEL_SCENARIO_META = {
    fast: {
      label: "быстрый",
      contextWindow: 2048,
      maxTokens: 320,
      temperature: 0.45,
      topP: 0.84,
      topK: 28,
    },
    precise: {
      label: "точный",
      contextWindow: 4096,
      maxTokens: 1024,
      temperature: 0.18,
      topP: 0.74,
      topK: 24,
    },
    long_context: {
      label: "длинный контекст",
      contextWindow: 16384,
      maxTokens: 2048,
      temperature: 0.34,
      topP: 0.9,
      topK: 40,
    },
  };

  let modelScenarioApplyPromise = null;
  let modelScenarioApplySignature = "";
  let modelScenarioAppliedSignature = "";
  let modelScenarioFailedSignature = "";

  function buildScenarioParamsPatch(profileKey, requirementsPayload = {}) {
    const scenario = MODEL_SCENARIO_META[profileKey];
    if (!scenario) {
      return {};
    }
    const requirements = requirementsPayload?.context_window_requirements && typeof requirementsPayload.context_window_requirements === "object"
      ? requirementsPayload.context_window_requirements
      : {};
    const currentParams = requirementsPayload?.params && typeof requirementsPayload.params === "object"
      ? requirementsPayload.params
      : {};
    const rawModelLimit = Number(requirements.model_context_limit);
    const safeModelLimit = Number.isFinite(rawModelLimit) && rawModelLimit > 0
      ? Math.max(512, Math.floor(rawModelLimit))
      : 262144;
    const rawMinContext = Number(requirements.min_context_window);
    const safeMinContext = Number.isFinite(rawMinContext) && rawMinContext > 0
      ? Math.max(256, Math.min(safeModelLimit, Math.floor(rawMinContext)))
      : 1024;

    const nextContextWindow = Math.max(
      safeMinContext,
      Math.min(Math.floor(scenario.contextWindow), safeModelLimit),
    );
    const maxTokensCeiling = Math.max(16, nextContextWindow - 64);
    const nextMaxTokens = Math.max(
      128,
      Math.min(Math.floor(scenario.maxTokens), maxTokensCeiling),
    );
    const targetParams = {
      context_window: nextContextWindow,
      max_tokens: nextMaxTokens,
      temperature: scenario.temperature,
      top_p: scenario.topP,
      top_k: Math.floor(scenario.topK),
    };
    const patch = {};
    Object.entries(targetParams).forEach(([key, value]) => {
      const currentValue = Number(currentParams[key]);
      if (!Number.isFinite(currentValue) || Math.abs(currentValue - Number(value)) > 0.0001) {
        patch[key] = value;
      }
    });
    return patch;
  }

  async function ensureModelScenarioProfileApplied({ onStatusUpdate } = {}) {
    if (runtimeConfig.mode !== "backend") {
      return;
    }
    if (!runtimeConfig.modelScenarioAutoApply) {
      return;
    }
    const profileKey = normalizeModelScenarioProfile(runtimeConfig.modelScenarioProfile);
    if (profileKey === "auto") {
      return;
    }
    const safeModelId = String(runtimeConfig.modelId || "").trim().toLowerCase();
    if (!safeModelId) {
      return;
    }
    const scenarioSignature = `${safeModelId}:${profileKey}`;
    if (modelScenarioAppliedSignature === scenarioSignature) {
      return;
    }
    if (modelScenarioApplyPromise && modelScenarioApplySignature === scenarioSignature) {
      await modelScenarioApplyPromise;
      return;
    }
    if (modelScenarioApplyPromise) {
      await modelScenarioApplyPromise;
      if (modelScenarioAppliedSignature === scenarioSignature) {
        return;
      }
    }

    const scenarioMeta = MODEL_SCENARIO_META[profileKey];
    modelScenarioApplySignature = scenarioSignature;
    modelScenarioApplyPromise = (async () => {
      try {
        onStatusUpdate?.(`Профиль модели: ${scenarioMeta.label}`);
        const requirementsPayload = await backendClient.getModelContextRequirements(safeModelId, { timeoutMs: 25000 });
        const paramsPatch = buildScenarioParamsPatch(profileKey, requirementsPayload);
        if (!paramsPatch || Object.keys(paramsPatch).length === 0) {
          modelScenarioAppliedSignature = scenarioSignature;
          modelScenarioFailedSignature = "";
          return;
        }
        await backendClient.updateModelParams(safeModelId, paramsPatch, { timeoutMs: 45000 });
        modelScenarioAppliedSignature = scenarioSignature;
        modelScenarioFailedSignature = "";
      } catch (error) {
        if (modelScenarioFailedSignature !== scenarioSignature) {
          pushToast(`Не удалось применить профиль модели: ${error.message}`, {
            tone: "warning",
            durationMs: 3400,
          });
        }
        modelScenarioFailedSignature = scenarioSignature;
      } finally {
        modelScenarioApplyPromise = null;
        modelScenarioApplySignature = "";
      }
    })();
    await modelScenarioApplyPromise;
  }

  function parseModelSizeScore(rawModel = {}) {
    const fromSizeField = String(rawModel?.size || "").trim();
    const fromId = String(rawModel?.id || "").trim().toLowerCase();
    const sizeMatch = /(\d+(?:\.\d+)?)\s*b/i.exec(fromSizeField) || /-(\d+(?:\.\d+)?)b(?:-|$)/i.exec(fromId);
    if (sizeMatch?.[1]) {
      const value = Number(sizeMatch[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
    const maxContext = Number(rawModel?.max_context);
    if (Number.isFinite(maxContext) && maxContext > 0) {
      return Math.max(0.1, 64 / maxContext);
    }
    return 999;
  }

  function normalizeCatalogModel(rawModel = {}) {
    const id = String(rawModel?.id || "").trim().toLowerCase();
    if (!id) {
      return null;
    }
    const compatibility = rawModel?.compatibility && typeof rawModel.compatibility === "object"
      ? rawModel.compatibility
      : {};
    const cache = rawModel?.cache && typeof rawModel.cache === "object"
      ? rawModel.cache
      : {};
    return {
      id,
      label: String(rawModel?.label || id).trim(),
      supportsTools: rawModel?.supports_tools !== false,
      compatible: compatibility.compatible !== false,
      cached: Boolean(cache.cached),
      loaded: Boolean(rawModel?.loaded),
      selected: Boolean(rawModel?.selected),
      sizeScore: parseModelSizeScore(rawModel),
    };
  }

  function shouldAttemptModelFallback(errorMessage = "") {
    const safeMessage = String(errorMessage || "").trim().toLowerCase();
    if (!safeMessage) {
      return false;
    }
    return (
      /out\s+of\s+memory|insufficient\s+memory|not\s+enough\s+memory|vram|gpu memory|cuda|metal|mlx/i.test(safeMessage)
      || /превышено время ожидания|timeout|timed out|503|502|504|service unavailable|runtime недоступен/i.test(safeMessage)
      || /loading model|ошибка загрузки модели|модель недоступна|model unavailable|model not ready/i.test(safeMessage)
      || /resource exhausted|oom|broken pipe|поток ответа недоступен/i.test(safeMessage)
    );
  }

  function buildModelFallbackCandidates(modelsPayload = {}) {
    const profileId = normalizeModelFallbackProfile(runtimeConfig.modelAutoFallbackProfile);
    const profile = {
      conservative: {
        maxAttempts: 1,
        cachedOnly: true,
        preferCached: true,
      },
      balanced: {
        maxAttempts: 2,
        cachedOnly: false,
        preferCached: true,
      },
      aggressive: {
        maxAttempts: 3,
        cachedOnly: false,
        preferCached: false,
      },
    }[profileId];
    const selectedModelId = String(
      modelsPayload?.selected_model || runtimeConfig.modelId || "",
    ).trim().toLowerCase();
    const models = Array.isArray(modelsPayload?.models)
      ? modelsPayload.models.map(normalizeCatalogModel).filter(Boolean)
      : [];
    const current = models.find((model) => model.id === selectedModelId) || null;
    const currentSizeScore = Number.isFinite(current?.sizeScore) ? current.sizeScore : null;
    let candidates = models
      .filter((model) => model.id !== selectedModelId)
      .filter((model) => model.supportsTools && model.compatible);
    if (profile.cachedOnly) {
      candidates = candidates.filter((model) => model.cached || model.loaded);
    }

    const scoreCandidate = (model) => {
      let score = Number(model.sizeScore || 999);
      if (profile.preferCached && !model.cached && !model.loaded) {
        score += 160;
      }
      if (model.loaded) {
        score -= 46;
      } else if (model.cached) {
        score -= 24;
      }
      if (currentSizeScore !== null && Number.isFinite(model.sizeScore)) {
        if (model.sizeScore > currentSizeScore) {
          score += 88 + (model.sizeScore - currentSizeScore) * 9;
        } else {
          score -= 18;
        }
      }
      return score;
    };

    candidates.sort((left, right) => scoreCandidate(left) - scoreCandidate(right));

    return {
      profileId,
      selectedModelId,
      candidates: candidates.slice(0, Math.max(1, Number(profile.maxAttempts) || 1)),
    };
  }

  async function requestAssistantReply(
    userText,
    chatId = getActiveChatSessionId?.(),
    {
      onPartial,
      onToolEvent,
      onModel,
      onStatusUpdate,
      signal,
      attachments = [],
      historyOverride = null,
      contextGuardEvent = null,
      pluginPermissionGrants = [],
      toolPermissionGrants = [],
      domainPermissionGrants = [],
      requestId = "",
      extraPayloadFields = {},
    } = {},
  ) {
    let latestPartialText = "";

    if (runtimeConfig.mode !== "backend") {
      const draft = {
        ...draftAssistantReply(userText),
        metaSuffix: "симуляция",
      };
      onPartial?.(draft.text);
      return draft;
    }

    const resolveIncomingDelta = (incomingText, currentText) => {
      const incoming = String(incomingText || "");
      if (!incoming) {
        return "";
      }
      const current = String(currentText || "");
      if (!current) {
        return incoming;
      }
      if (incoming.startsWith(current)) {
        return incoming.slice(current.length);
      }
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

    const buildRequestPayload = () => ({
      ...buildBackendChatPayload(
        userText,
        chatId,
        attachments,
        {
          historyOverride,
          contextGuardEvent,
          pluginPermissionGrants,
          toolPermissionGrants,
          domainPermissionGrants,
          requestId,
        },
      ),
      ...extraPayloadFields,
    });

    const performBackendAttempt = async (requestPayload, { allowTransportFallback = true } = {}) => {
      let streamedText = "";
      let streamError = "";
      let donePayload = null;

      const appendStreamDelta = (deltaText) => {
        const safeDelta = resolveIncomingDelta(deltaText, streamedText);
        if (!safeDelta) {
          return;
        }
        streamedText += safeDelta;
        latestPartialText = streamedText;
        onPartial?.(streamedText);
      };

      try {
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
          throw error;
        }
        const streamErrorMessage = String(error?.message || "");
        const hasPartialStreamReply = Boolean(donePayload) || Boolean(String(streamedText || "").trim());
        if (hasPartialStreamReply) {
          const partialPayload = donePayload || {
            reply: streamedText,
            mood: inferMoodFromText(streamedText),
            model: "backend-stream",
            stream: {
              mode: "partial_stream",
              reason: streamErrorMessage || "stream_interrupted",
            },
          };
          const parsed = parseBackendResponse(
            partialPayload,
            streamedText || "Поток ответа прервался.",
          );
          if (streamedText && !parsed.text) {
            parsed.text = streamedText;
          }
          if (!String(parsed.text || "").trim()) {
            parsed.text = "Поток ответа прервался.";
          }
          updateConnectionState(
            BACKEND_STATUS.connected,
            donePayload
              ? "Поток ответа завершён"
              : "Поток прерван, показан частичный результат",
          );
          return {
            ...parsed,
            metaSuffix: resolveModelMetaSuffix(parsed.model, runtimeConfig.modelId),
          };
        }
        const isStreamTransportIssue = /HTTP \d+/.test(streamErrorMessage)
          || /Поток ответа недоступен/i.test(streamErrorMessage)
          || /\/chat\/stream/i.test(streamErrorMessage)
          || /потоковой генерации/i.test(streamErrorMessage)
          || /stream(?:ing)? generation/i.test(streamErrorMessage)
          || /broken pipe|errno\s*32/i.test(streamErrorMessage);
        if (!allowTransportFallback || !isStreamTransportIssue) {
          throw error;
        }
        const payload = await backendClient.sendMessage(requestPayload);
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
      }
    };

    const tryModelFallback = async (sourceError) => {
      if (!runtimeConfig.modelAutoFallbackEnabled) {
        return null;
      }
      const sourceMessage = String(sourceError?.message || "");
      if (!shouldAttemptModelFallback(sourceMessage)) {
        return null;
      }

      let modelsPayload = null;
      try {
        modelsPayload = await backendClient.listModels();
      } catch {
        return null;
      }
      const fallbackPlan = buildModelFallbackCandidates(modelsPayload);
      if (!Array.isArray(fallbackPlan.candidates) || fallbackPlan.candidates.length === 0) {
        return null;
      }

      const originalModelId = String(fallbackPlan.selectedModelId || runtimeConfig.modelId || "").trim().toLowerCase();
      let lastFallbackError = sourceError;
      onStatusUpdate?.("Запускаем авто-fallback модели…");
      for (const candidate of fallbackPlan.candidates) {
        const candidateId = String(candidate?.id || "").trim().toLowerCase();
        if (!candidateId) {
          continue;
        }
        try {
          await backendClient.selectModel({ model_id: candidateId });
          runtimeConfig.modelId = candidateId;
          onStatusUpdate?.(`Fallback: ${candidate.label}`);
          onModel?.(candidate.label || candidateId);
          onPartial?.("");
          latestPartialText = "";
          const result = await performBackendAttempt(buildRequestPayload(), {
            allowTransportFallback: true,
          });
          pushToast(`Авто-fallback: переключено на ${candidate.label || candidateId}.`, {
            tone: "success",
            durationMs: 2600,
          });
          return result;
        } catch (fallbackError) {
          lastFallbackError = fallbackError;
        }
      }

      if (originalModelId) {
        try {
          await backendClient.selectModel({ model_id: originalModelId });
          runtimeConfig.modelId = originalModelId;
        } catch {
          // Если откат не удался, остаёмся на последней попытке.
        }
      }
      throw lastFallbackError;
    };

    try {
      await ensureModelScenarioProfileApplied({ onStatusUpdate });
      updateConnectionState(BACKEND_STATUS.checking, "Отправка запроса /chat/stream ...");
      return await performBackendAttempt(buildRequestPayload(), {
        allowTransportFallback: true,
      });
    } catch (error) {
      if (error?.code === "ABORTED" || /REQUEST_ABORTED/.test(String(error?.message || ""))) {
        return {
          text: latestPartialText,
          mood: "neutral",
          metaSuffix: "остановлено",
          cancelled: true,
        };
      }

      try {
        const fallbackResult = await tryModelFallback(error);
        if (fallbackResult) {
          return fallbackResult;
        }
      } catch (fallbackError) {
        error = fallbackError;
      }

      const detail = String(error?.message || "неизвестная ошибка");
      const isContextOverflow = /контекст переполнен|context.?overflow/i.test(detail);
      updateConnectionState(BACKEND_STATUS.error, `Ошибка бэкенда: ${detail}`);
      if (!isContextOverflow) {
        pushToast(`Бэкенд недоступен: ${detail}`, { tone: "error", durationMs: 3600 });
      }
      return {
        text: isContextOverflow ? detail : `Не удалось получить ответ модели: ${detail}`,
        mood: "error",
        metaSuffix: isContextOverflow ? "контекст переполнен" : "ошибка модели",
        isContextOverflow,
      };
    }
  }

  return {
    inferMoodFromText,
    resolveModelMetaSuffix,
    requestAssistantReply,
  };
}
