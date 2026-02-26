from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

MAX_IMAGE_DATA_URL_CHARS = 2_000_000
SAFE_IMAGE_DATA_URL_RE = re.compile(
  r"^data:image/(?:png|jpe?g|webp|gif|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,[a-z0-9+/=]+$",
  flags=re.IGNORECASE,
)


def _is_safe_image_data_url(value: Any) -> bool:
  return bool(SAFE_IMAGE_DATA_URL_RE.match(str(value or "").strip()))


def build_tool_schemas(active_tools: set[str], tool_schemas: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
  return [tool_schemas[name] for name in sorted(active_tools) if name in tool_schemas]


def _message_content_to_text(content: Any) -> str:
  if isinstance(content, str):
    return content
  if isinstance(content, list):
    chunks: list[str] = []
    for item in content:
      if isinstance(item, dict):
        block_type = str(item.get("type") or "").strip().lower()
        if block_type == "text":
          text_value = str(item.get("text") or "").strip()
          if text_value:
            chunks.append(text_value)
          continue
        if block_type == "image_url":
          chunks.append("[Изображение]")
          continue
      raw_value = str(item or "").strip()
      if raw_value:
        chunks.append(raw_value)
    return "\n".join(chunks).strip()
  return str(content or "").strip()


def convert_turns_for_compat(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
  """Конвертирует tool/assistant-with-tool_calls сообщения в формат для токенизаторов без tool role."""
  result: list[dict[str, Any]] = []
  for msg in messages:
    role = msg.get("role", "user")
    if role == "tool":
      content = _message_content_to_text(msg.get("content"))
      result.append({"role": "user", "content": f"[Результат инструмента]\n{content}"})
    elif role == "assistant" and msg.get("tool_calls"):
      calls_text = "\n".join(
        f'<tool_call>{json.dumps({"name": tc["function"]["name"], "args": json.loads(tc["function"].get("arguments", "{}"))}, ensure_ascii=False)}</tool_call>'
        for tc in (msg.get("tool_calls") or [])
        if isinstance(tc, dict) and isinstance(tc.get("function"), dict)
      )
      content = _message_content_to_text(msg.get("content"))
      result.append({"role": "assistant", "content": f"{content}\n{calls_text}".strip()})
    else:
      content = msg.get("content")
      if isinstance(content, list):
        normalized = dict(msg)
        normalized["content"] = _message_content_to_text(content)
        result.append(normalized)
      else:
        result.append(msg)
  return result


def normalize_attachment_kind(kind: str) -> str:
  normalized = str(kind or "").strip().lower()
  if normalized in {"image", "document", "text", "audio", "video"}:
    return normalized
  return "file"


def build_attachment_context(
  request: Any,
  *,
  truncate_text_fn: Callable[[str, int], str],
  supports_vision: bool,
) -> str:
  attachments = list(getattr(request, "attachments", None) or [])
  if not attachments:
    return ""

  lines: list[str] = ["Вложения пользователя:"]
  total_text_budget = 9000
  used_budget = 0

  for index, attachment in enumerate(attachments[:10], start=1):
    item = attachment.model_dump() if hasattr(attachment, "model_dump") else dict(attachment)
    name = str(item.get("name") or f"file-{index}").strip()
    kind = normalize_attachment_kind(str(item.get("kind") or "file"))
    mime_type = str(item.get("mimeType") or "").strip()
    size = max(0, int(item.get("size") or 0))
    size_label = f"{size} bytes" if size > 0 else "unknown size"
    suffix_parts = [kind]
    if mime_type:
      suffix_parts.append(mime_type)
    suffix_parts.append(size_label)
    lines.append(f"{index}. {name} ({', '.join(suffix_parts)})")

    text_content = str(item.get("textContent") or "").strip()
    if text_content and used_budget < total_text_budget:
      remaining = max(0, total_text_budget - used_budget)
      excerpt = truncate_text_fn(text_content, max(600, min(3500, remaining)))
      used_budget += len(excerpt)
      lines.append("```text")
      lines.append(excerpt)
      lines.append("```")
      continue

    if kind == "image":
      data_url = str(item.get("dataUrl") or "").strip()
      is_image_data_url = data_url.lower().startswith("data:image/")
      is_safe_embedded_image = _is_safe_image_data_url(data_url)
      if is_image_data_url and not is_safe_embedded_image:
        lines.append(
          "Изображение приложено в неподдерживаемом формате. "
          "Разрешены только base64 DataURL форматов png/jpeg/webp/gif/bmp/ico/avif."
        )
        continue
      if is_safe_embedded_image and len(data_url) > MAX_IMAGE_DATA_URL_CHARS:
        lines.append(
          "Изображение приложено, но размер слишком большой для прямой передачи в vision-модель. "
          "Отправь более лёгкую версию файла."
        )
        continue
      if supports_vision:
        lines.append("Изображение приложено. Доступен визуальный анализ.")
        lines.append(
          "Если вопрос про это изображение, анализируй его напрямую: "
          "не трактуй имя файла как URL и не запускай инструменты без явной просьбы пользователя."
        )
      else:
        lines.append(
          "Изображение приложено, но текущий runtime не умеет визуально анализировать фото. "
          "Не выдумывай содержание изображения; честно сообщи, что vision-анализ недоступен."
        )

  return "\n".join(lines).strip()


def _resolve_image_blocks(
  request: Any,
  *,
  truncate_text_fn: Callable[[str, int], str],
  supports_vision: bool,
) -> list[dict[str, Any]]:
  if not supports_vision:
    return []
  attachments = list(getattr(request, "attachments", None) or [])
  image_blocks: list[dict[str, Any]] = []
  for attachment in attachments[:6]:
    item = attachment.model_dump() if hasattr(attachment, "model_dump") else dict(attachment)
    kind = normalize_attachment_kind(str(item.get("kind") or "file"))
    if kind != "image":
      continue
    data_url = str(item.get("dataUrl") or "").strip()
    if not _is_safe_image_data_url(data_url):
      continue
    if len(data_url) > MAX_IMAGE_DATA_URL_CHARS:
      continue
    image_blocks.append(
      {
        "type": "image_url",
        "image_url": {
          "url": data_url,
        },
      }
    )
  return image_blocks


def _build_user_message_content(
  *,
  user_text: str,
  attachment_context: str,
  image_blocks: list[dict[str, Any]],
) -> str | list[dict[str, Any]]:
  merged_text = user_text
  if attachment_context:
    merged_text = f"{merged_text}\n\n{attachment_context}".strip()

  if not image_blocks:
    return merged_text

  text_block = merged_text.strip() or "Проанализируй вложенные изображения и ответь на запрос пользователя."
  text_block = (
    f"{text_block}\n\n"
    "Важно: для задач вида «что на фото/изображении» сначала используй визуальный анализ вложения. "
    "Не превращай имя файла во внешний URL и не вызывай инструменты, если пользователь явно этого не просил."
  ).strip()
  return [
    {
      "type": "text",
      "text": text_block,
    },
    *image_blocks,
  ]


def build_messages(
  request: Any,
  *,
  base_system_prompt: str,
  active_tools: set[str],
  tool_definitions: dict[str, dict[str, Any]] | None,
  turns: list[dict[str, Any]] | None,
  build_system_prompt_fn: Callable[..., str],
  truncate_text_fn: Callable[[str, int], str],
  build_attachment_context_fn: Callable[[Any], str],
  supports_vision: bool,
  max_history_messages: int,
  max_history_total_chars: int,
  max_history_entry_chars: int,
) -> list[dict[str, Any]]:
  messages: list[dict[str, Any]] = []
  system_prompt = build_system_prompt_fn(
    base_system_prompt,
    request,
    active_tools=active_tools,
    tool_definitions=tool_definitions or {},
  )
  if system_prompt.strip():
    messages.append({"role": "system", "content": system_prompt.strip()})

  selected_history: list[dict[str, Any]] = []
  total_chars = 0
  history = getattr(getattr(request, "context", None), "history", None) or []
  for entry in reversed(history):
    role = str(getattr(entry, "role", "") or "").strip().lower()
    if role not in {"user", "assistant", "system"}:
      continue
    text = truncate_text_fn(str(getattr(entry, "text", "") or "").strip(), max_history_entry_chars)
    if not text:
      continue
    projected_total = total_chars + len(text)
    if projected_total > max_history_total_chars and selected_history:
      break
    total_chars = projected_total
    selected_history.append({"role": role, "content": text})
    if len(selected_history) >= max_history_messages:
      break

  selected_history.reverse()
  messages.extend(selected_history)

  user_text = str(getattr(request, "message", "") or "").strip()
  attachment_context = build_attachment_context_fn(request)
  image_blocks = _resolve_image_blocks(
    request,
    truncate_text_fn=truncate_text_fn,
    supports_vision=supports_vision,
  )
  user_content = _build_user_message_content(
    user_text=user_text,
    attachment_context=attachment_context,
    image_blocks=image_blocks,
  )
  messages.append({"role": "user", "content": user_content})

  if turns:
    messages.extend(turns)

  return messages


def render_prompt(
  messages: list[dict[str, Any]],
  *,
  tokenizer: Any,
  active_tools: set[str],
  tool_schemas: dict[str, dict[str, Any]],
) -> str:
  if tokenizer is not None and hasattr(tokenizer, "apply_chat_template"):
    tools_schema = build_tool_schemas(active_tools, tool_schemas)
    if tools_schema:
      try:
        return tokenizer.apply_chat_template(
          messages,
          tools=tools_schema,
          tokenize=False,
          add_generation_prompt=True,
        )
      except Exception:
        pass

    try:
      return tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
      )
    except Exception:
      compat = convert_turns_for_compat(messages)
      try:
        return tokenizer.apply_chat_template(
          compat,
          tokenize=False,
          add_generation_prompt=True,
        )
      except Exception:
        pass

  blocks: list[str] = []
  for message in messages:
    role = message.get("role", "user")
    content = _message_content_to_text(message.get("content"))
    blocks.append(f"[{role}]\n{content}")
  blocks.append("[assistant]")
  return "\n\n".join(blocks)


def build_generation_attempts(
  prompt: str,
  plan: Any,
  *,
  make_sampler_fn: Callable[..., Any] | None,
) -> list[dict[str, Any]]:
  tier = plan.tier
  effective_context_window = int(plan.context_window_override or tier.max_context)
  effective_context_window = max(256, min(262144, effective_context_window))
  # Не ограничиваем выдачу жёстким потолком 4k: даём максимум в рамках окна контекста.
  reserve_for_prompt = max(96, min(4096, effective_context_window // 6))
  context_cap = max(96, min(131072, effective_context_window - reserve_for_prompt))
  default_cap_by_tier = {
    "compact": 320,
    "balanced": 640,
    "performance": 1024,
  }
  default_cap = default_cap_by_tier.get(tier.key, 320)
  env_cap_raw = os.getenv("ANCIA_MODEL_MAX_TOKENS", "").strip()
  if env_cap_raw:
    try:
      default_cap = max(64, min(131072, int(env_cap_raw)))
    except ValueError:
      pass
  max_tokens = max(64, min(context_cap, default_cap))
  if plan.max_tokens_override is not None:
    max_tokens = max(16, min(context_cap, int(plan.max_tokens_override)))

  temperature = float(plan.temperature_override if plan.temperature_override is not None else tier.temperature)
  temperature = max(0.0, min(2.0, temperature))
  top_p = float(plan.top_p_override if plan.top_p_override is not None else 0.9)
  top_p = max(0.0, min(1.0, top_p))
  top_k = int(plan.top_k_override if plan.top_k_override is not None else 40)
  top_k = max(1, min(400, top_k))
  attempts: list[dict[str, Any]] = []

  sampler = None
  if make_sampler_fn is not None:
    sampler_attempts = [
      {"temp": temperature, "top_p": top_p, "top_k": top_k},
      {"temperature": temperature, "top_p": top_p, "top_k": top_k},
      {"temp": temperature},
      {"temperature": temperature},
    ]
    for sampler_kwargs in sampler_attempts:
      try:
        sampler = make_sampler_fn(**sampler_kwargs)
        if sampler is not None:
          break
      except Exception:
        continue

  if sampler is not None:
    attempts.append(
      {
        "prompt": prompt,
        "max_tokens": max_tokens,
        "sampler": sampler,
      }
    )

  attempts.append(
    {
      "prompt": prompt,
      "max_tokens": max_tokens,
      "temperature": temperature,
      "top_p": top_p,
      "top_k": top_k,
    }
  )
  attempts.append(
    {
      "prompt": prompt,
      "max_tokens": max_tokens,
    }
  )

  return attempts
