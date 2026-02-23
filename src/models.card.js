import { icon } from "./ui/icons.js";

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeModelCardPayload(rawModel) {
  if (!rawModel || typeof rawModel !== "object") {
    return null;
  }
  const id = String(rawModel.id || "").trim().toLowerCase();
  if (!id) {
    return null;
  }
  const cache = rawModel.cache && typeof rawModel.cache === "object" ? rawModel.cache : {};
  const compatibility = rawModel.compatibility && typeof rawModel.compatibility === "object" ? rawModel.compatibility : {};
  const rawParams = rawModel.params && typeof rawModel.params === "object" ? rawModel.params : {};
  const asNumberOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    id,
    label: String(rawModel.label || id).trim(),
    family: String(rawModel.family || "").trim(),
    size: String(rawModel.size || "").trim(),
    quantization: String(rawModel.quantization || "").trim(),
    description: String(rawModel.description || "").trim(),
    homepage: String(rawModel.homepage || "").trim(),
    source: String(rawModel.source || "").trim(),
    supportsTools: rawModel.supports_tools !== false,
    supportsVision: Boolean(rawModel.supports_vision),
    supportsDocuments: rawModel.supports_documents !== false,
    selected: Boolean(rawModel.selected),
    loaded: Boolean(rawModel.loaded),
    loading: Boolean(rawModel.loading),
    cache: {
      cached: Boolean(cache.cached),
      size_human: String(cache.size_human || "").trim(),
    },
    compatibility: {
      compatible: compatibility.compatible !== false,
      level: String(compatibility.level || "ok").trim().toLowerCase(),
      reason: String(compatibility.reason || "").trim(),
    },
    params: {
      context_window: asNumberOrNull(rawParams.context_window),
      max_tokens: asNumberOrNull(rawParams.max_tokens),
      temperature: asNumberOrNull(rawParams.temperature),
      top_p: asNumberOrNull(rawParams.top_p),
      top_k: asNumberOrNull(rawParams.top_k),
    },
  };
}

function humanSource(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "huggingface") return "HuggingFace";
  if (normalized === "lmstudio") return "LM Studio";
  return normalized || "source";
}

function resolveStateBadge(model) {
  if (model.loading) {
    return { text: "загрузка", className: "border-amber-500/35 bg-amber-500/15 text-amber-200" };
  }
  if (model.loaded) {
    return { text: "загружена", className: "border-emerald-500/35 bg-emerald-500/15 text-emerald-200" };
  }
  if (model.selected) {
    return { text: "выбрана", className: "border-sky-500/35 bg-sky-500/15 text-sky-200" };
  }
  if (model.cache.cached) {
    return { text: "установлена", className: "border-zinc-500/35 bg-zinc-600/20 text-zinc-200" };
  }
  return { text: "доступна", className: "border-zinc-600/35 bg-zinc-800/70 text-zinc-300" };
}

function resolveCompatibilityClass(level) {
  if (level === "unsupported") return "text-red-300";
  if (level === "warning") return "text-amber-300";
  return "text-zinc-400";
}

export function renderModelCard(model) {
  const stateBadge = resolveStateBadge(model);
  const isInstalled = model.cache.cached || model.loaded || model.loading;
  const cardBorder = model.loaded
    ? "border-emerald-900/50"
    : model.selected
      ? "border-sky-900/50"
      : "border-zinc-800";
  const shortMeta = [model.family, model.size, model.quantization].filter(Boolean).join(" · ");
  const compatClass = resolveCompatibilityClass(model.compatibility.level);
  const compatText = model.compatibility.reason || "Совместимость не определена.";

  const capTags = [];
  if (model.supportsTools) capTags.push("инструменты");
  if (model.supportsVision) capTags.push("vision");
  if (model.supportsDocuments) capTags.push("документы");
  const capTagsHtml = capTags
    .map((tag) => `<span class="rounded-md border border-zinc-800 px-1.5 py-0.5">${escapeHtml(tag)}</span>`)
    .join("");

  const cacheLabel = model.cache.cached
    ? `Локально: ${model.cache.size_human || "готово"}`
    : "Не установлена";

  const btnBase = "icon-button active:scale-95 duration-300 rounded-lg border px-2.5 py-1 text-xs";
  const btnDefault = `${btnBase} border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800`;
  const btnAccent = `${btnBase} border-sky-900/50 bg-sky-950/40 text-sky-300 hover:bg-sky-950/60`;

  let actionHtml = "";
  if (model.loading) {
    actionHtml = `
      <button type="button" data-model-action="select" class="${btnDefault}">Выбрать</button>
      <button type="button" disabled class="rounded-lg border border-amber-900/40 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-400 opacity-70 cursor-default">
        <span class="inline-block animate-pulse">Загружается…</span>
      </button>
    `;
  } else if (model.loaded) {
    actionHtml = `
      <button type="button" data-model-action="select" class="${btnDefault}">Выбрать</button>
      <button type="button" data-model-action="unload" class="${btnDefault}">${icon("stop")} Выгрузить</button>
    `;
  } else if (model.cache.cached) {
    actionHtml = `
      <button type="button" data-model-action="select" class="${btnDefault}">Выбрать</button>
      <button type="button" data-model-action="load" class="${btnDefault}">${icon("play")} Запустить</button>
      <button type="button" data-model-action="delete-cache" class="${btnDefault}">${icon("trash")} Удалить</button>
    `;
  } else {
    actionHtml = `
      <button type="button" data-model-action="select" class="${btnDefault}">Выбрать</button>
      <button type="button" data-model-action="load" class="${btnAccent}">${icon("play")} Скачать и запустить</button>
    `;
  }

  const homepageHtml = model.homepage
    ? `<a href="${escapeHtml(model.homepage)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">${icon("globe", "ui-icon-sm")} источник</a>`
    : "";

  return `
    <article
      class="plugin-card flex flex-col rounded-xl border ${cardBorder} bg-zinc-900/30 p-3.5 gap-2.5 transition h-full"
      data-model-card
      data-model-id="${escapeHtml(model.id)}"
      data-model-source="${escapeHtml(model.source)}"
      data-model-installed="${isInstalled}"
      data-model-keywords="${escapeHtml([model.label, model.family, model.size, model.quantization, model.description].join(" ").toLowerCase())}"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 min-w-0">
            <h3 class="truncate text-sm font-semibold text-zinc-100 leading-snug">${escapeHtml(model.label)}</h3>
          </div>
          ${shortMeta ? `<p class="mt-0.5 truncate text-[11px] text-zinc-500">${escapeHtml(shortMeta)}</p>` : ""}
        </div>
        <span class="shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${stateBadge.className}">${escapeHtml(stateBadge.text)}</span>
      </div>

      ${model.description ? `<p class="text-xs leading-[1.6] text-zinc-400 line-clamp-2 flex-1">${escapeHtml(model.description)}</p>` : `<div class="flex-1"></div>`}

      <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-600">
        <span class="rounded border border-zinc-800 px-1.5 py-0.5 font-medium">${escapeHtml(humanSource(model.source))}</span>
        ${capTagsHtml}
        ${model.cache.cached ? `<span class="ml-auto text-zinc-500">${escapeHtml(model.cache.size_human || "локально")}</span>` : ""}
      </div>

      <p class="text-[11px] ${compatClass} leading-snug">${escapeHtml(compatText)}</p>

      <div class="flex flex-wrap items-center gap-1.5 pt-1">
        ${actionHtml}
        <div class="flex items-center gap-1.5 ml-auto">
          ${homepageHtml}
          ${isInstalled ? `<button type="button" data-model-action="open-params" class="icon-button text-xs text-zinc-500 hover:text-zinc-300">${icon("settings", "ui-icon-sm")} параметры</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

export function sortModels(models) {
  return [...models].sort((a, b) => {
    const score = (model) => (model.loaded ? 100 : 0) + (model.selected ? 30 : 0) + (model.loading ? 20 : 0) + (model.cache.cached ? 10 : 0);
    const diff = score(b) - score(a);
    return diff !== 0 ? diff : a.label.localeCompare(b.label, "ru");
  });
}
