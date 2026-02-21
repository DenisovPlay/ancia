from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

try:
  from backend.plugin_registry_utils import (
    fetch_remote_json,
    load_registry_items,
    normalize_http_url,
    sanitize_plugin_id,
  )
except ModuleNotFoundError:
  from plugin_registry_utils import (  # type: ignore
    fetch_remote_json,
    load_registry_items,
    normalize_http_url,
    sanitize_plugin_id,
  )


class PluginMarketplaceService:
  def __init__(
    self,
    *,
    storage: Any,
    plugin_manager: Any,
    user_plugins_dir: Path,
    plugin_registry_url_setting_key: str,
    default_plugin_registry_url: str,
    max_registry_download_bytes: int,
    utc_now_fn: Callable[[], str],
  ) -> None:
    self._storage = storage
    self._plugin_manager = plugin_manager
    self._user_plugins_dir = user_plugins_dir.resolve()
    self._plugin_registry_url_setting_key = plugin_registry_url_setting_key
    self._default_plugin_registry_url = default_plugin_registry_url
    self._max_registry_download_bytes = max_registry_download_bytes
    self._utc_now_fn = utc_now_fn

    builtin_plugin_ids = (
      plugin_manager.get_builtin_ids()
      if hasattr(plugin_manager, "get_builtin_ids")
      else set()
    )
    if not isinstance(builtin_plugin_ids, set):
      builtin_plugin_ids = set(builtin_plugin_ids)
    self._builtin_plugin_ids: set[str] = set(
      sanitize_plugin_id(item) for item in builtin_plugin_ids if sanitize_plugin_id(item)
    )

  @property
  def builtin_plugin_ids(self) -> set[str]:
    return set(self._builtin_plugin_ids)

  def sanitize_plugin_id(self, value: Any) -> str:
    return sanitize_plugin_id(value)

  def normalize_http_url(self, url_like: Any) -> str:
    return normalize_http_url(url_like)

  def fetch_remote_json(self, url: str, *, max_bytes: int) -> Any:
    return fetch_remote_json(url, max_bytes=max_bytes)

  def load_registry_items(self, *, autonomous_mode: bool) -> dict[str, Any]:
    return load_registry_items(
      storage=self._storage,
      setting_key=self._plugin_registry_url_setting_key,
      default_url=self._default_plugin_registry_url,
      autonomous_mode=autonomous_mode,
      max_registry_download_bytes=self._max_registry_download_bytes,
    )

  def resolve_user_plugin_manifest_path(self, plugin_id: str) -> Path | None:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return None

    default_path = (self._user_plugins_dir / f"{safe_plugin_id}.json").resolve()
    try:
      if default_path.exists() and default_path.is_file() and default_path.parent == self._user_plugins_dir:
        return default_path
    except OSError:
      return None

    for file_path in sorted(self._user_plugins_dir.glob("*.json")):
      if not file_path.is_file():
        continue
      try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
      except (OSError, json.JSONDecodeError):
        continue
      found_id = self.sanitize_plugin_id(payload.get("id"))
      if found_id == safe_plugin_id:
        return file_path.resolve()
    return None

  def resolve_plugin_source(self, plugin_id: str) -> str:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return "unknown"
    if safe_plugin_id in self._builtin_plugin_ids:
      return "builtin"
    if self.resolve_user_plugin_manifest_path(safe_plugin_id) is not None:
      return "user"
    return "bundled"

  def serialize_plugin(self, plugin: Any, *, autonomous_mode: bool) -> dict[str, Any]:
    payload = plugin.model_dump() if hasattr(plugin, "model_dump") else dict(plugin)
    safe_plugin_id = self.sanitize_plugin_id(payload.get("id"))
    source = self.resolve_plugin_source(safe_plugin_id)
    requires_network = bool(payload.get("requires_network"))
    is_blocked = autonomous_mode and requires_network
    payload["id"] = safe_plugin_id
    payload["effective_enabled"] = bool(payload.get("enabled")) and not is_blocked
    payload["blocked_reason"] = "autonomous_mode" if is_blocked else ""
    payload["installed"] = True
    payload["source"] = source
    payload["can_uninstall"] = source == "user"
    payload["can_install"] = False
    payload["installable"] = False
    payload["registry"] = False
    payload["manifest_url"] = str(payload.get("manifest_url") or payload.get("manifestUrl") or "").strip()
    payload["repo_url"] = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    return payload

  def list_plugins_payload(self, *, autonomous_mode: bool) -> dict[str, Any]:
    self._plugin_manager.reload()
    plugins = self._plugin_manager.list_plugins()
    serialized = [self.serialize_plugin(plugin, autonomous_mode=autonomous_mode) for plugin in plugins]
    enabled_effective = sum(1 for item in serialized if item.get("effective_enabled"))
    blocked_effective = sum(1 for item in serialized if item.get("blocked_reason") == "autonomous_mode")
    builtin_installed = sum(1 for item in serialized if item.get("source") == "builtin")
    user_installed = sum(1 for item in serialized if item.get("source") == "user")
    return {
      "plugins": serialized,
      "autonomous_mode": autonomous_mode,
      "summary": {
        "loaded": len(serialized),
        "installed": len(serialized),
        "installed_builtin": builtin_installed,
        "installed_user": user_installed,
        "enabled": enabled_effective,
        "blocked_by_autonomous_mode": blocked_effective,
      },
    }

  def build_registry_plugins_payload(self, *, autonomous_mode: bool) -> dict[str, Any]:
    installed_payload = self.list_plugins_payload(autonomous_mode=autonomous_mode)
    installed_plugins = installed_payload.get("plugins") if isinstance(installed_payload, dict) else []
    if not isinstance(installed_plugins, list):
      installed_plugins = []

    installed_by_id = {
      self.sanitize_plugin_id(item.get("id")): dict(item)
      for item in installed_plugins
      if isinstance(item, dict) and self.sanitize_plugin_id(item.get("id"))
    }

    registry_snapshot = self.load_registry_items(autonomous_mode=autonomous_mode)
    registry_items = registry_snapshot.get("plugins")
    if not isinstance(registry_items, list):
      registry_items = []

    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in registry_items:
      if not isinstance(item, dict):
        continue
      plugin_id = self.sanitize_plugin_id(item.get("id"))
      if not plugin_id or plugin_id in seen_ids:
        continue
      seen_ids.add(plugin_id)

      installed = installed_by_id.get(plugin_id)
      if installed:
        merged_item = dict(installed)
        merged_item["registry"] = True
        merged_item["installable"] = False
        merged_item["can_install"] = False
        if not merged_item.get("manifest_url"):
          merged_item["manifest_url"] = str(item.get("manifest_url") or "")
        if not merged_item.get("repo_url"):
          merged_item["repo_url"] = str(item.get("repo_url") or "")
        merged.append(merged_item)
        continue

      requires_network = bool(item.get("requires_network"))
      blocked_reason = "autonomous_mode" if (autonomous_mode and requires_network) else ""
      manifest_url = str(item.get("manifest_url") or "").strip()
      merged.append(
        {
          "id": plugin_id,
          "name": str(item.get("name") or plugin_id),
          "subtitle": str(item.get("subtitle") or ""),
          "description": str(item.get("description") or ""),
          "category": str(item.get("category") or "system"),
          "version": str(item.get("version") or "0.1.0"),
          "homepage": str(item.get("homepage") or ""),
          "repo_url": str(item.get("repo_url") or ""),
          "manifest_url": manifest_url,
          "keywords": list(item.get("keywords") or []),
          "tools": list(item.get("tools") or []),
          "requires_network": requires_network,
          "enabled": False,
          "effective_enabled": False,
          "blocked_reason": blocked_reason,
          "installed": False,
          "source": "registry",
          "locked": False,
          "allow_update": False,
          "registry": True,
          "installable": bool(manifest_url),
          "can_install": bool(manifest_url) and not autonomous_mode,
          "can_uninstall": False,
        }
      )

    for plugin in installed_plugins:
      if not isinstance(plugin, dict):
        continue
      plugin_id = self.sanitize_plugin_id(plugin.get("id"))
      if not plugin_id or plugin_id in seen_ids:
        continue
      cloned = dict(plugin)
      cloned["registry"] = False
      cloned["installable"] = False
      cloned["can_install"] = False
      merged.append(cloned)

    merged.sort(
      key=lambda item: (
        0 if bool(item.get("installed")) else 1,
        str(item.get("name") or item.get("id") or "").lower(),
      )
    )
    installable_count = sum(1 for item in merged if bool(item.get("can_install")))

    return {
      "registry_provider": "github-index",
      "registry_url": str(registry_snapshot.get("registry_url") or ""),
      "registry_error": str(registry_snapshot.get("error") or ""),
      "registry_fetched": bool(registry_snapshot.get("fetched")),
      "plugins": merged,
      "autonomous_mode": autonomous_mode,
      "summary": {
        "total": len(merged),
        "installed": sum(1 for item in merged if bool(item.get("installed"))),
        "available": sum(1 for item in merged if not bool(item.get("installed"))),
        "installable": installable_count,
      },
      "hint": {
        "format": "JSON index with plugins[] and fields id/name/version/manifest_url/homepage/repo_url",
        "example": "https://raw.githubusercontent.com/DenisovPlay/ancia-plugins/index.json",
      },
    }

  def normalize_install_manifest(self, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
      raise ValueError("Манифест плагина должен быть JSON-объектом.")
    if not hasattr(self._plugin_manager, "_normalize_manifest"):
      raise ValueError("Менеджер плагинов не поддерживает валидацию манифестов.")

    descriptor = self._plugin_manager._normalize_manifest(payload)
    plugin_id = self.sanitize_plugin_id(descriptor.id)
    if not plugin_id:
      raise ValueError("Некорректный id плагина.")
    if plugin_id in self._builtin_plugin_ids:
      raise ValueError("Нельзя переустановить встроенный плагин через marketplace.")

    manifest: dict[str, Any] = {
      "id": plugin_id,
      "name": descriptor.name,
      "subtitle": descriptor.subtitle,
      "description": descriptor.description,
      "homepage": descriptor.homepage,
      "enabled": bool(descriptor.enabled),
      "tools": list(descriptor.tools),
      "version": descriptor.version,
      "category": descriptor.category,
      "keywords": list(descriptor.keywords),
      "locked": False,
      "allow_update": bool(payload.get("allow_update", True)),
      "requires_network": bool(payload.get("requires_network", descriptor.requires_network)),
      "installed_at": self._utc_now_fn(),
    }
    repo_url = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    if repo_url:
      try:
        manifest["repo_url"] = self.normalize_http_url(repo_url)
      except ValueError:
        manifest["repo_url"] = ""
    return manifest

  def write_user_manifest(self, plugin_id: str, manifest: dict[str, Any]) -> None:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")

    file_path = (self._user_plugins_dir / f"{safe_plugin_id}.json").resolve()
    if file_path.parent != self._user_plugins_dir:
      raise ValueError("Некорректный путь сохранения плагина.")

    file_path.write_text(
      json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
      encoding="utf-8",
    )
    try:
      os.chmod(file_path, 0o600)
    except OSError:
      pass
