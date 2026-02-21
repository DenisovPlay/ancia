export function createSettingsFontController({
  elements,
  runtimeConfig,
  pushToast,
  fontCandidates,
}) {
  let systemFontCatalog = [];
  let systemFontLoading = false;

  function normalizeFontFamilyName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function uniqueSortedFontNames(values) {
    const seen = new Set();
    const out = [];
    (values || []).forEach((value) => {
      const safe = normalizeFontFamilyName(value);
      if (!safe) {
        return;
      }
      const key = safe.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      out.push(safe);
    });
    return out.sort((a, b) => a.localeCompare(b, "ru"));
  }

  async function queryLocalSystemFonts() {
    if (typeof window.queryLocalFonts !== "function") {
      return [];
    }
    try {
      const records = await window.queryLocalFonts();
      const names = (records || [])
        .map((item) => normalizeFontFamilyName(item?.family || item?.fullName || ""))
        .filter(Boolean);
      return uniqueSortedFontNames(names);
    } catch {
      return [];
    }
  }

  function detectSystemFontsByCanvasProbe() {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return [];
    }
    const text = "mmmmmmmmmmlliWWWW@@##12345";
    const fontSize = "72px";
    const baseFamilies = ["monospace", "sans-serif", "serif"];
    const baseWidths = new Map();
    baseFamilies.forEach((base) => {
      context.font = `${fontSize} ${base}`;
      baseWidths.set(base, context.measureText(text).width);
    });

    const detected = [];
    (fontCandidates || []).forEach((candidate) => {
      const safeCandidate = normalizeFontFamilyName(candidate);
      if (!safeCandidate) {
        return;
      }
      const exists = baseFamilies.some((base) => {
        context.font = `${fontSize} "${safeCandidate}", ${base}`;
        const width = context.measureText(text).width;
        return Math.abs(width - Number(baseWidths.get(base) || 0)) > 0.01;
      });
      if (exists) {
        detected.push(safeCandidate);
      }
    });
    return uniqueSortedFontNames(detected);
  }

  function renderOptions(preferredValue = "") {
    const select = elements.settingsUiFontFamily;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }
    const preferred = normalizeFontFamilyName(preferredValue);
    const current = normalizeFontFamilyName(select.value);
    const selected = preferred || current;

    select.innerHTML = "";
    if (!systemFontCatalog.length) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = "";
      fallbackOption.textContent = "Системные шрифты не обнаружены";
      select.append(fallbackOption);
      select.value = "";
      return;
    }

    systemFontCatalog.forEach((fontName) => {
      const option = document.createElement("option");
      option.value = fontName;
      option.textContent = fontName;
      select.append(option);
    });
    const resolved = systemFontCatalog.includes(selected)
      ? selected
      : systemFontCatalog[0];
    select.value = resolved;
  }

  function syncControls() {
    const selectedPreset = String(
      elements.settingsUiFontPreset?.value
      || runtimeConfig.uiFontPreset
      || "system",
    ).trim().toLowerCase();
    const isCustom = selectedPreset === "custom";
    const customField = elements.settingsUiFontFamily;
    if (customField instanceof HTMLSelectElement) {
      customField.disabled = !isCustom;
      customField.setAttribute("aria-disabled", String(!isCustom));
      customField.classList.toggle("opacity-60", !isCustom);
    }
    if (elements.settingsUiFontMeta) {
      if (!isCustom) {
        elements.settingsUiFontMeta.textContent = "Показываются реально доступные системные шрифты. Внешние font-CDN отключены.";
      } else if (systemFontLoading) {
        elements.settingsUiFontMeta.textContent = "Сканируем доступные системные шрифты...";
      } else if (!systemFontCatalog.length) {
        elements.settingsUiFontMeta.textContent = "Список системных шрифтов недоступен. Нажмите «Обновить».";
      } else {
        elements.settingsUiFontMeta.textContent = `Найдено системных шрифтов: ${systemFontCatalog.length}.`;
      }
    }
  }

  async function loadCatalog({ silent = true } = {}) {
    if (systemFontLoading) {
      return false;
    }
    systemFontLoading = true;
    try {
      let detectedFonts = await queryLocalSystemFonts();
      if (!detectedFonts.length) {
        detectedFonts = detectSystemFontsByCanvasProbe();
      }
      systemFontCatalog = uniqueSortedFontNames(detectedFonts);
      renderOptions(runtimeConfig.uiFontFamily);
      if (!systemFontCatalog.length && !silent) {
        pushToast("Не удалось получить список системных шрифтов автоматически.", {
          tone: "warning",
          durationMs: 3600,
        });
      }
      return systemFontCatalog.length > 0;
    } finally {
      systemFontLoading = false;
      syncControls();
    }
  }

  return {
    renderOptions,
    syncControls,
    loadCatalog,
  };
}
