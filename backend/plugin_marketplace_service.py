from __future__ import annotations

import io
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable

try:
  from backend.plugin_registry_utils import (
    fetch_remote_bytes,
    fetch_remote_json,
    load_registry_items,
    normalize_http_url,
    sanitize_plugin_id,
  )
except ModuleNotFoundError:
  from plugin_registry_utils import (  # type: ignore
    fetch_remote_bytes,
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
    preinstalled_plugins_dir: Path,
    plugin_registry_url_setting_key: str,
    default_plugin_registry_url: str,
    max_registry_download_bytes: int,
    utc_now_fn: Callable[[], str],
  ) -> None:
    self._storage = storage
    self._plugin_manager = plugin_manager
    self._user_plugins_dir = user_plugins_dir.resolve()
    self._preinstalled_plugins_dir = preinstalled_plugins_dir.resolve()
    self._plugin_registry_url_setting_key = plugin_registry_url_setting_key
    self._default_plugin_registry_url = default_plugin_registry_url
    self._max_registry_download_bytes = max_registry_download_bytes
    self._utc_now_fn = utc_now_fn
    for target_dir in (self._user_plugins_dir, self._preinstalled_plugins_dir):
      target_dir.mkdir(parents=True, exist_ok=True)
      try:
        os.chmod(target_dir, 0o700)
      except OSError:
        pass

  @property
  def builtin_plugin_ids(self) -> set[str]:
    self._plugin_manager.reload()
    result: set[str] = set()
    for plugin in self._plugin_manager.list_plugins():
      plugin_id = sanitize_plugin_id(getattr(plugin, "id", ""))
      if not plugin_id:
        continue
      if bool(getattr(plugin, "preinstalled", False)):
        result.add(plugin_id)
        continue
      source = str(getattr(plugin, "source", "") or "").strip().lower()
      if source in {"builtin", "preinstalled"}:
        result.add(plugin_id)
    return result

  def sanitize_plugin_id(self, value: Any) -> str:
    return sanitize_plugin_id(value)

  def normalize_http_url(self, url_like: Any) -> str:
    return normalize_http_url(url_like)

  def fetch_remote_json(self, url: str, *, max_bytes: int) -> Any:
    return fetch_remote_json(url, max_bytes=max_bytes)

  def fetch_remote_bytes(self, url: str, *, max_bytes: int) -> bytes:
    return fetch_remote_bytes(url, max_bytes=max_bytes)

  def load_registry_items(self, *, autonomous_mode: bool) -> dict[str, Any]:
    return load_registry_items(
      storage=self._storage,
      setting_key=self._plugin_registry_url_setting_key,
      default_url=self._default_plugin_registry_url,
      autonomous_mode=autonomous_mode,
      max_registry_download_bytes=self._max_registry_download_bytes,
    )

  @staticmethod
  def _is_path_within(path: Path, parent: Path) -> bool:
    try:
      safe_path = path.resolve()
      safe_parent = parent.resolve()
    except OSError:
      return False
    return safe_path == safe_parent or safe_parent in safe_path.parents

  def _resolve_plugin_install_dir(self, plugin_id: str, *, install_scope: str = "user") -> Path:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")
    scope = str(install_scope or "user").strip().lower()
    base_dir = self._preinstalled_plugins_dir if scope == "preinstalled" else self._user_plugins_dir
    target_dir = (base_dir / safe_plugin_id).resolve()
    if not self._is_path_within(target_dir, base_dir):
      raise ValueError("Некорректный путь установки плагина.")
    return target_dir

  def resolve_user_plugin_manifest_path(self, plugin_id: str) -> Path | None:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return None

    self._plugin_manager.reload()
    plugin = self._plugin_manager.get_plugin(safe_plugin_id)
    if plugin is not None:
      manifest_path = str(getattr(plugin, "manifest_path", "") or "").strip()
      if manifest_path:
        candidate = Path(manifest_path).resolve()
        if candidate.exists() and candidate.is_file() and self._is_path_within(candidate, self._user_plugins_dir):
          return candidate

    package_manifest_path = (self._user_plugins_dir / safe_plugin_id / "manifest.json").resolve()
    if package_manifest_path.exists() and package_manifest_path.is_file() and self._is_path_within(package_manifest_path, self._user_plugins_dir):
      return package_manifest_path

    legacy_manifest_path = (self._user_plugins_dir / f"{safe_plugin_id}.json").resolve()
    if legacy_manifest_path.exists() and legacy_manifest_path.is_file() and self._is_path_within(legacy_manifest_path, self._user_plugins_dir):
      return legacy_manifest_path

    return None

  def resolve_plugin_source(self, plugin_id: str) -> str:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return "unknown"
    self._plugin_manager.reload()
    plugin = self._plugin_manager.get_plugin(safe_plugin_id)
    if plugin is None:
      return "unknown"
    source = str(getattr(plugin, "source", "") or "").strip().lower()
    if source:
      return source
    if bool(getattr(plugin, "preinstalled", False)):
      return "preinstalled"
    return "user"

  def _normalize_install_manifest(
    self,
    payload: Any,
    *,
    source: str,
    manifest_url: str,
    package_url: str,
    repo_url: str,
    preinstalled: bool,
    keep_enabled: bool,
  ) -> dict[str, Any]:
    if not isinstance(payload, dict):
      raise ValueError("Манифест плагина должен быть JSON-объектом.")
    if not hasattr(self._plugin_manager, "_normalize_manifest"):
      raise ValueError("Менеджер плагинов не поддерживает валидацию манифестов.")

    descriptor = self._plugin_manager._normalize_manifest(payload)
    plugin_id = self.sanitize_plugin_id(descriptor.id)
    if not plugin_id:
      raise ValueError("Некорректный id плагина.")

    safe_manifest_url = ""
    if manifest_url:
      try:
        safe_manifest_url = self.normalize_http_url(manifest_url)
      except ValueError:
        safe_manifest_url = ""

    safe_package_url = ""
    package_candidate = package_url or str(payload.get("package_url") or payload.get("packageUrl") or "").strip()
    if package_candidate:
      try:
        safe_package_url = self.normalize_http_url(package_candidate)
      except ValueError:
        safe_package_url = ""

    safe_repo_url = ""
    repo_candidate = repo_url or str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    if repo_candidate:
      try:
        safe_repo_url = self.normalize_http_url(repo_candidate)
      except ValueError:
        safe_repo_url = ""

    if bool(getattr(descriptor, "locked", False)):
      keep_enabled = True

    normalized: dict[str, Any] = {
      "id": plugin_id,
      "name": str(getattr(descriptor, "name", "") or "").strip() or plugin_id,
      "subtitle": str(getattr(descriptor, "subtitle", "") or "").strip(),
      "description": str(getattr(descriptor, "description", "") or "").strip(),
      "homepage": str(getattr(descriptor, "homepage", "") or "").strip(),
      "manifest_url": safe_manifest_url,
      "repo_url": safe_repo_url,
      "package_url": safe_package_url,
      "source": str(source or "user").strip().lower() or "user",
      "preinstalled": bool(preinstalled),
      "enabled": bool(keep_enabled),
      "tools": list(getattr(descriptor, "tool_specs", []) or []),
      "ui_extensions": list(getattr(descriptor, "ui_extensions", []) or []),
      "version": str(getattr(descriptor, "version", "0.1.0") or "0.1.0").strip() or "0.1.0",
      "category": str(getattr(descriptor, "category", "system") or "system").strip().lower() or "system",
      "keywords": list(getattr(descriptor, "keywords", []) or []),
      "locked": bool(getattr(descriptor, "locked", False)),
      "allow_update": bool(getattr(descriptor, "allow_update", True)),
      "requires_network": bool(getattr(descriptor, "requires_network", False)),
      "installed_at": self._utc_now_fn(),
    }
    return normalized

  def normalize_install_manifest(self, payload: Any) -> dict[str, Any]:
    return self._normalize_install_manifest(
      payload,
      source="user",
      manifest_url="",
      package_url="",
      repo_url="",
      preinstalled=False,
      keep_enabled=True,
    )

  def _write_manifest(
    self,
    plugin_id: str,
    manifest: dict[str, Any],
    *,
    install_scope: str = "user",
  ) -> Path:
    scope = str(install_scope or "user").strip().lower()
    base_dir = self._preinstalled_plugins_dir if scope == "preinstalled" else self._user_plugins_dir
    target_dir = self._resolve_plugin_install_dir(plugin_id, install_scope=scope)
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
      os.chmod(target_dir, 0o700)
    except OSError:
      pass

    manifest_path = (target_dir / "manifest.json").resolve()
    if not self._is_path_within(manifest_path, base_dir):
      raise ValueError("Некорректный путь сохранения плагина.")

    manifest_path.write_text(
      json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
      encoding="utf-8",
    )
    try:
      os.chmod(manifest_path, 0o600)
    except OSError:
      pass

    return manifest_path

  def write_user_manifest(self, plugin_id: str, manifest: dict[str, Any]) -> None:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")
    self._write_manifest(safe_plugin_id, manifest, install_scope="user")

  def _clean_plugin_dir(self, plugin_id: str, *, install_scope: str = "user") -> None:
    target_dir = self._resolve_plugin_install_dir(plugin_id, install_scope=install_scope)
    if not target_dir.exists():
      return
    shutil.rmtree(target_dir, ignore_errors=False)

  def _extract_zip_to_dir(self, package_bytes: bytes, target_dir: Path) -> Path:
    target_dir = target_dir.resolve()
    if target_dir.exists():
      shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(package_bytes)) as archive:
      members = [item for item in archive.infolist() if not item.is_dir()]
      if not members:
        raise ValueError("Пакет плагина пуст.")

      top_parts = {
        Path(item.filename).parts[0]
        for item in members
        if Path(item.filename).parts
      }
      strip_top = len(top_parts) == 1

      for member in members:
        raw_path = Path(member.filename)
        if not raw_path.parts:
          continue
        relative_parts = raw_path.parts[1:] if strip_top else raw_path.parts
        safe_relative = Path(*relative_parts)
        if not safe_relative.parts:
          continue
        if ".." in safe_relative.parts:
          continue
        destination = (target_dir / safe_relative).resolve()
        if not self._is_path_within(destination, target_dir):
          continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(member) as src, destination.open("wb") as dst:
          shutil.copyfileobj(src, dst)

    manifest_path = (target_dir / "manifest.json").resolve()
    alt_manifest_path = (target_dir / "plugin.json").resolve()
    if manifest_path.exists() and manifest_path.is_file():
      return manifest_path
    if alt_manifest_path.exists() and alt_manifest_path.is_file():
      return alt_manifest_path
    raise ValueError("В пакете плагина отсутствует manifest.json/plugin.json.")

  def _load_manifest_from_path(self, manifest_path: Path) -> dict[str, Any]:
    try:
      return json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
      raise ValueError("Не удалось прочитать manifest плагина.") from exc

  def _registry_item_by_id(self, plugin_id: str, *, autonomous_mode: bool) -> dict[str, Any] | None:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return None
    snapshot = self.load_registry_items(autonomous_mode=autonomous_mode)
    items = snapshot.get("plugins") if isinstance(snapshot, dict) else []
    if not isinstance(items, list):
      return None
    for item in items:
      if not isinstance(item, dict):
        continue
      if self.sanitize_plugin_id(item.get("id")) == safe_plugin_id:
        return dict(item)
    return None

  def install_from_manifest_url(
    self,
    *,
    manifest_url: str,
    expected_plugin_id: str = "",
    source: str = "user",
    preinstalled: bool = False,
    repo_url: str = "",
    package_url: str = "",
    keep_enabled: bool = True,
    install_scope: str = "user",
  ) -> dict[str, Any]:
    safe_manifest_url = self.normalize_http_url(manifest_url)
    payload = self.fetch_remote_json(safe_manifest_url, max_bytes=512 * 1024)
    normalized = self._normalize_install_manifest(
      payload,
      source=source,
      manifest_url=safe_manifest_url,
      package_url=package_url,
      repo_url=repo_url,
      preinstalled=preinstalled,
      keep_enabled=keep_enabled,
    )
    installed_plugin_id = self.sanitize_plugin_id(normalized.get("id"))
    if expected_plugin_id and installed_plugin_id != self.sanitize_plugin_id(expected_plugin_id):
      raise ValueError(
        f"ID плагина из манифеста ('{installed_plugin_id}') не совпадает с запрошенным ('{expected_plugin_id}')."
      )

    self._clean_plugin_dir(installed_plugin_id, install_scope=install_scope)
    self._write_manifest(installed_plugin_id, normalized, install_scope=install_scope)
    self._storage.remove_plugin_state(installed_plugin_id)
    self._plugin_manager.reload()
    return normalized

  def install_from_package_url(
    self,
    *,
    package_url: str,
    expected_plugin_id: str = "",
    source: str = "user",
    preinstalled: bool = False,
    repo_url: str = "",
    manifest_url: str = "",
    keep_enabled: bool = True,
    install_scope: str = "user",
  ) -> dict[str, Any]:
    safe_package_url = self.normalize_http_url(package_url)
    package_bytes = self.fetch_remote_bytes(safe_package_url, max_bytes=20 * 1024 * 1024)

    safe_expected_plugin_id = self.sanitize_plugin_id(expected_plugin_id)
    with tempfile.TemporaryDirectory(prefix="ancia-plugin-") as temp_dir_raw:
      temp_root = Path(temp_dir_raw).resolve()
      extract_root = (temp_root / "extract").resolve()
      manifest_path = self._extract_zip_to_dir(package_bytes, extract_root)
      manifest_payload = self._load_manifest_from_path(manifest_path)

    normalized = self._normalize_install_manifest(
      manifest_payload,
      source=source,
      manifest_url=manifest_url,
      package_url=safe_package_url,
      repo_url=repo_url,
      preinstalled=preinstalled,
      keep_enabled=keep_enabled,
    )
    installed_plugin_id = self.sanitize_plugin_id(normalized.get("id"))
    if safe_expected_plugin_id and installed_plugin_id != safe_expected_plugin_id:
      raise ValueError(
        f"ID плагина из пакета ('{installed_plugin_id}') не совпадает с запрошенным ('{safe_expected_plugin_id}')."
      )

    target_dir = self._resolve_plugin_install_dir(installed_plugin_id, install_scope=install_scope)
    self._extract_zip_to_dir(package_bytes, target_dir)

    self._write_manifest(installed_plugin_id, normalized, install_scope=install_scope)
    self._storage.remove_plugin_state(installed_plugin_id)
    self._plugin_manager.reload()
    return normalized

  def install_plugin(self, payload: dict[str, Any], *, autonomous_mode: bool) -> dict[str, Any]:
    body = payload if isinstance(payload, dict) else {}
    inline_manifest = body.get("manifest") if isinstance(body.get("manifest"), dict) else None
    requested_plugin_id = self.sanitize_plugin_id(
      body.get("id")
      or body.get("plugin_id")
      or body.get("pluginId")
    )
    manifest_url_input = str(body.get("manifest_url") or body.get("manifestUrl") or "").strip()
    package_url_input = str(body.get("package_url") or body.get("packageUrl") or "").strip()

    if autonomous_mode and inline_manifest is None and (manifest_url_input or package_url_input or requested_plugin_id):
      raise ValueError("Автономный режим включен: установка плагинов из сети недоступна.")

    if inline_manifest is not None:
      normalized = self._normalize_install_manifest(
        inline_manifest,
        source="user",
        manifest_url="",
        package_url="",
        repo_url="",
        preinstalled=False,
        keep_enabled=True,
      )
      installed_plugin_id = self.sanitize_plugin_id(normalized.get("id"))
      if requested_plugin_id and installed_plugin_id != requested_plugin_id:
        raise ValueError(
          f"ID плагина из манифеста ('{installed_plugin_id}') не совпадает с запрошенным ('{requested_plugin_id}')."
        )
      self._clean_plugin_dir(installed_plugin_id, install_scope="user")
      self._write_manifest(installed_plugin_id, normalized, install_scope="user")
      self._storage.remove_plugin_state(installed_plugin_id)
      self._plugin_manager.reload()
      return normalized

    registry_item: dict[str, Any] | None = None
    if requested_plugin_id:
      registry_item = self._registry_item_by_id(requested_plugin_id, autonomous_mode=autonomous_mode)
      if registry_item is None and not manifest_url_input and not package_url_input:
        raise ValueError(f"Плагин '{requested_plugin_id}' не найден в реестре.")

    source = "user"
    preinstalled = False
    repo_url = ""
    manifest_url = manifest_url_input
    package_url = package_url_input

    if registry_item is not None:
      source = str(registry_item.get("source") or "registry").strip().lower() or "registry"
      preinstalled = bool(registry_item.get("preinstalled", False))
      repo_url = str(registry_item.get("repo_url") or "").strip()
      if not manifest_url:
        manifest_url = str(registry_item.get("manifest_url") or "").strip()
      if not package_url:
        package_url = str(registry_item.get("package_url") or "").strip()

    if requested_plugin_id and requested_plugin_id in self.builtin_plugin_ids and not package_url and not manifest_url:
      raise ValueError("Встроенный плагин уже установлен.")

    if package_url:
      return self.install_from_package_url(
        package_url=package_url,
        expected_plugin_id=requested_plugin_id,
        source=source,
        preinstalled=preinstalled,
        repo_url=repo_url,
        manifest_url=manifest_url,
        keep_enabled=True,
        install_scope="user",
      )
    if manifest_url:
      return self.install_from_manifest_url(
        manifest_url=manifest_url,
        expected_plugin_id=requested_plugin_id,
        source=source,
        preinstalled=preinstalled,
        repo_url=repo_url,
        package_url=package_url,
        keep_enabled=True,
        install_scope="user",
      )

    raise ValueError("Для установки требуется manifest_url или package_url.")

  def uninstall_plugin(self, plugin_id: str) -> dict[str, Any]:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")
    if safe_plugin_id in self.builtin_plugin_ids:
      raise PermissionError("Встроенные плагины нельзя удалить.")

    manifest_path = self.resolve_user_plugin_manifest_path(safe_plugin_id)
    if manifest_path is None:
      raise FileNotFoundError(f"Плагин '{safe_plugin_id}' не установлен.")

    target_root = manifest_path.parent
    if target_root.name == safe_plugin_id and self._is_path_within(target_root, self._user_plugins_dir):
      shutil.rmtree(target_root, ignore_errors=False)
    else:
      manifest_path.unlink(missing_ok=False)

    self._storage.remove_plugin_state(safe_plugin_id)
    self._plugin_manager.reload()
    return {"plugin_id": safe_plugin_id, "status": "uninstalled"}

  def update_plugin(self, plugin_id: str, *, autonomous_mode: bool) -> dict[str, Any]:
    safe_plugin_id = self.sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")

    self._plugin_manager.reload()
    plugin = self._plugin_manager.get_plugin(safe_plugin_id)
    if plugin is None:
      raise FileNotFoundError(f"Плагин '{safe_plugin_id}' не найден.")

    serialized_before = self.serialize_plugin(plugin, autonomous_mode=autonomous_mode)
    if not bool(serialized_before.get("allow_update", True)):
      raise PermissionError("Для плагина отключено обновление.")

    manifest_url = str(serialized_before.get("manifest_url") or "").strip()
    package_url = str(serialized_before.get("package_url") or "").strip()
    repo_url = str(serialized_before.get("repo_url") or "").strip()
    source = str(serialized_before.get("source") or "user").strip().lower() or "user"
    preinstalled = bool(serialized_before.get("preinstalled", False))
    install_scope = "preinstalled" if preinstalled or source in {"preinstalled", "builtin"} else "user"
    keep_enabled = bool(serialized_before.get("enabled", True))

    if autonomous_mode and (manifest_url or package_url):
      raise ValueError("Автономный режим включен: обновление плагина из сети недоступно.")

    if not manifest_url and not package_url:
      registry_item = self._registry_item_by_id(safe_plugin_id, autonomous_mode=autonomous_mode)
      if registry_item is not None:
        manifest_url = str(registry_item.get("manifest_url") or "").strip()
        package_url = str(registry_item.get("package_url") or "").strip()
        if not repo_url:
          repo_url = str(registry_item.get("repo_url") or "").strip()

    if package_url:
      self.install_from_package_url(
        package_url=package_url,
        expected_plugin_id=safe_plugin_id,
        source=source,
        preinstalled=preinstalled,
        repo_url=repo_url,
        manifest_url=manifest_url,
        keep_enabled=keep_enabled,
        install_scope=install_scope,
      )
    elif manifest_url:
      self.install_from_manifest_url(
        manifest_url=manifest_url,
        expected_plugin_id=safe_plugin_id,
        source=source,
        preinstalled=preinstalled,
        repo_url=repo_url,
        package_url=package_url,
        keep_enabled=keep_enabled,
        install_scope=install_scope,
      )
    else:
      self._plugin_manager.mark_updated(safe_plugin_id)

    self._storage.set_plugin_enabled(safe_plugin_id, keep_enabled)
    self._plugin_manager.reload()
    plugin_after = self._plugin_manager.get_plugin(safe_plugin_id)
    if plugin_after is None:
      raise RuntimeError("Плагин обновлён, но не найден после перезагрузки.")
    return self.serialize_plugin(plugin_after, autonomous_mode=autonomous_mode)

  def ensure_preinstalled_plugins(self, *, autonomous_mode: bool) -> dict[str, Any]:
    if autonomous_mode:
      return {
        "installed": [],
        "updated": [],
        "errors": ["Автономный режим включен: bootstrap встроенных плагинов из реестра пропущен."],
      }

    snapshot = self.load_registry_items(autonomous_mode=False)
    registry_items = snapshot.get("plugins")
    if not isinstance(registry_items, list):
      registry_items = []

    self._plugin_manager.reload()
    installed_ids = {self.sanitize_plugin_id(getattr(item, "id", "")) for item in self._plugin_manager.list_plugins()}

    installed: list[str] = []
    updated: list[str] = []
    errors: list[str] = []
    for item in registry_items:
      if not isinstance(item, dict):
        continue
      if not bool(item.get("preinstalled", False)):
        continue
      plugin_id = self.sanitize_plugin_id(item.get("id"))
      if not plugin_id:
        continue
      manifest_url = str(item.get("manifest_url") or "").strip()
      package_url = str(item.get("package_url") or "").strip()
      repo_url = str(item.get("repo_url") or "").strip()
      if not manifest_url and not package_url:
        continue
      try:
        if plugin_id in installed_ids:
          self.update_plugin(plugin_id, autonomous_mode=False)
          updated.append(plugin_id)
          continue
        if package_url:
          self.install_from_package_url(
            package_url=package_url,
            expected_plugin_id=plugin_id,
            source=str(item.get("source") or "preinstalled").strip().lower() or "preinstalled",
            preinstalled=True,
            repo_url=repo_url,
            manifest_url=manifest_url,
            keep_enabled=True,
            install_scope="preinstalled",
          )
          installed.append(plugin_id)
          installed_ids.add(plugin_id)
        elif manifest_url:
          self.install_from_manifest_url(
            manifest_url=manifest_url,
            expected_plugin_id=plugin_id,
            source=str(item.get("source") or "preinstalled").strip().lower() or "preinstalled",
            preinstalled=True,
            repo_url=repo_url,
            package_url=package_url,
            keep_enabled=True,
            install_scope="preinstalled",
          )
          installed.append(plugin_id)
          installed_ids.add(plugin_id)
      except Exception as exc:
        errors.append(f"{plugin_id}: {exc}")

    return {
      "installed": installed,
      "updated": updated,
      "errors": errors,
      "registry_error": str(snapshot.get("error") or ""),
      "registry_fetched": bool(snapshot.get("fetched")),
    }

  def serialize_plugin(self, plugin: Any, *, autonomous_mode: bool) -> dict[str, Any]:
    payload = plugin.model_dump() if hasattr(plugin, "model_dump") else dict(plugin)
    safe_plugin_id = self.sanitize_plugin_id(payload.get("id"))
    source = str(payload.get("source") or self.resolve_plugin_source(safe_plugin_id) or "unknown").strip().lower()
    requires_network = bool(payload.get("requires_network"))
    is_blocked = autonomous_mode and requires_network
    payload["id"] = safe_plugin_id
    payload["effective_enabled"] = bool(payload.get("enabled")) and not is_blocked
    payload["blocked_reason"] = "autonomous_mode" if is_blocked else ""
    payload["installed"] = True
    payload["source"] = source
    payload["preinstalled"] = bool(payload.get("preinstalled", False))
    payload["can_uninstall"] = source == "user"
    payload["can_install"] = False
    payload["installable"] = False
    payload["registry"] = False
    payload["manifest_url"] = str(payload.get("manifest_url") or payload.get("manifestUrl") or "").strip()
    payload["repo_url"] = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    payload["package_url"] = str(payload.get("package_url") or payload.get("packageUrl") or "").strip()
    payload["ui_extensions"] = list(payload.get("ui_extensions") or [])
    return payload

  def list_plugins_payload(self, *, autonomous_mode: bool) -> dict[str, Any]:
    self._plugin_manager.reload()
    plugins = self._plugin_manager.list_plugins()
    serialized = [self.serialize_plugin(plugin, autonomous_mode=autonomous_mode) for plugin in plugins]
    enabled_effective = sum(1 for item in serialized if item.get("effective_enabled"))
    blocked_effective = sum(1 for item in serialized if item.get("blocked_reason") == "autonomous_mode")
    builtin_installed = sum(1 for item in serialized if item.get("preinstalled") or item.get("source") in {"builtin", "preinstalled"})
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

  @staticmethod
  def _version_key(value: str) -> tuple[int, ...]:
    safe = str(value or "").strip().lower().lstrip("v")
    parts: list[int] = []
    for piece in safe.split("."):
      if not piece:
        continue
      digits = "".join(ch for ch in piece if ch.isdigit())
      if digits:
        parts.append(int(digits))
    return tuple(parts) if parts else (0,)

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
      registry_version = str(item.get("version") or "0.1.0")
      if installed:
        merged_item = dict(installed)
        merged_item["registry"] = True
        merged_item["installable"] = False
        merged_item["can_install"] = False
        merged_item["preinstalled"] = bool(installed.get("preinstalled", item.get("preinstalled", False)))
        if not merged_item.get("manifest_url"):
          merged_item["manifest_url"] = str(item.get("manifest_url") or "")
        if not merged_item.get("repo_url"):
          merged_item["repo_url"] = str(item.get("repo_url") or "")
        if not merged_item.get("package_url"):
          merged_item["package_url"] = str(item.get("package_url") or "")
        merged_item["allow_update"] = bool(merged_item.get("allow_update", True))
        local_version = str(merged_item.get("version") or "0.0.0")
        merged_item["update_available"] = (
          self._version_key(registry_version) > self._version_key(local_version)
          and bool(merged_item.get("allow_update", True))
        )
        merged_item["registry_version"] = registry_version
        merged.append(merged_item)
        continue

      requires_network = bool(item.get("requires_network"))
      blocked_reason = "autonomous_mode" if (autonomous_mode and requires_network) else ""
      manifest_url = str(item.get("manifest_url") or "").strip()
      package_url = str(item.get("package_url") or "").strip()
      can_install = bool(manifest_url or package_url) and not autonomous_mode
      merged.append(
        {
          "id": plugin_id,
          "name": str(item.get("name") or plugin_id),
          "subtitle": str(item.get("subtitle") or ""),
          "description": str(item.get("description") or ""),
          "category": str(item.get("category") or "system"),
          "version": registry_version,
          "homepage": str(item.get("homepage") or ""),
          "repo_url": str(item.get("repo_url") or ""),
          "manifest_url": manifest_url,
          "package_url": package_url,
          "keywords": list(item.get("keywords") or []),
          "tools": list(item.get("tools") or []),
          "requires_network": requires_network,
          "enabled": False,
          "effective_enabled": False,
          "blocked_reason": blocked_reason,
          "installed": False,
          "source": str(item.get("source") or "registry").strip().lower() or "registry",
          "preinstalled": bool(item.get("preinstalled", False)),
          "locked": False,
          "allow_update": True,
          "registry": True,
          "installable": bool(manifest_url or package_url),
          "can_install": can_install,
          "can_uninstall": False,
          "update_available": False,
          "registry_version": registry_version,
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
      cloned["update_available"] = False
      merged.append(cloned)

    merged.sort(
      key=lambda item: (
        0 if bool(item.get("installed")) else 1,
        0 if bool(item.get("preinstalled")) else 1,
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
        "format": "JSON index with plugins[] and fields id/name/version/manifest_url/package_url/homepage/repo_url",
        "example": "https://raw.githubusercontent.com/DenisovPlay/ancia-plugins/main/index.json",
      },
    }
