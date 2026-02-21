export const ROLE_STYLE_MAP = {
  assistant: {
    contentClass: "message-content message-content-assistant",
    metaPrefix: "",
  },
  user: {
    contentClass: "message-content message-content-user",
    metaPrefix: "",
  },
  tool: {
    contentClass: "message-content message-content-tool",
    metaPrefix: "",
  },
};

export const ASSISTANT_PENDING_LABEL = "Модель формирует ответ";

export function getClockTime(value = Date.now()) {
  const candidate = value instanceof Date ? value : new Date(value);
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
