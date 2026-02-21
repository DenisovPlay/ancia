from __future__ import annotations

from typing import Any, Callable

from fastapi import FastAPI, HTTPException


def register_plugin_routes(
  app: FastAPI,
  *,
  storage: Any,
  plugin_manager: Any,
  plugin_registry_url_setting_key: str,
  default_plugin_registry_url: str,
  max_manifest_download_bytes: int,
  builtin_plugin_ids: set[str],
  get_autonomous_mode: Callable[[], bool],
  sanitize_plugin_id: Callable[[Any], str],
  normalize_http_url: Callable[[Any], str],
  fetch_remote_json: Callable[..., Any],
  resolve_user_plugin_manifest_path: Callable[[str], Any],
  serialize_plugin: Callable[..., dict[str, Any]],
  list_plugins_payload: Callable[[], dict[str, Any]],
  build_registry_plugins_payload: Callable[[], dict[str, Any]],
  normalize_install_manifest: Callable[[Any], dict[str, Any]],
  write_user_manifest: Callable[[str, dict[str, Any]], None],
) -> None:
  @app.get("/plugins")
  def list_plugins() -> dict[str, Any]:
    return list_plugins_payload()

  @app.get("/plugins/registry")
  def plugins_registry() -> dict[str, Any]:
    return build_registry_plugins_payload()

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
      return build_registry_plugins_payload()

    try:
      normalized_registry_url = normalize_http_url(registry_url_input)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    storage.set_setting(plugin_registry_url_setting_key, normalized_registry_url)
    return build_registry_plugins_payload()

  @app.post("/plugins/install")
  def install_plugin(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    if get_autonomous_mode():
      raise HTTPException(
        status_code=409,
        detail="Автономный режим включен: установка плагинов из внешнего реестра недоступна.",
      )

    body = payload or {}
    requested_plugin_id = sanitize_plugin_id(
      body.get("id")
      or body.get("plugin_id")
      or body.get("pluginId"),
    )
    requested_manifest_url = str(
      body.get("manifest_url")
      or body.get("manifestUrl")
      or "",
    ).strip()

    if requested_plugin_id and requested_plugin_id in builtin_plugin_ids:
      raise HTTPException(
        status_code=409,
        detail="Встроенные плагины уже установлены и обновляются без переустановки.",
      )

    manifest_url = ""
    if requested_manifest_url:
      try:
        manifest_url = normalize_http_url(requested_manifest_url)
      except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    elif requested_plugin_id:
      registry_payload = build_registry_plugins_payload()
      registry_plugins = registry_payload.get("plugins")
      if not isinstance(registry_plugins, list):
        registry_plugins = []
      match = next(
        (
          item for item in registry_plugins
          if isinstance(item, dict) and sanitize_plugin_id(item.get("id")) == requested_plugin_id
        ),
        None,
      )
      if match is None:
        raise HTTPException(
          status_code=404,
          detail=f"Плагин '{requested_plugin_id}' не найден в реестре.",
        )
      manifest_url = str(match.get("manifest_url") or "").strip()
    else:
      raise HTTPException(status_code=400, detail="Требуется id или manifest_url для установки.")

    if not manifest_url:
      raise HTTPException(
        status_code=400,
        detail="Для выбранного плагина не указан manifest_url в реестре.",
      )

    try:
      manifest_payload = fetch_remote_json(
        manifest_url,
        max_bytes=max_manifest_download_bytes,
      )
    except RuntimeError as exc:
      raise HTTPException(status_code=502, detail=str(exc)) from exc

    try:
      normalized_manifest = normalize_install_manifest(manifest_payload)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    installed_plugin_id = sanitize_plugin_id(normalized_manifest.get("id"))
    if requested_plugin_id and installed_plugin_id != requested_plugin_id:
      raise HTTPException(
        status_code=409,
        detail=(
          f"ID плагина из манифеста ('{installed_plugin_id}') не совпадает "
          f"с запрошенным ('{requested_plugin_id}')."
        ),
      )
    if installed_plugin_id in builtin_plugin_ids:
      raise HTTPException(
        status_code=409,
        detail="Нельзя установить поверх встроенного плагина.",
      )

    normalized_manifest["manifest_url"] = manifest_url
    write_user_manifest(installed_plugin_id, normalized_manifest)
    storage.remove_plugin_state(installed_plugin_id)
    plugin_manager.reload()

    plugins_payload = list_plugins_payload()
    plugin = next(
      (
        item for item in (plugins_payload.get("plugins") or [])
        if isinstance(item, dict) and sanitize_plugin_id(item.get("id")) == installed_plugin_id
      ),
      None,
    )
    if plugin is None:
      raise HTTPException(status_code=500, detail="Плагин установлен, но не удалось перечитать каталог.")

    return {
      "plugin": plugin,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
      "plugins": plugins_payload,
      "status": "installed",
      "message": f"Плагин '{installed_plugin_id}' установлен.",
    }

  @app.delete("/plugins/{plugin_id}/uninstall")
  def uninstall_plugin(plugin_id: str) -> dict[str, Any]:
    safe_plugin_id = sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise HTTPException(status_code=400, detail="Некорректный id плагина.")
    if safe_plugin_id in builtin_plugin_ids:
      raise HTTPException(
        status_code=409,
        detail="Встроенные плагины нельзя удалить.",
      )

    manifest_path = resolve_user_plugin_manifest_path(safe_plugin_id)
    if manifest_path is None:
      raise HTTPException(status_code=404, detail=f"Плагин '{safe_plugin_id}' не установлен.")

    try:
      manifest_path.unlink()
    except OSError as exc:
      raise HTTPException(status_code=500, detail=f"Не удалось удалить плагин: {exc}") from exc

    storage.remove_plugin_state(safe_plugin_id)
    plugin_manager.reload()
    plugins_payload = list_plugins_payload()
    return {
      "ok": True,
      "plugin_id": safe_plugin_id,
      "plugins": plugins_payload,
      "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
      "status": "uninstalled",
    }

  @app.post("/plugins/{plugin_id}/enable")
  def enable_plugin(plugin_id: str) -> dict[str, Any]:
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, True)
    except KeyError as exc:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    return {
      "plugin": serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/disable")
  def disable_plugin(plugin_id: str) -> dict[str, Any]:
    plugin_manager.reload()
    try:
      plugin = plugin_manager.set_enabled(plugin_id, False)
    except KeyError as exc:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc
    except PermissionError as exc:
      raise HTTPException(status_code=409, detail=str(exc)) from exc

    autonomous_mode = get_autonomous_mode()
    return {
      "plugin": serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "autonomous_mode": autonomous_mode,
    }

  @app.post("/plugins/{plugin_id}/update")
  def update_plugin(plugin_id: str) -> dict[str, Any]:
    plugin_manager.reload()
    autonomous_mode = get_autonomous_mode()
    safe_plugin_id = sanitize_plugin_id(plugin_id)
    plugin = next(
      (
        item for item in plugin_manager.list_plugins()
        if sanitize_plugin_id(getattr(item, "id", "")) == safe_plugin_id
      ),
      None,
    )
    if plugin is None:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found")

    serialized_before = serialize_plugin(plugin, autonomous_mode=autonomous_mode)
    source = str(serialized_before.get("source") or "")
    manifest_url = str(serialized_before.get("manifest_url") or "").strip()
    if source == "user" and manifest_url:
      if autonomous_mode:
        raise HTTPException(
          status_code=409,
          detail="Автономный режим включен: обновление пользовательских плагинов из сети отключено.",
        )
      try:
        manifest_payload = fetch_remote_json(
          manifest_url,
          max_bytes=max_manifest_download_bytes,
        )
      except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
      try:
        next_manifest = normalize_install_manifest(manifest_payload)
      except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

      next_plugin_id = sanitize_plugin_id(next_manifest.get("id"))
      if next_plugin_id != safe_plugin_id:
        raise HTTPException(
          status_code=409,
          detail=(
            f"ID обновления ('{next_plugin_id}') не совпадает с выбранным плагином ('{safe_plugin_id}')."
          ),
        )
      next_manifest["manifest_url"] = manifest_url
      next_manifest["enabled"] = bool(serialized_before.get("enabled"))
      write_user_manifest(safe_plugin_id, next_manifest)
      storage.set_plugin_enabled(safe_plugin_id, bool(serialized_before.get("enabled")))
      plugin_manager.reload()
      plugin = next(
        (
          item for item in plugin_manager.list_plugins()
          if sanitize_plugin_id(getattr(item, "id", "")) == safe_plugin_id
        ),
        None,
      )
      if plugin is None:
        raise HTTPException(status_code=500, detail="Плагин обновлен, но не найден после перезагрузки.")
      serialized_after = serialize_plugin(plugin, autonomous_mode=autonomous_mode)
      return {
        "plugin": serialized_after,
        "status": "updated",
        "message": f"Plugin '{safe_plugin_id}' synced successfully",
        "autonomous_mode": autonomous_mode,
      }

    try:
      plugin = plugin_manager.mark_updated(plugin_id)
    except KeyError as exc:
      raise HTTPException(status_code=404, detail=f"Plugin '{plugin_id}' not found") from exc

    return {
      "plugin": serialize_plugin(plugin, autonomous_mode=autonomous_mode),
      "status": "updated",
      "message": f"Plugin '{plugin.id}' synced successfully",
      "autonomous_mode": autonomous_mode,
    }
