import { icon } from "../ui/icons.js";
import { normalizeTextInput } from "../ui/messageFormatter.js";

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
  onChange,
  maxComposerAttachments = 10,
  maxAttachmentTextChars = 8000,
  maxImageDataUrlChars = 140000,
}) {
  let attachments = [];

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
        attachment.dataUrl = String(dataUrl || "").slice(0, maxImageDataUrlChars);
      } catch {
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
        const label = String(item?.name || "file");
        const kind = String(item?.kind || "file");
        return `
          <span class="inline-flex items-center gap-2 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1 text-xs text-zinc-200">
            <span>${label}</span>
            <span class="text-zinc-400">${kind}</span>
            <button
              type="button"
              data-attachment-remove="${item.id}"
              class="icon-button h-5 w-5 rounded-full border border-zinc-600/40 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-700/80"
              aria-label="Удалить вложение"
              title="Удалить вложение"
            >
              ${icon("x-mark")}
            </button>
          </span>
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
    for (const file of selected) {
      const item = await buildComposerAttachment(file);
      attachments.push(item);
      if (!warnedAboutVision && item.kind === "image" && !/qwen3-vl/i.test(String(getModelId?.() || ""))) {
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
