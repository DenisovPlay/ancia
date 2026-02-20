from __future__ import annotations

import json
import os
import queue as queue_lib
import re
import threading
from pathlib import Path
from typing import Any, Callable, Generator
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

try:
  from backend.common import normalize_mood, utc_now_iso
  from backend.schemas import (
    ChatCreateRequest,
    ChatDuplicateRequest,
    HistoryMessage,
    ChatRequest,
    ChatResponse,
    ChatUpdateRequest,
    MessageUpdateRequest,
    ModelParamsUpdateRequest,
    ModelSelectRequest,
    RuntimeChatContext,
    ToolEvent,
  )
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore
  from schemas import (  # type: ignore
    ChatCreateRequest,
    ChatDuplicateRequest,
    HistoryMessage,
    ChatRequest,
    ChatResponse,
    ChatUpdateRequest,
    MessageUpdateRequest,
    ModelParamsUpdateRequest,
    ModelSelectRequest,
    RuntimeChatContext,
    ToolEvent,
  )


def register_api_routes(
  app: FastAPI,
  *,
  storage: Any,
  model_engine: Any,
  tool_registry: Any,
  plugin_manager: Any,
  system_prompt: str,
  data_dir: str,
  build_system_prompt_fn: Callable[..., str],
  normalize_model_tier_key_fn: Callable[[str | None, str], str],
) -> None:
  RUNTIME_CONFIG_SETTING_KEY = "runtime_config"
  ONBOARDING_STATE_SETTING_KEY = "onboarding_state"
  AUTONOMOUS_MODE_SETTING_KEY = "autonomous_mode"
  DEFAULT_RUNTIME_CONFIG: dict[str, Any] = {
    "mode": "backend",
    "backendUrl": "http://127.0.0.1:5055",
    "apiKey": "",
    "timeoutMs": 12000,
    "modelTier": "lite",
    "modelId": "qwen2.5-0.5b-instruct-mlx-4bit",
    "modelLabel": "Lite",
    "devicePreset": "auto",
    "modelContextWindow": None,
    "modelMaxTokens": None,
    "modelTemperature": None,
    "modelTopP": None,
    "modelTopK": None,
    "autoReconnect": True,
    "bootMood": "neutral",
    "defaultTransitionMs": 1200,
    "userName": "",
    "userContext": "",
    "userLanguage": "ru",
    "userTimezone": "UTC",
    "uiDensity": "comfortable",
    "uiAnimations": True,
    "uiFontScale": 100,
    "uiFontPreset": "system",
    "uiFontFamily": "",
    "uiShowInspector": True,
    "autonomousMode": False,
  }
  DEFAULT_ONBOARDING_STATE: dict[str, Any] = {
    "version": 4,
    "completed": False,
    "skipped": False,
    "completedAt": "",
    "data": {},
  }
  PLUGIN_REGISTRY_URL_SETTING_KEY = "plugin_registry_url"
  DEFAULT_PLUGIN_REGISTRY_URL = (
    os.getenv("ANCIA_PLUGIN_REGISTRY_URL", "").strip()
    or "https://raw.githubusercontent.com/denisovplay/Ancia-plugin-registry/main/index.json"
  )
  MAX_REGISTRY_DOWNLOAD_BYTES = 1024 * 1024
  MAX_MANIFEST_DOWNLOAD_BYTES = 512 * 1024
  SAFE_PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,63}$")
  user_plugins_dir = (Path(data_dir).resolve() / "plugins")
  user_plugins_dir.mkdir(parents=True, exist_ok=True)
  try:
    os.chmod(user_plugins_dir, 0o700)
  except OSError:
    pass
  builtin_plugin_ids = (
    plugin_manager.get_builtin_ids()
    if hasattr(plugin_manager, "get_builtin_ids")
    else set()
  )
  if not isinstance(builtin_plugin_ids, set):
    builtin_plugin_ids = set(builtin_plugin_ids)

  def sanitize_runtime_config(payload: Any) -> dict[str, Any]:
    result = dict(DEFAULT_RUNTIME_CONFIG)
    if isinstance(payload, dict):
      for key in DEFAULT_RUNTIME_CONFIG.keys():
        if key in payload:
          result[key] = payload[key]
    result["autonomousMode"] = bool(result.get("autonomousMode", False))
    return result

  def sanitize_onboarding_state(payload: Any) -> dict[str, Any]:
    result = dict(DEFAULT_ONBOARDING_STATE)
    if isinstance(payload, dict):
      if "version" in payload:
        try:
          result["version"] = max(1, int(payload.get("version") or DEFAULT_ONBOARDING_STATE["version"]))
        except (TypeError, ValueError):
          result["version"] = DEFAULT_ONBOARDING_STATE["version"]
      if "completed" in payload:
        result["completed"] = bool(payload.get("completed"))
      if "skipped" in payload:
        result["skipped"] = bool(payload.get("skipped"))
      if "completedAt" in payload:
        result["completedAt"] = str(payload.get("completedAt") or "")
      if "data" in payload and isinstance(payload.get("data"), dict):
        result["data"] = payload.get("data") or {}
    return result

  def get_autonomous_mode() -> bool:
    runtime_config = sanitize_runtime_config(storage.get_setting_json(RUNTIME_CONFIG_SETTING_KEY, {}))
    autonomous_from_runtime = bool(runtime_config.get("autonomousMode", False))
    autonomous_from_flag = storage.get_setting_flag(AUTONOMOUS_MODE_SETTING_KEY, autonomous_from_runtime)
    return bool(autonomous_from_flag)

  def apply_runtime_config_model_selection(runtime_config: dict[str, Any]) -> None:
    selected_tier = normalize_model_tier_key_fn(
      str(runtime_config.get("modelTier") or ""),
      model_engine.get_selected_tier(),
    )
    if selected_tier != model_engine.get_selected_tier():
      model_engine.set_selected_tier(selected_tier)
    requested_model_id = str(runtime_config.get("modelId") or "").strip().lower()
    if requested_model_id and requested_model_id != model_engine.get_selected_model_id(selected_tier):
      model_engine.set_selected_model(requested_model_id, tier=selected_tier)

  def get_settings_payload() -> dict[str, Any]:
    runtime_config = sanitize_runtime_config(storage.get_setting_json(RUNTIME_CONFIG_SETTING_KEY, {}))
    onboarding_state = sanitize_onboarding_state(storage.get_setting_json(ONBOARDING_STATE_SETTING_KEY, {}))
    autonomous_mode = get_autonomous_mode()
    runtime_config["autonomousMode"] = autonomous_mode
    return {
      "runtime_config": runtime_config,
      "onboarding_state": onboarding_state,
      "autonomous_mode": autonomous_mode,
    }

  def persist_settings_payload(
    *,
    runtime_config: dict[str, Any] | None = None,
    onboarding_state: dict[str, Any] | None = None,
    autonomous_mode: bool | None = None,
  ) -> dict[str, Any]:
    current = get_settings_payload()
    next_runtime = sanitize_runtime_config(runtime_config if runtime_config is not None else current["runtime_config"])
    next_onboarding = sanitize_onboarding_state(onboarding_state if onboarding_state is not None else current["onboarding_state"])
    next_autonomous = bool(next_runtime.get("autonomousMode", False) if autonomous_mode is None else autonomous_mode)
    next_runtime["autonomousMode"] = next_autonomous

    storage.set_setting_json(RUNTIME_CONFIG_SETTING_KEY, next_runtime)
    storage.set_setting_json(ONBOARDING_STATE_SETTING_KEY, next_onboarding)
    storage.set_setting_flag(AUTONOMOUS_MODE_SETTING_KEY, next_autonomous)

    try:
      apply_runtime_config_model_selection(next_runtime)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
      "runtime_config": next_runtime,
      "onboarding_state": next_onboarding,
      "autonomous_mode": next_autonomous,
    }

  def sanitize_plugin_id(value: Any) -> str:
    safe_value = str(value or "").strip().lower()
    if not safe_value:
      return ""
    if not SAFE_PLUGIN_ID_PATTERN.match(safe_value):
      return ""
    return safe_value

  def normalize_http_url(url_like: Any) -> str:
    raw_url = str(url_like or "").strip()
    if not raw_url:
      raise ValueError("URL is required")
    parsed = url_parse.urlparse(raw_url)
    if not parsed.scheme:
      raw_url = f"https://{raw_url}"
      parsed = url_parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
      raise ValueError("Only http/https URLs are allowed")
    if not parsed.netloc:
      raise ValueError("URL host is required")
    return parsed.geturl()

  def resolve_plugin_registry_url() -> str:
    from_settings = str(storage.get_setting(PLUGIN_REGISTRY_URL_SETTING_KEY) or "").strip()
    if from_settings:
      try:
        return normalize_http_url(from_settings)
      except ValueError:
        pass
    return DEFAULT_PLUGIN_REGISTRY_URL

  def fetch_remote_json(url: str, *, max_bytes: int) -> Any:
    try:
      safe_url = normalize_http_url(url)
    except ValueError as exc:
      raise RuntimeError(str(exc)) from exc

    request = url_request.Request(
      safe_url,
      headers={
        "User-Agent": "Ancia/0.1 (+plugin-registry)",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.5",
      },
    )

    try:
      with url_request.urlopen(request, timeout=20) as response:
        raw = response.read(max_bytes + 1)
    except url_error.HTTPError as exc:
      raise RuntimeError(f"HTTP {exc.code} while fetching registry") from exc
    except url_error.URLError as exc:
      raise RuntimeError(f"Network error while fetching registry: {exc.reason}") from exc
    except OSError as exc:
      raise RuntimeError(f"Network error while fetching registry: {exc}") from exc

    if len(raw) > max_bytes:
      raise RuntimeError("Registry payload is too large")

    try:
      text = raw.decode("utf-8")
      return json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
      raise RuntimeError("Registry payload is not valid JSON") from exc

  def normalize_registry_item(payload: Any) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
      return None

    plugin_id = sanitize_plugin_id(
      payload.get("id")
      or payload.get("plugin_id")
      or payload.get("slug"),
    )
    if not plugin_id:
      return None

    manifest_url = ""
    manifest_candidate = str(payload.get("manifest_url") or payload.get("manifestUrl") or "").strip()
    if manifest_candidate:
      try:
        manifest_url = normalize_http_url(manifest_candidate)
      except ValueError:
        manifest_url = ""

    homepage = str(payload.get("homepage") or payload.get("url") or "").strip()
    if homepage:
      try:
        homepage = normalize_http_url(homepage)
      except ValueError:
        homepage = ""

    repo_url = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    if repo_url:
      try:
        repo_url = normalize_http_url(repo_url)
      except ValueError:
        repo_url = ""

    raw_keywords = payload.get("keywords")
    keywords: list[str] = []
    if isinstance(raw_keywords, list):
      for keyword in raw_keywords:
        safe_keyword = str(keyword or "").strip().lower()
        if safe_keyword:
          keywords.append(safe_keyword)
    unique_keywords = sorted(set(keywords))

    raw_tools = payload.get("tools")
    tools: list[str] = []
    if isinstance(raw_tools, list):
      for item in raw_tools:
        if isinstance(item, str):
          safe_tool = item.strip().lower()
          if safe_tool:
            tools.append(safe_tool)
        elif isinstance(item, dict):
          safe_tool = str(item.get("name") or "").strip().lower()
          if safe_tool:
            tools.append(safe_tool)

    return {
      "id": plugin_id,
      "name": str(payload.get("name") or payload.get("title") or plugin_id).strip(),
      "subtitle": str(payload.get("subtitle") or payload.get("summary") or "").strip(),
      "description": str(payload.get("description") or "").strip(),
      "category": str(payload.get("category") or "system").strip().lower() or "system",
      "version": str(payload.get("version") or "0.1.0").strip() or "0.1.0",
      "homepage": homepage,
      "repo_url": repo_url,
      "manifest_url": manifest_url,
      "keywords": unique_keywords,
      "tools": tools,
      "requires_network": bool(payload.get("requires_network", False)),
    }

  def parse_registry_payload(payload: Any) -> list[dict[str, Any]]:
    items: list[Any] = []
    if isinstance(payload, list):
      items = payload
    elif isinstance(payload, dict):
      for key in ("plugins", "items", "entries"):
        candidate = payload.get(key)
        if isinstance(candidate, list):
          items = candidate
          break

    normalized_items: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in items:
      normalized = normalize_registry_item(item)
      if not normalized:
        continue
      plugin_id = str(normalized.get("id") or "").strip().lower()
      if not plugin_id or plugin_id in seen_ids:
        continue
      seen_ids.add(plugin_id)
      normalized_items.append(normalized)
    return normalized_items

  def load_registry_items(*, autonomous_mode: bool) -> dict[str, Any]:
    registry_url = resolve_plugin_registry_url()
    if autonomous_mode:
      return {
        "registry_url": registry_url,
        "plugins": [],
        "error": "Автономный режим включен: внешний реестр плагинов недоступен.",
        "fetched": False,
      }
    if not registry_url:
      return {
        "registry_url": "",
        "plugins": [],
        "error": "URL реестра плагинов не настроен.",
        "fetched": False,
      }
    try:
      payload = fetch_remote_json(
        registry_url,
        max_bytes=MAX_REGISTRY_DOWNLOAD_BYTES,
      )
      return {
        "registry_url": registry_url,
        "plugins": parse_registry_payload(payload),
        "error": "",
        "fetched": True,
      }
    except RuntimeError as exc:
      return {
        "registry_url": registry_url,
        "plugins": [],
        "error": str(exc),
        "fetched": False,
      }

  def resolve_user_plugin_manifest_path(plugin_id: str) -> Path | None:
    safe_plugin_id = sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return None

    default_path = (user_plugins_dir / f"{safe_plugin_id}.json").resolve()
    try:
      if default_path.exists() and default_path.is_file() and default_path.parent == user_plugins_dir.resolve():
        return default_path
    except OSError:
      return None

    for file_path in sorted(user_plugins_dir.glob("*.json")):
      if not file_path.is_file():
        continue
      try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
      except (OSError, json.JSONDecodeError):
        continue
      found_id = sanitize_plugin_id(payload.get("id"))
      if found_id == safe_plugin_id:
        return file_path.resolve()
    return None

  def resolve_plugin_source(plugin_id: str) -> str:
    safe_plugin_id = sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      return "unknown"
    if safe_plugin_id in builtin_plugin_ids:
      return "builtin"
    if resolve_user_plugin_manifest_path(safe_plugin_id) is not None:
      return "user"
    return "bundled"

  def serialize_plugin(plugin: Any, *, autonomous_mode: bool) -> dict[str, Any]:
    payload = plugin.model_dump() if hasattr(plugin, "model_dump") else dict(plugin)
    safe_plugin_id = sanitize_plugin_id(payload.get("id"))
    source = resolve_plugin_source(safe_plugin_id)
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

  def list_plugins_payload() -> dict[str, Any]:
    plugin_manager.reload()
    autonomous_mode = get_autonomous_mode()
    plugins = plugin_manager.list_plugins()
    serialized = [serialize_plugin(plugin, autonomous_mode=autonomous_mode) for plugin in plugins]
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

  def build_registry_plugins_payload() -> dict[str, Any]:
    installed_payload = list_plugins_payload()
    autonomous_mode = bool(installed_payload.get("autonomous_mode"))
    installed_plugins = installed_payload.get("plugins") if isinstance(installed_payload, dict) else []
    if not isinstance(installed_plugins, list):
      installed_plugins = []
    installed_by_id = {
      sanitize_plugin_id(item.get("id")): dict(item)
      for item in installed_plugins
      if isinstance(item, dict) and sanitize_plugin_id(item.get("id"))
    }

    registry_snapshot = load_registry_items(autonomous_mode=autonomous_mode)
    registry_items = registry_snapshot.get("plugins")
    if not isinstance(registry_items, list):
      registry_items = []

    merged: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in registry_items:
      if not isinstance(item, dict):
        continue
      plugin_id = sanitize_plugin_id(item.get("id"))
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
      plugin_id = sanitize_plugin_id(plugin.get("id"))
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
        "example": "https://raw.githubusercontent.com/denisovplay/Ancia-plugin-registry/main/index.json",
      },
    }

  def normalize_install_manifest(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
      raise ValueError("Манифест плагина должен быть JSON-объектом.")
    if not hasattr(plugin_manager, "_normalize_manifest"):
      raise ValueError("Менеджер плагинов не поддерживает валидацию манифестов.")

    descriptor = plugin_manager._normalize_manifest(payload)
    plugin_id = sanitize_plugin_id(descriptor.id)
    if not plugin_id:
      raise ValueError("Некорректный id плагина.")
    if plugin_id in builtin_plugin_ids:
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
      "installed_at": utc_now_iso(),
    }
    repo_url = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
    if repo_url:
      try:
        manifest["repo_url"] = normalize_http_url(repo_url)
      except ValueError:
        manifest["repo_url"] = ""
    return manifest

  def write_user_manifest(plugin_id: str, manifest: dict[str, Any]) -> None:
    safe_plugin_id = sanitize_plugin_id(plugin_id)
    if not safe_plugin_id:
      raise ValueError("Некорректный id плагина.")
    file_path = (user_plugins_dir / f"{safe_plugin_id}.json").resolve()
    if file_path.parent != user_plugins_dir.resolve():
      raise ValueError("Некорректный путь сохранения плагина.")
    file_path.write_text(
      json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
      encoding="utf-8",
    )
    try:
      os.chmod(file_path, 0o600)
    except OSError:
      pass

  @app.get("/health")
  def health() -> dict[str, Any]:
    plugins_payload = list_plugins_payload()
    selected_tier = model_engine.get_selected_tier()
    loaded_tier = model_engine.get_loaded_tier()
    startup = model_engine.get_startup_snapshot()
    startup_state = str(startup.get("status") or "").strip().lower()
    service_state = "ok"
    if startup_state in {"booting", "loading"}:
      service_state = "starting"
    elif startup_state == "idle":
      service_state = "idle"
    elif startup_state == "error":
      service_state = "degraded"

    return {
      "status": service_state,
      "service": "ancia-local-backend",
      "time": utc_now_iso(),
      "model": {
        "name": model_engine.model_name,
        "tier": selected_tier,
        "selected_tier": selected_tier,
        "loaded_tier": loaded_tier,
        "selected_model": model_engine.get_selected_model_id(selected_tier),
        "loaded_model": model_engine.get_loaded_model_id(),
        "repo": model_engine.model_repo,
        "selected_repo": model_engine.get_model_repo_for_tier(selected_tier),
        "catalog": model_engine.list_models_catalog(),
        "ready": startup_state == "ready",
      },
      "startup": startup,
      "runtime": model_engine.get_runtime_snapshot() if hasattr(model_engine, "get_runtime_snapshot") else {
        "startup": startup,
      },
      "plugins": plugins_payload["summary"],
      "policy": {
        "autonomous_mode": bool(plugins_payload.get("autonomous_mode")),
      },
      "data_dir": data_dir,
    }

  def build_models_payload() -> dict[str, Any]:
    selected_tier = model_engine.get_selected_tier()
    startup = model_engine.get_startup_snapshot()
    runtime = model_engine.get_runtime_snapshot()
    cache_map = (
      model_engine.get_local_cache_map()
      if hasattr(model_engine, "get_local_cache_map")
      else {}
    )
    startup_details = startup.get("details") if isinstance(startup, dict) and isinstance(startup.get("details"), dict) else {}
    progress_percent = startup_details.get("progress_percent")
    if progress_percent is None:
      stage = str(startup.get("stage") or "").strip().lower()
      progress_percent = {
        "backend_boot": 4,
        "environment_check": 15,
        "checking_gpu_memory": 30,
        "loading_model": 72,
        "ready": 100,
        "error": 100,
        "unloaded": 0,
      }.get(stage, 0)
    return {
      "selected": selected_tier,
      "loaded": model_engine.get_loaded_tier(),
      "selected_model": model_engine.get_selected_model_id(selected_tier),
      "loaded_model": model_engine.get_loaded_model_id(),
      "startup": startup,
      "runtime": runtime,
      "startup_progress_percent": max(0, min(100, int(progress_percent or 0))),
      "tiers": model_engine.list_tiers(),
      "models": model_engine.list_models_catalog(),
      "installed_models": cache_map,
    }

  @app.get("/models")
  def list_models() -> dict[str, Any]:
    return build_models_payload()

  @app.post("/models/select")
  def select_model(payload: ModelSelectRequest) -> dict[str, Any]:
    selected_tier = model_engine.get_selected_tier()
    try:
      if str(payload.tier or "").strip():
        selected_tier = model_engine.set_selected_tier(payload.tier)
      if str(payload.model_id or "").strip():
        model_engine.set_selected_model(payload.model_id, tier=selected_tier)
      if bool(getattr(payload, "load", False)):
        model_engine.start_background_load(selected_tier)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_models_payload()

  @app.post("/models/load")
  def load_model(payload: ModelSelectRequest | None = None) -> dict[str, Any]:
    data = payload or ModelSelectRequest()
    selected_tier = model_engine.get_selected_tier()
    try:
      if str(data.tier or "").strip():
        selected_tier = model_engine.set_selected_tier(data.tier)
      if str(data.model_id or "").strip():
        model_engine.set_selected_model(data.model_id, tier=selected_tier)
      model_engine.start_background_load(selected_tier)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc
    return build_models_payload()

  @app.post("/models/unload")
  def unload_model() -> dict[str, Any]:
    model_engine.unload_model()
    return build_models_payload()

  @app.delete("/models/{model_id}/cache")
  def delete_model_cache(model_id: str) -> dict[str, Any]:
    safe_model_id = str(model_id or "").strip().lower()
    if not safe_model_id:
      raise HTTPException(status_code=400, detail="model_id is required")
    try:
      deleted = model_engine.delete_local_model_cache(safe_model_id)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
      raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
      "ok": bool(deleted),
      "deleted": bool(deleted),
      "model_id": safe_model_id,
      "models_payload": build_models_payload(),
    }

  @app.patch("/models/{model_id}/params")
  def update_model_params(model_id: str, payload: ModelParamsUpdateRequest) -> dict[str, Any]:
    safe_model_id = str(model_id or "").strip().lower()
    if not safe_model_id:
      raise HTTPException(status_code=400, detail="model_id is required")
    requested = {
      "context_window": payload.context_window,
      "max_tokens": payload.max_tokens,
      "temperature": payload.temperature,
      "top_p": payload.top_p,
      "top_k": payload.top_k,
    }
    requested = {key: value for key, value in requested.items() if value is not None}
    if not requested:
      raise HTTPException(status_code=400, detail="No model params provided")

    model_item = next((item for item in model_engine.list_models_catalog() if str(item.get("id")) == safe_model_id), None)
    tier_hint = str(model_item.get("recommended_tier") or model_engine.get_selected_tier()) if model_item else model_engine.get_selected_tier()
    try:
      params = model_engine.set_model_params(
        safe_model_id,
        requested,
        tier_key=tier_hint,
      )
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
      "ok": True,
      "model_id": safe_model_id,
      "params": params,
      "models_payload": build_models_payload(),
    }

  @app.get("/tools")
  def list_tools() -> dict[str, Any]:
    autonomous_mode = get_autonomous_mode()
    return {
      "tools": tool_registry.list_tools(),
      "autonomous_mode": autonomous_mode,
    }

  @app.get("/settings")
  def get_settings() -> dict[str, Any]:
    return get_settings_payload()

  @app.patch("/settings")
  def patch_settings(payload: dict[str, Any] | None = None) -> dict[str, Any]:
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

    saved = persist_settings_payload(
      runtime_config=runtime_config,
      onboarding_state=onboarding_state,
      autonomous_mode=autonomous_mode,
    )
    return saved

  @app.get("/app/state")
  def app_state() -> dict[str, Any]:
    startup = model_engine.get_startup_snapshot()
    startup_state = str(startup.get("status") or "").strip().lower()
    return {
      "status": "ok" if startup_state == "ready" else ("degraded" if startup_state == "error" else "starting"),
      "time": utc_now_iso(),
      "settings": get_settings_payload(),
      "startup": startup,
      "runtime": model_engine.get_runtime_snapshot() if hasattr(model_engine, "get_runtime_snapshot") else {"startup": startup},
      "plugins": list_plugins_payload(),
      "store": storage.list_chat_store(),
    }

  @app.post("/app/reset")
  def app_reset(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    reset_onboarding = bool(body.get("reset_onboarding", True))
    previous_settings = get_settings_payload()
    model_engine.request_stop_generation()
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
    defaults = persist_settings_payload(
      runtime_config=DEFAULT_RUNTIME_CONFIG,
      onboarding_state=DEFAULT_ONBOARDING_STATE if reset_onboarding else previous_settings["onboarding_state"],
      autonomous_mode=False,
    )
    plugin_manager.reload()
    return {
      "ok": True,
      "message": "Локальные данные приложения сброшены.",
      "settings": defaults,
      "store": storage.list_chat_store(),
      "plugins": list_plugins_payload(),
      "removed_plugin_files": removed_plugin_files,
    }

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
      storage.set_setting(PLUGIN_REGISTRY_URL_SETTING_KEY, DEFAULT_PLUGIN_REGISTRY_URL)
      return build_registry_plugins_payload()

    try:
      normalized_registry_url = normalize_http_url(registry_url_input)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    storage.set_setting(PLUGIN_REGISTRY_URL_SETTING_KEY, normalized_registry_url)
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
        max_bytes=MAX_MANIFEST_DOWNLOAD_BYTES,
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
          max_bytes=MAX_MANIFEST_DOWNLOAD_BYTES,
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

  @app.get("/chats")
  def list_chats() -> dict[str, Any]:
    return storage.list_chat_store()

  @app.post("/chats")
  def create_chat(payload: ChatCreateRequest) -> dict[str, Any]:
    requested_chat_id = str(payload.id or "").strip()
    requested_title = str(payload.title or "").strip() or "Новая сессия"
    raw_mood = str(payload.mood or "").strip()
    requested_mood = normalize_mood(raw_mood, "") if raw_mood else ""

    session = storage.create_chat(
      chat_id=requested_chat_id,
      title=requested_title,
      mood=requested_mood,
    )
    if session is None:
      raise HTTPException(status_code=409, detail=f"Chat '{requested_chat_id}' already exists")

    return {
      "chat": session,
      "store": storage.list_chat_store(),
    }

  @app.patch("/chats/{chat_id}")
  def update_chat(chat_id: str, payload: ChatUpdateRequest) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")

    next_mood = payload.mood if payload.mood is None else normalize_mood(payload.mood, "")
    session = storage.update_chat(
      safe_chat_id,
      title=payload.title,
      mood=next_mood,
    )
    if session is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    return {
      "chat": session,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}")
  def delete_chat(chat_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")

    chats = storage.list_chats()
    if not any(str(chat.get("id")) == safe_chat_id for chat in chats):
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")
    if len(chats) <= 1:
      raise HTTPException(status_code=409, detail="Cannot delete the last chat")

    storage.delete_chat(safe_chat_id)
    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }

  @app.post("/chats/{chat_id}/duplicate")
  def duplicate_chat(chat_id: str, payload: ChatDuplicateRequest | None = None) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    body = payload or ChatDuplicateRequest()
    requested_target_id = str(body.id or "").strip()
    if requested_target_id and storage.get_chat(requested_target_id) is not None:
      raise HTTPException(status_code=409, detail=f"Chat '{requested_target_id}' already exists")

    duplicated = storage.duplicate_chat(
      safe_chat_id,
      target_chat_id=requested_target_id,
      title=body.title,
    )
    if duplicated is None:
      raise HTTPException(status_code=500, detail="Failed to duplicate chat")

    return {
      "chat": duplicated,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}/messages")
  def clear_chat_messages(chat_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    deleted = storage.clear_chat_messages(safe_chat_id)
    return {
      "deleted": deleted,
      "store": storage.list_chat_store(),
    }

  @app.patch("/chats/{chat_id}/messages/{message_id}")
  def update_chat_message(chat_id: str, message_id: str, payload: MessageUpdateRequest) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    next_text = str(payload.text or "").strip()
    if not next_text:
      raise HTTPException(status_code=400, detail="text is required")

    updated = storage.edit_message(safe_chat_id, message_id, next_text)
    if not updated:
      raise HTTPException(status_code=404, detail=f"Message '{message_id}' not found")

    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}/messages/{message_id}")
  def delete_chat_message(chat_id: str, message_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    deleted = storage.delete_message(safe_chat_id, message_id)
    if not deleted:
      raise HTTPException(status_code=404, detail=f"Message '{message_id}' not found")

    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }

  def format_tool_event_for_chat(event: ToolEvent) -> tuple[str, str]:
    name = str(event.name or "").strip().lower()
    status = str(event.status or "").strip().lower() or "ok"
    summary = model_engine._summarize_tool_event(event).strip()
    safe_summary = model_engine._truncate_text(summary, 2600) if summary else ""

    if name == "web.search.duckduckgo":
      query = str(event.output.get("query") or "").strip()
      header = f"Поиск: {query}" if query else "Поиск"
      label = f"{header}\n{safe_summary}".strip()
      return label, f"инструмент • {status}"

    if name == "web.visit.website":
      url = str(event.output.get("url") or event.output.get("requested_url") or "").strip()
      header = f"Страница: {url}" if url else "Страница"
      label = f"{header}\n{safe_summary}".strip()
      return label, f"инструмент • {status}"

    if name == "chat.set_mood":
      mood = str(event.output.get("mood") or "").strip()
      header = f"chat.set_mood: {mood}" if mood else "chat.set_mood"
      label = f"{header}\n{safe_summary}".strip()
      return label, f"инструмент • {status}"

    header = name or "tool"
    label = f"{header}\n{safe_summary}".strip()
    return label, f"инструмент • {status}"

  def prepare_chat_turn(
    payload: ChatRequest,
  ) -> tuple[str, str, str, str, RuntimeChatContext, set[str]]:
    user_text = payload.message.strip()
    attachments = list(payload.attachments or [])
    if not user_text and not attachments:
      raise HTTPException(status_code=400, detail="message or attachments are required")
    if not user_text and attachments:
      user_text = "Проанализируй вложения пользователя."

    requested_tier = normalize_model_tier_key_fn(
      payload.context.ui.modelTier,
      model_engine.get_selected_tier(),
    )
    if requested_tier != model_engine.get_selected_tier():
      model_engine.set_selected_tier(requested_tier)
    requested_model_id = str(payload.context.ui.modelId or "").strip().lower()
    if requested_model_id and requested_model_id != model_engine.get_selected_model_id(requested_tier):
      try:
        model_engine.set_selected_model(requested_model_id, tier=requested_tier)
      except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not model_engine.is_ready():
      raise HTTPException(
        status_code=503,
        detail={
          "message": model_engine.get_unavailable_message(),
          "startup": model_engine.get_startup_snapshot(),
        },
      )

    def is_placeholder_chat_title(raw_title: str) -> bool:
      safe_title = str(raw_title or "").strip().lower()
      if not safe_title:
        return False
      return bool(re.match(r"^новая\s+сессия\b", safe_title))

    chat_id = str(payload.context.chat_id or "default").strip() or "default"
    existing_chat = storage.get_chat(chat_id)
    existing_messages = storage.get_chat_messages(chat_id, limit=1) if existing_chat is not None else []
    is_first_turn = existing_chat is None or len(existing_messages) == 0
    requested_chat_title = str(payload.context.chat_title or "").strip()
    existing_chat_title = str(existing_chat["title"]) if existing_chat is not None else ""
    requested_is_placeholder = is_placeholder_chat_title(requested_chat_title)
    existing_is_placeholder = is_placeholder_chat_title(existing_chat_title)
    should_generate_title = bool(
      is_first_turn
      and (
        not requested_chat_title
        or requested_is_placeholder
        or existing_is_placeholder
      )
    )
    if requested_chat_title and not requested_is_placeholder:
      chat_title = requested_chat_title
    elif existing_chat_title:
      chat_title = existing_chat_title
    else:
      chat_title = requested_chat_title or (user_text[:96] or "Новая сессия")
    if should_generate_title:
      generated_title = str(model_engine.suggest_chat_title(user_text) or "").strip()
      if generated_title:
        chat_title = generated_title

    incoming_mood = normalize_mood(payload.context.mood, "neutral")
    storage.ensure_chat(chat_id, chat_title, incoming_mood)
    should_update_title = (
      existing_chat is not None
      and bool(chat_title)
      and chat_title != existing_chat_title
      and (not is_placeholder_chat_title(chat_title) or existing_is_placeholder)
    )
    if should_update_title:
      storage.update_chat(chat_id, title=chat_title)

    # Источник истории только backend-БД: не доверяем клиентскому кэшу.
    stored_history = storage.get_chat_messages(chat_id, limit=24)
    history_for_model: list[HistoryMessage] = []
    for entry in stored_history:
      role = str(entry.get("role") or "").strip().lower()
      if role not in {"user", "assistant", "system"}:
        continue
      text = str(entry.get("text") or "").strip()
      if not text:
        continue
      history_for_model.append(
        HistoryMessage(
          role=role,
          text=text,
          timestamp=str(entry.get("timestamp") or ""),
        )
      )
    payload.context.history = history_for_model

    attachment_payloads: list[dict[str, Any]] = []
    attachment_preview_lines: list[str] = []
    for index, attachment in enumerate(attachments, start=1):
      payload_item = attachment.model_dump()
      attachment_payloads.append(payload_item)
      safe_name = str(payload_item.get("name") or f"file-{index}").strip()
      safe_kind = str(payload_item.get("kind") or "file").strip().lower()
      safe_mime = str(payload_item.get("mimeType") or "").strip()
      try:
        safe_size = max(0, int(payload_item.get("size") or 0))
      except (TypeError, ValueError):
        safe_size = 0
      label_parts = [safe_name]
      meta_parts = [safe_kind]
      if safe_mime:
        meta_parts.append(safe_mime)
      if safe_size > 0:
        meta_parts.append(f"{safe_size} bytes")
      label_parts.append(f"({', '.join(meta_parts)})")
      text_content = str(payload_item.get("textContent") or "").strip()
      if text_content:
        preview = text_content[:220].replace("\n", " ")
        if len(text_content) > 220:
          preview += "…"
        label_parts.append(f"— {preview}")
      attachment_preview_lines.append(f"{index}. {' '.join(label_parts)}")

    user_text_for_storage = user_text
    if attachment_preview_lines:
      user_text_for_storage = (
        f"{user_text}\n\nВложения:\n" + "\n".join(attachment_preview_lines)
      ).strip()

    storage.append_message(
      chat_id=chat_id,
      role="user",
      text=user_text_for_storage,
      meta={
        "source": "ui",
        "meta_suffix": "",
        "attachments": attachment_payloads,
      },
    )

    runtime = RuntimeChatContext(
      chat_id=chat_id,
      mood=incoming_mood,
      user_name=payload.context.user.name.strip(),
      timezone=payload.context.user.timezone.strip() or "UTC",
    )

    autonomous_mode = get_autonomous_mode()
    plugin_manager.reload()
    active_tools = plugin_manager.resolve_active_tools(autonomous_mode=autonomous_mode)
    active_tools = {tool for tool in active_tools if tool_registry.has_tool(tool)}
    return user_text, chat_id, chat_title, incoming_mood, runtime, active_tools

  def build_chat_response(
    *,
    payload: ChatRequest,
    user_text: str,
    chat_id: str,
    incoming_mood: str,
    active_tools: set[str],
    result: Any,
  ) -> ChatResponse:
    final_mood = normalize_mood(result.mood, incoming_mood)
    storage.update_chat_mood(chat_id, final_mood)

    system_prompt_value = build_system_prompt_fn(
      system_prompt,
      payload,
      active_tools=active_tools,
    )
    for event in result.tool_events:
      tool_text, tool_meta_suffix = format_tool_event_for_chat(event)
      storage.append_message(
        chat_id=chat_id,
        role="tool",
        text=tool_text,
        meta={
          "meta_suffix": tool_meta_suffix,
          "tool_name": event.name,
          "status": event.status,
          "tool_output": event.output,
        },
      )
    storage.append_message(
      chat_id=chat_id,
      role="assistant",
      text=result.reply,
      meta={
        "model": result.model_name,
        "mood": final_mood,
        "meta_suffix": "бэкенд",
        "system_prompt": system_prompt_value,
        "tool_events": [event.model_dump() for event in result.tool_events],
      },
    )

    token_estimate = max(1, len(user_text) // 4 + len(result.reply) // 4)
    return ChatResponse(
      chat_id=chat_id,
      reply=result.reply,
      mood=final_mood,
      model=result.model_name,
      tool_events=result.tool_events,
      usage={
        "prompt_tokens": token_estimate,
        "completion_tokens": max(1, len(result.reply) // 4),
        "total_tokens": token_estimate + max(1, len(result.reply) // 4),
      },
    )

  def _format_sse(event: str, payload: dict[str, Any]) -> str:
    body = json.dumps(payload, ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n"

  @app.post("/chat", response_model=ChatResponse)
  def chat(payload: ChatRequest) -> ChatResponse:
    user_text, chat_id, _chat_title, incoming_mood, runtime, active_tools = prepare_chat_turn(payload)

    try:
      result = model_engine.complete(
        request=payload,
        runtime=runtime,
        tool_registry=tool_registry,
        active_tools=active_tools,
      )
    except RuntimeError as exc:
      raise HTTPException(
        status_code=503,
        detail={
          "message": str(exc),
          "startup": model_engine.get_startup_snapshot(),
        },
      ) from exc

    return build_chat_response(
      payload=payload,
      user_text=user_text,
      chat_id=chat_id,
      incoming_mood=incoming_mood,
      active_tools=active_tools,
      result=result,
    )

  @app.post("/chat/stream")
  def chat_stream(payload: ChatRequest) -> StreamingResponse:
    user_text, chat_id, chat_title, incoming_mood, runtime, active_tools = prepare_chat_turn(payload)

    def stream_events() -> Generator[str, None, None]:
      yield _format_sse(
        "start",
        {
          "chat_id": chat_id,
          "model": model_engine.model_name,
          "tier": model_engine.get_selected_tier(),
          "model_id": model_engine.get_selected_model_id(model_engine.get_selected_tier()),
        },
      )

      assistant_message_id = storage.append_message(
        chat_id=chat_id,
        role="assistant",
        text="",
        meta={
          "model": model_engine.model_name,
          "mood": incoming_mood,
          "meta_suffix": "бэкенд",
          "streaming": True,
          "tool_events": [],
        },
      )
      assistant_stream_text = ""
      tool_message_by_invocation: dict[str, str] = {}

      try:
        result: Any = None
        queue: queue_lib.Queue[tuple[str, Any]] = queue_lib.Queue()

        def run_generation() -> None:
          try:
            iterator = model_engine.iter_complete(
              request=payload,
              runtime=runtime,
              tool_registry=tool_registry,
              active_tools=active_tools,
            )
            while True:
              try:
                item = next(iterator)
              except StopIteration as stop:
                queue.put(("done", stop.value))
                return
              queue.put(("item", item))
          except Exception as exc:
            queue.put(("error", exc))

        worker = threading.Thread(
          target=run_generation,
          name=f"ancia-stream-worker-{chat_id}",
          daemon=True,
        )
        worker.start()

        yield _format_sse(
          "status",
          {
            "stage": "generating",
            "message": "Модель формирует ответ...",
          },
        )

        while True:
          try:
            packet_type, packet_payload = queue.get(timeout=0.8)
          except queue_lib.Empty:
            yield ": ping\n\n"
            continue

          if packet_type == "item":
            delta = packet_payload
            if isinstance(delta, dict):
              kind = str(delta.get("kind") or "").strip().lower()
              tool_payload = delta.get("payload")
              if not isinstance(tool_payload, dict):
                tool_payload = {}
              if kind == "tool_start":
                tool_invocation_id = str(tool_payload.get("invocation_id") or "").strip()
                tool_name = str(tool_payload.get("name") or "tool")
                tool_text = str(tool_payload.get("text") or tool_name).strip() or tool_name
                tool_meta = {
                  "meta_suffix": str(tool_payload.get("meta_suffix") or "инструмент • запуск"),
                  "tool_name": tool_name,
                  "status": str(tool_payload.get("status") or "running"),
                  "tool_args": tool_payload.get("args") if isinstance(tool_payload.get("args"), dict) else {},
                  "tool_output": tool_payload.get("output") if isinstance(tool_payload.get("output"), dict) else {},
                  "tool_phase": "start",
                  "invocation_id": tool_invocation_id,
                }
                if tool_invocation_id and tool_invocation_id in tool_message_by_invocation:
                  storage.update_message(
                    chat_id,
                    tool_message_by_invocation[tool_invocation_id],
                    text=tool_text,
                    meta=tool_meta,
                  )
                else:
                  tool_message_id = storage.append_message(
                    chat_id=chat_id,
                    role="tool",
                    text=tool_text,
                    meta=tool_meta,
                  )
                  if tool_invocation_id:
                    tool_message_by_invocation[tool_invocation_id] = tool_message_id
                yield _format_sse("tool_start", tool_payload)
                continue
              if kind == "tool_result":
                tool_invocation_id = str(tool_payload.get("invocation_id") or "").strip()
                tool_name = str(tool_payload.get("name") or "tool")
                tool_text = str(tool_payload.get("text") or tool_name).strip() or tool_name
                tool_meta = {
                  "meta_suffix": str(tool_payload.get("meta_suffix") or "инструмент • ok"),
                  "tool_name": tool_name,
                  "status": str(tool_payload.get("status") or "ok"),
                  "tool_args": tool_payload.get("args") if isinstance(tool_payload.get("args"), dict) else {},
                  "tool_output": tool_payload.get("output") if isinstance(tool_payload.get("output"), dict) else {},
                  "tool_phase": "result",
                  "invocation_id": tool_invocation_id,
                }
                if tool_invocation_id and tool_invocation_id in tool_message_by_invocation:
                  storage.update_message(
                    chat_id,
                    tool_message_by_invocation[tool_invocation_id],
                    text=tool_text,
                    meta=tool_meta,
                  )
                else:
                  tool_message_id = storage.append_message(
                    chat_id=chat_id,
                    role="tool",
                    text=tool_text,
                    meta=tool_meta,
                  )
                  if tool_invocation_id:
                    tool_message_by_invocation[tool_invocation_id] = tool_message_id
                yield _format_sse("tool_result", tool_payload)
                continue
            if not delta:
              continue
            assistant_stream_text += str(delta)
            storage.update_message(
              chat_id,
              assistant_message_id,
              text=assistant_stream_text,
              meta={
                "model": model_engine.model_name,
                "mood": incoming_mood,
                "meta_suffix": "бэкенд",
                "streaming": True,
              },
            )
            yield _format_sse("delta", {"text": delta})
            continue

          if packet_type == "done":
            result = packet_payload
            break

          if packet_type == "error":
            error = packet_payload
            if isinstance(error, RuntimeError):
              raise error
            raise RuntimeError(str(error))

        if result is None:
          raise RuntimeError("Поток генерации завершился без результата.")

        final_mood = normalize_mood(result.mood, incoming_mood)
        storage.update_chat_mood(chat_id, final_mood)
        system_prompt_value = build_system_prompt_fn(
          system_prompt,
          payload,
          active_tools=active_tools,
        )
        final_reply = str(result.reply or assistant_stream_text or "").strip()
        if not final_reply:
          final_reply = "Не удалось сформировать ответ."
        token_estimate = max(1, len(user_text) // 4 + len(final_reply) // 4)
        response_model = ChatResponse(
          chat_id=chat_id,
          reply=final_reply,
          mood=final_mood,
          model=result.model_name,
          tool_events=result.tool_events,
          usage={
            "prompt_tokens": token_estimate,
            "completion_tokens": max(1, len(final_reply) // 4),
            "total_tokens": token_estimate + max(1, len(final_reply) // 4),
          },
        )
        storage.update_message(
          chat_id,
          assistant_message_id,
          text=final_reply,
          meta={
            "model": result.model_name,
            "mood": final_mood,
            "meta_suffix": "бэкенд",
            "system_prompt": system_prompt_value,
            "tool_events": [event.model_dump() for event in result.tool_events],
            "streaming": False,
          },
        )
        yield _format_sse(
          "done",
          {
            "chat_id": response_model.chat_id,
            "chat_title": chat_title,
            "reply": response_model.reply,
            "mood": response_model.mood,
            "model": response_model.model,
            "tool_events": [event.model_dump() for event in response_model.tool_events],
            "usage": response_model.usage,
          },
        )
      except RuntimeError as exc:
        storage.update_message(
          chat_id,
          assistant_message_id,
          text=assistant_stream_text or str(exc),
          meta={
            "model": model_engine.model_name,
            "mood": "error",
            "meta_suffix": "ошибка бэкенда",
            "streaming": False,
            "error": str(exc),
          },
        )
        yield _format_sse(
          "error",
          {
            "message": str(exc),
            "startup": model_engine.get_startup_snapshot(),
          },
        )

    return StreamingResponse(
      stream_events(),
      media_type="text/event-stream",
      headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    )

  @app.post("/chat/stop")
  def stop_chat_generation() -> dict[str, Any]:
    model_engine.request_stop_generation()
    return {
      "ok": True,
      "message": "Сигнал остановки генерации отправлен.",
    }

  @app.get("/chats/{chat_id}/history")
  def chat_history(chat_id: str, limit: int = 40) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    safe_limit = max(1, min(200, int(limit)))
    history = storage.get_chat_messages(safe_chat_id, safe_limit)
    return {
      "chat_id": safe_chat_id,
      "history": history,
    }
