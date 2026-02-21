import { createComposerAttachmentsManager } from "./composerAttachments.js";
import { createComposerGenerationController } from "./composerGeneration.js";

export function createChatComposerController({
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
}) {
  let isBound = false;

  const composerAttachments = createComposerAttachmentsManager({
    elements,
    pushToast,
    getModelId: () => runtimeConfig.modelId,
    onChange: () => {
      syncState();
    },
    maxComposerAttachments: 10,
    maxAttachmentTextChars: 8000,
    maxImageDataUrlChars: 140000,
  });

  const generationController = createComposerGenerationController({
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
  });

  const {
    handleSubmit,
    syncState,
    stopActiveGeneration,
    isGenerationActiveForChat,
  } = generationController;

  function bind() {
    if (isBound) {
      return;
    }
    isBound = true;

    elements.composerForm?.addEventListener("submit", handleSubmit);

    elements.composerAttachButton?.addEventListener("click", () => {
      if (isGenerationActiveForChat()) {
        return;
      }
      elements.composerAttachmentsInput?.click();
    });

    elements.composerAttachmentsInput?.addEventListener("change", async () => {
      const input = elements.composerAttachmentsInput;
      const files = input?.files;
      if (!files || files.length === 0) {
        return;
      }
      await composerAttachments.queue(files);
      if (input) {
        input.value = "";
      }
    });

    elements.composerAttachmentsList?.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest("[data-attachment-remove]")
        : null;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const attachmentId = String(target.dataset.attachmentRemove || "").trim();
      if (!attachmentId) {
        return;
      }
      composerAttachments.removeById(attachmentId);
    });

    elements.composerInput?.addEventListener("input", () => {
      syncState();
    });

    elements.composerInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        elements.composerForm.requestSubmit();
      }
    });
  }

  return {
    bind,
    syncState,
    stopActiveGeneration,
    isGenerationActiveForChat,
    renderAttachments: () => composerAttachments.render(),
  };
}
