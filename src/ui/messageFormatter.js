const BLOCK_TOKEN_PATTERN = /@@BLOCK_(\d+)@@/g;
const INLINE_TOKEN_PATTERN = /@@INLINE_(\d+)@@/g;

let katexLoaderPromise = null;
let katexRender = null;
const KATEX_CSS_MODULE = "katex/dist/katex.min.css";
const KATEX_JS_MODULE = "katex";

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

function countChar(value, char) {
  const match = String(value || "").match(new RegExp(`\\${char}`, "g"));
  return match ? match.length : 0;
}

function stripUrlTrailingPunctuation(rawUrl) {
  let value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }
  while (/[.,!?;:]+$/.test(value)) {
    value = value.slice(0, -1);
  }
  let openParens = countChar(value, "(");
  let closeParens = countChar(value, ")");
  while (closeParens > openParens && value.endsWith(")")) {
    value = value.slice(0, -1);
    closeParens -= 1;
  }
  return value;
}

function sanitizeUrl(rawUrl) {
  const raw = stripUrlTrailingPunctuation(rawUrl);
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

function normalizeBrokenMarkdownLinks(input) {
  const source = normalizeTextInput(input);
  return source.replace(
    /\[([\s\S]{1,800}?)\]\((https?:\/\/[^\s<>"']+)\)/g,
    (full, label, url) => {
      const compactLabel = String(label || "").replace(/\s+/g, " ").trim();
      const compactUrl = String(url || "").replace(/\s+/g, "").trim();
      if (!compactLabel || !compactUrl) {
        return full;
      }
      return `[${compactLabel}](${compactUrl})`;
    },
  );
}

function tokenizeInline(input) {
  const tokens = [];
  let text = String(input || "");

  text = text.replace(/\[([^\]]{1,800})\]\((https?:\/\/[^\s<>"']+)\)/g, (_full, label, url) => {
    const compactLabel = String(label || "").replace(/\s+/g, " ").trim();
    return createToken("link", { label: compactLabel || "Ссылка", url }, tokens);
  });

  text = text.replace(/`([^`\n]+)`/g, (_full, code) => createToken("code", { code }, tokens));
  text = text.replace(/\\\((.+?)\\\)/g, (_full, expr) => createToken("math_inline", { expr }, tokens));
  text = text.replace(/\$([^\n$]+?)\$/g, (_full, expr) => createToken("math_inline", { expr }, tokens));
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>"']+)/g, (_full, prefix, url) => {
    return `${prefix}${createToken("link", { label: url, url }, tokens)}`;
  });

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

    const protectedLinks = [];
    const protectLine = safeLine.replace(
      /\[[^\]]{1,800}\]\((https?:\/\/[^\s<>"']+)\)/g,
      (full) => {
        const token = `@@MDLINK_${protectedLinks.length}@@`;
        protectedLinks.push(full);
        return token;
      },
    );

    let next = protectLine;

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

    next = next.replace(/@@MDLINK_(\d+)@@/g, (_full, indexRaw) => {
      const index = Number(indexRaw);
      return Number.isInteger(index) && protectedLinks[index] ? protectedLinks[index] : "";
    });

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
  const normalizedText = normalizeInlineListSyntax(normalizeBrokenMarkdownLinks(text));
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
  if (typeof katexRender === "function") {
    return Promise.resolve(true);
  }
  if (window.katex?.render) {
    katexRender = window.katex.render.bind(window.katex);
    return Promise.resolve(true);
  }
  if (katexLoaderPromise) {
    return katexLoaderPromise;
  }

  katexLoaderPromise = (async () => {
    try {
      await import(/* @vite-ignore */ KATEX_CSS_MODULE);
    } catch (error) {
      // CSS optional: rendering can still proceed without stylesheet.
    }

    try {
      const katexModule = await import(/* @vite-ignore */ KATEX_JS_MODULE);
      const katexApi = katexModule?.default && typeof katexModule.default.render === "function"
        ? katexModule.default
        : katexModule;
      if (katexApi && typeof katexApi.render === "function") {
        katexRender = katexApi.render.bind(katexApi);
        if (!window.katex) {
          window.katex = katexApi;
        }
        return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  })();

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
  const renderer = typeof katexRender === "function"
    ? katexRender
    : (window.katex?.render ? window.katex.render.bind(window.katex) : null);
  if (!ready || typeof renderer !== "function") {
    return;
  }

  candidates.forEach((node) => {
    const expr = String(node.getAttribute("data-latex") || "").trim();
    if (!expr) {
      return;
    }
    const displayMode = node.getAttribute("data-math-display") === "true";
    try {
      renderer(expr, node, {
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
