from __future__ import annotations

import re
from typing import Any, Callable
from urllib import parse as url_parse

PLUGIN_PERMISSION_POLICIES_SETTING_KEY = "plugin_permission_policies"
PLUGIN_TOOL_PERMISSION_POLICIES_SETTING_KEY = "plugin_tool_permission_policies"
PLUGIN_DOMAIN_PERMISSION_POLICIES_SETTING_KEY = "plugin_domain_permission_policies"
PLUGIN_DOMAIN_DEFAULT_POLICY_SETTING_KEY = "plugin_domain_default_policy"
DEFAULT_PLUGIN_PERMISSION_POLICY = "allow"
DEFAULT_DOMAIN_PERMISSION_POLICY = "allow"
VALID_PLUGIN_PERMISSION_POLICIES = {"allow", "ask", "deny"}
VALID_DOMAIN_DEFAULT_POLICIES = {"allow", "deny"}
SAFE_TOOL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,127}$")
SAFE_DOMAIN_PATTERN = re.compile(r"^[a-z0-9.-]{1,253}$")


def normalize_plugin_permission_policy(value: Any, fallback: str = DEFAULT_PLUGIN_PERMISSION_POLICY) -> str:
  safe_fallback = str(fallback or DEFAULT_PLUGIN_PERMISSION_POLICY).strip().lower() or DEFAULT_PLUGIN_PERMISSION_POLICY
  safe_value = str(value or "").strip().lower()
  if safe_value in VALID_PLUGIN_PERMISSION_POLICIES:
    return safe_value
  return safe_fallback if safe_fallback in VALID_PLUGIN_PERMISSION_POLICIES else DEFAULT_PLUGIN_PERMISSION_POLICY


def normalize_domain_default_policy(value: Any, fallback: str = DEFAULT_DOMAIN_PERMISSION_POLICY) -> str:
  safe_fallback = normalize_plugin_permission_policy(fallback, DEFAULT_DOMAIN_PERMISSION_POLICY)
  if safe_fallback not in VALID_DOMAIN_DEFAULT_POLICIES:
    safe_fallback = DEFAULT_DOMAIN_PERMISSION_POLICY
  safe_value = normalize_plugin_permission_policy(value, safe_fallback)
  if safe_value in VALID_DOMAIN_DEFAULT_POLICIES:
    return safe_value
  return safe_fallback


def _default_sanitize_plugin_id(value: Any) -> str:
  return str(value or "").strip().lower()


def _default_sanitize_tool_name(value: Any) -> str:
  safe_value = str(value or "").strip().lower()
  if not SAFE_TOOL_NAME_PATTERN.match(safe_value):
    return ""
  return safe_value


def _normalize_tool_policy_key(
  value: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str],
  sanitize_tool_name: Callable[[Any], str],
) -> str:
  if isinstance(value, dict):
    plugin_id = sanitize_plugin_id(
      value.get("plugin_id")
      or value.get("pluginId")
      or value.get("plugin"),
    )
    tool_name = sanitize_tool_name(
      value.get("tool_name")
      or value.get("toolName")
      or value.get("tool"),
    )
    return f"{plugin_id}::{tool_name}" if plugin_id and tool_name else ""

  raw = str(value or "").strip().lower()
  if not raw:
    return ""
  separator = "::" if "::" in raw else (":" if ":" in raw else "|")
  if separator not in raw:
    return ""
  plugin_raw, tool_raw = raw.split(separator, 1)
  plugin_id = sanitize_plugin_id(plugin_raw)
  tool_name = sanitize_tool_name(tool_raw)
  return f"{plugin_id}::{tool_name}" if plugin_id and tool_name else ""


def normalize_domain_key(value: Any) -> str:
  raw = str(value or "").strip().lower()
  if not raw:
    return ""
  if raw in {"*", "all", "any"}:
    return "*"
  if "://" in raw:
    parsed = url_parse.urlparse(raw)
    raw = str(parsed.hostname or "").strip().lower()
  if "/" in raw:
    raw = raw.split("/", 1)[0]
  if raw.startswith("*."):
    raw = raw[2:]
  if ":" in raw and raw.count(":") == 1:
    raw = raw.split(":", 1)[0]
  raw = raw.lstrip(".").rstrip(".")
  if not raw or not SAFE_DOMAIN_PATTERN.match(raw):
    return ""
  if ".." in raw:
    return ""
  return raw


def normalize_plugin_permissions_map(
  payload: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  if not isinstance(payload, dict):
    return {}
  sanitizer = sanitize_plugin_id or _default_sanitize_plugin_id
  normalized: dict[str, str] = {}
  for key, value in payload.items():
    plugin_id = sanitizer(key)
    if not plugin_id:
      continue
    normalized[plugin_id] = normalize_plugin_permission_policy(value)
  return normalized


def normalize_tool_permissions_map(
  payload: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
  sanitize_tool_name: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  if not isinstance(payload, dict):
    return {}
  sanitize_plugin = sanitize_plugin_id or _default_sanitize_plugin_id
  sanitize_tool = sanitize_tool_name or _default_sanitize_tool_name
  normalized: dict[str, str] = {}
  for key, value in payload.items():
    tool_key = _normalize_tool_policy_key(
      key,
      sanitize_plugin_id=sanitize_plugin,
      sanitize_tool_name=sanitize_tool,
    )
    if not tool_key:
      continue
    normalized[tool_key] = normalize_plugin_permission_policy(value)
  return normalized


def normalize_domain_permissions_map(payload: Any) -> dict[str, str]:
  if not isinstance(payload, dict):
    return {}
  normalized: dict[str, str] = {}
  for key, value in payload.items():
    domain = normalize_domain_key(key)
    if not domain:
      continue
    normalized[domain] = normalize_plugin_permission_policy(value)
  return normalized


def read_plugin_permissions(
  storage: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  if storage is None or not hasattr(storage, "get_setting_json"):
    return {}
  raw = storage.get_setting_json(PLUGIN_PERMISSION_POLICIES_SETTING_KEY, {})
  return normalize_plugin_permissions_map(raw, sanitize_plugin_id=sanitize_plugin_id)


def read_tool_permissions(
  storage: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
  sanitize_tool_name: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  if storage is None or not hasattr(storage, "get_setting_json"):
    return {}
  raw = storage.get_setting_json(PLUGIN_TOOL_PERMISSION_POLICIES_SETTING_KEY, {})
  return normalize_tool_permissions_map(
    raw,
    sanitize_plugin_id=sanitize_plugin_id,
    sanitize_tool_name=sanitize_tool_name,
  )


def read_domain_permissions(storage: Any) -> dict[str, str]:
  if storage is None or not hasattr(storage, "get_setting_json"):
    return {}
  raw = storage.get_setting_json(PLUGIN_DOMAIN_PERMISSION_POLICIES_SETTING_KEY, {})
  return normalize_domain_permissions_map(raw)


def read_domain_default_policy(storage: Any) -> str:
  if storage is None or not hasattr(storage, "get_setting"):
    return DEFAULT_DOMAIN_PERMISSION_POLICY
  raw = storage.get_setting(PLUGIN_DOMAIN_DEFAULT_POLICY_SETTING_KEY)
  if raw is None:
    raw = DEFAULT_DOMAIN_PERMISSION_POLICY
  return normalize_domain_default_policy(raw, DEFAULT_DOMAIN_PERMISSION_POLICY)


def write_plugin_permissions(
  storage: Any,
  policies: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  normalized = normalize_plugin_permissions_map(policies, sanitize_plugin_id=sanitize_plugin_id)
  if storage is not None and hasattr(storage, "set_setting_json"):
    storage.set_setting_json(PLUGIN_PERMISSION_POLICIES_SETTING_KEY, normalized)
  return normalized


def write_tool_permissions(
  storage: Any,
  policies: Any,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
  sanitize_tool_name: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  normalized = normalize_tool_permissions_map(
    policies,
    sanitize_plugin_id=sanitize_plugin_id,
    sanitize_tool_name=sanitize_tool_name,
  )
  if storage is not None and hasattr(storage, "set_setting_json"):
    storage.set_setting_json(PLUGIN_TOOL_PERMISSION_POLICIES_SETTING_KEY, normalized)
  return normalized


def write_domain_permissions(storage: Any, policies: Any) -> dict[str, str]:
  normalized = normalize_domain_permissions_map(policies)
  if storage is not None and hasattr(storage, "set_setting_json"):
    storage.set_setting_json(PLUGIN_DOMAIN_PERMISSION_POLICIES_SETTING_KEY, normalized)
  return normalized


def write_domain_default_policy(storage: Any, policy: Any) -> str:
  normalized = normalize_domain_default_policy(policy, DEFAULT_DOMAIN_PERMISSION_POLICY)
  if storage is not None and hasattr(storage, "set_setting"):
    storage.set_setting(PLUGIN_DOMAIN_DEFAULT_POLICY_SETTING_KEY, normalized)
  return normalized


def build_effective_plugin_permissions(
  plugin_ids: list[str] | set[str] | tuple[str, ...],
  policy_map: dict[str, str] | None = None,
  *,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  sanitizer = sanitize_plugin_id or _default_sanitize_plugin_id
  policies = normalize_plugin_permissions_map(policy_map or {}, sanitize_plugin_id=sanitizer)
  result: dict[str, str] = {}
  for item in plugin_ids:
    plugin_id = sanitizer(item)
    if not plugin_id:
      continue
    result[plugin_id] = normalize_plugin_permission_policy(
      policies.get(plugin_id, DEFAULT_PLUGIN_PERMISSION_POLICY),
      DEFAULT_PLUGIN_PERMISSION_POLICY,
    )
  return result


def build_effective_tool_permissions(
  tool_keys: list[str] | set[str] | tuple[str, ...],
  policy_map: dict[str, str] | None = None,
  *,
  plugin_policy_map: dict[str, str] | None = None,
  sanitize_plugin_id: Callable[[Any], str] | None = None,
  sanitize_tool_name: Callable[[Any], str] | None = None,
) -> dict[str, str]:
  sanitize_plugin = sanitize_plugin_id or _default_sanitize_plugin_id
  sanitize_tool = sanitize_tool_name or _default_sanitize_tool_name
  policies = normalize_tool_permissions_map(
    policy_map or {},
    sanitize_plugin_id=sanitize_plugin,
    sanitize_tool_name=sanitize_tool,
  )
  plugin_policies = normalize_plugin_permissions_map(
    plugin_policy_map or {},
    sanitize_plugin_id=sanitize_plugin,
  )
  result: dict[str, str] = {}
  for item in tool_keys:
    tool_key = _normalize_tool_policy_key(
      item,
      sanitize_plugin_id=sanitize_plugin,
      sanitize_tool_name=sanitize_tool,
    )
    if not tool_key:
      continue
    plugin_id, _tool_name = tool_key.split("::", 1)
    plugin_fallback = normalize_plugin_permission_policy(
      plugin_policies.get(plugin_id, DEFAULT_PLUGIN_PERMISSION_POLICY),
      DEFAULT_PLUGIN_PERMISSION_POLICY,
    )
    result[tool_key] = normalize_plugin_permission_policy(
      policies.get(tool_key, plugin_fallback),
      plugin_fallback,
    )
  return result


def build_effective_domain_permissions(
  domain_keys: list[str] | set[str] | tuple[str, ...],
  policy_map: dict[str, str] | None = None,
) -> dict[str, str]:
  policies = normalize_domain_permissions_map(policy_map or {})
  result: dict[str, str] = {}
  for item in domain_keys:
    domain = normalize_domain_key(item)
    if not domain:
      continue
    result[domain] = normalize_plugin_permission_policy(
      policies.get(domain, DEFAULT_PLUGIN_PERMISSION_POLICY),
      DEFAULT_PLUGIN_PERMISSION_POLICY,
    )
  return result
