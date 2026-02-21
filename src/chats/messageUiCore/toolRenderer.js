import { icon } from "../../ui/icons.js";
import { normalizeTextInput } from "../../ui/messageFormatter.js";

export function createToolRenderer({
  normalizeToolName: normalizeToolNameExternal,
  lookupToolMeta,
  renderMessageBody,
}) {
  function toSafeMarkdownUrl(rawUrl) {
    const safeRaw = String(rawUrl || "").trim();
    if (!safeRaw) {
      return "";
    }
    try {
      const parsed = new URL(safeRaw);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return "";
      }
      return parsed
        .toString()
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
    } catch {
      return "";
    }
  }

  function toSafeLinkLabel(rawTitle, fallback = "Ссылка") {
    const normalized = normalizeTextInput(String(rawTitle || "")).replace(/\s+/g, " ").trim();
    const safe = normalized.replace(/[\[\]]+/g, "").trim();
    return safe || fallback;
  }

  function normalizeLegacyToolName(rawName = "") {
    const safeName = String(rawName || "").trim();
    if (!safeName) {
      return "";
    }
    if (typeof normalizeToolNameExternal === "function") {
      const normalized = String(normalizeToolNameExternal(safeName) || "").trim();
      if (normalized) {
        return normalized;
      }
    }
    return safeName.toLowerCase();
  }

  function resolveToolMeta(toolName) {
    const normalizedName = normalizeLegacyToolName(toolName);
    if (typeof lookupToolMeta === "function") {
      const payload = lookupToolMeta(normalizedName, toolName);
      if (payload && typeof payload === "object") {
        return {
          displayName: String(payload.displayName || payload.title || toolName || "Инструмент").trim() || "Инструмент",
          iconKey: String(payload.iconKey || "plugins").trim() || "plugins",
          category: String(payload.category || "").trim().toLowerCase(),
        };
      }
    }
    return {
      displayName: String(toolName || "").trim() || "Инструмент",
      iconKey: "plugins",
      category: "",
    };
  }

  function resolveToolQueryPreview(name, args, output = null) {
    const safeOutput = output && typeof output === "object" ? output : {};
    const query = String(args?.query || safeOutput?.query || "").trim();
    if (query) {
      return `Поиск: ${query}`;
    }
    const candidateUrl = String(args?.url || safeOutput?.url || safeOutput?.requested_url || "").trim();
    if (candidateUrl) {
      try {
        return new URL(candidateUrl).hostname;
      } catch {
        return candidateUrl.slice(0, 48);
      }
    }
    const mood = String(args?.mood || safeOutput?.mood || "").trim();
    if (mood) {
      return mood;
    }
    return "";
  }

  function buildToolStatusSvg(status) {
    if (status === "running") {
      return '<svg class="ui-icon tool-spinner" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" stroke-dasharray="28 16" stroke-linecap="round"/></svg>';
    }
    if (status === "error") {
      return icon("x-mark");
    }
    return icon("check");
  }

  function formatToolOutputText(name, output) {
    if (!output || typeof output !== "object") {
      return String(output || "");
    }
    if (output.error) {
      return `**Ошибка:** ${output.error}`;
    }

    const hasMoodPayload = typeof output.mood === "string" && output.mood.trim();
    if (hasMoodPayload) {
      const moodLabels = {
        neutral: "Нейтральное",
        waiting: "Ожидание",
        thinking: "Размышление",
        planning: "Планирование",
        coding: "Разработка",
        researching: "Исследование",
        creative: "Творчество",
        success: "Успех",
        error: "Ошибка",
        warning: "Предупреждение",
        friendly: "Дружелюбное",
        offline: "Офлайн",
      };
      const mood = String(output.mood || "").trim().toLowerCase();
      const label = moodLabels[mood] || mood || "—";
      return `**Состояние изменено:** ${label}`;
    }

    const hasTimePayload = output.local_time || output.time || output.datetime || output.timezone || output.tz;
    if (hasTimePayload) {
      const time = String(output.local_time || output.time || output.datetime || "").trim();
      const tz = String(output.timezone || output.tz || "").trim();
      const lines = [];
      if (time) {
        lines.push(`**Время:** ${time}`);
      }
      if (tz) {
        lines.push(`**Часовой пояс:** ${tz}`);
      }
      return lines.join("\n") || "**Системное время**";
    }

    if (Array.isArray(output.results)) {
      const results = Array.isArray(output.results) ? output.results : [];
      const lines = ["**Результаты поиска**"];
      if (!results.length) {
        lines.push("_Ничего не найдено._");
        return lines.join("\n");
      }
      lines.push("");
      results.slice(0, 8).forEach((item, index) => {
        const title = toSafeLinkLabel(String(item?.title || ""), `Результат ${index + 1}`);
        const url = toSafeMarkdownUrl(String(item?.url || ""));
        const snippet = normalizeTextInput(String(item?.snippet || item?.description || "")).replace(/\s+/g, " ").trim();
        const snippetSuffix = snippet
          ? ` — ${snippet.length > 220 ? `${snippet.slice(0, 219)}…` : snippet}`
          : "";
        if (url) {
          lines.push(`${index + 1}. [${title}](${url})${snippetSuffix}`);
        } else {
          lines.push(`${index + 1}. ${title}${snippetSuffix}`);
        }
      });
      return lines.join("\n");
    }

    if (output.content || output.links || output.url || output.requested_url || output.title) {
      const title = toSafeLinkLabel(String(output.title || ""), "Страница");
      const url = toSafeMarkdownUrl(String(output.url || output.requested_url || ""));
      const content = normalizeTextInput(String(output.content || "")).trim();
      const links = Array.isArray(output.links) ? output.links : [];
      const lines = [];

      if (title && url) {
        lines.push(`**Страница:** [${title}](${url})`);
      } else if (url) {
        lines.push(`**Страница:** ${url}`);
      } else if (title) {
        lines.push(`**Страница:** ${title}`);
      } else {
        lines.push("**Открытие страницы**");
      }

      if (content) {
        lines.push("");
        lines.push(content.length > 2200 ? `${content.slice(0, 2199)}…` : content);
      }

      if (links.length) {
        lines.push("");
        lines.push("**Ссылки:**");
        links.slice(0, 10).forEach((link) => {
          const safeLink = String(link || "").trim();
          if (safeLink) {
            lines.push(`- ${safeLink}`);
          }
        });
      }

      return lines.join("\n").trim();
    }

    const json = JSON.stringify(output, null, 2);
    return `\`\`\`json\n${json.length > 2000 ? `${json.slice(0, 2000)}\n…` : json}\n\`\`\``;
  }

  function buildToolCardInto(wrapper, payload, phase) {
    const name = normalizeLegacyToolName(String(payload.name || "tool"));
    const payloadDisplayName = String(payload.display_name || payload.displayName || "").trim();
    const status = String(payload.status || (phase === "start" ? "running" : "ok")).toLowerCase();
    const args = payload.args && typeof payload.args === "object" ? payload.args : {};
    const output = payload.output && typeof payload.output === "object" ? payload.output : null;
    const invId = String(payload.invocation_id || "").trim();

    if (invId) {
      wrapper.dataset.invocationId = invId;
    }

    const { displayName } = resolveToolMeta(name);
    const resolvedDisplayName = payloadDisplayName || displayName;
    const queryPreview = resolveToolQueryPreview(name, args, output);

    const card = document.createElement("div");
    card.className = "tool-call-card";

    const statusIcon = document.createElement("span");
    statusIcon.className = `tool-call-status-icon tool-status-${status}`;
    statusIcon.setAttribute("data-tool-status", status);
    statusIcon.innerHTML = buildToolStatusSvg(status);

    const info = document.createElement("div");
    info.className = "tool-call-info";
    const nameEl = document.createElement("span");
    nameEl.className = "tool-call-name";
    nameEl.textContent = resolvedDisplayName;
    info.append(nameEl);
    if (queryPreview) {
      const qEl = document.createElement("span");
      qEl.className = "tool-call-query";
      qEl.textContent = queryPreview;
      info.append(qEl);
    }

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.disabled = false;
    expandBtn.className = "tool-expand-btn icon-button active:scale-95 h-7 w-7 rounded-full bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200";
    expandBtn.setAttribute("aria-label", "Подробности");
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.innerHTML = icon("chevron-down");

    card.append(statusIcon, info, expandBtn);
    wrapper.append(card);

    const details = document.createElement("div");
    details.className = "tool-call-details";
    details.setAttribute("data-tool-details", "true");

    const detailsInner = document.createElement("div");
    detailsInner.className = "tool-call-details-inner";

    const detailsBody = document.createElement("div");
    detailsBody.className = "message-body text-xs leading-6 text-zinc-200";
    detailsBody.setAttribute("data-message-body", "true");
    detailsInner.append(detailsBody);
    details.append(detailsInner);
    wrapper.append(details);

    const fallbackText = normalizeTextInput(String(payload.text || "")).trim();
    const detailContent = phase === "result" && output
      ? formatToolOutputText(name, output)
      : Object.keys(args).length
        ? `\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``
        : fallbackText;
    renderMessageBody(detailsBody, detailContent || "_Подробности отсутствуют._");

    expandBtn.addEventListener("click", () => {
      if (expandBtn.disabled) {
        return;
      }
      const isOpen = details.classList.toggle("is-open");
      expandBtn.setAttribute("aria-expanded", String(isOpen));
    });
  }

  function updateToolRow(row, payload) {
    if (!(row instanceof HTMLElement)) {
      return;
    }
    const status = String(payload.status || "ok").toLowerCase();

    const statusIcon = row.querySelector("[data-tool-status]");
    if (statusIcon) {
      statusIcon.className = `tool-call-status-icon tool-status-${status}`;
      statusIcon.setAttribute("data-tool-status", status);
      statusIcon.innerHTML = buildToolStatusSvg(status);
    }

    if (payload.output) {
      const name = normalizeLegacyToolName(String(payload.name || "tool"));
      const displayName = String(payload.display_name || payload.displayName || "").trim();
      if (displayName) {
        const toolNameNode = row.querySelector(".tool-call-name");
        if (toolNameNode instanceof HTMLElement) {
          toolNameNode.textContent = displayName;
        }
      }
      const detailsEl = row.querySelector("[data-tool-details]");
      const bodyEl = row.querySelector("[data-tool-details] [data-message-body]");
      if (bodyEl) {
        renderMessageBody(bodyEl, formatToolOutputText(name, payload.output));
      }
      const expandBtn = row.querySelector(".tool-expand-btn");
      if (expandBtn && expandBtn.style.display === "none") {
        expandBtn.disabled = false;
        expandBtn.style.display = "";
        expandBtn.removeAttribute("tabindex");
        expandBtn.removeAttribute("aria-hidden");
      }
      if (detailsEl && bodyEl?.textContent.trim()) {
        requestAnimationFrame(() => {
          detailsEl.classList.add("is-open");
          expandBtn?.setAttribute("aria-expanded", "true");
        });
      }
    }

    const meta = row.querySelector("[data-message-meta]");
    if (meta) {
      meta.textContent = String(payload.meta_suffix || `инструмент • ${status}`);
      meta.classList.remove("hidden");
    }
  }

  return {
    normalizeLegacyToolName,
    resolveToolMeta,
    formatToolOutputText,
    buildToolCardInto,
    updateToolRow,
  };
}
