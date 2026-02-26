from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response

try:
  from backend.access_control import user_can_download_plugins
  from backend.deployment import DEPLOYMENT_MODE_REMOTE_SERVER
  from backend.plugin_permissions import (
    DEFAULT_DOMAIN_PERMISSION_POLICY,
    DEFAULT_PLUGIN_PERMISSION_POLICY,
    VALID_PLUGIN_PERMISSION_POLICIES,
    build_effective_domain_permissions,
    build_effective_plugin_permissions,
    build_effective_tool_permissions,
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
    read_domain_default_policy,
    read_domain_permissions,
    read_plugin_permissions,
    read_tool_permissions,
    write_domain_default_policy,
    write_domain_permissions,
    write_plugin_permissions,
    write_tool_permissions,
  )
except ModuleNotFoundError:
  from access_control import user_can_download_plugins  # type: ignore
  from deployment import DEPLOYMENT_MODE_REMOTE_SERVER  # type: ignore
  from plugin_permissions import (  # type: ignore
    DEFAULT_DOMAIN_PERMISSION_POLICY,
    DEFAULT_PLUGIN_PERMISSION_POLICY,
    VALID_PLUGIN_PERMISSION_POLICIES,
    build_effective_domain_permissions,
    build_effective_plugin_permissions,
    build_effective_tool_permissions,
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
    read_domain_default_policy,
    read_domain_permissions,
    read_plugin_permissions,
    read_tool_permissions,
    write_domain_default_policy,
    write_domain_permissions,
    write_plugin_permissions,
    write_tool_permissions,
  )


def register_plugin_routes(
  app: FastAPI,
  *,
  storage: Any,
  plugin_manager: Any,
  plugin_marketplace: Any,
  plugin_registry_url_setting_key: str,
  default_plugin_registry_url: str,
  get_autonomous_mode: Callable[[], bool],
  refresh_tool_registry_fn: Callable[[], None] | None = None,
) -> None:
  def _deployment_mode_from_request(request: Request | None = None) -> str:
    if request is None:
      return ""
    return str(getattr(request.state, "deployment_mode", "") or "").strip().lower()

  def _auth_payload(request: Request | None = None) -> dict[str, Any]:
    if request is None:
      return {}
    payload = getattr(request.state, "auth", None)
    return payload if isinstance(payload, dict) else {}

  def _auth_user(request: Request | None = None) -> dict[str, Any]:
    payload = _auth_payload(request)
    user = payload.get("user")
    return user if isinstance(user, dict) else {}

  def _is_admin_user(request: Request | None = None) -> bool:
    user = _auth_user(request)
    role = str(user.get("role") or "user").strip().lower()
    return role == "admin"

  def _resolve_owner_user_id(request: Request | None = None) -> str:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      return ""
    user = _auth_user(request)
    return str(user.get("id") or "").strip()

  def _require_admin_if_remote(request: Request) -> None:
    if _deployment_mode_from_request(request) == DEPLOYMENT_MODE_REMOTE_SERVER and not _is_admin_user(request):
      raise HTTPException(status_code=403, detail="Admin access required.")

  def _require_plugin_download_access_if_remote(
    request: Request,
    *,
    action: str,
    target_id: str = "",
  ) -> None:
    if _deployment_mode_from_request(request) != DEPLOYMENT_MODE_REMOTE_SERVER:
      return
    if user_can_download_plugins(_auth_user(request)):
      return
    _append_audit_event(
      request=request,
      action=action,
      target_type="plugin",
      target_id=target_id,
      status="denied",
      details={"reason": "plugins_download_permission_required"},
    )
    raise HTTPException(
      status_code=403,
      detail="Недостаточно прав: загрузка и обновление плагинов запрещены для этого аккаунта.",
    )

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
    user = _auth_user(request)
    ip_address = str(getattr(getattr(request, "client", None), "host", "") or "") if request is not None else ""
    try:
      storage.append_audit_event(
        actor_user_id=str(user.get("id") or ""),
        actor_username=str(user.get("username") or ""),
        actor_role=str(user.get("role") or ""),
        action=action,
        target_type=target_type,
        target_id=target_id,
        status=status,
        details=details if isinstance(details, dict) else {},
        ip_address=ip_address,
      )
    except Exception:
      return

  def _sanitize_plugin_id(value: Any) -> str:
    if hasattr(plugin_marketplace, "sanitize_plugin_id"):
      return str(plugin_marketplace.sanitize_plugin_id(value) or "").strip().lower()
    return str(value or "").strip().lower()

  def _list_installed_plugin_ids() -> list[str]:
    plugin_manager.reload()
    ids: list[str] = []
    for plugin in plugin_manager.list_plugins():
      plugin_id = _sanitize_plugin_id(getattr(plugin, "id", ""))
      if plugin_id:
        ids.append(plugin_id)
    return sorted(set(ids))

  def _sanitize_tool_name(value: Any) -> str:
    safe_value = str(value or "").strip().lower()
    if not safe_value:
      return ""
    return safe_value

  def _build_tool_key(plugin_id: Any, tool_name: Any) -> str:
    safe_plugin_id = _sanitize_plugin_id(plugin_id)
    safe_tool_name = _sanitize_tool_name(tool_name)
    if not safe_plugin_id or not safe_tool_name:
      return ""
    return f"{safe_plugin_id}::{safe_tool_name}"

  def _list_installed_tools() -> list[dict[str, str]]:
    plugin_manager.reload()
    tools: list[dict[str, str]] = []
    for plugin in plugin_manager.list_plugins():
      plugin_id = _sanitize_plugin_id(getattr(plugin, "id", ""))
      if not plugin_id:
        continue
      raw_tools = list(getattr(plugin, "tools", []) or [])
      for tool_name in raw_tools:
        safe_tool_name = _sanitize_tool_name(tool_name)
        if not safe_tool_name:
          continue
        tools.append(
          {
            "plugin_id": plugin_id,
            "tool_name": safe_tool_name,
            "tool_key": f"{plugin_id}::{safe_tool_name}",
          }
        )
    tools.sort(key=lambda item: (item["plugin_id"], item["tool_name"]))
    return tools

  def _read_plugin_permission_map(owner_user_id: str = "") -> dict[str, str]:
    return read_plugin_permissions(
      storage,
      sanitize_plugin_id=_sanitize_plugin_id,
      owner_user_id=owner_user_id,
    )

  def _write_plugin_permission_map(policies: Any, owner_user_id: str = "") -> dict[str, str]:
    return write_plugin_permissions(
      storage,
      policies,
      sanitize_plugin_id=_sanitize_plugin_id,
      owner_user_id=owner_user_id,
    )

  def _read_tool_permission_map(owner_user_id: str = "") -> dict[str, str]:
    return read_tool_permissions(
      storage,
      sanitize_plugin_id=_sanitize_plugin_id,
      sanitize_tool_name=_sanitize_tool_name,
      owner_user_id=owner_user_id,
    )

  def _write_tool_permission_map(policies: Any, owner_user_id: str = "") -> dict[str, str]:
    return write_tool_permissions(
      storage,
      policies,
      sanitize_plugin_id=_sanitize_plugin_id,
      sanitize_tool_name=_sanitize_tool_name,
      owner_user_id=owner_user_id,
    )

  def _read_domain_permission_map(owner_user_id: str = "") -> dict[str, str]:
    return read_domain_permissions(storage, owner_user_id=owner_user_id)

  def _write_domain_permission_map(policies: Any, owner_user_id: str = "") -> dict[str, str]:
    return write_domain_permissions(storage, policies, owner_user_id=owner_user_id)

  def _read_domain_default_policy(owner_user_id: str = "") -> str:
    return read_domain_default_policy(storage, owner_user_id=owner_user_id)

  def _write_domain_default_policy(policy: Any, owner_user_id: str = "") -> str:
    return write_domain_default_policy(storage, policy, owner_user_id=owner_user_id)

  def _build_permissions_payload(owner_user_id: str = "") -> dict[str, Any]:
    installed_plugin_ids = _list_installed_plugin_ids()
    installed_tools = _list_installed_tools()
    installed_tool_keys = [item["tool_key"] for item in installed_tools]
    stored_policies = _read_plugin_permission_map(owner_user_id)
    effective_policies = build_effective_plugin_permissions(
      installed_plugin_ids,
      stored_policies,
      sanitize_plugin_id=_sanitize_plugin_id,
    )
    stored_tool_policies = _read_tool_permission_map(owner_user_id)
    effective_tool_policies = build_effective_tool_permissions(
      installed_tool_keys,
      stored_tool_policies,
      plugin_policy_map=effective_policies,
      sanitize_plugin_id=_sanitize_plugin_id,
      sanitize_tool_name=_sanitize_tool_name,
    )
    stored_domain_policies = _read_domain_permission_map(owner_user_id)
    effective_domain_policies = build_effective_domain_permissions(
      list(stored_domain_policies.keys()),
      stored_domain_policies,
    )
    domain_default_policy = normalize_domain_default_policy(
      _read_domain_default_policy(owner_user_id),
      DEFAULT_DOMAIN_PERMISSION_POLICY,
    )
    return {
      "default_policy": DEFAULT_PLUGIN_PERMISSION_POLICY,
      "valid_policies": sorted(VALID_PLUGIN_PERMISSION_POLICIES),
      "policies": effective_policies,
      "stored_policies": stored_policies,
      "tool_policies": effective_tool_policies,
      "stored_tool_policies": stored_tool_policies,
      "domain_policies": effective_domain_policies,
      "stored_domain_policies": stored_domain_policies,
      "domain_default_policy": domain_default_policy,
      "default_domain_policy": domain_default_policy,
      "tools": installed_tools,
      "plugins_total": len(installed_plugin_ids),
      "tools_total": len(installed_tool_keys),
    }

  def _inject_permissions_into_plugins_payload(payload: dict[str, Any], owner_user_id: str = "") -> dict[str, Any]:
    if not isinstance(payload, dict):
      return payload
    plugins = payload.get("plugins")
    if not isinstance(plugins, list):
      return payload
    policy_map = _read_plugin_permission_map(owner_user_id)
    tool_policy_map = _read_tool_permission_map(owner_user_id)
    domain_policy_map = _read_domain_permission_map(owner_user_id)
    installed_plugin_ids = [
      _sanitize_plugin_id(item.get("id"))
      for item in plugins
      if isinstance(item, dict)
    ]
    effective = build_effective_plugin_permissions(
      installed_plugin_ids,
      policy_map,
      sanitize_plugin_id=_sanitize_plugin_id,
    )
    for item in plugins:
      if not isinstance(item, dict):
        continue
      plugin_id = _sanitize_plugin_id(item.get("id"))
      policy = normalize_plugin_permission_policy(
        effective.get(plugin_id, DEFAULT_PLUGIN_PERMISSION_POLICY),
        DEFAULT_PLUGIN_PERMISSION_POLICY,
      )
      item["permission_policy"] = policy
      raw_tools = list(item.get("tools") or [])
      tool_policies: dict[str, str] = {}
      for tool_name in raw_tools:
        tool_key = _build_tool_key(plugin_id, tool_name)
        if not tool_key:
          continue
        tool_policies[str(tool_name).strip().lower()] = normalize_plugin_permission_policy(
          tool_policy_map.get(tool_key, policy),
          policy,
        )
      item["tool_permission_policies"] = tool_policies
    payload["plugin_permission_default"] = DEFAULT_PLUGIN_PERMISSION_POLICY
    payload["plugin_permission_policies"] = effective
    payload["plugin_tool_permission_policies"] = build_effective_tool_permissions(
      list(tool_policy_map.keys()),
      tool_policy_map,
      plugin_policy_map=effective,
      sanitize_plugin_id=_sanitize_plugin_id,
      sanitize_tool_name=_sanitize_tool_name,
    )
    payload["plugin_domain_permission_policies"] = build_effective_domain_permissions(
      list(domain_policy_map.keys()),
      domain_policy_map,
    )
    payload["plugin_domain_default_policy"] = normalize_domain_default_policy(
      _read_domain_default_policy(owner_user_id),
      DEFAULT_DOMAIN_PERMISSION_POLICY,
    )
    return payload

  def _refresh_plugins_and_tools() -> None:
    if callable(refresh_tool_registry_fn):
      refresh_tool_registry_fn()
    else:
      plugin_manager.reload()

  def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError):
      return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
      return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, ValueError):
      if "автономный режим" in str(exc).strip().lower():
        return HTTPException(status_code=409, detail=str(exc))
      return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError):
      return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))

  def _list_plugins_payload(owner_user_id: str = "") -> dict[str, Any]:
    payload = plugin_marketplace.list_plugins_payload(autonomous_mode=get_autonomous_mode())
    return _inject_permissions_into_plugins_payload(payload, owner_user_id)

  def _registry_payload(owner_user_id: str = "") -> dict[str, Any]:
    payload = plugin_marketplace.build_registry_plugins_payload(autonomous_mode=get_autonomous_mode())
    return _inject_permissions_into_plugins_payload(payload, owner_user_id)

  @app.get("/plugins")
  def list_plugins(request: Request) -> dict[str, Any]:
    owner_user_id = _resolve_owner_user_id(request)
    return _list_plugins_payload(owner_user_id)

  @app.get("/plugins/permissions")
  def get_plugin_permissions(request: Request) -> dict[str, Any]:
    owner_user_id = _resolve_owner_user_id(request)
    return _build_permissions_payload(owner_user_id)

  @app.patch("/plugins/permissions")
  def update_plugin_permissions(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    owner_user_id = _resolve_owner_user_id(request)
    body = payload or {}
    current_plugin = _read_plugin_permission_map(owner_user_id)
    current_tool = _read_tool_permission_map(owner_user_id)
    current_domain = _read_domain_permission_map(owner_user_id)
    installed_plugin_ids = set(_list_installed_plugin_ids())
    installed_tool_keys = {item["tool_key"] for item in _list_installed_tools()}
    updates_raw = body.get("policies")
    updates: dict[str, str] = {}
    tool_updates: dict[str, str] = {}
    domain_updates: dict[str, str] = {}
    domain_removals: set[str] = set()
    domain_default_policy = ""

    if isinstance(updates_raw, dict):
      for raw_plugin_id, raw_policy in updates_raw.items():
        plugin_id = _sanitize_plugin_id(raw_plugin_id)
        if not plugin_id:
          continue
        if plugin_id not in installed_plugin_ids:
          raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found")
        updates[plugin_id] = normalize_plugin_permission_policy(raw_policy)

    single_plugin_id = _sanitize_plugin_id(
      body.get("plugin_id")
      or body.get("pluginId")
      or body.get("id"),
    )
    if single_plugin_id:
      if single_plugin_id not in installed_plugin_ids:
        raise HTTPException(status_code=404, detail=f"Plugin '{single_plugin_id}' not found")
      updates[single_plugin_id] = normalize_plugin_permission_policy(
        body.get("policy"),
        DEFAULT_PLUGIN_PERMISSION_POLICY,
      )

    tool_updates_raw = body.get("tool_policies")
    if isinstance(tool_updates_raw, dict):
      for raw_tool_key, raw_policy in tool_updates_raw.items():
        tool_key = _build_tool_key(*str(raw_tool_key or "").split("::", 1)) if "::" in str(raw_tool_key or "") else ""
        if not tool_key:
          continue
        if tool_key not in installed_tool_keys:
          raise HTTPException(status_code=404, detail=f"Tool '{tool_key}' not found")
        tool_updates[tool_key] = normalize_plugin_permission_policy(
          raw_policy,
          DEFAULT_PLUGIN_PERMISSION_POLICY,
        )

    single_tool_plugin_id = _sanitize_plugin_id(
      body.get("tool_plugin_id")
      or body.get("toolPluginId")
      or body.get("plugin_id"),
    )
    single_tool_name = _sanitize_tool_name(
      body.get("tool_name")
      or body.get("toolName"),
    )
    if single_tool_plugin_id and single_tool_name:
      single_tool_key = _build_tool_key(single_tool_plugin_id, single_tool_name)
      if single_tool_key not in installed_tool_keys:
        raise HTTPException(status_code=404, detail=f"Tool '{single_tool_key}' not found")
      tool_updates[single_tool_key] = normalize_plugin_permission_policy(
        body.get("tool_policy") or body.get("policy"),
        DEFAULT_PLUGIN_PERMISSION_POLICY,
      )

    domain_updates_raw = body.get("domain_policies")
    if isinstance(domain_updates_raw, dict):
      for raw_domain, raw_policy in domain_updates_raw.items():
        domain = normalize_domain_key(raw_domain)
        if not domain:
          continue
        domain_updates[domain] = normalize_plugin_permission_policy(
          raw_policy,
          DEFAULT_PLUGIN_PERMISSION_POLICY,
        )

    domain_remove_raw = body.get("domain_policy_remove") or body.get("domainPolicyRemove") or []
    if isinstance(domain_remove_raw, (list, tuple, set)):
      for raw_domain in domain_remove_raw:
        domain = normalize_domain_key(raw_domain)
        if domain:
          domain_removals.add(domain)

    single_domain = normalize_domain_key(
      body.get("domain")
      or body.get("domain_name")
      or body.get("domainName"),
    )
    if single_domain:
      if bool(body.get("remove_domain_policy") or body.get("removeDomainPolicy")):
        domain_removals.add(single_domain)
      else:
        domain_updates[single_domain] = normalize_plugin_permission_policy(
          body.get("domain_policy") or body.get("policy"),
          DEFAULT_PLUGIN_PERMISSION_POLICY,
        )

    domain_default_raw = (
      body.get("domain_default_policy")
      or body.get("domainDefaultPolicy")
      or body.get("default_domain_policy")
      or body.get("defaultDomainPolicy")
      or body.get("unknown_domain_policy")
      or body.get("unknownDomainPolicy")
      or ""
    )
    if str(domain_default_raw).strip():
      domain_default_policy = normalize_domain_default_policy(
        domain_default_raw,
        DEFAULT_DOMAIN_PERMISSION_POLICY,
      )

    if not updates and not tool_updates and not domain_updates and not domain_removals and not domain_default_policy:
      raise HTTPException(status_code=400, detail="No permission updates provided")

    if updates:
      merged_plugin = {**current_plugin, **updates}
      _write_plugin_permission_map(merged_plugin, owner_user_id)
    if tool_updates:
      merged_tool = {**current_tool, **tool_updates}
      _write_tool_permission_map(merged_tool, owner_user_id)
    if domain_updates or domain_removals:
      merged_domain = {**current_domain, **domain_updates}
      for domain in domain_removals:
        merged_domain.pop(domain, None)
      _write_domain_permission_map(merged_domain, owner_user_id)
    if domain_default_policy:
      _write_domain_default_policy(domain_default_policy, owner_user_id)
    _append_audit_event(
      request=request,
      action="plugins.permissions.update",
      target_type="plugin_permissions",
      target_id=owner_user_id or "global",
      status="ok",
      details={
        "plugin_updates": len(updates),
        "tool_updates": len(tool_updates),
        "domain_updates": len(domain_updates),
        "domain_removals": len(domain_removals),
        "domain_default_updated": bool(domain_default_policy),
      },
    )
    return _build_permissions_payload(owner_user_id)

  @app.get("/plugins/registry")
  def plugins_registry(request: Request) -> dict[str, Any]:
    owner_user_id = _resolve_owner_user_id(request)
    return _registry_payload(owner_user_id)

  @app.patch("/plugins/registry")
  def update_plugins_registry(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    _require_admin_if_remote(request)
    owner_user_id = _resolve_owner_user_id(request)
    body = payload or {}
    registry_url_input = str(
      body.get("registry_url")
      or body.get("registryUrl")
      or body.get("url")
      or "",
    ).strip()

    if not registry_url_input:
      storage.set_setting(plugin_registry_url_setting_key, default_plugin_registry_url)
      _append_audit_event(
        request=request,
        action="plugins.registry.update",
        target_type="plugin_registry",
        target_id="default",
        status="ok",
        details={"registry_url": default_plugin_registry_url},
      )
      return _registry_payload(owner_user_id)

    try:
      normalized_registry_url = plugin_marketplace.normalize_http_url(registry_url_input)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    storage.set_setting(plugin_registry_url_setting_key, normalized_registry_url)
    _append_audit_event(
      request=request,
      action="plugins.registry.update",
      target_type="plugin_registry",
      target_id="custom",
      status="ok",
      details={"registry_url": normalized_registry_url},
    )
    return _registry_payload(owner_user_id)

  @app.post("/plugins/install")
  def install_plugin(request: Request, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    _require_plugin_download_access_if_remote(
      request,
      action="plugins.install",
      target_id=str((payload or {}).get("id") or (payload or {}).get("plugin_id") or ""),
    )
    owner_user_id = _resolve_owner_user_id(request)
    body = payload or {}
    autonomous_mode = get_autonomous_mode()
    try:
      installed_manifest = plugin_marketplace.install_plugin(body, autonomous_mode=autonomous_mode)
      _refresh_plugins_and_tools()
    except Exception as exc:
      http_exc = _to_http_error(exc)
      _append_audit_event(
        request=request,
        action="plugins.install",
        target_type="plugin",
        target_id=str(body.get("id") or body.get("plugin_id") or ""),
        status="error",
        details={"detail": str(http_exc.detail)},
      )
      raise http_exc from exc

    safe_plugin_id = plugin_marketplace.sanitize_plugin_id(installed_manifest.get("id"))
    plugins_payload = _list_plugins_payload(owner_user_id)
    plugin = next(
      (
        item for item in (plugins_payload.get("plugins") or [])
        if isinstance(item, dict) and plugin_marketplace.sanitize_plugin_id(item.get("id")) == safe_plugin_id
      ),
      None,
    )
    if plugin is None:
      raise HTTPException(status_code=500, detail="Плагин установлен, но не найден после перезагрузки.")

    _append_audit_event(
      request=request,
      action="plugins.install",
      target_type="plugin",
      target_id=safe_plugin_id,
      status="ok",
      details={"autonomous_mode": bool(plugins_payload.get("autonomous_mode"))},
    )
    return {
      "plugin": plugin,
      "plugins": plugins_payload,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
      "status": "installed",
      "message": f"Плагин '{safe_plugin_id}' установлен.",
    }

  @app.delete("/plugins/{plugin_id}/uninstall")
  def uninstall_plugin(plugin_id: str, request: Request) -> dict[str, Any]:
    _require_plugin_download_access_if_remote(
      request,
      action="plugins.uninstall",
      target_id=str(plugin_id or ""),
    )
    owner_user_id = _resolve_owner_user_id(request)
    try:
      result = plugin_marketplace.uninstall_plugin(plugin_id)
      _refresh_plugins_and_tools()
    except Exception as exc:
      http_exc = _to_http_error(exc)
      _append_audit_event(
        request=request,
        action="plugins.uninstall",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="error",
        details={"detail": str(http_exc.detail)},
      )
      raise http_exc from exc

    plugins_payload = _list_plugins_payload(owner_user_id)
    _append_audit_event(
      request=request,
      action="plugins.uninstall",
      target_type="plugin",
      target_id=str(plugin_id or ""),
      status="ok",
      details={"result": result},
    )
    return {
      "ok": True,
      **result,
      "plugins": plugins_payload,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
    }

  @app.post("/plugins/{plugin_id}/enable")
  def enable_plugin(plugin_id: str, request: Request) -> dict[str, Any]:
    _require_admin_if_remote(request)
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, True)
      _refresh_plugins_and_tools()
    except KeyError as exc:
      _append_audit_event(
        request=request,
        action="plugins.enable",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="error",
        details={"detail": f"Plugin '{plugin_id}' not found"},
      )
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      _append_audit_event(
        request=request,
        action="plugins.enable",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="denied",
        details={"detail": str(exc)},
      )
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    _append_audit_event(
      request=request,
      action="plugins.enable",
      target_type="plugin",
      target_id=str(plugin_id or ""),
      status="ok",
      details={"autonomous_mode": autonomous_mode},
    )
    return {
      "plugin": plugin_marketplace.serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/disable")
  def disable_plugin(plugin_id: str, request: Request) -> dict[str, Any]:
    _require_admin_if_remote(request)
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, False)
      _refresh_plugins_and_tools()
    except KeyError as exc:
      _append_audit_event(
        request=request,
        action="plugins.disable",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="error",
        details={"detail": f"Plugin '{plugin_id}' not found"},
      )
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      _append_audit_event(
        request=request,
        action="plugins.disable",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="denied",
        details={"detail": str(exc)},
      )
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    _append_audit_event(
      request=request,
      action="plugins.disable",
      target_type="plugin",
      target_id=str(plugin_id or ""),
      status="ok",
      details={"autonomous_mode": autonomous_mode},
    )
    return {
      "plugin": plugin_marketplace.serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/update")
  def update_plugin(plugin_id: str, request: Request) -> dict[str, Any]:
    _require_plugin_download_access_if_remote(
      request,
      action="plugins.update",
      target_id=str(plugin_id or ""),
    )
    autonomous_mode = get_autonomous_mode()
    try:
      plugin_payload = plugin_marketplace.update_plugin(plugin_id, autonomous_mode=autonomous_mode)
      _refresh_plugins_and_tools()
    except Exception as exc:
      http_exc = _to_http_error(exc)
      _append_audit_event(
        request=request,
        action="plugins.update",
        target_type="plugin",
        target_id=str(plugin_id or ""),
        status="error",
        details={"detail": str(http_exc.detail)},
      )
      raise http_exc from exc

    _append_audit_event(
      request=request,
      action="plugins.update",
      target_type="plugin",
      target_id=str(plugin_id or ""),
      status="ok",
      details={"plugin_id": str(plugin_payload.get("id") or "")},
    )
    return {
      "plugin": plugin_payload,
      "status": "updated",
      "message": f"Plugin '{plugin_payload.get('id')}' synced successfully",
      "autonomous_mode": autonomous_mode,
    }

  @app.get("/plugins/ui/extensions")
  def list_plugin_ui_extensions() -> dict[str, Any]:
    autonomous_mode = get_autonomous_mode()
    allow_remote_ui_extensions = str(os.getenv("ANCIA_ALLOW_REMOTE_UI_EXTENSIONS", "") or "").strip() == "1"
    plugin_manager.reload()

    extensions: list[dict[str, Any]] = []
    for plugin in plugin_manager.list_plugins():
      plugin_id = plugin_marketplace.sanitize_plugin_id(getattr(plugin, "id", ""))
      if not plugin_id:
        continue
      if not bool(getattr(plugin, "enabled", True)):
        continue
      requires_network = bool(getattr(plugin, "requires_network", False))
      if autonomous_mode and requires_network:
        continue
      raw_extensions = list(getattr(plugin, "ui_extensions", []) or [])
      plugin_dir = Path(str(getattr(plugin, "plugin_dir", "") or "")).resolve()
      for entry in raw_extensions:
        if not isinstance(entry, dict):
          continue
        ext_type = str(entry.get("type") or "").strip().lower()
        if ext_type not in {"script", "style"}:
          continue
        load_mode = str(entry.get("load") or ("module" if ext_type == "script" else "style")).strip().lower()
        rel_path = str(entry.get("path") or "").strip()
        ext_url = str(entry.get("url") or "").strip()

        resolved_url = ""
        if rel_path:
          rel = Path(rel_path)
          rel_parts = rel.parts
          if rel_parts and ".." not in rel_parts and not rel.is_absolute() and plugin_dir.exists():
            target = (plugin_dir / rel).resolve()
            if plugin_dir not in target.parents or not target.exists() or not target.is_file():
              continue
            encoded_path = "/".join(quote(part) for part in rel_parts)
            resolved_url = f"/plugins/assets/{quote(plugin_id)}/{encoded_path}"
        elif ext_url:
          if not allow_remote_ui_extensions:
            continue
          if autonomous_mode and ext_url.lower().startswith(("http://", "https://")):
            continue
          try:
            resolved_url = plugin_marketplace.normalize_http_url(ext_url)
          except Exception:
            continue

        if not resolved_url:
          continue
        extensions.append(
          {
            "plugin_id": plugin_id,
            "type": ext_type,
            "load": load_mode,
            "url": resolved_url,
          }
        )

    return {
      "extensions": extensions,
      "autonomous_mode": autonomous_mode,
      "count": len(extensions),
    }

  @app.get("/plugins/assets/{plugin_id}/{asset_path:path}")
  def get_plugin_asset(plugin_id: str, asset_path: str) -> Response:
    safe_plugin_id = plugin_marketplace.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise HTTPException(status_code=400, detail="Некорректный id плагина.")

    plugin_manager.reload()
    plugin = plugin_manager.get_plugin(safe_plugin_id)
    if plugin is None:
      raise HTTPException(status_code=404, detail=f"Plugin '{safe_plugin_id}' not found")

    plugin_dir = Path(str(getattr(plugin, "plugin_dir", "") or "")).resolve()
    if not plugin_dir.exists() or not plugin_dir.is_dir():
      raise HTTPException(status_code=404, detail="Каталог плагина не найден.")

    rel = Path(str(asset_path or "").strip())
    if not rel.parts or rel.is_absolute() or ".." in rel.parts:
      raise HTTPException(status_code=400, detail="Некорректный путь ресурса.")

    target = (plugin_dir / rel).resolve()
    if plugin_dir not in target.parents or not target.exists() or not target.is_file():
      raise HTTPException(status_code=404, detail="Ресурс плагина не найден.")

    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    try:
      body = target.read_bytes()
    except FileNotFoundError as exc:
      raise HTTPException(status_code=404, detail="Ресурс плагина не найден.") from exc
    except OSError as exc:
      raise HTTPException(status_code=500, detail=f"Не удалось прочитать ресурс плагина: {exc}") from exc

    return Response(content=body, media_type=media_type)
