(function registerFilesystemToolUi() {
  const api = window.AnciaPluginUI;
  if (!api || typeof api.registerToolRenderer !== "function") {
    return;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function formatBytes(bytes) {
    if (typeof bytes !== "number" || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  api.registerToolRenderer({
    pluginId: "filesystem",
    toolName: "fs.read_file",
    getQueryPreview({ args }) {
      const path = normalizeText(args?.path || "");
      if (!path) return "Чтение файла";
      const parts = path.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] || path;
    },
    formatStart({ args }) {
      const path = normalizeText(args?.path || "");
      return path ? `_Читаю файл: ${path}_` : "_Читаю файл..._";
    },
    formatOutput({ output, args }) {
      if (!output || typeof output !== "object") return "";
      if (output.error) {
        return `**Ошибка чтения:** ${normalizeText(output.error)}`;
      }
      const path = normalizeText(output.path || args?.path || "");
      const size = formatBytes(output.size_bytes);
      const lines = typeof output.lines === "number" ? output.lines : null;
      const truncated = Boolean(output.truncated);
      const info = [path && `**Файл:** ${path}`];
      if (size) info.push(`**Размер:** ${size}`);
      if (lines !== null) info.push(`**Строк:** ${lines}`);
      if (truncated) info.push("_Содержимое обрезано до лимита символов_");
      return info.filter(Boolean).join("\n") || "**Файл прочитан.**";
    },
  });

  api.registerToolRenderer({
    pluginId: "filesystem",
    toolName: "fs.list_dir",
    getQueryPreview({ args }) {
      const path = normalizeText(args?.path || "");
      if (!path) return "Список файлов";
      const parts = path.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] || path;
    },
    formatStart({ args }) {
      const path = normalizeText(args?.path || "");
      return path ? `_Просматриваю папку: ${path}_` : "_Просматриваю директорию..._";
    },
    formatOutput({ output, args }) {
      if (!output || typeof output !== "object") return "";
      if (output.error) {
        return `**Ошибка:** ${normalizeText(output.error)}`;
      }
      const path = normalizeText(output.path || args?.path || "");
      const count = typeof output.count === "number" ? output.count : 0;
      const truncated = Boolean(output.truncated);
      const lines = [`**Папка:** ${path || "~"}`, `**Записей:** ${count}`];
      if (truncated) lines.push("_Список обрезан до лимита_");
      return lines.join("\n");
    },
  });
})();
