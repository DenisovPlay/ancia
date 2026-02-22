from __future__ import annotations

import json
import re
from typing import Any

SAFE_TOOL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,127}$")


def normalize_tool_name(raw_name: str, *, payload: dict[str, Any] | None = None) -> str:
  raw = str(raw_name or "").strip().lower()
  if not raw:
    return ""

  normalized = re.sub(r"\s+", " ", raw).strip()
  if SAFE_TOOL_NAME_PATTERN.match(normalized):
    return normalized

  dotted = re.sub(r"[\s/]+", ".", normalized)
  dotted = re.sub(r"[^a-z0-9_.-]", "", dotted)
  dotted = re.sub(r"\.{2,}", ".", dotted).strip(".")
  if dotted and SAFE_TOOL_NAME_PATTERN.match(dotted):
    return dotted

  compact = re.sub(r"[^a-z0-9_.-]", "", normalized)
  if compact and SAFE_TOOL_NAME_PATTERN.match(compact):
    return compact

  return ""


def _collect_fallback_args(payload: dict[str, Any], function_payload: dict[str, Any]) -> dict[str, Any]:
  if not isinstance(payload, dict):
    payload = {}
  if not isinstance(function_payload, dict):
    function_payload = {}

  merged: dict[str, Any] = {}
  for source in (function_payload, payload):
    for key, value in source.items():
      if key in {"name", "tool", "tool_name", "function", "arguments", "args", "parameters", "input"}:
        continue
      merged.setdefault(str(key), value)
  return merged


def _normalize_tool_args(name: str, args: dict[str, Any], payload: dict[str, Any], function_payload: dict[str, Any]) -> dict[str, Any]:
  normalized = dict(args or {})
  fallback = _collect_fallback_args(payload, function_payload)
  for key, value in fallback.items():
    normalized.setdefault(key, value)
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
  return name, normalized_args
