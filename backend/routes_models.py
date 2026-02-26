from __future__ import annotations

from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request

try:
  from backend.access_control import user_can_download_models
  from backend.deployment import DEPLOYMENT_MODE_REMOTE_SERVER
  from backend.schemas import ContextUsageRequest, ModelParamsUpdateRequest, ModelSelectRequest
except ModuleNotFoundError:
  from access_control import user_can_download_models  # type: ignore
  from deployment import DEPLOYMENT_MODE_REMOTE_SERVER  # type: ignore
  from schemas import ContextUsageRequest, ModelParamsUpdateRequest, ModelSelectRequest  # type: ignore


def register_model_routes(
  app: FastAPI,
  *,
  model_engine: Any,
  tool_registry: Any,
  plugin_manager: Any | None = None,
  get_autonomous_mode: Callable[[], bool] | None = None,
) -> None:
  def _deployment_mode_from_request(request: Request | None = None) -> str:
    if request is None:
      return ""
    return str(getattr(request.state, "deployment_mode", "") or "").strip().lower()

  def _is_remote_server_request(request: Request | None = None) -> bool:
    return _deployment_mode_from_request(request) == DEPLOYMENT_MODE_REMOTE_SERVER

  def _auth_payload(request: Request | None = None) -> dict[str, Any]:
    if request is None:
      return {}
    payload = getattr(request.state, "auth", None)
    return payload if isinstance(payload, dict) else {}

  def _auth_user(request: Request | None = None) -> dict[str, Any]:
    payload = _auth_payload(request)
    user = payload.get("user")
    return user if isinstance(user, dict) else {}

  def _resolve_target_model_id(model_id: Any = "") -> str:
    requested = str(model_id or "").strip().lower()
    if requested:
      return requested
    return str(model_engine.get_selected_model_id() or "").strip().lower()

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

  def _require_model_download_permission(request: Request, *, model_id: str) -> None:
    if not _is_remote_server_request(request):
      return
    if user_can_download_models(_auth_user(request)):
      return
    if _is_model_cached_or_loading(model_id):
      return
    raise HTTPException(
      status_code=403,
      detail="Недостаточно прав: загрузка новых моделей запрещена для этого аккаунта.",
    )

  def resolve_context_guard_active_tools() -> set[str]:
    autonomous_mode = bool(get_autonomous_mode()) if callable(get_autonomous_mode) else False
    if plugin_manager is not None and hasattr(plugin_manager, "resolve_active_tools"):
      active_tools = plugin_manager.resolve_active_tools(autonomous_mode=autonomous_mode)
    else:
      listed_tools = tool_registry.list_tools() if hasattr(tool_registry, "list_tools") else []
      active_tools = {
        str(item.get("name") or "").strip().lower()
        for item in listed_tools
        if isinstance(item, dict) and str(item.get("name") or "").strip()
      }
    if hasattr(tool_registry, "has_tool"):
      active_tools = {tool for tool in active_tools if tool_registry.has_tool(tool)}
    return active_tools

  def build_context_window_requirements_payload() -> dict[str, Any]:
    if not hasattr(model_engine, "get_context_window_requirements"):
      return {}
    active_tools = resolve_context_guard_active_tools()
    tool_definitions = (
      tool_registry.build_tool_definition_map(active_tools)
      if hasattr(tool_registry, "build_tool_definition_map")
      else {}
    )
    return model_engine.get_context_window_requirements(
      active_tools=active_tools,
      tool_definitions=tool_definitions,
    )

  def build_models_payload() -> dict[str, Any]:
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
    context_requirements = build_context_window_requirements_payload()
    return {
      "selected_model": model_engine.get_selected_model_id(),
      "loaded_model": model_engine.get_loaded_model_id(),
      "models_dir": str(runtime.get("models_dir") or ""),
      "startup": startup,
      "runtime": runtime,
      "startup_progress_percent": max(0, min(100, int(progress_percent or 0))),
      "context_window_requirements": context_requirements,
      "models": model_engine.list_models_catalog(),
      "installed_models": cache_map,
    }

  @app.get("/models")
  def list_models() -> dict[str, Any]:
    return build_models_payload()

  @app.post("/models/select")
  def select_model(payload: ModelSelectRequest, request: Request) -> dict[str, Any]:
    try:
      if str(payload.model_id or "").strip():
        model_engine.set_selected_model(payload.model_id)
      if bool(getattr(payload, "load", False)):
        _require_model_download_permission(
          request,
          model_id=_resolve_target_model_id(),
        )
        model_engine.start_background_load()
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    return build_models_payload()

  @app.post("/models/load")
  def load_model(request: Request, payload: ModelSelectRequest | None = None) -> dict[str, Any]:
    data = payload or ModelSelectRequest()
    try:
      if str(data.model_id or "").strip():
        model_engine.set_selected_model(data.model_id)
      _require_model_download_permission(
        request,
        model_id=_resolve_target_model_id(),
      )
      model_engine.start_background_load()
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc
    return build_models_payload()

  @app.post("/models/catalog/refresh")
  def refresh_model_catalog(request: Request) -> dict[str, Any]:
    if _is_remote_server_request(request) and not user_can_download_models(_auth_user(request)):
      raise HTTPException(
        status_code=403,
        detail="Недостаточно прав: обновление каталога моделей запрещено для этого аккаунта.",
      )
    from backend.model_catalog import fetch_catalog_from_hf, merge_and_save_catalog
    new_entries = fetch_catalog_from_hf()
    added = merge_and_save_catalog(new_entries)
    return {"ok": True, "added": added, "models_payload": build_models_payload()}

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

    context_limits: dict[str, Any] = {}
    requested_context_window = requested.get("context_window")
    if requested_context_window is not None:
      context_limits = build_context_window_requirements_payload()
      minimum_context_window = int(context_limits.get("min_context_window") or 0)
      if int(requested_context_window) < minimum_context_window:
        raise HTTPException(
          status_code=400,
          detail={
            "code": "context_window_too_small",
            "message": (
              "Слишком маленький context_window: он должен быть не меньше системного промпта "
              "и бюджета истории сообщений."
            ),
            "requested_context_window": int(requested_context_window),
            "minimum_context_window": minimum_context_window,
            "requirements": context_limits,
          },
        )

    model_item = next((item for item in model_engine.list_models_catalog() if str(item.get("id")) == safe_model_id), None)
    tier_hint = str(model_item.get("recommended_tier") or "compact") if model_item else "compact"
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
      "context_window_requirements": context_limits,
    }

  @app.get("/models/context-requirements")
  def get_context_requirements(model_id: str | None = None) -> dict[str, Any]:
    selected_model_id = str(model_engine.get_selected_model_id() or "").strip().lower()
    safe_model_id = str(model_id or "").strip().lower()
    target_model_id = safe_model_id or selected_model_id
    if not target_model_id:
      raise HTTPException(status_code=400, detail="model_id is required")

    model_item = next((item for item in model_engine.list_models_catalog() if str(item.get("id") or "").strip().lower() == target_model_id), None)
    if model_item is None:
      raise HTTPException(status_code=400, detail="Unsupported model id")
    tier_hint = str(model_item.get("recommended_tier") or "compact")

    context_limits = build_context_window_requirements_payload()
    params = model_engine.get_model_params(target_model_id, tier_key=tier_hint)
    return {
      "ok": True,
      "model_id": target_model_id,
      "selected_model_id": selected_model_id,
      "loaded_model_id": str(model_engine.get_loaded_model_id() or "").strip().lower(),
      "recommended_tier": tier_hint,
      "params": params,
      "context_window_requirements": context_limits,
    }

  @app.post("/models/context-usage")
  def get_context_usage(payload: ContextUsageRequest) -> dict[str, Any]:
    if not hasattr(model_engine, "get_context_usage"):
      raise HTTPException(status_code=501, detail="Context usage API is not available")

    active_tools = resolve_context_guard_active_tools()
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
    try:
      usage_payload = model_engine.get_context_usage(
        model_id=str(payload.model_id or "").strip().lower(),
        draft_text=str(payload.draft_text or ""),
        pending_assistant_text=str(payload.pending_assistant_text or ""),
        history=list(payload.history or []),
        attachments=list(payload.attachments or []),
        history_variants=list(payload.history_variants or []),
        active_tools=active_tools,
        tool_definitions=tool_definitions,
        tool_schemas=tool_schemas,
      )
    except RuntimeError as exc:
      raise HTTPException(
        status_code=409,
        detail={
          "code": "tokenizer_unavailable",
          "message": str(exc),
        },
      ) from exc
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
      "ok": True,
      **usage_payload,
    }

  @app.get("/tools")
  def list_tools() -> dict[str, Any]:
    autonomous_mode = bool(get_autonomous_mode()) if callable(get_autonomous_mode) else False
    return {
      "tools": tool_registry.list_tools(),
      "autonomous_mode": autonomous_mode,
    }
