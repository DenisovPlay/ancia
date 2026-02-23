(function registerPythonRunToolUi() {
  const api = window.AnciaPluginUI;
  if (!api || typeof api.registerToolRenderer !== "function") {
    return;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function truncate(value, maxLen) {
    const text = String(value || "");
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLen - 1))}…`;
  }

  function stripCodeFences(value) {
    let raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    if (raw.includes("\\n") && !raw.includes("\n")) {
      raw = raw.replace(/\\n/g, "\n");
    }
    const fenceMatch = raw.match(/```(?:\s*python|\s*py)?\s*\n?([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      return String(fenceMatch[1]).trim();
    }
    if (raw.startsWith("`") && raw.endsWith("`")) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  }

  function sanitizeCodeFenceBody(value, maxLen) {
    return truncate(String(value || "").replace(/```/g, "``\\`"), maxLen);
  }

  function extractCode(args, output) {
    const fromArgs = String(args?.code || args?.python || args?.script || args?.source || "").trim();
    if (fromArgs) {
      return stripCodeFences(fromArgs);
    }
    const fromOutput = String(output?.code || output?.code_preview || "").trim();
    return stripCodeFences(fromOutput);
  }

  api.registerToolRenderer({
    pluginId: "python-run",
    toolName: "python.run",
    getQueryPreview({ args, output }) {
      const code = extractCode(args, output);
      if (!code) {
        return "Python";
      }
      const firstLine = normalizeText(code.split("\n").find((line) => normalizeText(line)) || code);
      return truncate(firstLine, 64) || "Python";
    },
    formatStart({ args, output }) {
      const code = extractCode(args, output);
      if (!code) {
        return "_Запускаю Python-код..._";
      }
      const preview = sanitizeCodeFenceBody(code, 1000);
      return [
        "**Запуск Python-кода**",
        "",
        "```python",
        preview,
        "```",
      ].join("\n");
    },
    formatOutput({ output, args }) {
      if (!output || typeof output !== "object") {
        return "";
      }

      const safeOutput = output;
      const lines = [];
      const durationMs = Number(safeOutput.duration_ms || 0);
      const code = extractCode(args, safeOutput);
      const hasError = Boolean(safeOutput.error);
      const timedOut = Boolean(safeOutput.timed_out);
      let hasDetailedOutput = false;

      if (code) {
        lines.push("**Код запуска**");
        lines.push("```python");
        lines.push(sanitizeCodeFenceBody(code, 12000));
        lines.push("```");
        if (safeOutput.code_truncated) {
          lines.push("_Код в деталях обрезан по лимиту._");
        }
        lines.push("");
      }

      lines.push("**Результат выполнения**");

      if (timedOut) {
        lines.push(`Таймаут: ${normalizeText(safeOutput.error || "Выполнение прервано.")}`);
      } else if (hasError) {
        lines.push(`Ошибка Python: ${normalizeText(safeOutput.error)}`);
      } else {
        lines.push("Успешно.");
      }

      if (durationMs > 0) {
        lines.push(`Время: ${durationMs} ms`);
      }

      if (safeOutput.result_repr) {
        hasDetailedOutput = true;
        lines.push("");
        lines.push("**Результат выражения**");
        lines.push("```text");
        lines.push(sanitizeCodeFenceBody(safeOutput.result_repr, 4000));
        lines.push("```");
      }

      if (safeOutput.stdout) {
        hasDetailedOutput = true;
        lines.push("");
        lines.push("**stdout**");
        lines.push("```text");
        lines.push(sanitizeCodeFenceBody(safeOutput.stdout, 6000));
        lines.push("```");
      }

      if (safeOutput.stderr) {
        hasDetailedOutput = true;
        lines.push("");
        lines.push("**stderr**");
        lines.push("```text");
        lines.push(sanitizeCodeFenceBody(safeOutput.stderr, 6000));
        lines.push("```");
      }

      if (safeOutput.traceback) {
        hasDetailedOutput = true;
        lines.push("");
        lines.push("**traceback**");
        lines.push("```text");
        lines.push(sanitizeCodeFenceBody(safeOutput.traceback, 7000));
        lines.push("```");
      }

      if (safeOutput.truncated) {
        lines.push("");
        lines.push("_Вывод был обрезан по лимиту._");
      }

      if (!hasDetailedOutput && !hasError && !timedOut) {
        lines.push("");
        lines.push("_Код выполнен без текстового вывода._");
      }

      return lines.join("\n").trim();
    },
  });
})();
