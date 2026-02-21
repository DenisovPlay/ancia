from __future__ import annotations

import json
import re
from typing import Any

try:
  from backend.tool_catalog import MOOD_VALUES, build_tool_alias_map
except ModuleNotFoundError:
  from tool_catalog import MOOD_VALUES, build_tool_alias_map  # type: ignore


TOOL_ALIAS_MAP = build_tool_alias_map()
TOOL_ALIAS_MAP_COMPACT = {
  re.sub(r"[^a-z0-9_.]+", "", alias): name
  for alias, name in TOOL_ALIAS_MAP.items()
  if alias
}
ALLOWED_MOOD_VALUES = set(MOOD_VALUES)


def normalize_tool_name(raw_name: str, *, payload: dict[str, Any] | None = None) -> str:
  raw = str(raw_name or "").strip().lower()
  normalized = re.sub(r"\s+", " ", raw).strip()
  if normalized in TOOL_ALIAS_MAP:
    return TOOL_ALIAS_MAP[normalized]

  compact = re.sub(r"[^a-z0-9_.]+", "", normalized)
  if compact in TOOL_ALIAS_MAP_COMPACT:
    return TOOL_ALIAS_MAP_COMPACT[compact]

  safe_payload = payload if isinstance(payload, dict) else {}
  type_hint = str(
    safe_payload.get("type")
    or safe_payload.get("tool_type")
    or safe_payload.get("tool")
    or ""
  ).strip().lower()
  if "duckduckgo" in type_hint or "web search" in type_hint or type_hint == "search":
    return "web.search.duckduckgo"
  if "visit" in type_hint or "website" in type_hint or "web page" in type_hint:
    return "web.visit.website"
  if "system time" in type_hint or type_hint == "time":
    return "system.time"
  if "mood" in type_hint:
    return "chat.set_mood"

  if "query" in safe_payload and str(safe_payload.get("query") or "").strip():
    return "web.search.duckduckgo"
  if "url" in safe_payload and str(safe_payload.get("url") or "").strip():
    return "web.visit.website"
  if "mood" in safe_payload and str(safe_payload.get("mood") or "").strip():
    return "chat.set_mood"

  return ""


def _collect_fallback_args(payload: dict[str, Any], function_payload: dict[str, Any]) -> dict[str, Any]:
  if not isinstance(payload, dict):
    payload = {}
  if not isinstance(function_payload, dict):
    function_payload = {}
  merged: dict[str, Any] = {}
  for key in ("query", "limit", "url", "max_chars", "max_links", "mood"):
    if key in payload:
      merged[key] = payload.get(key)
    elif key in function_payload:
      merged[key] = function_payload.get(key)
  return merged


def _normalize_tool_args(name: str, args: dict[str, Any], payload: dict[str, Any], function_payload: dict[str, Any]) -> dict[str, Any]:
  normalized = dict(args or {})
  fallback = _collect_fallback_args(payload, function_payload)
  for key, value in fallback.items():
    normalized.setdefault(key, value)

  if name == "web.search.duckduckgo":
    query = str(normalized.get("query") or "").strip()
    if not query:
      return {}
    result: dict[str, Any] = {"query": query}
    try:
      if normalized.get("limit") is not None:
        result["limit"] = int(normalized.get("limit"))
    except (TypeError, ValueError):
      pass
    return result

  if name == "web.visit.website":
    url = str(normalized.get("url") or "").strip()
    if not url:
      return {}
    result = {"url": url}
    for key in ("max_chars", "max_links"):
      try:
        if normalized.get(key) is not None:
          result[key] = int(normalized.get(key))
      except (TypeError, ValueError):
        continue
    return result

  if name == "chat.set_mood":
    mood = str(normalized.get("mood") or "").strip().lower()
    if mood not in ALLOWED_MOOD_VALUES:
      return {}
    return {"mood": mood}

  if name == "system.time":
    return {}

  return normalized


def normalize_tool_call_payload(payload: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
  function_payload = payload.get("function")
  function_payload = function_payload if isinstance(function_payload, dict) else {}
  raw_name = str(
    payload.get("name")
    or payload.get("tool")
    or payload.get("tool_name")
    or payload.get("function_name")
    or function_payload.get("name")
    or ""
  ).strip()

  args_candidate = payload.get("args")
  if args_candidate is None:
    args_candidate = payload.get("arguments")
  if args_candidate is None:
    args_candidate = payload.get("parameters")
  if args_candidate is None:
    args_candidate = payload.get("input")
  if args_candidate is None and function_payload:
    args_candidate = (
      function_payload.get("arguments")
      if "arguments" in function_payload
      else function_payload.get("args")
    )

  if args_candidate is None:
    args: dict[str, Any] = {}
  elif isinstance(args_candidate, dict):
    args = dict(args_candidate)
  elif isinstance(args_candidate, str):
    raw_args = args_candidate.strip()
    if not raw_args:
      args = {}
    else:
      try:
        parsed_args = json.loads(raw_args)
      except json.JSONDecodeError:
        return None
      if isinstance(parsed_args, dict):
        args = dict(parsed_args)
      else:
        return None
  else:
    return None

  name = normalize_tool_name(raw_name, payload=payload)
  if not name:
    return None

  normalized_args = _normalize_tool_args(name, args, payload, function_payload)
  if name in {"web.search.duckduckgo", "web.visit.website", "chat.set_mood"} and not normalized_args:
    return None
  return name, normalized_args
