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
  from backend.common import normalize_mood, utc_now_iso
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
  from backend.schemas import (
    HistoryMessage,
    ChatRequest,
    ChatResponse,
    RuntimeChatContext,
    ToolEvent,
  )
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore
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
  from schemas import (  # type: ignore
    HistoryMessage,
    ChatRequest,
    ChatResponse,
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
  plugins_root_dir: str,
  plugins_user_dir: str,
  plugins_preinstalled_dir: str,
  build_system_prompt_fn: Callable[..., str],
  refresh_tool_registry_fn: Callable[[], None] | None = None,
) -> None:
  settings_service = SettingsService(storage=storage, model_engine=model_engine)
  get_autonomous_mode = settings_service.get_autonomous_mode
  get_settings_payload = settings_service.get_settings_payload
  persist_settings_payload = settings_service.persist_settings_payload
  PLUGIN_REGISTRY_URL_SETTING_KEY = "plugin_registry_url"
  DEFAULT_PLUGIN_REGISTRY_URL = (
    os.getenv("ANCIA_PLUGIN_REGISTRY_URL", "").strip()
    or "https://raw.githubusercontent.com/DenisovPlay/ancia-plugins/main/index.json"
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

  def normalize_http_url(url_like: Any) -> str:
    return plugin_marketplace.normalize_http_url(url_like)

  def list_plugins_payload() -> dict[str, Any]:
    return plugin_marketplace.list_plugins_payload(autonomous_mode=get_autonomous_mode())

  def build_registry_plugins_payload() -> dict[str, Any]:
    return plugin_marketplace.build_registry_plugins_payload(autonomous_mode=get_autonomous_mode())

  def _bootstrap_preinstalled_plugins() -> None:
    try:
      bootstrap_result = plugin_marketplace.ensure_preinstalled_plugins(autonomous_mode=False)
      if (bootstrap_result.get("installed") or bootstrap_result.get("updated")) and callable(refresh_tool_registry_fn):
        refresh_tool_registry_fn()
    except Exception:
      # Bootstrap preinstalled plugins must not break backend startup.
      return

  if not get_autonomous_mode():
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
      with url_request.urlopen(req_head, timeout=7.0) as response:
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
      with url_request.urlopen(req_get, timeout=7.0) as response:
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

  def ensure_selected_model_ready(*, timeout_seconds: float = 240.0) -> tuple[str, str]:
    selected_model_id = model_engine.get_selected_model_id()
    selected_model_label = resolve_model_display_name(selected_model_id)
    runtime_snapshot = (
      model_engine.get_runtime_snapshot()
      if hasattr(model_engine, "get_runtime_snapshot")
      else {}
    )
    loaded_model_id = str(runtime_snapshot.get("loaded_model_id") or "").strip().lower()
    is_ready_now = bool(
      model_engine.is_ready()
      and loaded_model_id == str(selected_model_id).strip().lower()
    )
    if is_ready_now:
      return selected_model_id, selected_model_label

    model_engine.start_background_load()
    ok, snapshot = model_engine.wait_until_ready(
      expected_model_id=selected_model_id,
      timeout_seconds=timeout_seconds,
      poll_interval_seconds=0.25,
    )
    if not ok:
      startup = snapshot.get("startup") if isinstance(snapshot, dict) else {}
      message = str((startup or {}).get("message") or "").strip() or model_engine.get_unavailable_message()
      raise RuntimeError(message or "Модель ещё не готова.")
    return selected_model_id, selected_model_label

  def prepare_chat_turn(
    payload: ChatRequest,
  ) -> tuple[str, str, str, str, RuntimeChatContext, set[str]]:
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

    storage.append_message(
      chat_id=chat_id,
      role="user",
      text=user_text_for_storage,
      meta={
        "source": "ui",
        "meta_suffix": "",
        "attachments": attachment_payloads,
        "attachment_preview_lines": attachment_preview_lines,
        "has_attachments": bool(attachment_payloads),
      },
    )

    runtime = RuntimeChatContext(
      chat_id=chat_id,
      mood=incoming_mood,
      user_name=payload.context.user.name.strip(),
      timezone=payload.context.user.timezone.strip() or "UTC",
    )

    autonomous_mode = get_autonomous_mode()
    if callable(refresh_tool_registry_fn):
      refresh_tool_registry_fn()
    else:
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
      tool_definitions=(
        tool_registry.build_tool_definition_map(active_tools)
        if hasattr(tool_registry, "build_tool_definition_map")
        else {}
      ),
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
      ensure_selected_model_ready(timeout_seconds=240.0)
    except RuntimeError as exc:
      raise HTTPException(
        status_code=503,
        detail={
          "message": str(exc),
          "startup": model_engine.get_startup_snapshot(),
        },
      ) from exc

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
      selected_model_id = model_engine.get_selected_model_id()
      selected_model_label = resolve_model_display_name(selected_model_id)
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
      assistant_stream_text = ""
      tool_message_by_invocation: dict[str, str] = {}
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
        nonlocal assistant_message_id
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
          )
        else:
          storage.update_message(
            chat_id,
            assistant_message_id,
            text=text,
            meta=meta_payload,
          )
        return assistant_message_id

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
        startup = runtime_snapshot.get("startup") if isinstance(runtime_snapshot, dict) else {}
        startup_status = str((startup or {}).get("status") or "").strip().lower()
        selected_matches_loaded = bool(
          startup_status == "ready"
          and loaded_model_id == str(selected_model_id).strip().lower()
        )
        if not selected_matches_loaded:
          loading_started_at = time.time()
          model_engine.start_background_load()
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
            is_ready = bool(
              status == "ready"
              and loaded_model_id == str(selected_model_id).strip().lower()
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
        if loaded_model_id_after_ready:
          stream_model_id = loaded_model_id_after_ready
          stream_model_label = resolve_model_display_name(stream_model_id)
          if assistant_message_id is not None:
            upsert_assistant_message(
              assistant_stream_text,
              model_label=stream_model_label,
              mood=incoming_mood,
              streaming=True,
              extra_meta={"tool_events": []},
            )

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
              mood=incoming_mood,
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

        final_mood = normalize_mood(result.mood, incoming_mood)
        storage.update_chat_mood(chat_id, final_mood)
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
        final_reply = str(result.reply or assistant_stream_text or "").strip()
        if not final_reply:
          final_reply = "Не удалось сформировать ответ."
        stream_diagnostics = build_stream_diagnostics(final_reply)
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
        upsert_assistant_message(
          final_reply,
          model_label=str(result.model_name or selected_model_label),
          mood=final_mood,
          streaming=False,
          extra_meta={
            "system_prompt": system_prompt_value,
            "tool_events": [event.model_dump() for event in result.tool_events],
            "stream": stream_diagnostics,
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
          }
          if assistant_message_id is not None and cancelled_reply:
            storage.update_message(
              chat_id,
              assistant_message_id,
              text=cancelled_reply,
              meta=cancelled_meta,
            )
          elif assistant_message_id is None and cancelled_reply:
            assistant_message_id = storage.append_message(
              chat_id=chat_id,
              role="assistant",
              text=cancelled_reply,
              meta=cancelled_meta,
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
        }
        if assistant_message_id is None:
          assistant_message_id = storage.append_message(
            chat_id=chat_id,
            role="assistant",
            text=error_text,
            meta=error_meta,
          )
        else:
          storage.update_message(
            chat_id,
            assistant_message_id,
            text=error_text,
            meta=error_meta,
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
