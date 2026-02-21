export function createToastManager({ region, clampFn }) {
  const clamp = typeof clampFn === "function"
    ? clampFn
    : (value, min, max) => Math.min(max, Math.max(min, value));

  const TOAST_TONE_TITLE = {
    success: "Готово",
    error: "Ошибка",
    warning: "Внимание",
    neutral: "Статус",
  };

  let toastSeq = 0;

  function pushToast(message, { tone = "neutral", durationMs = 2800 } = {}) {
    if (!(region instanceof HTMLElement) || !message) {
      return;
    }

    const id = ++toastSeq;
    const toast = document.createElement("article");
    toast.className = "toast-item";
    toast.dataset.toastId = String(id);
    toast.dataset.tone = tone;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");

    const title = document.createElement("p");
    title.className = "toast-item__title";
    title.textContent = TOAST_TONE_TITLE[tone] || TOAST_TONE_TITLE.neutral;

    const body = document.createElement("p");
    body.className = "toast-item__body";
    body.textContent = String(message);

    toast.append(title, body);
    region.appendChild(toast);

    const removeToast = () => {
      toast.classList.add("toast-item-leave");
      window.setTimeout(() => {
        toast.remove();
      }, 170);
    };

    window.setTimeout(removeToast, clamp(Number(durationMs) || 2800, 1000, 10000));
  }

  return {
    pushToast,
  };
}
