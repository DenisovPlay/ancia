function toSafeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.trunc(parsed));
}

export function normalizeAttachment(item, index = 0) {
  const safeItem = item && typeof item === "object" ? item : {};
  return {
    id: String(safeItem.id || `att-${index + 1}`),
    name: String(safeItem.name || `file-${index + 1}`),
    kind: String(safeItem.kind || "file").trim().toLowerCase() || "file",
    mimeType: String(safeItem.mimeType || "").trim().toLowerCase(),
    size: toSafeInteger(safeItem.size),
    textContent: String(safeItem.textContent || ""),
    dataUrl: String(safeItem.dataUrl || ""),
  };
}

export function formatAttachmentSize(size) {
  const safeSize = toSafeInteger(size);
  if (safeSize <= 0) {
    return "размер неизвестен";
  }
  if (safeSize < 1024) {
    return `${safeSize} B`;
  }
  if (safeSize < 1024 * 1024) {
    return `${(safeSize / 1024).toFixed(1)} KB`;
  }
  return `${(safeSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageAttachment(item) {
  const safeItem = normalizeAttachment(item);
  return safeItem.kind === "image" || safeItem.mimeType.startsWith("image/");
}

export function buildAttachmentMetaLabel(item) {
  const safeItem = normalizeAttachment(item);
  const parts = [];
  if (safeItem.kind) {
    parts.push(safeItem.kind);
  }
  if (safeItem.mimeType) {
    parts.push(safeItem.mimeType);
  }
  parts.push(formatAttachmentSize(safeItem.size));
  return parts.join(" • ");
}

export function buildAttachmentTextPreview(item, maxChars = 150) {
  const safeItem = normalizeAttachment(item);
  const raw = safeItem.textContent.trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.replace(/\s+/g, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(32, maxChars - 1)).trimEnd()}…`;
}
