from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response


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

  def _list_plugins_payload() -> dict[str, Any]:
    return plugin_marketplace.list_plugins_payload(autonomous_mode=get_autonomous_mode())

  def _registry_payload() -> dict[str, Any]:
    return plugin_marketplace.build_registry_plugins_payload(autonomous_mode=get_autonomous_mode())

  @app.get("/plugins")
  def list_plugins() -> dict[str, Any]:
    return _list_plugins_payload()

  @app.get("/plugins/registry")
  def plugins_registry() -> dict[str, Any]:
    return _registry_payload()

  @app.patch("/plugins/registry")
  def update_plugins_registry(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    registry_url_input = str(
      body.get("registry_url")
      or body.get("registryUrl")
      or body.get("url")
      or "",
    ).strip()

    if not registry_url_input:
      storage.set_setting(plugin_registry_url_setting_key, default_plugin_registry_url)
      return _registry_payload()

    try:
      normalized_registry_url = plugin_marketplace.normalize_http_url(registry_url_input)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    storage.set_setting(plugin_registry_url_setting_key, normalized_registry_url)
    return _registry_payload()

  @app.post("/plugins/install")
  def install_plugin(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    autonomous_mode = get_autonomous_mode()
    try:
      installed_manifest = plugin_marketplace.install_plugin(body, autonomous_mode=autonomous_mode)
      _refresh_plugins_and_tools()
    except Exception as exc:
      raise _to_http_error(exc) from exc

    safe_plugin_id = plugin_marketplace.sanitize_plugin_id(installed_manifest.get("id"))
    plugins_payload = _list_plugins_payload()
    plugin = next(
      (
        item for item in (plugins_payload.get("plugins") or [])
        if isinstance(item, dict) and plugin_marketplace.sanitize_plugin_id(item.get("id")) == safe_plugin_id
      ),
      None,
    )
    if plugin is None:
      raise HTTPException(status_code=500, detail="Плагин установлен, но не найден после перезагрузки.")

    return {
      "plugin": plugin,
      "plugins": plugins_payload,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
      "status": "installed",
      "message": f"Плагин '{safe_plugin_id}' установлен.",
    }

  @app.delete("/plugins/{plugin_id}/uninstall")
  def uninstall_plugin(plugin_id: str) -> dict[str, Any]:
    try:
      result = plugin_marketplace.uninstall_plugin(plugin_id)
      _refresh_plugins_and_tools()
    except Exception as exc:
      raise _to_http_error(exc) from exc

    plugins_payload = _list_plugins_payload()
    return {
      "ok": True,
      **result,
      "plugins": plugins_payload,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
    }

  @app.post("/plugins/{plugin_id}/enable")
  def enable_plugin(plugin_id: str) -> dict[str, Any]:
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, True)
      _refresh_plugins_and_tools()
    except KeyError as exc:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    return {
      "plugin": plugin_marketplace.serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/disable")
  def disable_plugin(plugin_id: str) -> dict[str, Any]:
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, False)
      _refresh_plugins_and_tools()
    except KeyError as exc:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    return {
      "plugin": plugin_marketplace.serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/update")
  def update_plugin(plugin_id: str) -> dict[str, Any]:
    autonomous_mode = get_autonomous_mode()
    try:
      plugin_payload = plugin_marketplace.update_plugin(plugin_id, autonomous_mode=autonomous_mode)
      _refresh_plugins_and_tools()
    except Exception as exc:
      raise _to_http_error(exc) from exc

    return {
      "plugin": plugin_payload,
      "status": "updated",
      "message": f"Plugin '{plugin_payload.get('id')}' synced successfully",
      "autonomous_mode": autonomous_mode,
    }

  @app.get("/plugins/ui/extensions")
  def list_plugin_ui_extensions() -> dict[str, Any]:
    autonomous_mode = get_autonomous_mode()
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
          if autonomous_mode and ext_url.lower().startswith(("http://", "https://")):
            continue
          resolved_url = ext_url

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
