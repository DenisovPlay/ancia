from __future__ import annotations

import json
import re
from typing import Any

TOOLS_PROMPT_PLACEHOLDER = "{{TOOLS_RUNTIME_BLOCK}}"


def _example_value_for_schema_property(schema: dict[str, Any]) -> Any:
  if not isinstance(schema, dict):
    return ""
  enum_values = schema.get("enum")
  if isinstance(enum_values, list) and enum_values:
    return enum_values[0]
  if "default" in schema:
    return schema.get("default")
  value_type = str(schema.get("type") or "").strip().lower()
  if value_type == "integer":
    return 1
  if value_type == "number":
    return 0.5
  if value_type == "boolean":
    return True
  if value_type == "array":
    return []
  if value_type == "object":
    return {}
  return "..."


def _build_tool_args_example(input_schema: dict[str, Any]) -> dict[str, Any]:
  if not isinstance(input_schema, dict):
    return {}
  properties = input_schema.get("properties")
  if not isinstance(properties, dict):
    return {}
  required = input_schema.get("required")
  required_keys = [str(item).strip() for item in required] if isinstance(required, list) else []
  required_keys = [key for key in required_keys if key]
  ordered_keys: list[str] = []
  seen: set[str] = set()
  for key in required_keys:
    if key in properties and key not in seen:
      ordered_keys.append(key)
      seen.add(key)
  for key in properties.keys():
    safe_key = str(key).strip()
    if safe_key and safe_key not in seen:
      ordered_keys.append(safe_key)
      seen.add(safe_key)
  payload: dict[str, Any] = {}
  for key in ordered_keys:
    value_schema = properties.get(key)
    if isinstance(value_schema, dict):
      payload[key] = _example_value_for_schema_property(value_schema)
  return payload


def _resolve_tool_definitions(
  active_tools: set[str],
  tool_definitions: dict[str, dict[str, Any]] | None,
) -> dict[str, dict[str, Any]]:
  if not isinstance(tool_definitions, dict):
    return {}
  safe_active = {str(name or "").strip().lower() for name in active_tools if str(name or "").strip()}
  result: dict[str, dict[str, Any]] = {}
  for name in sorted(safe_active):
    payload = tool_definitions.get(name)
    if isinstance(payload, dict):
      result[name] = payload
  return result


def build_enabled_tools_prompt(
  active_tools: set[str],
  *,
  tool_definitions: dict[str, dict[str, Any]] | None = None,
) -> str:
  safe_tool_definitions = _resolve_tool_definitions(active_tools, tool_definitions)
  if not safe_tool_definitions:
    return ""

  lines: list[str] = [
    "## Доступные инструменты",
    "Ниже только инструменты, которые реально подключены в текущем runtime.",
  ]

  for tool_name in sorted(safe_tool_definitions.keys()):
    spec = safe_tool_definitions.get(tool_name) or {}
    description = str(spec.get("description") or "").strip()
    input_schema = spec.get("input_schema") if isinstance(spec.get("input_schema"), dict) else {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": False,
    }
    runtime_meta = spec.get("runtime_meta") if isinstance(spec.get("runtime_meta"), dict) else {}
    required = input_schema.get("required")
    required_keys = [str(item).strip() for item in required] if isinstance(required, list) else []
    required_keys = [key for key in required_keys if key]
    required_text = ", ".join(required_keys) if required_keys else "нет"
    example_args = _build_tool_args_example(input_schema)
    call_example = json.dumps(
      {"name": tool_name, "args": example_args},
      ensure_ascii=False,
      separators=(",", ":"),
    )

    lines.append(f"- `{tool_name}` — {description or 'Без описания'}")
    lines.append(f"  Обязательные аргументы: {required_text}.")
    lines.append(f"  Пример вызова: `<tool_call>{call_example}</tool_call>`.")

    prompt_hint = str(runtime_meta.get("prompt") or "").strip()
    if prompt_hint:
      lines.append(f"  Подсказка плагина: {prompt_hint}")

  lines.extend([
    "",
    "### Правила вызова",
    "- Вызывай инструмент только если это действительно нужно для ответа.",
    "- Используй точные имена из списка выше.",
    "- Допустимы форматы: `<tool_call>{\"name\":\"...\",\"args\":{...}}</tool_call>` и JSON `{\\\"name\\\":\\\"...\\\",\\\"arguments\\\":{...}}`.",
    "- После результатов инструментов дай финальный ответ обычным текстом.",
    "- Не выдумывай данные, если инструмент вернул ошибку или пустой результат.",
  ])

  return "\n".join(lines).strip()


def strip_legacy_tool_prompt_sections(base_prompt: str) -> str:
  raw = str(base_prompt or "").replace("\r\n", "\n").strip()
  if not raw:
    return ""
  patterns = [
    r"\n?Инструменты:\n(?:- .*(?:\n|$))+",
    r"\n?Когда нужен вызов инструмента:\n(?:- .*(?:\n|$))+",
    r"\n?После результатов инструментов:\n(?:- .*(?:\n|$))+",
    r"\n?Настроение чата:\n(?:- .*(?:\n|$))+",
    r"\n?## Веб-инструменты.*?(?=\n## |\Z)",
  ]
  cleaned = raw
  for pattern in patterns:
    cleaned = re.sub(pattern, "\n", cleaned, flags=re.IGNORECASE | re.DOTALL)
  cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
  return cleaned.strip()


def apply_enabled_tools_prompt(
  base_prompt: str,
  active_tools: set[str],
  *,
  tool_definitions: dict[str, dict[str, Any]] | None = None,
) -> str:
  raw = strip_legacy_tool_prompt_sections(base_prompt)
  dynamic_block = build_enabled_tools_prompt(active_tools, tool_definitions=tool_definitions)

  if TOOLS_PROMPT_PLACEHOLDER in raw:
    replaced = raw.replace(TOOLS_PROMPT_PLACEHOLDER, dynamic_block).strip()
    return re.sub(r"\n{3,}", "\n\n", replaced).strip()

  if not dynamic_block:
    return raw
  if not raw:
    return dynamic_block
  return f"{raw}\n\n{dynamic_block}".strip()
