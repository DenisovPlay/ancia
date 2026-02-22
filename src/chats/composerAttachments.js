import { icon } from "../ui/icons.js";
import { normalizeTextInput } from "../ui/messageFormatter.js";
import {
  isImageAttachment,
  normalizeAttachment,
} from "./attachmentUtils.js";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function classifyAttachmentKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const mimeType = String(file?.type || "").toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (
    mimeType.startsWith("text/")
    || mimeType.includes("json")
    || mimeType.includes("xml")
    || mimeType.includes("yaml")
    || mimeType.includes("csv")
    || /\.(txt|md|markdown|json|csv|xml|ya?ml|html?|js|ts|py|java|go|rs|c|cpp|h)$/i.test(name)
  ) {
    return "text";
  }
  if (/\.(pdf|doc|docx|rtf|odt)$/i.test(name)) {
    return "document";
  }
  return "file";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read_error"));
    reader.readAsDataURL(file);
  });
}

export function createComposerAttachmentsManager({
  elements,
  pushToast,
  getModelId,
  getModelSupportsVision,
  resolveCurrentModelSupportsVision,
  onChange,
  maxComposerAttachments = 10,
  maxAttachmentTextChars = 8000,
  maxImageDataUrlChars = 2_000_000,
}) {
  let attachments = [];
  let visionSupportCache = {
    modelId: "",
    value: null,
  };

  function guessVisionSupportByModelId(modelId) {
    const normalized = String(modelId || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return /(?:^|[-_/])(vl|vision|llava|idefics|pixtral|moondream|minicpm-v)/i.test(normalized);
  }

  async function resolveVisionSupport() {
    const currentModelId = String(getModelId?.() || "").trim().toLowerCase();
    if (currentModelId && visionSupportCache.modelId === currentModelId && typeof visionSupportCache.value === "boolean") {
      return visionSupportCache.value;
    }

    let resolved = null;
    if (typeof resolveCurrentModelSupportsVision === "function") {
      try {
        const value = await resolveCurrentModelSupportsVision();
        if (typeof value === "boolean") {
          resolved = value;
        }
      } catch {
        resolved = null;
      }
    }

    if (resolved == null && typeof getModelSupportsVision === "function") {
      const value = getModelSupportsVision();
      if (typeof value === "boolean") {
        resolved = value;
      }
    }

    if (resolved == null) {
      resolved = guessVisionSupportByModelId(currentModelId);
    }

    const safeResolved = Boolean(resolved);
    visionSupportCache = {
      modelId: currentModelId,
      value: safeResolved,
    };
    return safeResolved;
  }

  async function buildComposerAttachment(file) {
    const kind = classifyAttachmentKind(file);
    const attachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(file?.name || "file"),
      kind,
      mimeType: String(file?.type || ""),
      size: Number(file?.size || 0),
      textContent: "",
      dataUrl: "",
      error: "",
    };

    if (kind === "text") {
      try {
        const text = await file.text();
        attachment.textContent = normalizeTextInput(text).slice(0, maxAttachmentTextChars);
      } catch {
        attachment.textContent = "";
      }
    } else if (kind === "image") {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const safeDataUrl = String(dataUrl || "");
        if (!safeDataUrl.startsWith("data:image/")) {
          attachment.error = "image_invalid";
        } else if (safeDataUrl.length > maxImageDataUrlChars) {
          attachment.error = "image_too_large";
        } else {
          attachment.dataUrl = safeDataUrl;
        }
      } catch {
        attachment.error = "image_read_failed";
        attachment.dataUrl = "";
      }
    }
    return attachment;
  }

  function render() {
    if (!(elements.composerAttachmentsList instanceof HTMLElement)) {
      return;
    }
    if (!attachments.length) {
      elements.composerAttachmentsList.classList.add("hidden");
      elements.composerAttachmentsList.innerHTML = "";
      return;
    }

    elements.composerAttachmentsList.classList.remove("hidden");
    elements.composerAttachmentsList.innerHTML = attachments
      .map((item) => {
        const normalized = normalizeAttachment(item);
        const label = escapeHtml(normalized.name);
        const hasPreviewImage = isImageAttachment(normalized) && String(normalized.dataUrl || "").startsWith("data:image/");
        return `
          <div class="composer-attachment-card">
            <div class="composer-attachment-card__preview">
              ${hasPreviewImage
                ? `<img src="${normalized.dataUrl}" alt="${label}" class="composer-attachment-card__image" loading="lazy" />`
                : `<span class="composer-attachment-card__icon">${icon("attach")}</span>`}
            </div>
            <div class="composer-attachment-card__content">
              <p class="composer-attachment-card__name" title="${label}">${label}</p>
            </div>
            <button
              type="button"
              data-attachment-remove="${normalized.id}"
              class="composer-attachment-card__remove icon-button"
              aria-label="Удалить вложение"
              title="Удалить вложение"
            >
              ${icon("x-mark")}
            </button>
          </div>
        `;
      })
      .join("");
  }

  async function queue(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }
    const slotsLeft = Math.max(0, maxComposerAttachments - attachments.length);
    const selected = files.slice(0, slotsLeft);
    if (selected.length < files.length) {
      pushToast?.(`Можно прикрепить не более ${maxComposerAttachments} файлов за раз.`, {
        tone: "warning",
        durationMs: 3200,
      });
    }

    let warnedAboutVision = false;
    const supportsVision = await resolveVisionSupport();
    const imageSizeHintBytes = Math.max(64 * 1024, Math.floor((maxImageDataUrlChars - 512) * 0.74));
    for (const file of selected) {
      const item = await buildComposerAttachment(file);
      if (item.kind === "image" && !String(item.dataUrl || "").startsWith("data:image/")) {
        const errorCode = String(item.error || "").trim().toLowerCase();
        if (errorCode === "image_too_large") {
          const maxMbLabel = (imageSizeHintBytes / (1024 * 1024)).toFixed(2);
          pushToast?.(`Фото слишком большое для анализа (лимит примерно ${maxMbLabel} MB).`, {
            tone: "warning",
            durationMs: 3600,
          });
        } else {
          pushToast?.("Не удалось прочитать изображение для анализа.", {
            tone: "warning",
            durationMs: 3200,
          });
        }
        continue;
      }
      attachments.push(normalizeAttachment(item));
      if (!warnedAboutVision && item.kind === "image" && !supportsVision) {
        warnedAboutVision = true;
        pushToast?.("Текущая модель может не анализировать изображения. Для фото лучше выбрать vision-модель.", {
          tone: "warning",
          durationMs: 3600,
        });
      }
    }
    render();
    onChange?.();
  }

  function removeById(id) {
    const safeId = String(id || "").trim();
    if (!safeId) {
      return false;
    }
    const initialLength = attachments.length;
    attachments = attachments.filter((item) => String(item.id || "") !== safeId);
    const changed = attachments.length !== initialLength;
    if (changed) {
      render();
      onChange?.();
    }
    return changed;
  }

  function clear() {
    attachments = [];
    if (elements.composerAttachmentsInput instanceof HTMLInputElement) {
      elements.composerAttachmentsInput.value = "";
    }
    render();
    onChange?.();
  }

  function snapshot() {
    return attachments.map((item) => ({ ...item }));
  }

  function hasAny() {
    return attachments.length > 0;
  }

  return {
    queue,
    removeById,
    clear,
    snapshot,
    hasAny,
    render,
  };
}
