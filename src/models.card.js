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
    ? "border-emerald-500/30"
    : model.selected
      ? "border-sky-500/30"
      : "border-zinc-600/30";
  const shortMeta = [model.family, model.size, model.quantization].filter(Boolean).join(" · ");
  const compatClass = resolveCompatibilityClass(model.compatibility.level);
  const compatText = model.compatibility.reason || "Совместимость не определена.";

  const capTags = [];
  if (model.supportsTools) capTags.push("инструменты");
  if (model.supportsVision) capTags.push("vision");
  if (model.supportsDocuments) capTags.push("документы");
  const capTagsHtml = capTags
    .map((tag) => `<span class="rounded-full border border-zinc-700/40 px-2 py-0.5">${escapeHtml(tag)}</span>`)
    .join("");

  const cacheLabel = model.cache.cached
    ? `Локально: ${model.cache.size_human || "готово"}`
    : "Не установлена";

  let actionHtml = "";
  if (model.loading) {
    actionHtml = `
      <button type="button" data-model-action="select" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">Выбрать</button>
      <button type="button" disabled class="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 opacity-70 cursor-default">
        <span class="inline-block animate-pulse">Загружается…</span>
      </button>
    `;
  } else if (model.loaded) {
    actionHtml = `
      <button type="button" data-model-action="select" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">Выбрать</button>
      <button type="button" data-model-action="unload" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">${icon("stop")} Выгрузить</button>
    `;
  } else if (model.cache.cached) {
    actionHtml = `
      <button type="button" data-model-action="select" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">Выбрать</button>
      <button type="button" data-model-action="load" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">${icon("play")} Запустить</button>
      <button type="button" data-model-action="delete-cache" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">${icon("trash")} Удалить</button>
    `;
  } else {
    actionHtml = `
      <button type="button" data-model-action="select" class="icon-button active:scale-95 rounded-full border border-zinc-600/30 bg-zinc-800/70 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-700/80">Выбрать</button>
      <button type="button" data-model-action="load" class="icon-button active:scale-95 rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 transition hover:bg-sky-500/20">${icon("play")} Скачать и запустить</button>
    `;
  }

  const homepageHtml = model.homepage
    ? `<a href="${escapeHtml(model.homepage)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition">${icon("globe", "ui-icon-sm")} источник</a>`
    : "";

  return `
    <article
      class="plugin-card rounded-3xl border ${cardBorder} p-3 flex flex-col h-full gap-0 transition"
      data-model-card
      data-model-id="${escapeHtml(model.id)}"
      data-model-source="${escapeHtml(model.source)}"
      data-model-installed="${isInstalled}"
      data-model-keywords="${escapeHtml([model.label, model.family, model.size, model.quantization, model.description].join(" ").toLowerCase())}"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="truncate text-sm font-semibold text-zinc-100">${escapeHtml(model.label)}</h3>
          ${shortMeta ? `<p class="mt-0.5 truncate text-xs text-zinc-400">${escapeHtml(shortMeta)}</p>` : ""}
        </div>
        <span class="ml-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${stateBadge.className}">${escapeHtml(stateBadge.text)}</span>
      </div>

      ${model.description ? `<p class="mt-2 text-xs leading-5 text-zinc-300 line-clamp-3">${escapeHtml(model.description)}</p>` : ""}

      <p class="mt-1.5 text-[11px] ${compatClass}">${escapeHtml(compatText)}</p>
      <div class="flex-grow flex-shrink-0"></div>
      <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
        <span class="rounded-full border border-zinc-700/40 px-2 py-0.5">${escapeHtml(humanSource(model.source))}</span>
        ${capTagsHtml}
        <span class="ml-auto text-zinc-600">${escapeHtml(cacheLabel)}</span>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        ${actionHtml}
        ${homepageHtml}
        ${isInstalled ? `<button type="button" data-model-action="open-params" class="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition">${icon("settings", "ui-icon-sm")} параметры</button>` : ""}
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
