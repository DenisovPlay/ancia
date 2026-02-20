const BLOCK_TOKEN_PATTERN = /@@BLOCK_(\d+)@@/g;
const INLINE_TOKEN_PATTERN = /@@INLINE_(\d+)@@/g;

let katexLoaderPromise = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(String(value || "").replace(/\s+/g, " ").trim());
}

function normalizeTextInput(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function sanitizeUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch (error) {
    return "";
  }
}

function createToken(type, payload, tokens) {
  const id = tokens.push({ type, payload }) - 1;
  return `@@INLINE_${id}@@`;
}

function tokenizeInline(input) {
  const tokens = [];
  let text = String(input || "");

  text = text.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]+)\)/g, (_full, label, url) => {
    return createToken("link", { label, url }, tokens);
  });

  text = text.replace(/`([^`\n]+)`/g, (_full, code) => createToken("code", { code }, tokens));
  text = text.replace(/\\\((.+?)\\\)/g, (_full, expr) => createToken("math_inline", { expr }, tokens));
  text = text.replace(/\$([^\n$]+?)\$/g, (_full, expr) => createToken("math_inline", { expr }, tokens));

  return { text, tokens };
}

function restoreInlineTokens(escapedText, tokens) {
  return escapedText.replace(INLINE_TOKEN_PATTERN, (_full, indexRaw) => {
    const index = Number(indexRaw);
    const token = Number.isInteger(index) ? tokens[index] : null;
    if (!token) {
      return "";
    }
    if (token.type === "code") {
      return `<code class="message-inline-code">${escapeHtml(token.payload.code)}</code>`;
    }
    if (token.type === "link") {
      const safeUrl = sanitizeUrl(token.payload.url);
      const label = escapeHtml(token.payload.label);
      if (!safeUrl) {
        return label;
      }
      return `<a href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    if (token.type === "math_inline") {
      return (
        `<span class="message-math message-math-inline" data-latex="${escapeAttr(token.payload.expr)}" data-math-display="false">`
        + `${escapeHtml(token.payload.expr)}`
        + "</span>"
      );
    }
    return "";
  });
}

function renderInline(rawText) {
  const { text, tokens } = tokenizeInline(rawText);
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/(^|[\s(])\*([^*\n][^*]*?)\*(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  escaped = escaped.replace(/(^|[\s(])_([^_\n][^_]*?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  return restoreInlineTokens(escaped, tokens);
}

function tokenizeBlocks(input) {
  const tokens = [];
  let text = normalizeTextInput(input);

  const pushBlock = (type, payload) => {
    const id = tokens.push({ type, payload }) - 1;
    return `\n@@BLOCK_${id}@@\n`;
  };

  text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_full, language, code) => (
    pushBlock("code_block", {
      language: String(language || "").trim(),
      code: String(code || "").replace(/\n$/, ""),
    })
  ));

  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_full, content) => (
    pushBlock("think_block", { content: String(content || "").trim() })
  ));
  text = text.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_full, content) => (
    pushBlock("think_block", { content: String(content || "").trim() })
  ));

  const openThinkMatch = /<(think|thinking)>([\s\S]*)$/i.exec(text);
  if (openThinkMatch && openThinkMatch.index >= 0) {
    const before = text.slice(0, openThinkMatch.index);
    const tailContent = String(openThinkMatch[2] || "").trim();
    text = `${before}\n${pushBlock("think_live", { content: tailContent })}\n`;
  }

  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_full, expr) => (
    pushBlock("math_block", { expr: String(expr || "").trim() })
  ));
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_full, expr) => (
    pushBlock("math_block", { expr: String(expr || "").trim() })
  ));

  return { text, tokens };
}

function renderBlockToken(token) {
  if (!token) {
    return "";
  }
  if (token.type === "code_block") {
    const language = String(token.payload.language || "").trim();
    const languageClass = language ? ` language-${escapeAttr(language)}` : "";
    return (
      `<pre class="message-code-block"><code class="message-code${languageClass}">`
      + `${escapeHtml(token.payload.code || "")}`
      + "</code></pre>"
    );
  }
  if (token.type === "math_block") {
    const expr = String(token.payload.expr || "").trim();
    if (!expr) {
      return "";
    }
    return (
      `<div class="message-math message-math-block" data-latex="${escapeAttr(expr)}" data-math-display="true">`
      + `${escapeHtml(expr)}`
      + "</div>"
    );
  }
  if (token.type === "think_block") {
    const content = String(token.payload.content || "").trim();
    if (!content) {
      return "";
    }
    return (
      '<details class="message-thinking"><summary>Мышление модели</summary>'
      + `<div class="message-thinking__body">${renderMarkdown(content)}</div>`
      + "</details>"
    );
  }
  if (token.type === "think_live") {
    const content = String(token.payload.content || "").trim();
    if (!content) {
      return "";
    }
    return (
      '<details class="message-thinking" open><summary>Мышление модели (поток)</summary>'
      + `<div class="message-thinking__body">${renderMarkdown(content)}</div>`
      + "</details>"
    );
  }
  return "";
}

function isBlockMarker(line) {
  return /^@@BLOCK_(\d+)@@$/.exec(String(line || "").trim());
}

function normalizeInlineListSyntax(input) {
  const source = normalizeTextInput(input);
  const rawLines = source.split("\n");
  const normalizedLines = rawLines.map((line) => {
    const safeLine = String(line || "");
    const trimmed = safeLine.trim();
    if (!trimmed || isBlockMarker(trimmed)) {
      return safeLine;
    }

    let next = safeLine;

    // Частый кейс от моделей: ".... . - Пункт - Пункт"
    // Нормализуем в реальные markdown-списки.
    next = next.replace(
      /([.!?:;])\s+([-*+])\s+(?=[A-Za-zА-Яа-яЁё0-9"«])/g,
      "$1\n$2 ",
    );
    next = next.replace(
      /([.!?:;])\s+(\d{1,3}\.)\s+(?=[A-Za-zА-Яа-яЁё0-9"«])/g,
      "$1\n$2 ",
    );
    next = next.replace(/\s+-\s+(?=📌\s+)/g, "\n- ");
    next = next.replace(
      /\s+-\s+(?=(?:📌|✅|⚠️|🔹|🔸|\*\*|[A-ZА-ЯЁ]))/g,
      "\n- ",
    );
    next = next.replace(
      /\s+(\d{1,3}\.)\s+(?=(?:📌|✅|⚠️|🔹|🔸|\*\*|[A-ZА-ЯЁ]))/g,
      "\n$1 ",
    );

    return next;
  });
  return normalizedLines.join("\n");
}

function renderParagraph(lines) {
  const content = lines.map((line) => renderInline(line)).join("<br>");
  if (!content.trim()) {
    return "";
  }
  return `<p>${content}</p>`;
}

function renderMarkdown(input) {
  const { text, tokens } = tokenizeBlocks(input);
  const normalizedText = normalizeInlineListSyntax(text);
  const lines = normalizeTextInput(normalizedText).split("\n");
  const htmlBlocks = [];

  let index = 0;
  while (index < lines.length) {
    const current = lines[index];
    if (!current || !current.trim()) {
      index += 1;
      continue;
    }

    const markerMatch = isBlockMarker(current);
    if (markerMatch) {
      const tokenIndex = Number(markerMatch[1]);
      htmlBlocks.push(renderBlockToken(tokens[tokenIndex]));
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(current.trim());
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      htmlBlocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(current.trim())) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      htmlBlocks.push(`<blockquote>${renderParagraph(quoteLines)}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(current.trim())) {
      const items = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      htmlBlocks.push(`<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(current.trim())) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      htmlBlocks.push(`<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim()) {
      const paragraphMarker = isBlockMarker(lines[index]);
      if (paragraphMarker) {
        break;
      }
      if (/^(#{1,6})\s+/.test(lines[index].trim())) {
        break;
      }
      if (/^>\s?/.test(lines[index].trim())) {
        break;
      }
      if (/^[-*+]\s+/.test(lines[index].trim()) || /^\d+\.\s+/.test(lines[index].trim())) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      htmlBlocks.push(renderParagraph(paragraphLines));
      continue;
    }
    index += 1;
  }

  return htmlBlocks.filter(Boolean).join("\n");
}

function ensureKatexLoaded() {
  if (window.katex?.render) {
    return Promise.resolve(true);
  }
  if (katexLoaderPromise) {
    return katexLoaderPromise;
  }

  katexLoaderPromise = new Promise((resolve) => {
    const head = document.head || document.querySelector("head");
    if (!head) {
      resolve(false);
      return;
    }

    const existingScript = document.querySelector('script[data-katex-loader="true"]');
    if (existingScript) {
      resolve(Boolean(window.katex?.render));
      return;
    }

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
    stylesheet.setAttribute("data-katex-loader", "true");
    head.appendChild(stylesheet);

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js";
    script.defer = true;
    script.setAttribute("data-katex-loader", "true");
    script.onload = () => resolve(Boolean(window.katex?.render));
    script.onerror = () => resolve(false);
    head.appendChild(script);

    window.setTimeout(() => resolve(Boolean(window.katex?.render)), 5000);
  });

  return katexLoaderPromise;
}

export function renderMessageHtml(text) {
  return renderMarkdown(text);
}

export async function typesetMathInElement(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }
  const candidates = [...container.querySelectorAll("[data-latex]")];
  if (candidates.length === 0) {
    return;
  }

  const ready = await ensureKatexLoaded();
  if (!ready || !window.katex?.render) {
    return;
  }

  candidates.forEach((node) => {
    const expr = String(node.getAttribute("data-latex") || "").trim();
    if (!expr) {
      return;
    }
    const displayMode = node.getAttribute("data-math-display") === "true";
    try {
      window.katex.render(expr, node, {
        throwOnError: false,
        displayMode,
        strict: "ignore",
      });
      node.classList.add("message-math-ready");
    } catch (error) {
      // Оставляем текстовый fallback, если KaTeX не смог разобрать выражение.
    }
  });
}

export { normalizeTextInput };
