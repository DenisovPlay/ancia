from __future__ import annotations

import ipaddress
import shutil
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request

try:
  from backend.common import utc_now_iso
  from backend.deployment import (
    DEPLOYMENT_MODE_REMOTE_SERVER,
    normalize_deployment_mode,
    resolve_deployment_mode,
  )
except ModuleNotFoundError:
  from common import utc_now_iso  # type: ignore
  from deployment import (  # type: ignore
    DEPLOYMENT_MODE_REMOTE_SERVER,
    normalize_deployment_mode,
    resolve_deployment_mode,
  )

USER_RUNTIME_CONFIG_PREFIX = "runtime_config_user:"
USER_ONBOARDING_STATE_PREFIX = "onboarding_state_user:"
USER_RUNTIME_OVERRIDABLE_FIELDS = {
  "timeoutMs",
  "autoReconnect",
  "bootMood",
  "defaultTransitionMs",
  "userName",
  "userContext",
  "userLanguage",
  "userTimezone",
  "uiDensity",
  "uiAnimations",
  "uiFontScale",
  "uiFontPreset",
  "uiFontFamily",
  "uiShowInspector",
  "contextGuardPluginEnabled",
  "contextGuardAutoCompress",
  "contextGuardShowChatEvents",
}


def register_settings_routes(
  app: FastAPI,
  *,
  storage: Any,
  model_engine: Any,
  plugin_manager: Any,
  user_plugins_dir: Path,
  get_settings_payload: Callable[[], dict[str, Any]],
  persist_settings_payload: Callable[..., dict[str, Any]],
  list_plugins_payload: Callable[[], dict[str, Any]],
  default_runtime_config: dict[str, Any],
  default_onboarding_state: dict[str, Any],
  refresh_tool_registry_fn: Callable[[], None] | None = None,
  auth_service: Any | None = None,
) -> None:
  def _deployment_mode_from_request(request: Request | None = None) -> str:
    if request is not None:
      from_state = str(getattr(request.state, "deployment_mode", "") or "").strip().lower()
      if from_state:
        return normalize_deployment_mode(from_state)
    return resolve_deployment_mode(storage)

  def _is_remote_server(request: Request | None = None) -> bool:
    return _deployment_mode_from_request(request) == DEPLOYMENT_MODE_REMOTE_SERVER

  def _auth_payload(request: Request) -> dict[str, Any]:
    payload = getattr(request.state, "auth", None)
    return payload if isinstance(payload, dict) else {}

  def _auth_user(request: Request) -> dict[str, Any]:
    payload = _auth_payload(request)
    user = payload.get("user")
    return user if isinstance(user, dict) else {}

  def _owner_user_id(request: Request) -> str:
    if not _is_remote_server(request):
      return ""
    user = _auth_user(request)
    return str(user.get("id") or "").strip()

  def _is_admin_user(request: Request) -> bool:
    user = _auth_user(request)
    role = str(user.get("role") or "user").strip().lower()
    return role == "admin"

  def _require_admin_if_remote(request: Request) -> None:
    if _is_remote_server(request) and not _is_admin_user(request):
      raise HTTPException(status_code=403, detail="Admin access required.")

  def _is_loopback_client(request: Request | None = None) -> bool:
    if request is None:
      return False
    host = str(getattr(getattr(request, "client", None), "host", "") or "").strip().lower()
    if not host:
      return False
    if host in {"localhost", "127.0.0.1", "::1"}:
      return True
    try:
      return ipaddress.ip_address(host).is_loopback
    except ValueError:
      return False

  def _is_local_recovery_request(request: Request | None = None) -> bool:
    if request is None:
      return False
    forwarded = str(request.headers.get("forwarded") or "").strip()
    xff = str(request.headers.get("x-forwarded-for") or "").strip()
    if forwarded or xff:
      return False
    return _is_loopback_client(request)

  def _requested_runtime_deployment_mode(runtime_input: Any = None) -> str:
    if not isinstance(runtime_input, dict):
      return ""
    raw = (
      runtime_input.get("deploymentMode")
      if "deploymentMode" in runtime_input
      else runtime_input.get("deployment_mode")
    )
    safe = str(raw or "").strip().lower()
    if safe in {"local", "remote_client", "remote_server"}:
      return safe
    return ""

  def _require_remote_server_admin(request: Request, *, action: str) -> None:
    if not _is_remote_server(request):
      raise HTTPException(
        status_code=409,
        detail=f"{str(action or 'Операция')}: доступ только в режиме remote_server.",
      )
    if not _is_admin_user(request):
      raise HTTPException(status_code=403, detail="Admin access required.")

  def _sanitize_settings_for_client(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict):
      return {
        "runtime_config": {},
        "onboarding_state": {},
        "autonomous_mode": False,
      }

    runtime_config_raw = payload.get("runtime_config") if isinstance(payload.get("runtime_config"), dict) else {}
    runtime_config = dict(runtime_config_raw)
    runtime_config.pop("apiKey", None)

    if _is_remote_server(request) and not _is_admin_user(request):
      runtime_config.pop("serverAllowRegistration", None)

    return {
      "runtime_config": runtime_config,
      "onboarding_state": payload.get("onboarding_state") if isinstance(payload.get("onboarding_state"), dict) else {},
      "autonomous_mode": bool(payload.get("autonomous_mode")),
    }

  def _runtime_server_allow_registration() -> bool:
    runtime = storage.get_setting_json("runtime_config", {}) if hasattr(storage, "get_setting_json") else {}
    if not isinstance(runtime, dict):
      return False
    return bool(runtime.get("serverAllowRegistration", False))

  def _read_bearer_token(request: Request) -> str:
    raw_header = str(request.headers.get("authorization") or "").strip()
    if raw_header.lower().startswith("bearer "):
      return raw_header[7:].strip()
    return ""

  def _admin_count() -> int:
    if auth_service is None:
      return 0
    users = auth_service.list_users()
    return sum(1 for item in users if str(item.get("role") or "").strip().lower() == "admin")

  def _user_runtime_key(user_id: str) -> str:
    safe_user_id = str(user_id or "").strip()
    return f"{USER_RUNTIME_CONFIG_PREFIX}{safe_user_id}" if safe_user_id else USER_RUNTIME_CONFIG_PREFIX

  def _user_onboarding_key(user_id: str) -> str:
    safe_user_id = str(user_id or "").strip()
    return f"{USER_ONBOARDING_STATE_PREFIX}{safe_user_id}" if safe_user_id else USER_ONBOARDING_STATE_PREFIX

  def _sanitize_user_runtime_overrides(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
      return {}
    normalized: dict[str, Any] = {}
    for key in USER_RUNTIME_OVERRIDABLE_FIELDS:
      if key not in payload:
        continue
      raw_value = payload.get(key)
      default_value = default_runtime_config.get(key)
      if isinstance(default_value, bool):
        normalized[key] = bool(raw_value)
      elif isinstance(default_value, int) and not isinstance(default_value, bool):
        try:
          parsed = int(raw_value)
        except (TypeError, ValueError):
          continue
        if key == "uiFontScale":
          parsed = max(70, min(220, parsed))
        elif key == "defaultTransitionMs":
          parsed = max(0, min(10_000, parsed))
        elif key == "timeoutMs":
          parsed = max(1000, min(120_000, parsed))
        normalized[key] = parsed
      else:
        normalized[key] = str(raw_value or "")
    return normalized

  def _read_user_runtime_overrides(user_id: str) -> dict[str, Any]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id:
      return {}
    raw = storage.get_setting_json(_user_runtime_key(safe_user_id), {}) if hasattr(storage, "get_setting_json") else {}
    return _sanitize_user_runtime_overrides(raw)

  def _write_user_runtime_overrides(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id:
      return {}
    normalized = _sanitize_user_runtime_overrides(payload)
    if hasattr(storage, "set_setting_json"):
      storage.set_setting_json(_user_runtime_key(safe_user_id), normalized)
    return normalized

  def _sanitize_user_onboarding_state(payload: Any) -> dict[str, Any]:
    fallback = default_onboarding_state if isinstance(default_onboarding_state, dict) else {}
    base = dict(fallback)
    if not isinstance(payload, dict):
      return base
    if "version" in payload:
      try:
        base["version"] = max(1, int(payload.get("version") or base.get("version") or 1))
      except (TypeError, ValueError):
        pass
    if "completed" in payload:
      base["completed"] = bool(payload.get("completed"))
    if "skipped" in payload:
      base["skipped"] = bool(payload.get("skipped"))
    if "completedAt" in payload:
      base["completedAt"] = str(payload.get("completedAt") or "")
    if "data" in payload and isinstance(payload.get("data"), dict):
      base["data"] = payload.get("data") or {}
    return base

  def _read_user_onboarding_state(user_id: str, fallback: dict[str, Any]) -> dict[str, Any]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id:
      return _sanitize_user_onboarding_state(fallback)
    raw = (
      storage.get_setting_json(_user_onboarding_key(safe_user_id), None)
      if hasattr(storage, "get_setting_json")
      else None
    )
    if raw is None:
      return _sanitize_user_onboarding_state(fallback)
    return _sanitize_user_onboarding_state(raw)

  def _write_user_onboarding_state(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id:
      return _sanitize_user_onboarding_state(payload)
    normalized = _sanitize_user_onboarding_state(payload)
    if hasattr(storage, "set_setting_json"):
      storage.set_setting_json(_user_onboarding_key(safe_user_id), normalized)
    return normalized

  def _merge_user_settings(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    if not isinstance(payload, dict):
      return payload
    if not _is_remote_server(request) or _is_admin_user(request):
      return payload
    user_id = _owner_user_id(request)
    if not user_id:
      return payload

    runtime_base = payload.get("runtime_config") if isinstance(payload.get("runtime_config"), dict) else {}
    runtime_merged = dict(runtime_base)
    runtime_merged.update(_read_user_runtime_overrides(user_id))
    onboarding_base = payload.get("onboarding_state") if isinstance(payload.get("onboarding_state"), dict) else {}
    onboarding_merged = _read_user_onboarding_state(user_id, onboarding_base)
    return {
      "runtime_config": runtime_merged,
      "onboarding_state": onboarding_merged,
      "autonomous_mode": bool(payload.get("autonomous_mode")),
    }

  def _effective_settings_payload(request: Request) -> dict[str, Any]:
    base = get_settings_payload()
    return _merge_user_settings(base, request)

  def _append_audit_event(
    *,
    request: Request | None,
    action: str,
    target_type: str = "",
    target_id: str = "",
    status: str = "ok",
    details: dict[str, Any] | None = None,
  ) -> None:
    if not hasattr(storage, "append_audit_event"):
      return
    request_user = _auth_user(request) if request is not None else {}
    ip_address = str(getattr(getattr(request, "client", None), "host", "") or "") if request is not None else ""
    try:
      storage.append_audit_event(
        actor_user_id=str(request_user.get("id") or ""),
        actor_username=str(request_user.get("username") or ""),
        actor_role=str(request_user.get("role") or ""),
        action=action,
        target_type=target_type,
        target_id=target_id,
        status=status,
        details=details if isinstance(details, dict) else {},
        ip_address=ip_address,
      )
    except Exception:
      return

  @app.get("/settings")
  def get_settings(request: Request) -> dict[str, Any]:
    return _sanitize_settings_for_client(_effective_settings_payload(request), request)

  @app.patch("/settings")
  def patch_settings(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    current = get_settings_payload()
    runtime_input = body.get("runtime_config")
    if runtime_input is None and isinstance(body.get("runtimeConfig"), dict):
      runtime_input = body.get("runtimeConfig")
    runtime_config = dict(current["runtime_config"])
    if isinstance(runtime_input, dict):
      runtime_config.update(runtime_input)

    onboarding_input = body.get("onboarding_state")
    if onboarding_input is None and isinstance(body.get("onboardingState"), dict):
      onboarding_input = body.get("onboardingState")
    onboarding_state = current["onboarding_state"]
    if isinstance(onboarding_input, dict):
      onboarding_state = onboarding_input

    autonomous_mode: bool | None = None
    if "autonomous_mode" in body:
      autonomous_mode = bool(body.get("autonomous_mode"))
    elif "autonomousMode" in body:
      autonomous_mode = bool(body.get("autonomousMode"))
    elif isinstance(runtime_input, dict) and "autonomousMode" in runtime_input:
      autonomous_mode = bool(runtime_input.get("autonomousMode"))

    if _is_remote_server(request) and not _is_admin_user(request):
      requested_deployment_mode = _requested_runtime_deployment_mode(runtime_input)
      if requested_deployment_mode == "local" and _is_local_recovery_request(request):
        runtime_config_recovery = dict(current["runtime_config"])
        runtime_config_recovery["deploymentMode"] = "local"
        runtime_config_recovery["serverAllowRegistration"] = False
        persisted = persist_settings_payload(
          runtime_config=runtime_config_recovery,
          onboarding_state=current["onboarding_state"],
          autonomous_mode=current.get("autonomous_mode"),
        )
        _append_audit_event(
          request=request,
          action="settings.switch_local_recovery",
          target_type="settings",
          target_id="runtime_config",
          status="ok",
          details={"source": "loopback"},
        )
        return _sanitize_settings_for_client(persisted, request)

      user_id = _owner_user_id(request)
      if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required.")
      existing_user_runtime = _read_user_runtime_overrides(user_id)
      global_runtime = current["runtime_config"] if isinstance(current.get("runtime_config"), dict) else {}
      merged_user_runtime = {**existing_user_runtime}
      runtime_updates = _sanitize_user_runtime_overrides(runtime_input) if isinstance(runtime_input, dict) else {}
      if runtime_updates:
        merged_user_runtime.update(runtime_updates)
      normalized_user_runtime = {
        key: value
        for key, value in merged_user_runtime.items()
        if global_runtime.get(key) != value
      }
      _write_user_runtime_overrides(user_id, normalized_user_runtime)
      onboarding_changed = False
      if isinstance(onboarding_input, dict):
        _write_user_onboarding_state(user_id, onboarding_input)
        onboarding_changed = True
      merged_payload = _effective_settings_payload(request)
      _append_audit_event(
        request=request,
        action="settings.update.self",
        target_type="user_settings",
        target_id=user_id,
        status="ok",
        details={
          "runtime_keys": sorted(list(runtime_updates.keys())),
          "onboarding_updated": onboarding_changed,
        },
      )
      return _sanitize_settings_for_client(merged_payload, request)

    _require_admin_if_remote(request)
    persisted = persist_settings_payload(
      runtime_config=runtime_config,
      onboarding_state=onboarding_state,
      autonomous_mode=autonomous_mode,
    )
    if _is_remote_server(request):
      _append_audit_event(
        request=request,
        action="settings.update.global",
        target_type="settings",
        target_id="runtime_config",
        status="ok",
        details={
          "runtime_keys": sorted(list(runtime_config.keys())),
          "autonomous_mode": bool(persisted.get("autonomous_mode")),
        },
      )
    return _sanitize_settings_for_client(persisted, request)

  @app.get("/app/state")
  def app_state(request: Request) -> dict[str, Any]:
    startup = model_engine.get_startup_snapshot()
    startup_state = str(startup.get("status") or "").strip().lower()
    is_remote = _is_remote_server(request)
    is_admin = _is_admin_user(request)
    owner_user_id = _owner_user_id(request)

    include_store = (not is_remote) or bool(owner_user_id)
    include_plugins = (not is_remote) or is_admin

    return {
      "status": "ok" if startup_state == "ready" else ("degraded" if startup_state == "error" else "starting"),
      "time": utc_now_iso(),
      "deployment_mode": _deployment_mode_from_request(request),
      "settings": _sanitize_settings_for_client(_effective_settings_payload(request), request),
      "startup": startup,
      "runtime": model_engine.get_runtime_snapshot() if hasattr(model_engine, "get_runtime_snapshot") else {"startup": startup},
      "plugins": list_plugins_payload() if include_plugins else {"summary": {}, "plugins": []},
      "store": (
        storage.list_chat_store(owner_user_id=owner_user_id)
        if include_store
        else {"version": 1, "activeSessionId": "", "sessions": []}
      ),
    }

  @app.post("/app/reset")
  def app_reset(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    _require_admin_if_remote(request)

    body = payload or {}
    reset_onboarding = bool(body.get("reset_onboarding", True))
    previous_settings = get_settings_payload()
    model_engine.request_stop_generation()
    if hasattr(storage, "reset_runtime_data"):
      storage.reset_runtime_data()
    else:
      storage.reset_all()
    removed_plugin_files = 0
    for file_path in sorted(user_plugins_dir.glob("*.json")):
      if not file_path.is_file():
        continue
      try:
        file_path.unlink()
        removed_plugin_files += 1
      except OSError:
        continue
    for dir_path in sorted(user_plugins_dir.iterdir()):
      if not dir_path.is_dir():
        continue
      try:
        shutil.rmtree(dir_path)
        removed_plugin_files += 1
      except OSError:
        continue
    runtime_defaults = dict(default_runtime_config)
    if _is_remote_server(request):
      previous_runtime = (
        previous_settings.get("runtime_config")
        if isinstance(previous_settings.get("runtime_config"), dict)
        else {}
      )
      runtime_defaults["deploymentMode"] = DEPLOYMENT_MODE_REMOTE_SERVER
      runtime_defaults["serverAllowRegistration"] = bool(previous_runtime.get("serverAllowRegistration", False))
      runtime_defaults["backendUrl"] = str(previous_runtime.get("backendUrl") or runtime_defaults.get("backendUrl") or "")
    defaults = persist_settings_payload(
      runtime_config=runtime_defaults,
      onboarding_state=default_onboarding_state if reset_onboarding else previous_settings["onboarding_state"],
      autonomous_mode=False,
    )
    if callable(refresh_tool_registry_fn):
      refresh_tool_registry_fn()
    else:
      plugin_manager.reload()
    response_payload = {
      "ok": True,
      "message": "Локальные данные приложения сброшены.",
      "settings": defaults,
      "store": storage.list_chat_store(owner_user_id=_owner_user_id(request)),
      "plugins": list_plugins_payload(),
      "removed_plugin_files": removed_plugin_files,
    }
    response_payload["settings"] = _sanitize_settings_for_client(defaults, request)
    if _is_remote_server(request):
      _append_audit_event(
        request=request,
        action="app.reset",
        target_type="app",
        target_id="runtime_data",
        status="ok",
        details={
          "removed_plugin_files": removed_plugin_files,
          "reset_onboarding": reset_onboarding,
        },
      )
    return response_payload

  @app.get("/auth/config")
  def auth_config(request: Request) -> dict[str, Any]:
    deployment_mode = _deployment_mode_from_request(request)
    is_remote_server = deployment_mode == DEPLOYMENT_MODE_REMOTE_SERVER
    users_count = auth_service.count_users() if (auth_service is not None and is_remote_server) else 0
    has_admin = auth_service.has_admin_users() if (auth_service is not None and is_remote_server) else False
    return {
      "deployment_mode": deployment_mode,
      "auth_required": is_remote_server,
      "allow_registration": _runtime_server_allow_registration() if is_remote_server else False,
      "users_count": users_count,
      "has_admin": has_admin,
    }

  @app.post("/auth/bootstrap")
  def auth_bootstrap(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      raise HTTPException(status_code=409, detail="Bootstrap доступен только в режиме remote_server.")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    body = payload or {}
    username = str(body.get("username") or body.get("login") or "").strip()
    password = str(body.get("password") or "")
    remember = bool(body.get("remember", True))

    try:
      user = auth_service.bootstrap_admin(username=username, password=password)
      login_result = auth_service.login(
        username=user.get("username"),
        password=password,
        remember=remember,
        remote_addr=str(getattr(getattr(request, "client", None), "host", "") or ""),
      )
    except Exception as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    _append_audit_event(
      request=request,
      action="auth.bootstrap",
      target_type="user",
      target_id=str(user.get("id") or ""),
      status="ok",
      details={"username": str(user.get("username") or "")},
    )

    return {
      "ok": True,
      "user": login_result.get("user"),
      "token": login_result.get("token"),
      "token_type": login_result.get("token_type", "bearer"),
      "expires_at": login_result.get("expires_at"),
    }

  @app.post("/auth/register")
  def auth_register(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      raise HTTPException(status_code=409, detail="Регистрация доступна только в remote_server режиме.")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    if not _runtime_server_allow_registration() and auth_service.count_users() > 0:
      raise HTTPException(status_code=403, detail="Регистрация отключена сервером.")

    body = payload or {}
    username = str(body.get("username") or body.get("login") or "").strip()
    password = str(body.get("password") or "")

    try:
      user = auth_service.create_user(username=username, password=password, role="user")
    except Exception as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
      "ok": True,
      "user": user,
    }

  @app.post("/auth/login")
  def auth_login(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      raise HTTPException(status_code=409, detail="Login доступен только в remote_server режиме.")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    body = payload or {}
    username = str(body.get("username") or body.get("login") or "").strip()
    password = str(body.get("password") or "")
    remember = bool(body.get("remember", False))

    try:
      result = auth_service.login(
        username=username,
        password=password,
        remember=remember,
        remote_addr=str(getattr(getattr(request, "client", None), "host", "") or ""),
      )
    except Exception as exc:
      retry_after = int(getattr(exc, "retry_after_seconds", 0) or 0)
      if retry_after > 0:
        raise HTTPException(
          status_code=429,
          detail=str(exc),
          headers={"Retry-After": str(retry_after)},
        ) from exc
      raise HTTPException(status_code=401, detail=str(exc)) from exc

    return {
      "ok": True,
      "token": result.get("token"),
      "token_type": result.get("token_type", "bearer"),
      "expires_at": result.get("expires_at"),
      "user": result.get("user"),
    }

  @app.post("/auth/logout")
  def auth_logout(request: Request) -> dict[str, Any]:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      return {"ok": True}
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    token = _read_bearer_token(request)
    if token:
      auth_service.logout(token)
    return {"ok": True}

  @app.get("/auth/me")
  def auth_me(request: Request) -> dict[str, Any]:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      return {
        "authenticated": False,
        "deployment_mode": _deployment_mode_from_request(request),
      }
    user = _auth_user(request)
    if not user:
      raise HTTPException(status_code=401, detail="Authentication required.")
    return {
      "authenticated": True,
      "user": user,
      "deployment_mode": _deployment_mode_from_request(request),
    }

  @app.get("/admin/users")
  def admin_list_users(request: Request) -> dict[str, Any]:
    _require_remote_server_admin(request, action="Список пользователей")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")
    return {
      "users": auth_service.list_users(),
      "count": auth_service.count_users(),
    }

  @app.post("/admin/users")
  def admin_create_user(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    _require_remote_server_admin(request, action="Создание пользователя")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    body = payload or {}
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    role = str(body.get("role") or "user").strip().lower()
    status = str(body.get("status") or "active").strip().lower()
    permissions = body.get("permissions") if isinstance(body.get("permissions"), dict) else {}

    try:
      user = auth_service.create_user(
        username=username,
        password=password,
        role=role,
        status=status,
        permissions=permissions,
      )
    except Exception as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    _append_audit_event(
      request=request,
      action="admin.users.create",
      target_type="user",
      target_id=str(user.get("id") or ""),
      status="ok",
      details={
        "username": str(user.get("username") or ""),
        "role": str(user.get("role") or ""),
        "status": str(user.get("status") or ""),
      },
    )

    return {
      "ok": True,
      "user": user,
    }

  @app.patch("/admin/users/{user_id}")
  def admin_update_user(user_id: str, request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    _require_remote_server_admin(request, action="Изменение пользователя")
    if auth_service is None:
      raise HTTPException(status_code=500, detail="Auth service is not available.")

    body = payload or {}
    role = body.get("role") if "role" in body else None
    status = body.get("status") if "status" in body else None
    password = body.get("password") if "password" in body else None
    revoke_sessions = bool(body.get("revoke_sessions", False))
    permissions = body.get("permissions") if "permissions" in body else None

    safe_user_id = str(user_id or "").strip()
    existing_user = auth_service.get_user_public(safe_user_id)
    if existing_user is None:
      raise HTTPException(status_code=404, detail="Пользователь не найден.")

    # Prevent removing access from the last admin account.
    if role is not None:
      next_role = str(role or "").strip().lower()
      if str(existing_user.get("role") or "").strip().lower() == "admin" and next_role != "admin" and _admin_count() <= 1:
        raise HTTPException(status_code=409, detail="Нельзя снять роль у последнего администратора.")
    if status is not None:
      next_status = str(status or "").strip().lower()
      if str(existing_user.get("role") or "").strip().lower() == "admin" and next_status == "blocked" and _admin_count() <= 1:
        raise HTTPException(status_code=409, detail="Нельзя блокировать последнего администратора.")

    try:
      user = auth_service.update_user(
        safe_user_id,
        role=role,
        status=status,
        permissions=permissions,
        password=password,
        revoke_sessions=revoke_sessions,
      )
    except Exception as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    _append_audit_event(
      request=request,
      action="admin.users.update",
      target_type="user",
      target_id=safe_user_id,
      status="ok",
      details={
        "role": role,
        "status": status,
        "revoke_sessions": bool(revoke_sessions),
        "password_updated": bool(password),
        "permissions_updated": permissions is not None,
      },
    )

    return {
      "ok": True,
      "user": user,
    }

  @app.get("/admin/audit")
  def admin_audit(
    request: Request,
    limit: int = 200,
    actor_user_id: str = "",
    action_prefix: str = "",
    status: str = "",
  ) -> dict[str, Any]:
    _require_remote_server_admin(request, action="Просмотр аудита")
    if not hasattr(storage, "list_audit_events"):
      raise HTTPException(status_code=500, detail="Audit service is not available.")
    events = storage.list_audit_events(
      limit=limit,
      actor_user_id=actor_user_id,
      action_prefix=action_prefix,
      status=status,
    )
    return {
      "events": events,
      "count": len(events),
    }
