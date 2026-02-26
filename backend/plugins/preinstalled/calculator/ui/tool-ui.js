(function registerCalculatorToolUi() {
  const api = window.AnciaPluginUI;
  if (!api || typeof api.registerToolRenderer !== "function") {
    return;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  api.registerToolRenderer({
    pluginId: "calculator",
    toolName: "calculator.eval",
    getQueryPreview({ args }) {
      const expr = normalizeText(args?.expression || "");
      return expr ? `= ${expr}` : "Вычисление";
    },
    formatStart({ args }) {
      const expr = normalizeText(args?.expression || "");
      return expr ? `_Вычисляю: ${expr}_` : "_Вычисляю выражение..._";
    },
    formatOutput({ output, args }) {
      if (!output || typeof output !== "object") {
        return "";
      }
      if (output.error) {
        return `**Ошибка:** ${normalizeText(output.error)}`;
      }
      const expr = normalizeText(output.expression || args?.expression || "");
      const result = normalizeText(output.result_repr || String(output.result ?? ""));
      if (!result) {
        return "**Результат получен.**";
      }
      return expr ? `**${expr} = ${result}**` : `**Результат:** ${result}`;
    },
  });
})();
