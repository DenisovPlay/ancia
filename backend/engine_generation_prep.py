from __future__ import annotations

import json
import os
from typing import Any, Callable


def build_tool_schemas(active_tools: set[str], tool_schemas: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
  return [tool_schemas[name] for name in active_tools if name in tool_schemas]


def convert_turns_for_compat(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
  """Конвертирует tool/assistant-with-tool_calls сообщения в формат для токенизаторов без tool role."""
  result: list[dict[str, Any]] = []
  for msg in messages:
    role = msg.get("role", "user")
    if role == "tool":
      content = str(msg.get("content") or "")
      result.append({"role": "user", "content": f"[Результат инструмента]\n{content}"})
    elif role == "assistant" and msg.get("tool_calls"):
      calls_text = "\n".join(
        f'<tool_call>{json.dumps({"name": tc["function"]["name"], "args": json.loads(tc["function"].get("arguments", "{}"))}, ensure_ascii=False)}</tool_call>'
        for tc in (msg.get("tool_calls") or [])
        if isinstance(tc, dict) and isinstance(tc.get("function"), dict)
      )
      content = str(msg.get("content") or "").strip()
      result.append({"role": "assistant", "content": f"{content}\n{calls_text}".strip()})
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
  get_model_entry_fn: Callable[[str], Any | None],
  normalize_model_id_fn: Callable[[str | None, str], str],
) -> str:
  attachments = list(getattr(request, "attachments", None) or [])
  if not attachments:
    return ""

  lines: list[str] = ["Вложения пользователя:"]
  total_text_budget = 9000
  used_budget = 0
  ui_context = getattr(getattr(request, "context", None), "ui", None)
  selected_model_id = normalize_model_id_fn(getattr(ui_context, "modelId", ""), "")
  selected_model = get_model_entry_fn(selected_model_id) if selected_model_id else None
  supports_vision = bool(selected_model and getattr(selected_model, "supports_vision", False))

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
      if supports_vision:
        lines.append("Изображение приложено. Модель vision-capable: можно использовать визуальный анализ.")
        if data_url and used_budget < total_text_budget:
          remaining = max(0, total_text_budget - used_budget)
          excerpt = truncate_text_fn(data_url, max(420, min(1800, remaining)))
          used_budget += len(excerpt)
          lines.append("```text")
          lines.append(f"image_data_url={excerpt}")
          lines.append("```")
      else:
        lines.append("Изображение приложено. Текущая модель text-only, требуется описание изображения текстом.")

  return "\n".join(lines).strip()


def build_messages(
  request: Any,
  *,
  base_system_prompt: str,
  active_tools: set[str],
  turns: list[dict[str, Any]] | None,
  build_system_prompt_fn: Callable[..., str],
  truncate_text_fn: Callable[[str, int], str],
  build_attachment_context_fn: Callable[[Any], str],
  max_history_messages: int,
  max_history_total_chars: int,
  max_history_entry_chars: int,
) -> list[dict[str, Any]]:
  messages: list[dict[str, Any]] = []
  system_prompt = build_system_prompt_fn(
    base_system_prompt,
    request,
    active_tools=active_tools,
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
  if attachment_context:
    user_text = f"{user_text}\n\n{attachment_context}".strip()
  messages.append({"role": "user", "content": user_text})

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
    content = message.get("content") or ""
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
  effective_context_window = max(256, min(32768, effective_context_window))
  context_cap = max(96, min(2048, effective_context_window // 8))
  default_cap_by_tier = {
    "compact": 220,
    "balanced": 320,
    "performance": 420,
  }
  default_cap = default_cap_by_tier.get(tier.key, 320)
  env_cap_raw = os.getenv("ANCIA_MODEL_MAX_TOKENS", "").strip()
  if env_cap_raw:
    try:
      default_cap = max(64, min(1024, int(env_cap_raw)))
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
