from __future__ import annotations

from typing import Any

try:
  from backend.engine_support import format_bytes, normalize_model_repo, normalize_model_tier_key, resolve_available_memory_bytes, resolve_total_memory_bytes
  from backend.model_catalog import DEFAULT_MODEL_ID_BY_TIER, get_model_entry, list_model_catalog_payload, normalize_model_id, resolve_model_id_for_tier
  from backend.schemas import MODEL_TIERS
except ModuleNotFoundError:
  from engine_support import format_bytes, normalize_model_repo, normalize_model_tier_key, resolve_available_memory_bytes, resolve_total_memory_bytes  # type: ignore
  from model_catalog import DEFAULT_MODEL_ID_BY_TIER, get_model_entry, list_model_catalog_payload, normalize_model_id, resolve_model_id_for_tier  # type: ignore
  from schemas import MODEL_TIERS  # type: ignore


class EngineModelsMixin:
  def _runtime_supports_vision(self) -> bool:
    resolver = getattr(self, "_runtime_supports_vision_inputs", None)
    if callable(resolver):
      try:
        return bool(resolver())
      except Exception:
        return False
    return True

  def get_selected_tier(self) -> str:
    selected_model_id = self.get_selected_model_id()
    selected_model = get_model_entry(selected_model_id)
    if selected_model is not None:
      return normalize_model_tier_key(getattr(selected_model, "recommended_tier", ""), "compact")
    raw = self._storage.get_setting("model_tier")
    return normalize_model_tier_key(raw, "compact")

  def get_loaded_tier(self) -> str:
    with self._state_lock:
      return self._loaded_tier

  def get_loaded_model_id(self) -> str:
    with self._state_lock:
      return self._loaded_model_id

  def get_runtime_snapshot(self) -> dict[str, Any]:
    with self._state_lock:
      pending_model_id = self._pending_model_id
      loaded_model_id = self._loaded_model_id
    runtime_backend_kind = str(getattr(self, "_runtime_backend_kind", "") or "").strip().lower()
    stream_source = ""
    stream_available = False
    generation_lock = getattr(self, "_generation_lock", None)
    if generation_lock is not None:
      acquired = False
      try:
        acquired = bool(generation_lock.acquire(blocking=False))
      except TypeError:
        acquired = bool(generation_lock.acquire(False))
      if acquired:
        try:
          if runtime_backend_kind == "mlx_vlm":
            stream_available = bool(getattr(self, "_vlm_stream_generate_fn", None))
            stream_source = "mlx_vlm.stream_generate"
          else:
            stream_available = bool(getattr(self, "_stream_generate_fn", None))
            stream_source = "mlx_lm.stream_generate"
        finally:
          generation_lock.release()
      else:
        # Не блокируем API-поток, если прямо сейчас идёт генерация.
        if runtime_backend_kind == "mlx_vlm":
          stream_available = bool(getattr(self, "_vlm_stream_generate_fn", None))
          stream_source = "mlx_vlm.stream_generate"
        else:
          stream_available = bool(getattr(self, "_stream_generate_fn", None))
          stream_source = "mlx_lm.stream_generate"
    else:
      if runtime_backend_kind == "mlx_vlm":
        stream_available = bool(getattr(self, "_vlm_stream_generate_fn", None))
        stream_source = "mlx_vlm.stream_generate"
      else:
        stream_available = bool(getattr(self, "_stream_generate_fn", None))
        stream_source = "mlx_lm.stream_generate"

    startup = self.get_startup_snapshot()
    startup_details = startup.get("details") if isinstance(startup, dict) and isinstance(startup.get("details"), dict) else {}
    loading_model_id = normalize_model_id(startup_details.get("model_id"), "")

    vision_runtime_available = self._runtime_supports_vision()
    return {
      "selected_model_id": self.get_selected_model_id(),
      "loaded_model_id": loaded_model_id,
      "loading_model_id": loading_model_id,
      "pending_model_id": pending_model_id,
      "models_dir": str(getattr(self, "_models_dir", "") or ""),
      "runtime_backend_kind": runtime_backend_kind,
      "streaming_runtime_source": stream_source,
      "streaming_runtime_available": stream_available,
      "vision_runtime_available": vision_runtime_available,
      "generation_stop_requested": self._generation_stop_event.is_set(),
      "startup": startup,
      "memory": dict(self._memory_details or {}),
    }

  @classmethod
  def _model_setting_key_for_tier(cls, tier: str | None = None) -> str:
    safe_tier = normalize_model_tier_key(tier, "compact")
    return f"{cls.MODEL_SETTING_PREFIX}{safe_tier}"

  def get_selected_model_id(self, tier: str | None = None) -> str:
    global_stored = normalize_model_id(self._storage.get_setting(self.MODEL_SELECTED_SETTING_KEY), "")
    if global_stored:
      return global_stored

    if tier is None:
      safe_tier = normalize_model_tier_key(self._storage.get_setting("model_tier"), "compact")
    else:
      safe_tier = normalize_model_tier_key(tier, "compact")
    legacy_stored = self._storage.get_setting(self._model_setting_key_for_tier(safe_tier))
    resolved = resolve_model_id_for_tier(safe_tier, legacy_stored)
    if resolved:
      self._storage.set_setting(self.MODEL_SELECTED_SETTING_KEY, resolved)
    return resolved

  def get_selected_model(self, tier: str | None = None) -> dict[str, Any] | None:
    model_id = self.get_selected_model_id(tier)
    entry = get_model_entry(model_id)
    if entry is None:
      return None
    runtime_supports_vision = self._runtime_supports_vision()
    catalog_supports_vision = bool(entry.supports_vision)
    return {
      "id": entry.id,
      "label": entry.label,
      "repo": self.get_model_repo_for_tier(tier),
      "source": entry.source,
      "homepage": entry.homepage,
      "family": entry.family,
      "size": entry.size,
      "quantization": entry.quantization,
      "description": entry.description,
      "supports_tools": entry.supports_tools,
      "supports_vision": bool(catalog_supports_vision and runtime_supports_vision),
      "supports_vision_catalog": catalog_supports_vision,
      "supports_documents": entry.supports_documents,
      "recommended_tier": entry.recommended_tier,
      "max_context": entry.max_context,
      "estimated_unified_memory_bytes": entry.estimated_unified_memory_bytes,
      "estimated_unified_memory_human": format_bytes(entry.estimated_unified_memory_bytes),
    }

  def get_model_params(self, model_id: str, *, tier_key: str = "compact") -> dict[str, Any]:
    return self._model_storage.get_model_params(model_id, tier_key=tier_key)

  def set_model_params(self, model_id: str, params: dict[str, Any], *, tier_key: str = "compact") -> dict[str, Any]:
    return self._model_storage.set_model_params(model_id, params, tier_key=tier_key)

  def get_local_cache_map(self) -> dict[str, dict[str, Any]]:
    return self._model_storage.get_local_cache_map()

  def delete_local_model_cache(self, model_id: str) -> bool:
    return self._model_storage.delete_local_model_cache(model_id)

  def build_compatibility_payload(self) -> dict[str, dict[str, Any]]:
    total_memory, total_source = resolve_total_memory_bytes()
    available_memory, available_source = resolve_available_memory_bytes()
    payload: dict[str, dict[str, Any]] = {}
    for model in list_model_catalog_payload():
      model_id = str(model.get("id") or "").strip()
      required = int(model.get("estimated_unified_memory_bytes") or 0)
      compatible = True
      level = "ok"
      reason = "Совместима с текущей конфигурацией."
      if required > 0 and total_memory is not None and total_memory < required:
        compatible = False
        level = "unsupported"
        reason = (
          f"Недостаточно общей памяти устройства: нужно ~{format_bytes(required)}, "
          f"доступно всего {format_bytes(total_memory)}."
        )
      elif required > 0 and available_memory is not None and available_memory < required:
        level = "warning"
        reason = (
          f"Сейчас мало свободной памяти: нужно ~{format_bytes(required)}, "
          f"свободно {format_bytes(available_memory)}."
        )
      payload[model_id] = {
        "compatible": compatible,
        "level": level,
        "reason": reason,
        "required_unified_memory_bytes": required,
        "required_unified_memory_human": format_bytes(required),
        "total_unified_memory_bytes": total_memory,
        "total_unified_memory_human": format_bytes(total_memory),
        "available_unified_memory_bytes": available_memory,
        "available_unified_memory_human": format_bytes(available_memory),
        "total_source": total_source,
        "available_source": available_source,
      }
    return payload

  def list_models_catalog(self) -> list[dict[str, Any]]:
    cache_map = self.get_local_cache_map()
    compatibility_map = self.build_compatibility_payload()
    runtime = self.get_runtime_snapshot()
    selected_model_id = normalize_model_id(self.get_selected_model_id(), "")
    loaded_model_id = normalize_model_id(runtime.get("loaded_model_id"), "")
    startup = runtime.get("startup") if isinstance(runtime, dict) else {}
    startup_details = startup.get("details") if isinstance(startup, dict) and isinstance(startup.get("details"), dict) else {}
    startup_model_id = normalize_model_id(startup_details.get("model_id"), "")
    runtime_supports_vision = self._runtime_supports_vision()

    payload: list[dict[str, Any]] = []
    for model in list_model_catalog_payload():
      model_id = str(model.get("id") or "").strip()
      recommended_tier = normalize_model_tier_key(str(model.get("recommended_tier") or ""), "compact")
      params = self.get_model_params(model_id, tier_key=recommended_tier)
      model_cache = cache_map.get(model_id, {"cached": False})
      compatibility = compatibility_map.get(model_id, {
        "compatible": True,
        "level": "ok",
        "reason": "",
      })
      catalog_supports_vision = bool(model.get("supports_vision"))
      payload.append(
        {
          **model,
          "supports_vision": bool(catalog_supports_vision and runtime_supports_vision),
          "supports_vision_catalog": catalog_supports_vision,
          "params": params,
          "cache": model_cache,
          "compatibility": compatibility,
          "selected": model_id == selected_model_id,
          "loaded": model_id == loaded_model_id and self.is_ready(),
          "loading": (
            model_id == startup_model_id
            and str(startup.get("status") or "").strip().lower() == "loading"
          ),
        }
      )
    return payload

  def get_model_repo_for_tier(self, tier: str | None = None) -> str:
    key = normalize_model_tier_key(tier, "compact")
    selected_model_id = self.get_selected_model_id(key)
    selected_model = get_model_entry(selected_model_id)
    fallback_model = get_model_entry(DEFAULT_MODEL_ID_BY_TIER.get(key, DEFAULT_MODEL_ID_BY_TIER["compact"]))
    fallback_repo = fallback_model.repo if fallback_model is not None else ""
    selected_repo = selected_model.repo if selected_model is not None else fallback_repo
    return normalize_model_repo(selected_repo, fallback_repo)

  def set_selected_tier(self, tier: str, *, auto_load: bool = False) -> str:
    requested = str(tier or "").strip().lower()
    key = normalize_model_tier_key(requested, "")
    if not key:
      raise ValueError("Unsupported model tier")
    current = self.get_selected_tier()
    if key != current:
      self._storage.set_setting("model_tier", key)
    target_repo = self.get_model_repo_for_tier(key)
    if auto_load and (self.model_repo != target_repo or not self.is_ready()):
      self.start_background_load(key)
    return key

  def set_selected_model(self, model_id: str, *, tier: str | None = None, auto_load: bool = False) -> str:
    safe_tier = normalize_model_tier_key(tier, self.get_selected_tier())
    normalized_model_id = normalize_model_id(model_id, "")
    if not normalized_model_id:
      raise ValueError("Unsupported model id")
    self._storage.set_setting(self.MODEL_SELECTED_SETTING_KEY, normalized_model_id)
    self._storage.set_setting(self._model_setting_key_for_tier(safe_tier), normalized_model_id)

    model_entry = get_model_entry(normalized_model_id)
    recommended_tier = normalize_model_tier_key(
      getattr(model_entry, "recommended_tier", "") if model_entry is not None else safe_tier,
      safe_tier,
    )
    self._storage.set_setting("model_tier", recommended_tier)
    self._storage.set_setting(self._model_setting_key_for_tier(recommended_tier), normalized_model_id)

    if auto_load:
      target_repo = self.get_model_repo_for_tier(recommended_tier)
      if self.model_repo != target_repo or not self.is_ready() or self.get_loaded_model_id() != normalized_model_id:
        self.start_background_load(recommended_tier)
    return normalized_model_id

  def list_tiers(self) -> list[dict[str, Any]]:
    active_tier = self.get_selected_tier()
    loaded_tier = self.get_loaded_tier()
    loaded_model_id = self.get_loaded_model_id()
    runtime_supports_vision = self._runtime_supports_vision()
    result: list[dict[str, Any]] = []
    for key in ["compact", "balanced", "performance"]:
      tier = MODEL_TIERS[key]
      model_id = self.get_selected_model_id(key)
      model_entry = get_model_entry(model_id)
      result.append(
        {
          "key": tier.key,
          "label": tier.label,
          "max_context": tier.max_context,
          "temperature": tier.temperature,
          "active": tier.key == active_tier,
          "loaded": tier.key == loaded_tier,
          "model_id": model_id,
          "model_label": model_entry.label if model_entry is not None else model_id,
          "model_loaded": tier.key == loaded_tier and model_id == loaded_model_id,
          "supports_tools": bool(model_entry and model_entry.supports_tools),
          "supports_vision": bool(model_entry and model_entry.supports_vision and runtime_supports_vision),
          "supports_vision_catalog": bool(model_entry and model_entry.supports_vision),
          "supports_documents": bool(model_entry and model_entry.supports_documents),
          "repo": self.get_model_repo_for_tier(tier.key),
        }
      )
    return result
