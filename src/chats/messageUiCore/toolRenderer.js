import { icon } from "../../ui/icons.js";
import { normalizeTextInput } from "../../ui/messageFormatter.js";

export function createToolRenderer({
  normalizeToolName: normalizeToolNameExternal,
  lookupToolMeta,
  getPluginToolRenderer,
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

  function resolvePluginRenderer(toolName) {
    if (typeof getPluginToolRenderer !== "function") {
      return null;
    }
    const renderer = getPluginToolRenderer(toolName);
    return renderer && typeof renderer === "object" ? renderer : null;
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
          pluginId: String(payload.pluginId || "").trim().toLowerCase(),
        };
      }
    }
    return {
      displayName: String(toolName || "").trim() || "Инструмент",
      iconKey: "plugins",
      category: "",
      pluginId: "",
    };
  }

  function resolveToolQueryPreview(name, args, output = null, payload = null) {
    const renderer = resolvePluginRenderer(name);
    if (renderer && typeof renderer.getQueryPreview === "function") {
      try {
        const pluginPreview = String(
          renderer.getQueryPreview({
            toolName: name,
            args: args || {},
            output: output && typeof output === "object" ? output : {},
            payload: payload && typeof payload === "object" ? payload : {},
          }) || "",
        ).trim();
        if (pluginPreview) {
          return pluginPreview;
        }
      } catch {
        // Ignore plugin renderer errors and continue with generic fallback.
      }
    }

    const safeOutput = output && typeof output === "object" ? output : {};
    const query = String(args?.query || safeOutput?.query || "").trim();
    if (query) {
      return query;
    }
    const candidateUrl = String(args?.url || safeOutput?.url || safeOutput?.requested_url || "").trim();
    if (candidateUrl) {
      try {
        return new URL(candidateUrl).hostname;
      } catch {
        return candidateUrl.slice(0, 64);
      }
    }
    const mood = String(args?.mood || safeOutput?.mood || "").trim();
    if (mood) {
      return mood;
    }
    const fact = String(args?.fact || safeOutput?.memory?.fact || "").trim();
    if (fact) {
      return fact.length > 64 ? `${fact.slice(0, 63)}…` : fact;
    }
    return "";
  }

  function normalizeText(value) {
    return normalizeTextInput(String(value || "")).replace(/\s+/g, " ").trim();
  }

  function formatMemoryLine(entry, index) {
    const fact = normalizeText(entry?.fact || "") || "Без текста";
    const key = normalizeText(entry?.key || "");
    const tagsRaw = Array.isArray(entry?.tags) ? entry.tags : [];
    const tags = tagsRaw.map((item) => normalizeText(item)).filter(Boolean);
    const bits = [];
    if (key) {
      bits.push(`ключ: ${key}`);
    }
    if (tags.length > 0) {
      bits.push(`теги: ${tags.join(", ")}`);
    }
    return `${index + 1}. ${fact}${bits.length ? ` (${bits.join(" • ")})` : ""}`;
  }

  function formatMemoryOutputFallback(toolName, output) {
    const safeOutput = output && typeof output === "object" ? output : null;
    if (!safeOutput) {
      return "";
    }
    if (safeOutput.error) {
      return `**Ошибка памяти:** ${normalizeText(safeOutput.error)}`;
    }

    const safeToolName = String(toolName || "").trim().toLowerCase();
    const looksLikeRemember = safeToolName === "memory.remember" || safeToolName === "memory.user.remember";
    if (looksLikeRemember) {
      const status = normalizeText(safeOutput.status || "saved").toLowerCase();
      const actionLabel = status === "updated" ? "Память обновлена" : "Память сохранена";
      const memory = safeOutput.memory && typeof safeOutput.memory === "object" ? safeOutput.memory : {};
      const fact = normalizeText(memory.fact || "");
      const key = normalizeText(memory.key || "");
      const tags = (Array.isArray(memory.tags) ? memory.tags : [])
        .map((item) => normalizeText(item))
        .filter(Boolean);
      const lines = [`**${actionLabel}**`];
      if (fact) {
        lines.push(`- Факт: ${fact}`);
      }
      if (key) {
        lines.push(`- Ключ: ${key}`);
      }
      if (tags.length > 0) {
        lines.push(`- Теги: ${tags.join(", ")}`);
      }
      if (typeof safeOutput.total_memories === "number") {
        lines.push(`- Всего записей: ${Math.max(0, Number(safeOutput.total_memories) || 0)}`);
      }
      return lines.join("\n");
    }

    const memories = Array.isArray(safeOutput.memories) ? safeOutput.memories : [];
    const looksLikeRecall = safeToolName === "memory.recall" || safeToolName === "memory.user.recall";
    if (looksLikeRecall) {
      if (!memories.length) {
        return "**Память:** подходящих записей не найдено.";
      }
      const lines = ["**Найдено в памяти**", ""];
      memories.slice(0, 12).forEach((entry, index) => {
        lines.push(formatMemoryLine(entry, index));
      });
      if (typeof safeOutput.count === "number" && safeOutput.count > memories.length) {
        lines.push("");
        lines.push(`И ещё: ${safeOutput.count - memories.length}`);
      }
      return lines.join("\n");
    }

    const removed = Array.isArray(safeOutput.removed) ? safeOutput.removed : [];
    const looksLikeForget = safeToolName === "memory.forget" || safeToolName === "memory.user.forget";
    if (looksLikeForget) {
      const removedCount = Math.max(0, Number(safeOutput.removed_count) || 0);
      const remainingCount = Math.max(0, Number(safeOutput.remaining_count) || 0);
      if (removedCount <= 0) {
        return "**Память:** ничего не удалено (совпадений нет).";
      }
      const lines = [
        `**Удалено записей:** ${removedCount}`,
        `**Осталось записей:** ${remainingCount}`,
      ];
      if (removed.length > 0) {
        lines.push("");
        lines.push("Удалено:");
        removed.slice(0, 8).forEach((entry, index) => {
          lines.push(formatMemoryLine(entry, index));
        });
      }
      return lines.join("\n");
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

  function formatGenericObjectOutput(output) {
    if (!output || typeof output !== "object") {
      return String(output || "");
    }

    if (output.error) {
      return `**Ошибка:** ${output.error}`;
    }

    if (Array.isArray(output.results)) {
      const results = Array.isArray(output.results) ? output.results : [];
      const lines = ["**Результаты**"];
      if (!results.length) {
        lines.push("_Пусто._");
        return lines.join("\n");
      }
      lines.push("");
      results.slice(0, 10).forEach((item, index) => {
        const title = toSafeLinkLabel(String(item?.title || item?.name || ""), `Результат ${index + 1}`);
        const url = toSafeMarkdownUrl(String(item?.url || item?.href || ""));
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

    const json = JSON.stringify(output, null, 2);
    const shortened = json.length > 3200 ? `${json.slice(0, 3199)}\n…` : json;
    return `\`\`\`json\n${shortened}\n\`\`\``;
  }

  function formatToolOutputText(name, output, options = {}) {
    const safeOptions = options && typeof options === "object" ? options : {};
    const args = safeOptions.args && typeof safeOptions.args === "object" ? safeOptions.args : {};
    const payload = safeOptions.payload && typeof safeOptions.payload === "object" ? safeOptions.payload : {};
    const phase = String(safeOptions.phase || "result").trim().toLowerCase();
    const rawText = normalizeTextInput(String(safeOptions.rawText || payload.text || "")).trim();
    const renderer = resolvePluginRenderer(name);

    if (renderer) {
      try {
        if (phase === "start" && typeof renderer.formatStart === "function") {
          const started = String(renderer.formatStart({ toolName: name, args, output, payload }) || "").trim();
          if (started) {
            return started;
          }
        }
        if (typeof renderer.formatOutput === "function") {
          const rendered = String(renderer.formatOutput({ toolName: name, args, output, payload, phase }) || "").trim();
          if (rendered) {
            return rendered;
          }
        }
      } catch {
        // Ignore plugin formatter errors and continue with generic fallback.
      }
    }

    if (phase === "start") {
      if (Object.keys(args).length > 0) {
        return `\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
      }
      return rawText || "_Инструмент запущен._";
    }

    if (output && typeof output === "object") {
      const memoryFallback = formatMemoryOutputFallback(name, output);
      if (memoryFallback) {
        return memoryFallback;
      }
      return formatGenericObjectOutput(output);
    }
    return rawText || "_Подробности отсутствуют._";
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
    if (name) {
      wrapper.dataset.toolName = name;
    }

    const toolMeta = resolveToolMeta(name);
    const resolvedDisplayName = payloadDisplayName || toolMeta.displayName;
    if (toolMeta.pluginId) {
      wrapper.dataset.toolPluginId = toolMeta.pluginId;
    }
    const queryPreview = resolveToolQueryPreview(name, args, output, payload);

    const card = document.createElement("div");
    card.className = "tool-call-card";
    if (toolMeta.pluginId) {
      card.dataset.toolPluginId = toolMeta.pluginId;
    }

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
    expandBtn.className = "tool-expand-btn icon-button active:scale-95 h-7 w-7 rounded-md border border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200";
    expandBtn.setAttribute("aria-label", "Подробности");
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.innerHTML = icon("chevron-down");

    card.append(statusIcon, info, expandBtn);
    wrapper.append(card);

    const details = document.createElement("div");
    details.className = "tool-call-details";
    details.setAttribute("data-tool-details", "true");
    if (toolMeta.pluginId) {
      details.dataset.toolPluginId = toolMeta.pluginId;
    }

    const detailsInner = document.createElement("div");
    detailsInner.className = "tool-call-details-inner";

    const detailsBody = document.createElement("div");
    detailsBody.className = "message-body text-xs leading-6 text-zinc-200";
    detailsBody.setAttribute("data-message-body", "true");
    detailsInner.append(detailsBody);
    details.append(detailsInner);
    wrapper.append(details);

    const detailContent = formatToolOutputText(name, output, {
      args,
      payload,
      phase,
      rawText: payload.text,
    });
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

    const name = normalizeLegacyToolName(String(payload.name || row.dataset.toolName || "tool"));
    const args = payload.args && typeof payload.args === "object" ? payload.args : {};
    const hasOutput = Object.prototype.hasOwnProperty.call(payload || {}, "output");
    const output = payload.output && typeof payload.output === "object" ? payload.output : null;

    const displayName = String(payload.display_name || payload.displayName || "").trim();
    if (displayName) {
      const toolNameNode = row.querySelector(".tool-call-name");
      if (toolNameNode instanceof HTMLElement) {
        toolNameNode.textContent = displayName;
      }
    }

    const queryPreview = resolveToolQueryPreview(name, args, output, payload);
    const queryNode = row.querySelector(".tool-call-query");
    if (queryNode instanceof HTMLElement) {
      queryNode.textContent = queryPreview;
      queryNode.classList.toggle("hidden", !queryPreview);
    }

    if (hasOutput || payload.text) {
      const detailsEl = row.querySelector("[data-tool-details]");
      const bodyEl = row.querySelector("[data-tool-details] [data-message-body]");
      if (bodyEl) {
        const detailContent = formatToolOutputText(name, output, {
          args,
          payload,
          phase: "result",
          rawText: payload.text,
        });
        renderMessageBody(bodyEl, detailContent || "_Подробности отсутствуют._");
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
