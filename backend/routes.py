from __future__ import annotations

import asyncio
import json
import os
import queue as queue_lib
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Generator
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

try:
  from backend.access_control import user_can_download_models
  from backend.common import normalize_mood, utc_now_iso
  from backend.deployment import DEPLOYMENT_MODE_REMOTE_SERVER, resolve_deployment_mode
  from backend.plugin_permissions import (
    DEFAULT_DOMAIN_PERMISSION_POLICY,
    DEFAULT_PLUGIN_PERMISSION_POLICY,
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
    read_domain_default_policy,
    read_domain_permissions,
    read_plugin_permissions,
    read_tool_permissions,
  )
  from backend.plugin_marketplace_service import PluginMarketplaceService
  from backend.routes_chat_store import register_chat_store_routes
  from backend.routes_models import register_model_routes
  from backend.routes_plugins import register_plugin_routes
  from backend.routes_settings import register_settings_routes
  from backend.settings_service import (
    DEFAULT_ONBOARDING_STATE,
    DEFAULT_RUNTIME_CONFIG,
    SettingsService,
  )
  from backend.text_stream_utils import compact_repetitions, is_repetition_runaway
  from backend.schemas import (
    HistoryMessage,
    ChatRequest,
    ChatResponse,
    RuntimeChatContext,
    ToolEvent,
  )
except ModuleNotFoundError:
  from access_control import user_can_download_models  # type: ignore
  from common import normalize_mood, utc_now_iso  # type: ignore
  from deployment import DEPLOYMENT_MODE_REMOTE_SERVER, resolve_deployment_mode  # type: ignore
  from plugin_permissions import (  # type: ignore
    DEFAULT_DOMAIN_PERMISSION_POLICY,
    DEFAULT_PLUGIN_PERMISSION_POLICY,
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
    read_domain_default_policy,
    read_domain_permissions,
    read_plugin_permissions,
    read_tool_permissions,
  )
  from plugin_marketplace_service import PluginMarketplaceService  # type: ignore
  from routes_chat_store import register_chat_store_routes  # type: ignore
  from routes_models import register_model_routes  # type: ignore
  from routes_plugins import register_plugin_routes  # type: ignore
  from routes_settings import register_settings_routes  # type: ignore
  from settings_service import (  # type: ignore
    DEFAULT_ONBOARDING_STATE,
    DEFAULT_RUNTIME_CONFIG,
    SettingsService,
  )
  from text_stream_utils import compact_repetitions, is_repetition_runaway  # type: ignore
  from schemas import (  # type: ignore
    HistoryMessage,
    ChatRequest,
    ChatResponse,
    RuntimeChatContext,
    ToolEvent,
  )

try:
  from backend.netguard import open_safe_http_request
except ModuleNotFoundError:
  from netguard import open_safe_http_request  # type: ignore

SAFE_IMAGE_DATA_URL_RE = re.compile(
  r"^data:image/(?:png|jpe?g|webp|gif|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,[a-z0-9+/=]+$",
  flags=re.IGNORECASE,
)


def _is_safe_image_data_url(value: Any) -> bool:
  return bool(SAFE_IMAGE_DATA_URL_RE.match(str(value or "").strip()))


def register_api_routes(
  app: FastAPI,
  *,
  storage: Any,
  model_engine: Any,
  tool_registry: Any,
  plugin_manager: Any,
  system_prompt: str,
  data_dir: str,
  plugins_root_dir: str,
  plugins_user_dir: str,
  plugins_preinstalled_dir: str,
  build_system_prompt_fn: Callable[..., str],
  refresh_tool_registry_fn: Callable[[], None] | None = None,
  auth_service: Any | None = None,
) -> None:
  settings_service = SettingsService(storage=storage, model_engine=model_engine)
  get_autonomous_mode = settings_service.get_autonomous_mode
  get_settings_payload = settings_service.get_settings_payload
  persist_settings_payload = settings_service.persist_settings_payload
  PLUGIN_REGISTRY_URL_SETTING_KEY = "plugin_registry_url"
  DEFAULT_PLUGIN_REGISTRY_URL = (
    os.getenv("ANCIA_PLUGIN_REGISTRY_URL", "").strip()
  )
  MAX_REGISTRY_DOWNLOAD_BYTES = 1024 * 1024
  plugins_user_path = Path(plugins_user_dir).resolve()
  plugins_preinstalled_path = Path(plugins_preinstalled_dir).resolve()
  plugin_marketplace = PluginMarketplaceService(
    storage=storage,
    plugin_manager=plugin_manager,
    user_plugins_dir=plugins_user_path,
    preinstalled_plugins_dir=plugins_preinstalled_path,
    plugin_registry_url_setting_key=PLUGIN_REGISTRY_URL_SETTING_KEY,
    default_plugin_registry_url=DEFAULT_PLUGIN_REGISTRY_URL,
    max_registry_download_bytes=MAX_REGISTRY_DOWNLOAD_BYTES,
    utc_now_fn=utc_now_iso,
  )
  _tool_registry_refresh_interval_sec = max(
    1.0,
    float(os.getenv("ANCIA_TOOL_REGISTRY_REFRESH_INTERVAL_SEC", "8") or 8),
  )
  _tool_registry_refresh_lock = threading.Lock()
  _tool_registry_last_refresh_monotonic = 0.0

  def maybe_refresh_tool_registry(force: bool = False) -> None:
    nonlocal _tool_registry_last_refresh_monotonic
    if not callable(refresh_tool_registry_fn):
      plugin_manager.reload()
      return
    now_monotonic = time.monotonic()
    if not force and (now_monotonic - _tool_registry_last_refresh_monotonic) < _tool_registry_refresh_interval_sec:
      return
    with _tool_registry_refresh_lock:
      now_monotonic = time.monotonic()
      if not force and (now_monotonic - _tool_registry_last_refresh_monotonic) < _tool_registry_refresh_interval_sec:
        return
      refresh_tool_registry_fn()
      _tool_registry_last_refresh_monotonic = now_monotonic

  def normalize_http_url(url_like: Any) -> str:
    return plugin_marketplace.normalize_http_url(url_like)

  def list_plugins_payload() -> dict[str, Any]:
    return plugin_marketplace.list_plugins_payload(autonomous_mode=get_autonomous_mode())

  def build_registry_plugins_payload() -> dict[str, Any]:
    return plugin_marketplace.build_registry_plugins_payload(autonomous_mode=get_autonomous_mode())

  def _bootstrap_preinstalled_plugins() -> None:
    try:
      bootstrap_result = plugin_marketplace.ensure_preinstalled_plugins(autonomous_mode=False)
      if (bootstrap_result.get("installed") or bootstrap_result.get("updated")):
        maybe_refresh_tool_registry(force=True)
    except Exception:
      # Bootstrap preinstalled plugins must not break backend startup.
      return

  should_bootstrap_preinstalled = str(os.getenv("ANCIA_ENABLE_PLUGIN_BOOTSTRAP", "") or "").strip() == "1"
  if should_bootstrap_preinstalled and not get_autonomous_mode():
    bootstrap_thread = threading.Thread(
      target=_bootstrap_preinstalled_plugins,
      name="ancia-plugin-bootstrap",
      daemon=True,
    )
    bootstrap_thread.start()

  @app.get("/health")
  def health() -> dict[str, Any]:
    plugins_payload = list_plugins_payload()
    selected_model_id = model_engine.get_selected_model_id()
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
      "deployment_mode": resolve_deployment_mode(storage),
      "model": {
        "name": model_engine.model_name,
        "selected_model": selected_model_id,
        "loaded_model": model_engine.get_loaded_model_id(),
        "repo": model_engine.model_repo,
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

  register_model_routes(
    app,
    model_engine=model_engine,
    tool_registry=tool_registry,
    plugin_manager=plugin_manager,
    get_autonomous_mode=get_autonomous_mode,
  )

  register_settings_routes(
    app,
    storage=storage,
    model_engine=model_engine,
    plugin_manager=plugin_manager,
    user_plugins_dir=plugins_user_path,
    get_settings_payload=get_settings_payload,
    persist_settings_payload=persist_settings_payload,
    list_plugins_payload=list_plugins_payload,
    default_runtime_config=DEFAULT_RUNTIME_CONFIG,
    default_onboarding_state=DEFAULT_ONBOARDING_STATE,
    refresh_tool_registry_fn=refresh_tool_registry_fn,
    auth_service=auth_service,
  )

  register_plugin_routes(
    app,
    storage=storage,
    plugin_manager=plugin_manager,
    plugin_marketplace=plugin_marketplace,
    plugin_registry_url_setting_key=PLUGIN_REGISTRY_URL_SETTING_KEY,
    default_plugin_registry_url=DEFAULT_PLUGIN_REGISTRY_URL,
    get_autonomous_mode=get_autonomous_mode,
    refresh_tool_registry_fn=refresh_tool_registry_fn,
  )

  register_chat_store_routes(
    app,
    storage=storage,
    normalize_mood_fn=normalize_mood,
  )

  def _fetch_link_headers(url: str) -> tuple[str, dict[str, str]]:
    safe_url = normalize_http_url(url)
    if not safe_url:
      raise HTTPException(status_code=400, detail="Некорректный URL")

    headers = {
      "User-Agent": "AnciaLinkOverlay/1.0 (+https://localhost)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    req_head = url_request.Request(safe_url, method="HEAD", headers=headers)
    try:
      with open_safe_http_request(
        req_head,
        timeout=7.0,
        allow_http=True,
        allow_loopback=False,
        allow_private=False,
      ) as response:
        final_url = str(response.geturl() or safe_url)
        normalized_headers = {
          str(key or "").lower(): str(value or "")
          for key, value in response.headers.items()
        }
        return final_url, normalized_headers
    except url_error.HTTPError as exc:
      if int(getattr(exc, "code", 0) or 0) not in {403, 405, 501}:
        raise HTTPException(status_code=400, detail=f"Не удалось проверить URL: HTTP {exc.code}") from exc
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"Не удалось проверить URL: {exc}") from exc

    req_get = url_request.Request(
      safe_url,
      method="GET",
      headers={
        **headers,
        "Range": "bytes=0-0",
      },
    )
    try:
      with open_safe_http_request(
        req_get,
        timeout=7.0,
        allow_http=True,
        allow_loopback=False,
        allow_private=False,
      ) as response:
        final_url = str(response.geturl() or safe_url)
        normalized_headers = {
          str(key or "").lower(): str(value or "")
          for key, value in response.headers.items()
        }
        return final_url, normalized_headers
    except url_error.HTTPError as exc:
      raise HTTPException(status_code=400, detail=f"Не удалось проверить URL: HTTP {exc.code}") from exc
    except Exception as exc:
      raise HTTPException(status_code=400, detail=f"Не удалось проверить URL: {exc}") from exc

  def _extract_frame_ancestors(csp_value: str) -> list[str]:
    safe_csp = str(csp_value or "").strip()
    if not safe_csp:
      return []
    match = re.search(r"(?:^|;)\s*frame-ancestors\s+([^;]+)", safe_csp, flags=re.IGNORECASE)
    if not match:
      return []
    return [token.strip().strip('"').strip("'") for token in match.group(1).split() if token.strip()]

  def _origin_matches_frame_ancestor(source: str, *, request_origin: str, target_origin: str) -> bool:
    safe_source = str(source or "").strip().lower()
    safe_request_origin = str(request_origin or "").strip().lower()
    safe_target_origin = str(target_origin or "").strip().lower()
    if not safe_source or not safe_request_origin:
      return False
    if safe_source == "*":
      return True
    if safe_source in {"self", "'self'"}:
      return bool(safe_target_origin and safe_request_origin == safe_target_origin)
    if safe_source in {"none", "'none'"}:
      return False

    request_parsed = url_parse.urlparse(safe_request_origin)
    request_scheme = str(request_parsed.scheme or "").strip().lower()
    request_host = str(request_parsed.hostname or "").strip().lower()
    if not request_scheme or not request_host:
      return False

    # CSP host-source может быть без схемы, тогда схема не ограничивается.
    source_has_scheme = "://" in safe_source
    source_allows_any_port = safe_source.endswith(":*")
    source_for_parse = safe_source[:-2] if source_allows_any_port else safe_source
    if not source_has_scheme:
      source_for_parse = f"{request_scheme}://{source_for_parse}"

    parsed_source = url_parse.urlparse(source_for_parse)
    source_scheme = str(parsed_source.scheme or "").strip().lower()
    source_host = str(parsed_source.hostname or "").strip().lower()
    if not source_host:
      return False
    if source_has_scheme and source_scheme and source_scheme != request_scheme:
      return False

    try:
      request_port = request_parsed.port
    except ValueError:
      request_port = None
    if request_port is None:
      if request_scheme == "https":
        request_port = 443
      elif request_scheme == "http":
        request_port = 80

    try:
      source_port = parsed_source.port
    except ValueError:
      source_port = None
    if not source_allows_any_port and source_port is not None:
      if request_port is None or request_port != source_port:
        return False

    if source_host.startswith("*."):
      suffix = source_host[2:]
      if not suffix or request_host == suffix:
        return False
      return request_host.endswith(f".{suffix}")

    return request_host == source_host

  @app.get("/links/inspect")
  async def inspect_link(url: str, request: Request) -> dict[str, Any]:
    final_url, headers = await asyncio.to_thread(_fetch_link_headers, url)
    parsed_target = url_parse.urlparse(final_url)
    target_origin = f"{parsed_target.scheme}://{parsed_target.netloc}".lower() if parsed_target.netloc else ""
    request_origin = str(request.headers.get("origin") or "").strip().lower()
    is_cross_origin = bool(request_origin and target_origin and request_origin != target_origin)

    x_frame_options = str(headers.get("x-frame-options") or "").strip()
    csp = str(headers.get("content-security-policy") or "").strip()
    frame_ancestors = _extract_frame_ancestors(csp)

    blocked_reasons: list[str] = []
    upper_xfo = x_frame_options.upper()
    if "DENY" in upper_xfo:
      blocked_reasons.append("Сайт запрещает iframe через X-Frame-Options: DENY.")
    elif "SAMEORIGIN" in upper_xfo and is_cross_origin:
      blocked_reasons.append("Сайт разрешает iframe только для того же origin (X-Frame-Options: SAMEORIGIN).")
    elif upper_xfo.startswith("ALLOW-FROM") and is_cross_origin:
      blocked_reasons.append("Сайт ограничивает iframe через X-Frame-Options: ALLOW-FROM.")

    if frame_ancestors:
      lower_ancestors = [token.lower() for token in frame_ancestors]
      if any(token in {"none", "'none'"} for token in lower_ancestors):
        blocked_reasons.append("Сайт запрещает iframe через CSP frame-ancestors 'none'.")
      elif request_origin and not any(token in {"*", "'*'"} for token in lower_ancestors):
        allows_origin = any(
          _origin_matches_frame_ancestor(
            token,
            request_origin=request_origin,
            target_origin=target_origin,
          )
          for token in frame_ancestors
        )
        if not allows_origin:
          if any(token in {"self", "'self'"} for token in lower_ancestors):
            blocked_reasons.append("Сайт разрешает iframe только для того же origin (CSP frame-ancestors 'self').")
          else:
            blocked_reasons.append("CSP frame-ancestors не разрешает текущий origin приложения.")

    blocked = len(blocked_reasons) > 0
    return {
      "url": final_url,
      "blocked": blocked,
      "reason": " ".join(blocked_reasons).strip(),
      "headers": {
        "x_frame_options": x_frame_options,
        "content_security_policy": csp,
      },
      "request_origin": request_origin,
      "target_origin": target_origin,
      "cross_origin": is_cross_origin,
    }

  def format_tool_event_for_chat(event: ToolEvent) -> tuple[str, str]:
    name = str(event.name or "").strip().lower()
    display_name = (
      str(tool_registry.get_tool_meta(name).get("display_name") or "").strip()
      if hasattr(tool_registry, "get_tool_meta")
      else ""
    )
    status = str(event.status or "").strip().lower() or "ok"
    summary = model_engine._summarize_tool_event(event).strip()
    safe_summary = model_engine._truncate_text(summary, 2600) if summary else ""
    header = display_name or name or "tool"
    label = f"{header}\n{safe_summary}".strip()
    return label, f"инструмент • {status}"

  def resolve_model_display_name(model_id: str) -> str:
    safe_model_id = str(model_id or "").strip().lower()
    if safe_model_id:
      try:
        catalog = model_engine.list_models_catalog()
      except Exception:
        catalog = []
      if isinstance(catalog, list):
        for item in catalog:
          if not isinstance(item, dict):
            continue
          item_id = str(item.get("id") or "").strip().lower()
          if item_id != safe_model_id:
            continue
          item_label = str(item.get("label") or "").strip()
          if item_label:
            return item_label

    model_name = str(getattr(model_engine, "model_name", "") or "").strip()
    if model_name:
      return model_name
    if safe_model_id:
      return safe_model_id
    return "модель"

  def _startup_progress_percent(startup: dict[str, Any] | None) -> int:
    if isinstance(startup, dict):
      details = startup.get("details")
      if isinstance(details, dict):
        raw_progress = details.get("progress_percent")
        if raw_progress is not None:
          try:
            return max(0, min(100, int(raw_progress)))
          except (TypeError, ValueError):
            pass
      stage = str(startup.get("stage") or "").strip().lower()
    else:
      stage = ""
    stage_progress_map = {
      "backend_boot": 4,
      "environment_check": 15,
      "checking_gpu_memory": 30,
      "loading_model": 72,
      "ready": 100,
      "error": 100,
      "unloaded": 0,
    }
    return int(stage_progress_map.get(stage, 0))

  def _payload_has_image_attachments(payload: ChatRequest) -> bool:
    attachments = list(payload.attachments or [])
    for attachment in attachments:
      item = attachment.model_dump() if hasattr(attachment, "model_dump") else dict(attachment)
      data_url = str(item.get("dataUrl") or "").strip()
      if _is_safe_image_data_url(data_url):
        return True
    return False

  def _selected_model_supports_vision_catalog(selected_model_id: str) -> bool:
    safe_selected_model_id = str(selected_model_id or "").strip().lower()
    if not safe_selected_model_id or not hasattr(model_engine, "list_models_catalog"):
      return False
    try:
      for item in model_engine.list_models_catalog():
        model_id = str(item.get("id") or "").strip().lower()
        if model_id != safe_selected_model_id:
          continue
        return bool(item.get("supports_vision_catalog", item.get("supports_vision", False)))
    except Exception:
      return False
    return False

  def _resolve_required_runtime_backend(*, selected_model_id: str, require_vision_runtime: bool) -> str:
    if require_vision_runtime and _selected_model_supports_vision_catalog(selected_model_id):
      return "mlx_vlm"
    return "mlx_lm"

  def ensure_selected_model_ready(
    *,
    timeout_seconds: float = 240.0,
    require_vision_runtime: bool = False,
  ) -> tuple[str, str]:
    selected_model_id = model_engine.get_selected_model_id()
    selected_model_label = resolve_model_display_name(selected_model_id)
    required_runtime_backend = _resolve_required_runtime_backend(
      selected_model_id=selected_model_id,
      require_vision_runtime=require_vision_runtime,
    )
    prefer_vision_runtime = required_runtime_backend == "mlx_vlm"
    runtime_snapshot = (
      model_engine.get_runtime_snapshot()
      if hasattr(model_engine, "get_runtime_snapshot")
      else {}
    )
    startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
    startup_status = str((startup or {}).get("status") or "").strip().lower()
    loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
    runtime_backend = str(runtime_snapshot.get("runtime_backend_kind") or "").strip().lower()
    is_ready_now = bool(
      startup_status == "ready"
      and model_engine.is_ready()
      and loaded_model_id == str(selected_model_id).strip().lower()
      and runtime_backend == required_runtime_backend
    )
    if is_ready_now:
      return selected_model_id, selected_model_label

    loading_started_at = time.time()
    model_engine.start_background_load(prefer_vision_runtime=prefer_vision_runtime)
    while True:
      runtime_snapshot = (
        model_engine.get_runtime_snapshot()
        if hasattr(model_engine, "get_runtime_snapshot")
        else {}
      )
      startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
      status = str((startup or {}).get("status") or "").strip().lower()
      message = str((startup or {}).get("message") or "").strip()
      loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
      runtime_backend = str(runtime_snapshot.get("runtime_backend_kind") or "").strip().lower()
      is_ready = bool(
        status == "ready"
        and loaded_model_id == str(selected_model_id).strip().lower()
        and runtime_backend == required_runtime_backend
      )
      if is_ready:
        return selected_model_id, selected_model_label
      if status == "error":
        raise RuntimeError(message or model_engine.get_unavailable_message())
      if time.time() - loading_started_at > timeout_seconds:
        if prefer_vision_runtime:
          raise RuntimeError("Превышено время ожидания загрузки модели с vision runtime.")
        raise RuntimeError("Превышено время ожидания загрузки модели.")
      time.sleep(0.25)

  def _resolve_owner_user_id(request: Request | None = None) -> str:
    if request is None:
      return ""
    deployment_mode = str(getattr(request.state, "deployment_mode", "") or "").strip().lower()
    if deployment_mode != DEPLOYMENT_MODE_REMOTE_SERVER:
      return ""
    auth_payload = getattr(request.state, "auth", None)
    if not isinstance(auth_payload, dict):
      return ""
    user_payload = auth_payload.get("user")
    if not isinstance(user_payload, dict):
      return ""
    return str(user_payload.get("id") or "").strip()

  def _resolve_deployment_mode_from_request(request: Request | None = None) -> str:
    if request is None:
      return ""
    return str(getattr(request.state, "deployment_mode", "") or "").strip().lower()

  def _auth_user_from_request(request: Request | None = None) -> dict[str, Any]:
    if request is None:
      return {}
    auth_payload = getattr(request.state, "auth", None)
    if not isinstance(auth_payload, dict):
      return {}
    user_payload = auth_payload.get("user")
    return user_payload if isinstance(user_payload, dict) else {}

  def _request_can_download_models(request: Request | None = None) -> bool:
    if request is None:
      return True
    deployment_mode = str(getattr(request.state, "deployment_mode", "") or "").strip().lower()
    if deployment_mode != DEPLOYMENT_MODE_REMOTE_SERVER:
      return True
    return user_can_download_models(_auth_user_from_request(request))

  def _is_model_cached_or_loading(model_id: str) -> bool:
    safe_model_id = str(model_id or "").strip().lower()
    if not safe_model_id:
      return False

    runtime_snapshot = (
      model_engine.get_runtime_snapshot()
      if hasattr(model_engine, "get_runtime_snapshot")
      else {}
    )
    loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
    if loaded_model_id == safe_model_id:
      return True

    startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
    startup_details = startup.get("details") if isinstance(startup, dict) and isinstance(startup.get("details"), dict) else {}
    startup_model_id = str(startup_details.get("model_id") or "").strip().lower()
    startup_status = str(startup.get("status") or "").strip().lower()
    if startup_model_id == safe_model_id and startup_status in {"loading", "booting"}:
      return True

    if not hasattr(model_engine, "get_local_cache_map"):
      return False
    cache_map = model_engine.get_local_cache_map()
    if not isinstance(cache_map, dict):
      return False
    cache_entry = cache_map.get(safe_model_id)
    if isinstance(cache_entry, dict):
      return bool(cache_entry.get("cached"))
    return bool(cache_entry)

  def _require_model_download_access_for_request(request: Request, *, model_id: str) -> None:
    if _request_can_download_models(request):
      return
    if _is_model_cached_or_loading(model_id):
      return
    raise HTTPException(
      status_code=403,
      detail="Недостаточно прав: загрузка новых моделей запрещена для этого аккаунта.",
    )

  def prepare_chat_turn(
    payload: ChatRequest,
    *,
    owner_user_id: str = "",
    deployment_mode: str = "",
  ) -> tuple[str, str, str, str, RuntimeChatContext, set[str], str]:
    MAX_ATTACHMENTS_TOTAL_SIZE = 52_428_800
    MAX_ATTACHMENTS_TOTAL_TEXT = 500_000

    def _sanitize_attachment_for_storage(item: dict[str, Any]) -> dict[str, Any]:
      safe_item = dict(item or {})
      data_url_value = str(safe_item.get("dataUrl") or "").strip()
      if data_url_value:
        safe_item["hasDataUrl"] = True
        safe_item["dataUrlLength"] = len(data_url_value)
      safe_item.pop("dataUrl", None)
      text_content = str(safe_item.get("textContent") or "")
      if text_content and len(text_content) > 5000:
        safe_item["textContent"] = text_content[:5000] + "…"
      return safe_item

    user_text = payload.message.strip()
    attachments = list(payload.attachments or [])
    if not user_text and not attachments:
      raise HTTPException(status_code=400, detail="message or attachments are required")
    if not user_text and attachments:
      user_text = "Проанализируй вложения пользователя."

    # Модель выбирается через /models/select; из payload контекста не переопределяем

    def is_placeholder_chat_title(raw_title: str) -> bool:
      safe_title = str(raw_title or "").strip().lower()
      if not safe_title:
        return False
      return bool(re.match(r"^новая\s+сессия\b", safe_title))

    chat_id = str(payload.context.chat_id or "default").strip() or "default"
    existing_chat = storage.get_chat(chat_id, owner_user_id=owner_user_id)
    existing_messages = (
      storage.get_chat_messages(
        chat_id,
        limit=1,
        owner_user_id=owner_user_id,
      )
      if existing_chat is not None
      else []
    )
    continue_mode_requested = bool(
      getattr(payload, "continue_mode", False)
      or getattr(payload, "skip_user_persist", False)
    )
    continue_from_message_id = str(getattr(payload, "continue_from_message_id", None) or "").strip()
    if continue_from_message_id and not continue_mode_requested:
      raise HTTPException(
        status_code=400,
        detail="continue_from_message_id requires continue_mode/skip_user_persist.",
      )
    if continue_mode_requested:
      if not continue_from_message_id:
        raise HTTPException(
          status_code=400,
          detail="continue_from_message_id is required in continue mode.",
        )
      if not existing_messages:
        raise HTTPException(
          status_code=409,
          detail="Продолжение недоступно: в чате нет assistant-сообщения для продолжения.",
        )
      last_entry = existing_messages[-1]
      last_message_id = str(last_entry.get("id") or "").strip()
      last_role = str(last_entry.get("role") or "").strip().lower()
      if last_message_id != continue_from_message_id or last_role != "assistant":
        raise HTTPException(
          status_code=409,
          detail="Продолжение доступно только для последнего assistant-сообщения.",
        )
      try:
        payload.skip_user_persist = True
      except Exception:
        pass

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
    storage.ensure_chat(
      chat_id,
      chat_title,
      incoming_mood,
      owner_user_id=owner_user_id,
    )
    should_update_title = (
      existing_chat is not None
      and bool(chat_title)
      and chat_title != existing_chat_title
      and (not is_placeholder_chat_title(chat_title) or existing_is_placeholder)
    )
    if should_update_title:
      storage.update_chat(chat_id, title=chat_title, owner_user_id=owner_user_id)

    # История для модели:
    # - по умолчанию берём backend-БД (источник истины),
    # - при history_override_enabled=true используем переданный override только для модели.
    client_history_override_enabled = bool(getattr(payload.context, "history_override_enabled", False))
    client_history_override: list[HistoryMessage] = []
    if client_history_override_enabled:
      raw_history = list(getattr(payload.context, "history", None) or [])
      for entry in raw_history[-48:]:
        role = str(getattr(entry, "role", "") or "").strip().lower()
        if role not in {"user", "assistant", "system"}:
          continue
        text = str(getattr(entry, "text", "") or "").strip()
        if not text:
          continue
        client_history_override.append(
          HistoryMessage(
            role=role,
            text=text,
            timestamp=str(getattr(entry, "timestamp", "") or ""),
          )
        )
      if client_history_override:
        tail = client_history_override[-1]
        if str(tail.role or "").strip().lower() == "user" and str(tail.text or "").strip() == user_text:
          client_history_override = client_history_override[:-1]

    stored_history = storage.get_chat_messages(
      chat_id,
      limit=24,
      owner_user_id=owner_user_id,
    )
    history_from_storage: list[HistoryMessage] = []
    for entry in stored_history:
      role = str(entry.get("role") or "").strip().lower()
      if role not in {"user", "assistant", "system"}:
        continue
      text = str(entry.get("text") or "").strip()
      if not text:
        continue
      history_from_storage.append(
        HistoryMessage(
          role=role,
          text=text,
          timestamp=str(entry.get("timestamp") or ""),
        )
      )
    payload.context.history = client_history_override if client_history_override else history_from_storage

    attachment_payloads: list[dict[str, Any]] = []
    attachment_preview_lines: list[str] = []
    total_attachment_size = 0
    total_attachment_text = 0
    for index, attachment in enumerate(attachments, start=1):
      payload_item = attachment.model_dump()
      try:
        attachment_size = max(0, int(payload_item.get("size") or 0))
      except (TypeError, ValueError):
        attachment_size = 0
      total_attachment_size += attachment_size
      text_content = str(payload_item.get("textContent") or "")
      data_url = str(payload_item.get("dataUrl") or "")
      total_attachment_text += len(text_content) + len(data_url)
      if total_attachment_size > MAX_ATTACHMENTS_TOTAL_SIZE:
        raise HTTPException(
          status_code=413,
          detail=f"Суммарный размер вложений превышает {MAX_ATTACHMENTS_TOTAL_SIZE // (1024 * 1024)} MB.",
        )
      if total_attachment_text > MAX_ATTACHMENTS_TOTAL_TEXT:
        raise HTTPException(
          status_code=413,
          detail="Суммарный объём текстовых данных вложений слишком большой.",
        )
      safe_kind_for_check = str(payload_item.get("kind") or "file").strip().lower()
      safe_mime_for_check = str(payload_item.get("mimeType") or "").strip().lower()
      has_image_markers = (
        safe_kind_for_check == "image"
        or safe_mime_for_check.startswith("image/")
        or str(data_url or "").strip().lower().startswith("data:image/")
      )
      if has_image_markers and not _is_safe_image_data_url(data_url):
        raise HTTPException(
          status_code=400,
          detail=(
            "Некорректное изображение во вложении: поддерживаются только base64 DataURL "
            "форматов png/jpeg/webp/gif/bmp/ico/avif; SVG и другие форматы запрещены."
          ),
        )

      attachment_payloads.append(_sanitize_attachment_for_storage(payload_item))
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
      safe_text_content = str(payload_item.get("textContent") or "").strip()
      if safe_text_content:
        preview = safe_text_content[:220].replace("\n", " ")
        if len(safe_text_content) > 220:
          preview += "…"
        label_parts.append(f"— {preview}")
      attachment_preview_lines.append(f"{index}. {' '.join(label_parts)}")

    user_text_for_storage = user_text
    request_id = str(getattr(payload.context, "request_id", "") or "").strip()

    user_message_id = ""
    if request_id and existing_messages:
      last_entry = existing_messages[-1]
      last_role = str(last_entry.get("role") or "").strip().lower()
      last_text = str(last_entry.get("text") or "").strip()
      last_meta = last_entry.get("meta") if isinstance(last_entry.get("meta"), dict) else {}
      last_request_id = str(last_meta.get("request_id") or "").strip()
      if (
        last_role == "user"
        and last_request_id
        and last_request_id == request_id
        and last_text == user_text_for_storage
      ):
        user_message_id = str(last_entry.get("id") or "").strip()

    if not user_message_id and not getattr(payload, "skip_user_persist", False):
      user_message_id = storage.append_message(
        chat_id=chat_id,
        role="user",
        text=user_text_for_storage,
        meta={
          "source": "ui",
          "meta_suffix": "",
          "attachments": attachment_payloads,
          "attachment_preview_lines": attachment_preview_lines,
          "has_attachments": bool(attachment_payloads),
          "request_id": request_id,
        },
        owner_user_id=owner_user_id,
      )

    # Для continue-режима: подменяем текст сообщения на чёткую инструкцию для модели
    if getattr(payload, "skip_user_persist", False):
      payload.message = (
        "Твой предыдущий ответ оборвался на полуслове. Продолжи его точно с того места, где он закончился. "
        "Не повторяй ничего из уже написанного — начни сразу с продолжения."
      )
      user_text = payload.message

    context_guard_event_raw = getattr(payload.context, "context_guard_event", None)
    if isinstance(context_guard_event_raw, dict):
      event_name = str(context_guard_event_raw.get("name") or "").strip().lower()
      event_text = str(context_guard_event_raw.get("text") or "").strip()
      if event_name == "context_guard.compress" and event_text:
        event_display_name = str(context_guard_event_raw.get("display_name") or "").strip() or "Context Guard"
        event_status_raw = str(context_guard_event_raw.get("status") or "ok").strip().lower()
        event_status = event_status_raw if event_status_raw in {"ok", "warning", "error"} else "ok"
        event_args = context_guard_event_raw.get("args") if isinstance(context_guard_event_raw.get("args"), dict) else {}
        event_badge = context_guard_event_raw.get("badge") if isinstance(context_guard_event_raw.get("badge"), dict) else None
        storage.append_message(
          chat_id=chat_id,
          role="tool",
          text=event_text,
          meta={
            "meta_suffix": str(context_guard_event_raw.get("meta_suffix") or "сжатие контекста"),
            "tool_name": "context_guard.compress",
            "tool_display_name": event_display_name,
            "status": event_status,
            "tool_output": {},
            "tool_args": event_args,
            "tool_badge": event_badge,
            "context_guard_event": True,
          },
          owner_user_id=owner_user_id,
        )

    autonomous_mode = get_autonomous_mode()
    maybe_refresh_tool_registry(force=False)
    active_tools = plugin_manager.resolve_active_tools(autonomous_mode=autonomous_mode)
    active_tools = {tool for tool in active_tools if tool_registry.has_tool(tool)}
    plugin_permission_map = read_plugin_permissions(
      storage,
      sanitize_plugin_id=plugin_marketplace.sanitize_plugin_id,
      owner_user_id=owner_user_id,
    )
    tool_permission_map = read_tool_permissions(
      storage,
      sanitize_plugin_id=plugin_marketplace.sanitize_plugin_id,
      sanitize_tool_name=lambda value: str(value or "").strip().lower(),
      owner_user_id=owner_user_id,
    )
    domain_permission_map = read_domain_permissions(storage, owner_user_id=owner_user_id)
    domain_default_policy = normalize_domain_default_policy(
      read_domain_default_policy(storage, owner_user_id=owner_user_id),
      DEFAULT_DOMAIN_PERMISSION_POLICY,
    )
    granted_plugin_ids = {
      str(plugin_marketplace.sanitize_plugin_id(item) or "").strip().lower()
      for item in list(getattr(payload.context, "plugin_permission_grants", None) or [])
      if str(plugin_marketplace.sanitize_plugin_id(item) or "").strip()
    }
    granted_tool_keys: set[str] = set()
    for raw_item in list(getattr(payload.context, "tool_permission_grants", None) or []):
      raw_value = str(raw_item or "").strip().lower()
      if not raw_value:
        continue
      separator = "::" if "::" in raw_value else (":" if ":" in raw_value else ("|" if "|" in raw_value else ""))
      if not separator:
        continue
      plugin_raw, tool_raw = raw_value.split(separator, 1)
      plugin_id = str(plugin_marketplace.sanitize_plugin_id(plugin_raw) or "").strip().lower()
      tool_name = str(tool_raw or "").strip().lower()
      if not plugin_id or not tool_name:
        continue
      if hasattr(tool_registry, "resolve_tool_name"):
        tool_name = str(tool_registry.resolve_tool_name(tool_name) or "").strip().lower()
      if not tool_name:
        continue
      granted_tool_keys.add(f"{plugin_id}::{tool_name}")
    granted_domain_keys: set[str] = set()
    for raw_domain in list(getattr(payload.context, "domain_permission_grants", None) or []):
      safe_domain = normalize_domain_key(raw_domain)
      if safe_domain:
        granted_domain_keys.add(safe_domain)
    filtered_tools: set[str] = set()
    effective_tool_policy_map: dict[str, str] = {}
    for tool_name in active_tools:
      tool_meta = tool_registry.get_tool_meta(tool_name) if hasattr(tool_registry, "get_tool_meta") else {}
      plugin_id = str(plugin_marketplace.sanitize_plugin_id(tool_meta.get("plugin_id")) or "").strip().lower()
      if not plugin_id:
        filtered_tools.add(tool_name)
        continue
      policy = normalize_plugin_permission_policy(
        plugin_permission_map.get(plugin_id, DEFAULT_PLUGIN_PERMISSION_POLICY),
        DEFAULT_PLUGIN_PERMISSION_POLICY,
      )
      if policy == "deny":
        continue
      if policy == "ask" and plugin_id not in granted_plugin_ids:
        continue
      tool_key = f"{plugin_id}::{tool_name}"
      tool_policy = normalize_plugin_permission_policy(
        tool_permission_map.get(tool_key, policy),
        policy,
      )
      effective_tool_policy_map[tool_key] = tool_policy
      if tool_policy == "deny":
        continue
      if tool_policy == "ask" and tool_key not in granted_tool_keys:
        continue
      filtered_tools.add(tool_name)
    runtime = RuntimeChatContext(
      chat_id=chat_id,
      mood=incoming_mood,
      user_name=payload.context.user.name.strip(),
      timezone=payload.context.user.timezone.strip() or "UTC",
      deployment_mode=str(deployment_mode or "").strip().lower(),
      plugin_permission_grants=granted_plugin_ids,
      tool_permission_grants=granted_tool_keys,
      domain_permission_grants=granted_domain_keys,
      tool_permission_policies=effective_tool_policy_map,
      domain_permission_policies=domain_permission_map,
      domain_default_policy=domain_default_policy,
    )
    return user_text, chat_id, chat_title, incoming_mood, runtime, filtered_tools, user_message_id

  def ensure_context_window_not_overflow(
    payload: ChatRequest,
    active_tools: set[str],
  ) -> dict[str, Any]:
    if not hasattr(model_engine, "get_context_usage"):
      return {}

    tool_definitions = (
      tool_registry.build_tool_definition_map(active_tools)
      if hasattr(tool_registry, "build_tool_definition_map")
      else {}
    )
    tool_schemas = (
      tool_registry.build_llm_schema_map(active_tools)
      if hasattr(tool_registry, "build_llm_schema_map")
      else {}
    )

    # Применяем те же ограничения что и фронтенд (historyAndPersistence.js),
    # чтобы подсчёт токенов на стороне бэкенда совпадал с фронтендом
    # и авто-сжатие contextGuard срабатывало своевременно.
    _MAX_CHARS_PER_MSG = 1400
    _MAX_TOTAL_CHARS = 18000
    _raw_history = list(getattr(payload.context, "history", None) or [])
    _check_history: list[Any] = []
    _total_chars = 0
    for _entry in reversed(_raw_history):
      _role = str(getattr(_entry, "role", "") or "").strip().lower()
      if _role not in {"user", "assistant", "system"}:
        continue
      _text = str(getattr(_entry, "text", "") or "")
      if len(_text) > _MAX_CHARS_PER_MSG:
        _text = _text[:_MAX_CHARS_PER_MSG - 1] + "…"
      _proj = _total_chars + len(_text)
      if _proj > _MAX_TOTAL_CHARS and _check_history:
        break
      _total_chars = _proj
      _check_history.append({"role": _role, "text": _text})
    _check_history.reverse()

    try:
      usage_payload = model_engine.get_context_usage(
        model_id=str(model_engine.get_selected_model_id() or "").strip().lower(),
        draft_text=str(payload.message or ""),
        pending_assistant_text="",
        history=_check_history,
        attachments=list(payload.attachments or []),
        history_variants=[],
        active_tools=active_tools,
        tool_definitions=tool_definitions,
        tool_schemas=tool_schemas,
      )
    except RuntimeError:
      raise HTTPException(
        status_code=409,
        detail={
          "code": "context_usage_unavailable",
          "message": (
            "Точный подсчёт токенов недоступен: отправка остановлена, "
            "чтобы не допустить переполнение контекста."
          ),
        },
      )
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    usage = usage_payload.get("usage") if isinstance(usage_payload, dict) else {}
    if not isinstance(usage, dict):
      return usage_payload if isinstance(usage_payload, dict) else {}

    effective_tokens = int(usage.get("effective_tokens") or usage.get("used_tokens") or 0)
    context_window = int(usage.get("context_window") or 0)
    if context_window > 0 and effective_tokens > context_window:
      raise HTTPException(
        status_code=400,
        detail={
          "code": "context_overflow",
          "message": (
            "Контекст переполнен: запрос остановлен до отправки в модель. "
            "Уменьшите историю/вложения или увеличьте context window."
          ),
          "used_tokens": int(usage.get("used_tokens") or 0),
          "effective_tokens": effective_tokens,
          "context_window": context_window,
          "remaining_tokens": int(usage.get("remaining_tokens") or 0),
        },
      )
    return usage_payload if isinstance(usage_payload, dict) else {}

  def _extract_tool_event_mood(output: Any) -> str:
    if not isinstance(output, dict):
      return ""
    mood_candidate = str(
      output.get("mood")
      or output.get("state")
      or "",
    ).strip()
    if not mood_candidate:
      return ""
    return normalize_mood(mood_candidate, "")

  def resolve_final_chat_mood(
    *,
    incoming_mood: str,
    result_mood: str,
    tool_events: list[Any] | None = None,
  ) -> str:
    safe_tool_events = list(tool_events or [])
    for event in reversed(safe_tool_events):
      output = event.get("output") if isinstance(event, dict) else getattr(event, "output", {})
      tool_mood = _extract_tool_event_mood(output)
      if tool_mood:
        return tool_mood
    return normalize_mood(result_mood, incoming_mood)

  def estimate_completion_tokens(text: str) -> int:
    safe_text = str(text or "")
    if not safe_text:
      return 0
    estimator = getattr(model_engine, "_estimate_token_count_exact", None)
    if callable(estimator):
      try:
        estimated = estimator(safe_text)
        if isinstance(estimated, tuple):
          return max(0, int(estimated[0] or 0))
        return max(0, int(estimated or 0))
      except Exception:
        pass
    return max(1, len(safe_text) // 4)

  def resolve_selected_model_max_tokens() -> int:
    selected_model_id = str(model_engine.get_selected_model_id() or "").strip().lower()
    if not selected_model_id:
      return 0
    if hasattr(model_engine, "get_context_usage"):
      try:
        usage_payload = model_engine.get_context_usage(
          model_id=selected_model_id,
          draft_text="",
          pending_assistant_text="",
          history=[],
          attachments=[],
          history_variants=[],
          active_tools=set(),
          tool_definitions={},
          tool_schemas={},
        )
        params_payload = usage_payload.get("params") if isinstance(usage_payload, dict) else {}
        max_tokens = int((params_payload or {}).get("max_tokens") or 0)
        if max_tokens > 0:
          return max_tokens
      except Exception:
        pass
    tier_key = "compact"
    if hasattr(model_engine, "get_selected_tier"):
      tier_key = str(model_engine.get_selected_tier() or "").strip().lower() or "compact"
    if hasattr(model_engine, "get_model_params"):
      try:
        params = model_engine.get_model_params(selected_model_id, tier_key=tier_key)
        return max(0, int((params or {}).get("max_tokens") or 0))
      except Exception:
        return 0
    return 0

  def _is_reply_truncated(reply: str) -> bool:
    """Проверяет, обрывается ли ответ на середине (незавершённые теги, слова, списки)."""
    safe_reply = str(reply or "").strip()
    if not safe_reply:
      return False

    last_line = safe_reply.split("\n")[-1].strip()

    # Обрыв на середине Markdown-элемента (проверяем только последнюю строку)
    # ** в начале или конце строки без закрытия
    if re.search(r"^\*\*[^*]+$", last_line):  # **текст без закрытия
      return True
    if re.search(r"[^*]\*\*$", last_line):  # текст** без закрытия
      return True
    # ``` в конце без закрытия
    if re.search(r"```$", last_line) and not re.search(r"```.*```", safe_reply):
      return True
    # [ без закрытия ]
    if re.search(r"\[[^\]]*$", last_line):
      return True
    # Пустые элементы списка
    if re.match(r"^\s*[-*+]\s*$", last_line):
      return True
    if re.match(r"^\s*\d+\.\s*$", last_line):
      return True


    # Проверяем последнюю строку на незавершённость
    if last_line and len(last_line) > 3:
      # Если последняя строка не заканчивается на знак препинания или закрывающий элемент
      if not re.search(r"[.!?;:)}\]>]\s*$", last_line):
        # И не является полным элементом списка
        if not re.match(r"^[-*+]\s+.+[.!?]\s*$", last_line):
          if not re.match(r"^\d+\.\s+.+[.!?]\s*$", last_line):
            # Проверяем, не обрывается ли на середине слова
            last_word_match = re.search(r"(\w+)[^\w]*$", last_line)
            if last_word_match:
              last_word = last_word_match.group(1)
              # Если последнее "слово" >4 символов и не похоже на завершённое
              if len(last_word) > 4 and last_word.lower() not in {"the", "and", "для", "что", "как", "это", "так", "текст", "text"}:
                return True

    # Незавершённые HTML-теги — проверяем весь ответ
    # Ищем открытые теги, которые не закрыты
    open_tags = re.findall(r"<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>(?!</\1>)", safe_reply)
    closed_tags = re.findall(r"</([a-zA-Z][a-zA-Z0-9]*)>", safe_reply)
    # Self-closing теги не учитываем
    self_closing = {"br", "hr", "img", "input", "meta", "link"}
    open_tags = [t for t in open_tags if t.lower() not in self_closing]
    # Проверяем баланс
    for tag in set(open_tags):
      if open_tags.count(tag) > closed_tags.count(tag):
        # Есть незакрытый тег — проверяем, не в конце ли он
        last_open = safe_reply.rfind(f"<{tag}")
        last_close = safe_reply.rfind(f"</{tag}>")
        if last_open > last_close:
          # Тег открыт, но не закрыт в конце
          return True

    return False

  def build_generation_actions_meta(
    *,
    source_user_text: str,
    source_user_message_id: str = "",
    final_reply: str = "",
  ) -> dict[str, Any]:
    completion_tokens = estimate_completion_tokens(final_reply)
    completion_limit = resolve_selected_model_max_tokens()

    # allow_continue = True если:
    # 1. Достигнут лимит токенов (completion_tokens >= limit - 2)
    # 2. ИЛИ ответ обрывается на середине (незавершённые теги, слова, списки)
    allow_continue = (
      completion_limit > 0
      and completion_tokens >= max(1, completion_limit - 2)
    )
    # Дополнительная проверка на обрыв ответа
    if not allow_continue and _is_reply_truncated(final_reply):
      allow_continue = True

    return {
      "source_user_text": str(source_user_text or ""),
      "source_user_message_id": str(source_user_message_id or "").strip(),
      "allow_retry": False,
      "allow_continue": bool(allow_continue),
      "allow_regenerate": True,
    }

  def build_chat_response(
    *,
    payload: ChatRequest,
    user_text: str,
    user_message_id: str = "",
    chat_id: str,
    incoming_mood: str,
    active_tools: set[str],
    result: Any,
    owner_user_id: str = "",
  ) -> ChatResponse:
    final_mood = resolve_final_chat_mood(
      incoming_mood=incoming_mood,
      result_mood=str(getattr(result, "mood", "") or ""),
      tool_events=list(getattr(result, "tool_events", []) or []),
    )
    storage.update_chat_mood(chat_id, final_mood, owner_user_id=owner_user_id)

    system_prompt_value = build_system_prompt_fn(
      system_prompt,
      payload,
      active_tools=active_tools,
      tool_definitions=(
        tool_registry.build_tool_definition_map(active_tools)
        if hasattr(tool_registry, "build_tool_definition_map")
        else {}
      ),
    )
    generation_actions_meta = build_generation_actions_meta(
      source_user_text=user_text,
      source_user_message_id=user_message_id,
      final_reply=str(result.reply or ""),
    )
    for event in result.tool_events:
      tool_text, tool_meta_suffix = format_tool_event_for_chat(event)
      tool_name = str(event.name or "").strip().lower()
      tool_display_name = (
        str(tool_registry.get_tool_meta(tool_name).get("display_name") or "").strip()
        if hasattr(tool_registry, "get_tool_meta")
        else ""
      )
      storage.append_message(
        chat_id=chat_id,
        role="tool",
        text=tool_text,
        meta={
          "meta_suffix": tool_meta_suffix,
          "tool_name": tool_name or event.name,
          "tool_display_name": tool_display_name or tool_name or str(event.name or "tool"),
          "status": event.status,
          "tool_output": event.output,
        },
        owner_user_id=owner_user_id,
      )
    storage.append_message(
      chat_id=chat_id,
      role="assistant",
      text=result.reply,
      meta={
        "model": result.model_name,
        "mood": final_mood,
        "meta_suffix": str(result.model_name or "модель"),
        "system_prompt": system_prompt_value,
        "tool_events": [event.model_dump() for event in result.tool_events],
        "generation_actions": generation_actions_meta,
      },
      owner_user_id=owner_user_id,
    )

    completion_tokens = max(1, estimate_completion_tokens(str(result.reply or "")))
    token_estimate = max(1, len(user_text) // 4 + completion_tokens)
    return ChatResponse(
      chat_id=chat_id,
      reply=result.reply,
      mood=final_mood,
      model=result.model_name,
      tool_events=result.tool_events,
      usage={
        "prompt_tokens": token_estimate,
        "completion_tokens": completion_tokens,
        "total_tokens": token_estimate + completion_tokens,
      },
      generation_actions=generation_actions_meta,
    )

  def _format_sse(event: str, payload: dict[str, Any]) -> str:
    body = json.dumps(payload, ensure_ascii=False)
    return f"event: {event}\ndata: {body}\n\n"

  @app.post("/chat", response_model=ChatResponse)
  def chat(payload: ChatRequest, request: Request) -> ChatResponse:
    owner_user_id = _resolve_owner_user_id(request)
    user_text, chat_id, _chat_title, incoming_mood, runtime, active_tools, user_message_id = prepare_chat_turn(
      payload,
      owner_user_id=owner_user_id,
      deployment_mode=_resolve_deployment_mode_from_request(request),
    )
    require_vision_runtime = _payload_has_image_attachments(payload)
    _require_model_download_access_for_request(
      request,
      model_id=str(model_engine.get_selected_model_id() or "").strip().lower(),
    )
    try:
      ensure_selected_model_ready(
        timeout_seconds=240.0,
        require_vision_runtime=require_vision_runtime,
      )
    except RuntimeError as exc:
      raise HTTPException(
        status_code=503,
        detail={
          "message": str(exc),
          "startup": model_engine.get_startup_snapshot(),
        },
      ) from exc

    ensure_context_window_not_overflow(payload, active_tools)

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
      user_message_id=user_message_id,
      chat_id=chat_id,
      incoming_mood=incoming_mood,
      active_tools=active_tools,
      result=result,
      owner_user_id=owner_user_id,
    )

  @app.post("/chat/stream")
  def chat_stream(payload: ChatRequest, request: Request) -> StreamingResponse:
    owner_user_id = _resolve_owner_user_id(request)
    user_text, chat_id, chat_title, incoming_mood, runtime, active_tools, user_message_id = prepare_chat_turn(
      payload,
      owner_user_id=owner_user_id,
      deployment_mode=_resolve_deployment_mode_from_request(request),
    )
    _require_model_download_access_for_request(
      request,
      model_id=str(model_engine.get_selected_model_id() or "").strip().lower(),
    )

    def stream_events() -> Generator[str, None, None]:
      selected_model_id = model_engine.get_selected_model_id()
      selected_model_label = resolve_model_display_name(selected_model_id)
      require_vision_runtime = _payload_has_image_attachments(payload)
      required_runtime_backend = _resolve_required_runtime_backend(
        selected_model_id=selected_model_id,
        require_vision_runtime=require_vision_runtime,
      )
      prefer_vision_runtime = required_runtime_backend == "mlx_vlm"
      stream_model_id = str(selected_model_id or "").strip()
      stream_model_label = str(selected_model_label or "").strip() or "модель"
      yield _format_sse(
        "start",
        {
          "chat_id": chat_id,
          "model": stream_model_label,
          "model_label": stream_model_label,
          "model_id": stream_model_id,
        },
      )

      assistant_message_id: str | None = None
      # Continue mode: update existing assistant message instead of creating a new one
      _continue_from_id = str(getattr(payload, "continue_from_message_id", None) or "").strip()
      if _continue_from_id and getattr(payload, "skip_user_persist", False):
        assistant_message_id = _continue_from_id
      assistant_stream_text = ""
      tool_message_by_invocation: dict[str, str] = {}

      generation_actions_meta = build_generation_actions_meta(
        source_user_text=user_text,
        source_user_message_id=user_message_id,
        final_reply="",
      )
      stream_started_at = time.perf_counter()
      first_delta_at: float | None = None
      delta_count = 0
      delta_chars = 0

      def build_stream_diagnostics(final_reply: str) -> dict[str, Any]:
        safe_reply = str(final_reply or "")
        reply_chars = len(safe_reply)
        total_ms = max(0, int((time.perf_counter() - stream_started_at) * 1000))
        first_token_ms = (
          max(0, int((first_delta_at - stream_started_at) * 1000))
          if first_delta_at is not None
          else None
        )

        mode = "streaming"
        reason = ""
        if delta_count == 0:
          mode = "buffered"
          reason = "no_delta_events"
        elif (
          delta_count == 1
          and reply_chars >= 48
          and delta_chars >= max(1, int(reply_chars * 0.8))
        ):
          mode = "buffered_single_chunk"
          reason = "single_large_delta"

        return {
          "mode": mode,
          "reason": reason,
          "delta_count": int(delta_count),
          "delta_chars": int(delta_chars),
          "reply_chars": int(reply_chars),
          "first_token_ms": first_token_ms,
          "total_ms": total_ms,
        }

      def upsert_assistant_message(
        text: str,
        *,
        model_label: str,
        mood: str,
        streaming: bool,
        extra_meta: dict[str, Any] | None = None,
      ) -> str:
        nonlocal assistant_message_id, assistant_stream_text
        meta_payload: dict[str, Any] = {
          "model": model_label,
          "mood": mood,
          "meta_suffix": model_label,
          "streaming": streaming,
        }
        if extra_meta:
          meta_payload.update(extra_meta)
        if assistant_message_id is None:
          assistant_message_id = storage.append_message(
            chat_id=chat_id,
            role="assistant",
            text=text,
            meta=meta_payload,
            owner_user_id=owner_user_id,
          )
        else:
          # В режиме продолжения text — это полный текст (existing + delta)
          # В обычном режиме text — это накопленный текст
          storage.update_message(
            chat_id,
            assistant_message_id,
            text=text,
            meta=meta_payload,
            owner_user_id=owner_user_id,
          )
        return assistant_message_id

      def close_assistant_segment(
        *,
        model_label: str,
        mood: str,
      ) -> None:
        safe_text = str(assistant_stream_text or "")
        if not safe_text.strip():
          return
        upsert_assistant_message(
          safe_text,
          model_label=model_label,
          mood=mood,
          streaming=False,
        )

      def is_user_cancelled_error(error: RuntimeError) -> bool:
        normalized = str(error or "").strip().lower()
        return (
          "генерация остановлена пользователем" in normalized
          or "generation stopped by user" in normalized
        )

      try:
        runtime_snapshot = (
          model_engine.get_runtime_snapshot()
          if hasattr(model_engine, "get_runtime_snapshot")
          else {}
        )
        loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
        runtime_backend = str(runtime_snapshot.get("runtime_backend_kind") or "").strip().lower()
        startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
        startup_status = str((startup or {}).get("status") or "").strip().lower()
        selected_matches_loaded = bool(
          startup_status == "ready"
          and loaded_model_id == str(selected_model_id).strip().lower()
          and runtime_backend == required_runtime_backend
        )
        if not selected_matches_loaded:
          loading_started_at = time.time()
          model_engine.start_background_load(prefer_vision_runtime=prefer_vision_runtime)
          last_loading_snapshot = ""
          while True:
            runtime_snapshot = (
              model_engine.get_runtime_snapshot()
              if hasattr(model_engine, "get_runtime_snapshot")
              else {}
            )
            startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
            status = str((startup or {}).get("status") or "").strip().lower()
            stage = str((startup or {}).get("stage") or "").strip().lower()
            message = str((startup or {}).get("message") or "").strip() or "Загрузка модели..."
            progress_percent = _startup_progress_percent(startup if isinstance(startup, dict) else {})
            snapshot_key = f"{status}|{stage}|{progress_percent}|{message}"
            if snapshot_key != last_loading_snapshot:
              yield _format_sse(
                "status",
                {
                  "stage": stage or "loading_model",
                  "status": status or "loading",
                  "progress_percent": progress_percent,
                  "message": message,
                  "model": selected_model_label,
                  "model_id": selected_model_id,
                },
              )
              last_loading_snapshot = snapshot_key

            loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
            runtime_backend = str(runtime_snapshot.get("runtime_backend_kind") or "").strip().lower()
            is_ready = bool(
              status == "ready"
              and loaded_model_id == str(selected_model_id).strip().lower()
              and runtime_backend == required_runtime_backend
            )
            if is_ready:
              break
            if status == "error":
              raise RuntimeError(message or model_engine.get_unavailable_message())
            if time.time() - loading_started_at > 240.0:
              raise RuntimeError("Превышено время ожидания загрузки модели.")
            yield ": ping\n\n"
            time.sleep(0.35)

        post_load_snapshot = (
          model_engine.get_runtime_snapshot()
          if hasattr(model_engine, "get_runtime_snapshot")
          else {}
        )
        loaded_model_id_after_ready = str(post_load_snapshot.get("loaded_model_id") or "").strip().lower()
        runtime_backend_after_ready = str(post_load_snapshot.get("runtime_backend_kind") or "").strip().lower()
        if runtime_backend_after_ready != required_runtime_backend:
          if prefer_vision_runtime:
            raise RuntimeError("Vision runtime недоступен для выбранной модели.")
          raise RuntimeError("Не удалось переключить runtime модели в текстовый режим.")
        if loaded_model_id_after_ready:
          stream_model_id = loaded_model_id_after_ready
          stream_model_label = resolve_model_display_name(stream_model_id)

        try:
          ensure_context_window_not_overflow(payload, active_tools)
        except HTTPException as exc:
          detail = exc.detail
          if isinstance(detail, dict):
            message = str(detail.get("message") or "Контекст переполнен.")
          else:
            message = str(detail or "Контекст переполнен.")
          raise RuntimeError(message) from exc

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
              "message": f"{stream_model_label}",
              "model": stream_model_label,
              "model_id": stream_model_id,
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
                close_assistant_segment(
                  model_label=stream_model_label,
                  mood=normalize_mood(incoming_mood, "neutral"),
                )
                tool_invocation_id = str(tool_payload.get("invocation_id") or "").strip()
                tool_name = str(tool_payload.get("name") or "tool")
                tool_display_name = str(tool_payload.get("display_name") or tool_name).strip() or tool_name
                tool_text = str(tool_payload.get("text") or tool_name).strip() or tool_name
                tool_meta = {
                  "meta_suffix": str(tool_payload.get("meta_suffix") or "инструмент • запуск"),
                  "tool_name": tool_name,
                  "tool_display_name": tool_display_name,
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
                    owner_user_id=owner_user_id,
                  )
                else:
                  tool_message_id = storage.append_message(
                    chat_id=chat_id,
                    role="tool",
                    text=tool_text,
                    meta=tool_meta,
                    owner_user_id=owner_user_id,
                  )
                  if tool_invocation_id:
                    tool_message_by_invocation[tool_invocation_id] = tool_message_id
                yield _format_sse("tool_start", tool_payload)
                continue
              if kind == "tool_result":
                tool_invocation_id = str(tool_payload.get("invocation_id") or "").strip()
                tool_name = str(tool_payload.get("name") or "tool")
                tool_display_name = str(tool_payload.get("display_name") or tool_name).strip() or tool_name
                tool_text = str(tool_payload.get("text") or tool_name).strip() or tool_name
                tool_meta = {
                  "meta_suffix": str(tool_payload.get("meta_suffix") or "инструмент • ok"),
                  "tool_name": tool_name,
                  "tool_display_name": tool_display_name,
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
                    owner_user_id=owner_user_id,
                  )
                else:
                  tool_message_id = storage.append_message(
                    chat_id=chat_id,
                    role="tool",
                    text=tool_text,
                    meta=tool_meta,
                    owner_user_id=owner_user_id,
                  )
                  if tool_invocation_id:
                    tool_message_by_invocation[tool_invocation_id] = tool_message_id
                yield _format_sse("tool_result", tool_payload)
                continue
            if not delta:
              continue
            safe_delta = str(delta)
            if not safe_delta:
              continue
            assistant_stream_text += safe_delta
            delta_count += 1
            delta_chars += len(safe_delta)
            if first_delta_at is None:
              first_delta_at = time.perf_counter()
            upsert_assistant_message(
              assistant_stream_text,
              model_label=stream_model_label,
              mood=normalize_mood(incoming_mood, "neutral"),
              streaming=True,
            )
            yield _format_sse("delta", {"text": safe_delta})
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

        final_mood = resolve_final_chat_mood(
          incoming_mood=incoming_mood,
          result_mood=str(getattr(result, "mood", "") or ""),
          tool_events=list(getattr(result, "tool_events", []) or []),
        )
        storage.update_chat_mood(chat_id, final_mood, owner_user_id=owner_user_id)
        system_prompt_value = build_system_prompt_fn(
          system_prompt,
          payload,
          active_tools=active_tools,
          tool_definitions=(
            tool_registry.build_tool_definition_map(active_tools)
            if hasattr(tool_registry, "build_tool_definition_map")
            else {}
          ),
        )
        streamed_reply = str(assistant_stream_text or "")
        model_reply = str(result.reply or "")
        final_reply = streamed_reply if streamed_reply.strip() else model_reply
        if is_repetition_runaway(final_reply):
          final_reply = compact_repetitions(final_reply)
        if not str(final_reply).strip():
          final_reply = "Не удалось сформировать ответ."
        full_reply_for_stats = streamed_reply if streamed_reply.strip() else final_reply
        generation_actions_meta = build_generation_actions_meta(
          source_user_text=user_text,
          source_user_message_id=user_message_id,
          final_reply=final_reply,
        )
        stream_diagnostics = build_stream_diagnostics(full_reply_for_stats)
        completion_tokens = max(1, estimate_completion_tokens(full_reply_for_stats))
        token_estimate = max(1, len(user_text) // 4 + completion_tokens)
        response_model = ChatResponse(
          chat_id=chat_id,
          reply=final_reply,
          mood=final_mood,
          model=result.model_name,
          tool_events=result.tool_events,
          usage={
            "prompt_tokens": token_estimate,
            "completion_tokens": completion_tokens,
            "total_tokens": token_estimate + completion_tokens,
          },
          generation_actions=generation_actions_meta,
        )
        upsert_assistant_message(
          final_reply,
          model_label=str(result.model_name or selected_model_label),
          mood=final_mood,
          streaming=False,
          extra_meta={
            "system_prompt": system_prompt_value,
            "tool_events": [event.model_dump() for event in result.tool_events],
            "stream": stream_diagnostics,
            "generation_actions": generation_actions_meta,
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
            "stream": stream_diagnostics,
            "generation_actions": generation_actions_meta,
          },
        )
      except RuntimeError as exc:
        if is_user_cancelled_error(exc):
          cancelled_reply = str(assistant_stream_text or "").strip()
          cancelled_model = str(stream_model_label or selected_model_label or "модель")
          cancelled_mood = normalize_mood(incoming_mood, "neutral")
          stream_diagnostics = build_stream_diagnostics(cancelled_reply)
          cancelled_meta: dict[str, Any] = {
            "model": cancelled_model,
            "mood": cancelled_mood,
            "meta_suffix": f"{cancelled_model} • остановлено",
            "streaming": False,
            "cancelled": True,
            "stream": stream_diagnostics,
            "generation_actions": generation_actions_meta,
          }
          if assistant_message_id is not None and cancelled_reply:
            storage.update_message(
              chat_id,
              assistant_message_id,
              text=cancelled_reply,
              meta=cancelled_meta,
              owner_user_id=owner_user_id,
            )
          elif assistant_message_id is None and cancelled_reply:
            assistant_message_id = storage.append_message(
              chat_id=chat_id,
              role="assistant",
              text=cancelled_reply,
              meta=cancelled_meta,
              owner_user_id=owner_user_id,
            )
          prompt_tokens = max(1, len(user_text) // 4)
          completion_tokens = max(0, len(cancelled_reply) // 4)
          yield _format_sse(
            "done",
            {
              "chat_id": chat_id,
              "chat_title": chat_title,
              "reply": cancelled_reply,
              "mood": cancelled_mood,
              "model": cancelled_model,
              "tool_events": [],
              "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
              },
              "cancelled": True,
              "stream": stream_diagnostics,
              "generation_actions": generation_actions_meta,
            },
          )
          return

        error_text = assistant_stream_text or str(exc)
        error_label = stream_model_label
        stream_diagnostics = build_stream_diagnostics(error_text)
        error_meta: dict[str, Any] = {
          "model": error_label,
          "mood": "error",
          "meta_suffix": f"{error_label} • ошибка",
          "streaming": False,
          "error": str(exc),
          "stream": stream_diagnostics,
          "generation_actions": generation_actions_meta,
        }
        # Не сохраняем ошибку переполнения контекста, если ничего не было сгенерировано.
        # Фронтенд получит чистый текст ошибки через SSE error и сохранит локально.
        _is_empty_overflow = (
          assistant_message_id is None
          and not (assistant_stream_text or "").strip()
          and ("контекст переполнен" in str(exc).lower() or "context_overflow" in str(exc).lower())
        )
        if not _is_empty_overflow:
          if assistant_message_id is None:
            assistant_message_id = storage.append_message(
              chat_id=chat_id,
              role="assistant",
              text=error_text,
              meta=error_meta,
              owner_user_id=owner_user_id,
            )
          else:
            storage.update_message(
              chat_id,
              assistant_message_id,
              text=error_text,
              meta=error_meta,
              owner_user_id=owner_user_id,
            )
        yield _format_sse(
          "error",
          {
            "message": str(exc),
            "startup": model_engine.get_startup_snapshot(),
            "stream": stream_diagnostics,
          },
        )

    def stream_events_with_cleanup() -> Generator[str, None, None]:
      try:
        yield from stream_events()
      finally:
        model_engine.request_stop_generation()

    return StreamingResponse(
      stream_events_with_cleanup(),
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
  def chat_history(chat_id: str, request: Request, limit: int = 40) -> dict[str, Any]:
    owner_user_id = _resolve_owner_user_id(request)
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id, owner_user_id=owner_user_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    safe_limit = max(1, min(200, int(limit)))
    history = storage.get_chat_messages(
      safe_chat_id,
      safe_limit,
      owner_user_id=owner_user_id,
    )
    return {
      "chat_id": safe_chat_id,
      "history": history,
    }
