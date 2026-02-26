from __future__ import annotations

from typing import Any

PERMISSION_MODELS_DOWNLOAD = "models_download"
PERMISSION_PLUGINS_DOWNLOAD = "plugins_download"

LEGACY_PERMISSION_MODELS = "models"
LEGACY_PERMISSION_PLUGINS = "plugins"


def permission_value_to_bool(value: Any) -> bool:
  if isinstance(value, bool):
    return value
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    return value != 0
  normalized = str(value or "").strip().lower()
  if not normalized:
    return False
  return normalized in {"1", "true", "yes", "on", "allow", "allowed", "enabled"}


def extract_user_permissions(user_payload: Any) -> dict[str, Any]:
  if not isinstance(user_payload, dict):
    return {}
  permissions = user_payload.get("permissions")
  return permissions if isinstance(permissions, dict) else {}


def is_admin_user(user_payload: Any) -> bool:
  if not isinstance(user_payload, dict):
    return False
  return str(user_payload.get("role") or "").strip().lower() == "admin"


def has_user_permission(
  user_payload: Any,
  permission_key: str,
  *,
  fallback_keys: list[str] | tuple[str, ...] = (),
) -> bool:
  if is_admin_user(user_payload):
    return True
  permissions = extract_user_permissions(user_payload)
  safe_key = str(permission_key or "").strip().lower()
  if safe_key and safe_key in permissions:
    return permission_value_to_bool(permissions.get(safe_key))
  for key in fallback_keys:
    safe_fallback = str(key or "").strip().lower()
    if safe_fallback and safe_fallback in permissions:
      return permission_value_to_bool(permissions.get(safe_fallback))
  return False


def user_can_download_models(user_payload: Any) -> bool:
  return has_user_permission(
    user_payload,
    PERMISSION_MODELS_DOWNLOAD,
    fallback_keys=(LEGACY_PERMISSION_MODELS,),
  )


def user_can_download_plugins(user_payload: Any) -> bool:
  return has_user_permission(
    user_payload,
    PERMISSION_PLUGINS_DOWNLOAD,
    fallback_keys=(LEGACY_PERMISSION_PLUGINS,),
  )
