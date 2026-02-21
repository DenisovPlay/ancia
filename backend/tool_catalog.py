from __future__ import annotations

import copy
from typing import Any


MOOD_VALUES: list[str] = [
  "neutral",
  "success",
  "error",
  "warning",
  "thinking",
  "planning",
  "coding",
  "researching",
  "creative",
  "friendly",
  "waiting",
  "offline",
]


TOOL_SPECS: dict[str, dict[str, Any]] = {
  "web.search.duckduckgo": {
    "title": "Web Search (DuckDuckGo)",
    "subtitle": "Веб-поиск по интернету",
    "description": (
      "Веб-поиск через DuckDuckGo. Используй для актуальных фактов, новостей, "
      "информации о людях, событиях, курсах и любых данных из интернета."
    ),
    "category": "web",
    "requires_network": True,
    "keywords": ["duckduckgo", "search", "web", "поиск", "интернет", "новости", "факты"],
    "aliases": ["web.search", "duckduckgo", "ddg", "web search", "search", "поиск"],
    "input_schema": {
      "type": "object",
      "properties": {
        "query": {"type": "string", "description": "Поисковый запрос"},
        "limit": {"type": "integer", "description": "Максимум результатов (1–10)", "default": 5},
      },
      "required": ["query"],
      "additionalProperties": False,
    },
    "plugin": {
      "id": "duckduckgo",
      "homepage": "https://lmstudio.ai/danielsig/duckduckgo",
      "version": "1.0.0",
      "allow_update": True,
      "locked": False,
      "enabled": True,
    },
  },
  "web.visit.website": {
    "title": "Visit Website",
    "subtitle": "Чтение содержимого страниц",
    "description": "Открывает URL и извлекает содержимое страницы.",
    "category": "web",
    "requires_network": True,
    "keywords": ["visit", "website", "url", "страница", "сайт", "контент", "браузинг"],
    "aliases": ["web.visit", "visit website", "visit", "open website", "website", "страница"],
    "input_schema": {
      "type": "object",
      "properties": {
        "url": {"type": "string", "description": "URL страницы"},
        "max_chars": {"type": "integer", "description": "Лимит символов контента", "default": 6000},
        "max_links": {"type": "integer", "description": "Лимит ссылок", "default": 20},
      },
      "required": ["url"],
      "additionalProperties": False,
    },
    "plugin": {
      "id": "visit-website",
      "homepage": "https://lmstudio.ai/danielsig/visit-website",
      "version": "1.0.0",
      "allow_update": True,
      "locked": False,
      "enabled": True,
    },
  },
  "system.time": {
    "title": "System Time",
    "subtitle": "Системное время",
    "description": "Возвращает текущее время и дату.",
    "category": "system",
    "requires_network": False,
    "keywords": ["time", "date", "system", "время", "дата", "timezone"],
    "aliases": ["time", "clock", "system time"],
    "input_schema": {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": False,
    },
    "plugin": {
      "id": "system-time",
      "homepage": "",
      "version": "1.0.0",
      "allow_update": True,
      "locked": False,
      "enabled": True,
    },
  },
  "chat.set_mood": {
    "title": "Chat Mood",
    "subtitle": "Состояние чата",
    "description": "Устанавливает визуальное состояние (mood) чата.",
    "category": "agent",
    "requires_network": False,
    "keywords": ["mood", "chat", "state", "фон", "настроение", "состояние"],
    "aliases": ["set mood", "chat mood", "mood"],
    "input_schema": {
      "type": "object",
      "properties": {
        "mood": {
          "type": "string",
          "enum": list(MOOD_VALUES),
          "description": (
            "Состояние: neutral, success, error, warning, thinking, planning, coding, "
            "researching, creative, friendly, waiting, offline"
          ),
        },
      },
      "required": ["mood"],
      "additionalProperties": False,
    },
    "plugin": {
      "id": "chat-mood",
      "homepage": "",
      "version": "1.0.0",
      "allow_update": True,
      "locked": False,
      "enabled": True,
    },
  },
}


def get_tool_spec(name: str) -> dict[str, Any] | None:
  safe_name = str(name or "").strip().lower()
  spec = TOOL_SPECS.get(safe_name)
  return copy.deepcopy(spec) if isinstance(spec, dict) else None


def get_tool_input_schema(name: str) -> dict[str, Any]:
  spec = get_tool_spec(name)
  if not spec:
    return {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
  schema = spec.get("input_schema")
  if not isinstance(schema, dict):
    return {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
  normalized = copy.deepcopy(schema)
  normalized.setdefault("type", "object")
  normalized.setdefault("properties", {})
  normalized.setdefault("required", [])
  normalized.setdefault("additionalProperties", False)
  return normalized


def get_tool_llm_schema(name: str) -> dict[str, Any]:
  spec = get_tool_spec(name)
  if not spec:
    return {}
  return {
    "type": "function",
    "function": {
      "name": str(name).strip().lower(),
      "description": str(spec.get("description") or ""),
      "parameters": get_tool_input_schema(name),
    },
  }


def build_tool_schemas() -> dict[str, dict[str, Any]]:
  result: dict[str, dict[str, Any]] = {}
  for name in sorted(TOOL_SPECS.keys()):
    result[name] = get_tool_llm_schema(name)
  return result


def build_tool_alias_map() -> dict[str, str]:
  aliases: dict[str, str] = {}
  for name, spec in TOOL_SPECS.items():
    safe_name = str(name or "").strip().lower()
    if not safe_name:
      continue
    aliases[safe_name] = safe_name
    raw_aliases = spec.get("aliases")
    if isinstance(raw_aliases, list):
      for alias in raw_aliases:
        safe_alias = str(alias or "").strip().lower()
        if safe_alias:
          aliases[safe_alias] = safe_name
  return aliases


def build_preinstalled_plugin_manifests() -> list[dict[str, Any]]:
  manifests: list[dict[str, Any]] = []
  for tool_name, spec in TOOL_SPECS.items():
    plugin = spec.get("plugin")
    if not isinstance(plugin, dict):
      continue
    plugin_id = str(plugin.get("id") or "").strip().lower()
    if not plugin_id:
      continue
    manifests.append(
      {
        "id": plugin_id,
        "name": str(spec.get("title") or tool_name),
        "subtitle": str(spec.get("subtitle") or ""),
        "description": str(spec.get("description") or ""),
        "homepage": str(plugin.get("homepage") or ""),
        "version": str(plugin.get("version") or "1.0.0"),
        "enabled": bool(plugin.get("enabled", True)),
        "category": str(spec.get("category") or "system"),
        "keywords": list(spec.get("keywords") or []),
        "locked": bool(plugin.get("locked", False)),
        "allow_update": bool(plugin.get("allow_update", True)),
        "requires_network": bool(spec.get("requires_network", False)),
        "tools": [tool_name],
      }
    )
  manifests.sort(key=lambda item: str(item.get("id") or ""))
  return manifests

