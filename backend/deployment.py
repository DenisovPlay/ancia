from __future__ import annotations

import os
from typing import Any

DEPLOYMENT_MODE_LOCAL = "local"
DEPLOYMENT_MODE_REMOTE_CLIENT = "remote_client"
DEPLOYMENT_MODE_REMOTE_SERVER = "remote_server"
VALID_DEPLOYMENT_MODES = {
  DEPLOYMENT_MODE_LOCAL,
  DEPLOYMENT_MODE_REMOTE_CLIENT,
  DEPLOYMENT_MODE_REMOTE_SERVER,
}

LOCAL_CORS_DEFAULT_ORIGINS = [
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "http://127.0.0.1:1420",
  "http://localhost:1420",
  "http://127.0.0.1:5055",
  "http://localhost:5055",
]


def normalize_deployment_mode(value: Any, fallback: str = DEPLOYMENT_MODE_LOCAL) -> str:
  safe_fallback = str(fallback or DEPLOYMENT_MODE_LOCAL).strip().lower()
  if safe_fallback not in VALID_DEPLOYMENT_MODES:
    safe_fallback = DEPLOYMENT_MODE_LOCAL
  safe_value = str(value or "").strip().lower()
  if safe_value in VALID_DEPLOYMENT_MODES:
    return safe_value
  return safe_fallback


def read_deployment_mode_from_storage(storage: Any, *, fallback: str = DEPLOYMENT_MODE_LOCAL) -> str:
  raw = {}
  if storage is not None and hasattr(storage, "get_setting_json"):
    raw = storage.get_setting_json("runtime_config", {}) or {}
  if not isinstance(raw, dict):
    raw = {}
  return normalize_deployment_mode(raw.get("deploymentMode"), fallback)


def resolve_deployment_mode(storage: Any = None, *, fallback: str = DEPLOYMENT_MODE_LOCAL) -> str:
  env_override = str(os.getenv("ANCIA_DEPLOYMENT_MODE", "") or "").strip().lower()
  if env_override:
    return normalize_deployment_mode(env_override, fallback)
  return read_deployment_mode_from_storage(storage, fallback=fallback)


def _parse_origin_csv(raw_value: str) -> list[str]:
  result: list[str] = []
  for item in str(raw_value or "").split(","):
    safe = str(item or "").strip()
    if not safe:
      continue
    if safe == "*":
      continue
    result.append(safe)
  return result


def resolve_cors_origins_for_mode(mode: str) -> list[str]:
  env_value = str(os.getenv("ANCIA_CORS_ALLOW_ORIGINS", "") or "").strip()
  if env_value:
    parsed = _parse_origin_csv(env_value)
    if parsed:
      return parsed

  safe_mode = normalize_deployment_mode(mode, DEPLOYMENT_MODE_LOCAL)
  if safe_mode == DEPLOYMENT_MODE_REMOTE_SERVER:
    # Safe default for desktop/web clients; production can override via ANCIA_CORS_ALLOW_ORIGINS.
    return list(LOCAL_CORS_DEFAULT_ORIGINS)

  return list(LOCAL_CORS_DEFAULT_ORIGINS)


def allow_credentials_for_mode(mode: str) -> bool:
  safe_mode = normalize_deployment_mode(mode, DEPLOYMENT_MODE_LOCAL)
  return safe_mode == DEPLOYMENT_MODE_REMOTE_SERVER
