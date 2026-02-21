from __future__ import annotations

import json
import re
from typing import Any

try:
  from backend.tool_catalog import MOOD_VALUES, TOOL_SPECS, get_tool_input_schema, get_tool_spec
except ModuleNotFoundError:
  from tool_catalog import MOOD_VALUES, TOOL_SPECS, get_tool_input_schema, get_tool_spec  # type: ignore


TOOLS_PROMPT_PLACEHOLDER = "{{TOOLS_RUNTIME_BLOCK}}"
WEB_TOOLS_SECTION_HEADING = "## Веб-инструменты (Web Search + Visit Website)"
WEB_TOOLS_SECTION_PATTERN = re.compile(
  r"\n?## Веб-инструменты \(Web Search \+ Visit Website\).*?(?=\n## |\Z)",
  re.DOTALL,
)
WEB_TOOLS_DECLARATION_PATTERN = re.compile(
  r"## Веб-инструменты \(Web Search \+ Visit Website\).*?(?=\n### Когда использовать инструменты|\Z)",
  re.DOTALL,
)


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


def build_enabled_tools_prompt(active_tools: set[str]) -> str:
  has_web_search = "web.search.duckduckgo" in active_tools
  has_web_visit = "web.visit.website" in active_tools
  has_set_mood = "chat.set_mood" in active_tools

  parts = []

  if has_set_mood:
    mood_list = ", ".join(MOOD_VALUES)
    parts.append("\n".join([
      "## Инструмент смены состояния чата",
      "Управляй визуальным состоянием (фоном) активного чата через `chat.set_mood`.",
      f"Допустимые значения: {mood_list}.",
      "Правила:",
      "- Вызывай в начале ответа, если тема/настроение явно соответствует состоянию.",
      "  Код/отладка → `coding`; ошибка/проблема → `error`; поиск информации → `researching`; задача выполнена → `success`; риск → `warning`; ожидание → `thinking`.",
      "- При нейтральном разговоре не вызывай (оставляй текущее состояние).",
      "- Не более одного вызова за ответ.",
      "- Синтаксис: <tool_call>{\"name\":\"chat.set_mood\",\"args\":{\"mood\":\"ЗНАЧЕНИЕ\"}}</tool_call>",
    ]))

  known_tool_names = sorted(name for name in active_tools if name in TOOL_SPECS)
  if known_tool_names:
    catalog_lines = ["## Доступные инструменты"]
    for tool_name in known_tool_names:
      spec = get_tool_spec(tool_name) or {}
      description = str(spec.get("description") or "").strip()
      input_schema = get_tool_input_schema(tool_name)
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
      catalog_lines.append(f"- `{tool_name}` — {description}")
      catalog_lines.append(f"  Обязательные аргументы: {required_text}.")
      catalog_lines.append(f"  Пример вызова: `<tool_call>{call_example}</tool_call>`.")
    parts.append("\n".join(catalog_lines))

  if has_web_search or has_web_visit:
    web_lines = [
      WEB_TOOLS_SECTION_HEADING,
      "У тебя есть доступ к инструментам веб-поиска и чтения сайтов:",
    ]
    if has_web_search:
      web_lines.append("- Web Search (DuckDuckGo): ищет информацию по всему интернету (без ограничений по доменам).")
    if has_web_visit:
      web_lines.append("- Visit Website: открывает конкретный URL и извлекает содержимое страницы (текст/заголовки/ссылки).")
    web_lines.extend(
      [
        "",
        "### Как использовать инструменты",
        "- Используй их только по необходимости: для актуальных фактов, ссылок, новостей, курсов, проверок источников.",
        "- Если инструменты не нужны, отвечай без обращений к ним.",
        "- Если нужен вызов, используй только имена инструментов из раздела `## Доступные инструменты`.",
        "- Формат вызова: `<tool_call>{\"name\":\"...\",\"args\":{...}}</tool_call>`.",
        "- Альтернатива: JSON-объект `{\"name\":\"...\",\"arguments\":{...}}` на отдельной строке.",
        "- Можно вызывать несколько инструментов (несколько блоков/объектов подряд).",
        "- Результаты инструментов приходят отдельными сообщениями роли tool.",
        "- При наличии результатов опирайся на них и формулируй итог без выдумок.",
        "- Для временно-зависимых данных (курсы валют, цены, новости, «сегодня/сейчас») не выдавай точные числа без результатов инструментов.",
        "- После выполнения инструментов дай финальный ответ обычным текстом, без новых <tool_call>, если данных уже достаточно.",
        "- Не добавляй нерелевантные заявления про Ancia/Anci, если пользователь явно не спрашивал про продукт.",
        "- Ничего не выдумывай. Если инструмент вернул ошибку/пусто, так и напиши.",
      ]
    )
    parts.append("\n".join(web_lines))

  return "\n\n".join(parts)


def strip_legacy_tool_prompt_sections(base_prompt: str) -> str:
  raw = str(base_prompt or "").replace("\r\n", "\n").strip()
  if not raw:
    return ""
  patterns = [
    r"\n?Инструменты:\n(?:- .*(?:\n|$))+",
    r"\n?Когда нужен вызов инструмента:\n(?:- .*(?:\n|$))+",
    r"\n?После результатов инструментов:\n(?:- .*(?:\n|$))+",
    r"\n?Настроение чата:\n(?:- .*(?:\n|$))+",
  ]
  cleaned = raw
  for pattern in patterns:
    cleaned = re.sub(pattern, "\n", cleaned, flags=re.IGNORECASE)
  cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
  return cleaned.strip()


def apply_enabled_tools_prompt(base_prompt: str, active_tools: set[str]) -> str:
  raw = strip_legacy_tool_prompt_sections(base_prompt)
  dynamic_block = build_enabled_tools_prompt(active_tools)

  if TOOLS_PROMPT_PLACEHOLDER in raw:
    replaced = raw.replace(TOOLS_PROMPT_PLACEHOLDER, dynamic_block).strip()
    return re.sub(r"\n{3,}", "\n\n", replaced).strip()

  if not dynamic_block:
    return WEB_TOOLS_SECTION_PATTERN.sub("\n", raw).strip()

  if WEB_TOOLS_DECLARATION_PATTERN.search(raw):
    return WEB_TOOLS_DECLARATION_PATTERN.sub(dynamic_block + "\n\n", raw).strip()

  if not raw:
    return dynamic_block
  return f"{raw}\n\n{dynamic_block}".strip()
