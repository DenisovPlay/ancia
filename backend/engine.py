from __future__ import annotations

import ast
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Generator
from urllib import parse as url_parse

try:
  from backend.common import normalize_mood, utc_now_iso
  from backend.model_catalog import (
    DEFAULT_MODEL_ID_BY_TIER,
    get_model_entry,
    list_model_catalog_payload,
    normalize_model_id,
    resolve_model_id_for_tier,
  )
  from backend.schemas import MODEL_TIER_ALIASES, MODEL_TIERS, ChatRequest, ModelTier, RuntimeChatContext, ToolEvent
  from backend.storage import AppStorage
  from backend.tooling import TOOL_SCHEMAS, ToolRegistry, apply_enabled_tools_prompt
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore
  from model_catalog import (  # type: ignore
    DEFAULT_MODEL_ID_BY_TIER,
    get_model_entry,
    list_model_catalog_payload,
    normalize_model_id,
    resolve_model_id_for_tier,
  )
  from schemas import MODEL_TIER_ALIASES, MODEL_TIERS, ChatRequest, ModelTier, RuntimeChatContext, ToolEvent  # type: ignore
  from storage import AppStorage  # type: ignore
  from tooling import TOOL_SCHEMAS, ToolRegistry, apply_enabled_tools_prompt  # type: ignore


CHAT_MOOD_DIRECTIVE_PATTERN = re.compile(r"\[\[\s*mood\s*:\s*([a-zA-Z_]+)\s*\]\]", re.IGNORECASE)
TOOL_CALL_BLOCK_PATTERN = re.compile(r"<tool_call>\s*([\s\S]*?)\s*</tool_call>", re.IGNORECASE)
TOOL_CALL_LINE_PREFIX_PATTERN = re.compile(
  r"^\s*(?:(?:>\s*)+|[-*+\u2022]\s+|[\u2013\u2014]\s+|\(\d{1,3}\)\s+|\d{1,3}[.)]\s+)"
)
TOOL_CALL_LABEL_PREFIX_PATTERN = re.compile(
  r"^\s*(?:tool(?:_call)?|function|json)\s*[:=-]\s*",
  re.IGNORECASE,
)
TOOL_CALL_INVISIBLE_PREFIX_PATTERN = re.compile(r"^[\s\u200b\u200c\u200d\ufeff]+")
SMART_QUOTES_TRANSLATION = str.maketrans({
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u201e": "\"",
  "\u00ab": "\"",
  "\u00bb": "\"",
})
LOGGER = logging.getLogger("ancia.engine")
STARTUP_STAGE_PROGRESS = {
  "backend_boot": 4,
  "environment_check": 15,
  "checking_gpu_memory": 30,
  "loading_model": 72,
  "ready": 100,
  "error": 100,
  "unloaded": 0,
}


def build_chat_mood_prompt() -> str:
  return (
    "## Настроение и фон чата\n"
    "Фон чата зависит от настроения ответа модели.\n"
    "Ты можешь явно задать настроение маркером: [[mood:<state>]]. Этот маркер не показывается пользователю.\n"
    "Доступные состояния: neutral, thinking, waiting, success, friendly, warning, error, aggression, creative, "
    "planning, coding, researching, offline.\n"
    "Примеры: [[mood:aggression]], [[mood:warning]], [[mood:success]].\n"
    "Выбирай mood по контексту запроса и тону диалога."
  )


@dataclass
class ModelResult:
  reply: str
  mood: str
  tool_events: list[ToolEvent]
  model_name: str


@dataclass
class GenerationPlan:
  tier: ModelTier
  user_text: str
  context_mood: str
  active_tools: set[str]
  context_window_override: int | None = None
  max_tokens_override: int | None = None
  temperature_override: float | None = None
  top_p_override: float | None = None
  top_k_override: int | None = None


def format_bytes(value: int | None) -> str:
  if value is None or value < 0:
    return "n/a"
  size = float(value)
  for unit in ["B", "KB", "MB", "GB", "TB"]:
    if size < 1024 or unit == "TB":
      if unit == "B":
        return f"{int(size)} {unit}"
      return f"{size:.2f} {unit}"
    size /= 1024
  return f"{value} B"


def resolve_available_memory_bytes() -> tuple[int | None, str]:
  try:
    import psutil  # type: ignore

    available = int(psutil.virtual_memory().available)
    return max(0, available), "psutil.virtual_memory.available"
  except Exception:
    pass

  if hasattr(os, "sysconf"):
    try:
      pages = int(os.sysconf("SC_AVPHYS_PAGES"))
      page_size = int(os.sysconf("SC_PAGE_SIZE"))
      if pages > 0 and page_size > 0:
        return pages * page_size, "os.sysconf"
    except (OSError, TypeError, ValueError):
      pass

  return None, "unknown"


def resolve_total_memory_bytes() -> tuple[int | None, str]:
  if platform.system() == "Darwin":
    try:
      output = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
      value = int(output)
      if value > 0:
        return value, "sysctl hw.memsize"
    except (OSError, subprocess.SubprocessError, ValueError):
      pass

  if hasattr(os, "sysconf"):
    try:
      pages = int(os.sysconf("SC_PHYS_PAGES"))
      page_size = int(os.sysconf("SC_PAGE_SIZE"))
      if pages > 0 and page_size > 0:
        return pages * page_size, "os.sysconf"
    except (OSError, TypeError, ValueError):
      pass

  return None, "unknown"


class ModelStartupState:
  def __init__(self) -> None:
    self._lock = threading.Lock()
    self._snapshot: dict[str, Any] = {
      "status": "booting",
      "stage": "backend_boot",
      "message": "Инициализация backend...",
      "updated_at": utc_now_iso(),
      "details": {},
    }

  def set(
    self,
    *,
    status: str,
    stage: str,
    message: str,
    details: dict[str, Any] | None = None,
  ) -> None:
    with self._lock:
      self._snapshot = {
        "status": str(status or "booting"),
        "stage": str(stage or "backend_boot"),
        "message": str(message or ""),
        "updated_at": utc_now_iso(),
        "details": dict(details or {}),
      }

  def get(self) -> dict[str, Any]:
    with self._lock:
      return dict(self._snapshot)


def normalize_model_tier_key(value: str | None, fallback: str = "lite") -> str:
  raw = str(value or "").strip().lower()
  if raw in MODEL_TIER_ALIASES:
    raw = MODEL_TIER_ALIASES[raw]
  if raw in MODEL_TIERS:
    return raw
  return fallback


def normalize_model_repo(value: str | None, fallback: str = "") -> str:
  aliases = {
    "qwen/qwen3-vl-4b": "lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit",
  }
  raw = str(value or "").strip()
  if not raw:
    return fallback

  if raw.startswith("http://") or raw.startswith("https://"):
    try:
      parsed = url_parse.urlparse(raw)
      path_parts = [part for part in parsed.path.split("/") if part]
      if len(path_parts) >= 3 and path_parts[0].lower() == "models":
        owner = path_parts[1].strip()
        model = path_parts[2].strip()
        if owner and model:
          mapped = aliases.get(f"{owner}/{model}".lower())
          return mapped or f"{owner}/{model}"
    except Exception:
      pass

  normalized = raw.strip("/")
  mapped = aliases.get(normalized.lower())
  return mapped or normalized


class PythonModelEngine:
  MODEL_SETTING_PREFIX = "model_id_"
  MODEL_PARAMS_SETTING_KEY = "model_params_by_id"
  MIN_REQUIRED_UNIFIED_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
  SUPPORTED_PYTHON_MIN = (3, 10)
  SUPPORTED_PYTHON_MAX_EXCLUSIVE = (3, 13)
  MAX_HISTORY_MESSAGES = 12
  MAX_HISTORY_TOTAL_CHARS = 5200
  MAX_HISTORY_ENTRY_CHARS = 900
  MAX_TOOL_CALL_ROUNDS = 4
  MAX_TOOL_CALLS_PER_ROUND = 4

  def __init__(self, storage: AppStorage, *, base_system_prompt: str) -> None:
    self._storage = storage
    self._base_system_prompt = base_system_prompt
    self._startup = ModelStartupState()
    self._load_thread: threading.Thread | None = None
    self._state_lock = threading.Lock()
    self._generation_lock = threading.Lock()
    self._generation_stop_event = threading.Event()
    self._model: Any = None
    self._tokenizer: Any = None
    self._generate_fn: Callable[..., Any] | None = None
    self._stream_generate_fn: Callable[..., Any] | None = None
    self._make_sampler_fn: Callable[..., Any] | None = None
    self._make_logits_processors_fn: Callable[..., Any] | None = None
    self._memory_details: dict[str, Any] = {}
    self._loading_tier = ""
    self._pending_tier = ""
    self._pending_model_id = ""
    self._loaded_tier = ""
    self._loaded_model_id = ""
    self._model_repo_override_by_tier: dict[str, str] = {
      "lite": normalize_model_repo(os.getenv("ANCIA_MODEL_LITE_REPO"), ""),
      "standart": normalize_model_repo(os.getenv("ANCIA_MODEL_STANDART_REPO"), ""),
      "plus": normalize_model_repo(os.getenv("ANCIA_MODEL_PLUS_REPO"), ""),
    }

    selected_tier = self.get_selected_tier()
    selected_model = self.get_selected_model_id(selected_tier)
    selected_model_entry = get_model_entry(selected_model)
    self.model_repo = self.get_model_repo_for_tier(selected_tier)
    self.model_name = selected_model_entry.label if selected_model_entry is not None else self.model_repo
    self._startup.set(
      status="idle",
      stage="unloaded",
      message="Модель не загружена. Запустится при первом запросе.",
      details={
        "progress_percent": STARTUP_STAGE_PROGRESS["unloaded"],
        "model_tier": selected_tier,
        "model_id": selected_model,
        "model_repo": self.model_repo,
      },
    )

  def start_background_load(self, tier: str | None = None) -> None:
    target_tier = normalize_model_tier_key(tier, self.get_selected_tier())
    target_model_id = self.get_selected_model_id(target_tier)
    target_model_entry = get_model_entry(target_model_id)
    target_repo = self.get_model_repo_for_tier(target_tier)
    load_thread = threading.Thread(
      target=self._load_model,
      args=(target_tier, target_model_id, target_repo),
      name="ancia-model-loader",
      daemon=True,
    )
    with self._state_lock:
      if self._load_thread and self._load_thread.is_alive():
        self._pending_tier = target_tier
        self._pending_model_id = target_model_id
        return
      self._loading_tier = target_tier
      self._pending_tier = ""
      self._pending_model_id = ""
      self._load_thread = load_thread

    self._startup.set(
      status="loading",
      stage="backend_boot",
      message="Инициализация Python-модуля модели...",
      details={
        "progress_percent": STARTUP_STAGE_PROGRESS["backend_boot"],
        "model_tier": target_tier,
        "model_id": target_model_id,
        "model_label": target_model_entry.label if target_model_entry is not None else target_model_id,
        "model_repo": target_repo,
      },
    )
    load_thread.start()

  def get_startup_snapshot(self) -> dict[str, Any]:
    return self._startup.get()

  def is_ready(self) -> bool:
    return self.get_startup_snapshot().get("status") == "ready"

  def get_unavailable_message(self) -> str:
    snapshot = self.get_startup_snapshot()
    status = str(snapshot.get("status") or "")
    message = str(snapshot.get("message") or "").strip()
    if status == "idle":
      return message or "Модель не загружена."
    if status in {"booting", "loading"}:
      return message or "Модель ещё загружается."
    if status == "error":
      return message or "Модель недоступна из-за ошибки запуска."
    return message or "Модель недоступна."

  def _resolve_mood(self, text: str, context_mood: str) -> str:
    normalized = text.lower()
    if re.search(r"ошиб|error|critical|failed", normalized):
      return "error"
    if re.search(r"агресс|angry|rage", normalized):
      return "aggression"
    if re.search(r"успех|успеш|success|готово|done", normalized):
      return "success"
    if re.search(r"дожд|ожидан|thinking|think|подума", normalized):
      return "thinking"
    if re.search(r"предупреж|warning|risk", normalized):
      return "warning"
    if re.search(r"друж|friendly", normalized):
      return "friendly"
    return normalize_mood(context_mood, "neutral")

  def get_selected_tier(self) -> str:
    raw = self._storage.get_setting("model_tier")
    return normalize_model_tier_key(raw, "lite")

  def get_loaded_tier(self) -> str:
    with self._state_lock:
      return self._loaded_tier

  def get_loaded_model_id(self) -> str:
    with self._state_lock:
      return self._loaded_model_id

  def get_runtime_snapshot(self) -> dict[str, Any]:
    with self._state_lock:
      loading_tier = self._loading_tier
      pending_tier = self._pending_tier
      pending_model_id = self._pending_model_id
      loaded_tier = self._loaded_tier
      loaded_model_id = self._loaded_model_id

    return {
      "selected_tier": self.get_selected_tier(),
      "selected_model_id": self.get_selected_model_id(),
      "loaded_tier": loaded_tier,
      "loaded_model_id": loaded_model_id,
      "loading_tier": loading_tier,
      "pending_tier": pending_tier,
      "pending_model_id": pending_model_id,
      "generation_stop_requested": self._generation_stop_event.is_set(),
      "startup": self.get_startup_snapshot(),
      "memory": dict(self._memory_details or {}),
    }

  @classmethod
  def _model_setting_key_for_tier(cls, tier: str | None = None) -> str:
    safe_tier = normalize_model_tier_key(tier, "lite")
    return f"{cls.MODEL_SETTING_PREFIX}{safe_tier}"

  def get_selected_model_id(self, tier: str | None = None) -> str:
    safe_tier = normalize_model_tier_key(tier, self.get_selected_tier())
    stored = self._storage.get_setting(self._model_setting_key_for_tier(safe_tier))
    return resolve_model_id_for_tier(safe_tier, stored)

  def get_selected_model(self, tier: str | None = None) -> dict[str, Any] | None:
    model_id = self.get_selected_model_id(tier)
    entry = get_model_entry(model_id)
    if entry is None:
      return None
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
      "supports_vision": entry.supports_vision,
      "supports_documents": entry.supports_documents,
      "recommended_tier": entry.recommended_tier,
      "max_context": entry.max_context,
      "estimated_unified_memory_bytes": entry.estimated_unified_memory_bytes,
      "estimated_unified_memory_human": format_bytes(entry.estimated_unified_memory_bytes),
    }

  @classmethod
  def _default_model_params(cls, tier_key: str) -> dict[str, Any]:
    tier = MODEL_TIERS.get(tier_key) or MODEL_TIERS["lite"]
    return {
      "context_window": int(tier.max_context),
      "max_tokens": 320 if tier.key == "plus" else 256,
      "temperature": float(tier.temperature),
      "top_p": 0.9,
      "top_k": 40,
    }

  def _load_model_params_map(self) -> dict[str, Any]:
    payload = self._storage.get_setting_json(self.MODEL_PARAMS_SETTING_KEY, {})
    if not isinstance(payload, dict):
      return {}
    return payload

  @staticmethod
  def _normalize_model_params_payload(params: dict[str, Any], tier_key: str) -> dict[str, Any]:
    defaults = PythonModelEngine._default_model_params(tier_key)
    out = dict(defaults)
    if not isinstance(params, dict):
      return out

    def _int_value(value: Any, minimum: int, maximum: int, fallback: int) -> int:
      try:
        parsed = int(value)
      except (TypeError, ValueError):
        return fallback
      return max(minimum, min(maximum, parsed))

    def _float_value(value: Any, minimum: float, maximum: float, fallback: float) -> float:
      try:
        parsed = float(value)
      except (TypeError, ValueError):
        return fallback
      return max(minimum, min(maximum, parsed))

    out["context_window"] = _int_value(params.get("context_window"), 256, 32768, defaults["context_window"])
    out["max_tokens"] = _int_value(params.get("max_tokens"), 16, 4096, defaults["max_tokens"])
    out["temperature"] = _float_value(params.get("temperature"), 0.0, 2.0, defaults["temperature"])
    out["top_p"] = _float_value(params.get("top_p"), 0.0, 1.0, defaults["top_p"])
    out["top_k"] = _int_value(params.get("top_k"), 1, 400, defaults["top_k"])
    return out

  def get_model_params(self, model_id: str, *, tier_key: str = "lite") -> dict[str, Any]:
    safe_model_id = normalize_model_id(model_id, "")
    if not safe_model_id:
      return self._default_model_params(tier_key)
    params_map = self._load_model_params_map()
    raw_model_params = params_map.get(safe_model_id, {})
    return self._normalize_model_params_payload(raw_model_params, tier_key)

  def set_model_params(self, model_id: str, params: dict[str, Any], *, tier_key: str = "lite") -> dict[str, Any]:
    safe_model_id = normalize_model_id(model_id, "")
    if not safe_model_id:
      raise ValueError("Unsupported model id")
    params_map = self._load_model_params_map()
    normalized = self._normalize_model_params_payload(params, tier_key)
    params_map[safe_model_id] = normalized
    self._storage.set_setting_json(self.MODEL_PARAMS_SETTING_KEY, params_map)
    return normalized

  def _resolve_hf_hub_cache_root(self) -> Path:
    hf_home = str(os.getenv("HF_HOME") or "").strip()
    if hf_home:
      return (Path(hf_home).expanduser().resolve() / "hub")
    xdg_home = str(os.getenv("XDG_CACHE_HOME") or "").strip()
    if xdg_home:
      return (Path(xdg_home).expanduser().resolve() / "huggingface" / "hub")
    return (Path.home() / ".cache" / "huggingface" / "hub").resolve()

  @staticmethod
  def _repo_to_hf_cache_prefix(repo: str) -> str:
    owner, _, name = str(repo or "").partition("/")
    owner = owner.strip()
    name = name.strip()
    if not owner or not name:
      return ""
    safe_owner = owner.replace("/", "--")
    safe_name = name.replace("/", "--")
    return f"models--{safe_owner}--{safe_name}"

  def _resolve_repo_cache_dir(self, repo: str) -> Path | None:
    prefix = self._repo_to_hf_cache_prefix(repo)
    if not prefix:
      return None
    return (self._resolve_hf_hub_cache_root() / prefix).resolve()

  @staticmethod
  def _directory_size_bytes(path: Path) -> int:
    total = 0
    try:
      for root, _, files in os.walk(path):
        for file_name in files:
          file_path = Path(root) / file_name
          try:
            total += file_path.stat().st_size
          except OSError:
            continue
    except OSError:
      return 0
    return max(0, total)

  def get_local_cache_map(self) -> dict[str, dict[str, Any]]:
    cache_map: dict[str, dict[str, Any]] = {}
    for model_entry in self.list_models_catalog():
      repo = str(model_entry.get("repo") or "").strip()
      model_id = str(model_entry.get("id") or "").strip()
      cache_dir = self._resolve_repo_cache_dir(repo)
      if not repo or not model_id or cache_dir is None or not cache_dir.exists():
        continue
      snapshots_dir = cache_dir / "snapshots"
      refs_dir = cache_dir / "refs"
      has_snapshots = snapshots_dir.exists() and any(snapshots_dir.iterdir())
      if not has_snapshots:
        continue
      size_bytes = self._directory_size_bytes(cache_dir)
      cache_map[model_id] = {
        "cached": True,
        "repo": repo,
        "cache_dir": str(cache_dir),
        "snapshots_dir": str(snapshots_dir),
        "refs_dir": str(refs_dir),
        "size_bytes": size_bytes,
        "size_human": format_bytes(size_bytes),
      }
    return cache_map

  def delete_local_model_cache(self, model_id: str) -> bool:
    safe_model_id = normalize_model_id(model_id, "")
    if not safe_model_id:
      raise ValueError("Unsupported model id")
    if safe_model_id == self.get_loaded_model_id():
      raise RuntimeError("Нельзя удалить кэш загруженной модели. Сначала выгрузите модель.")

    entry = get_model_entry(safe_model_id)
    if entry is None:
      raise ValueError("Unsupported model id")
    cache_dir = self._resolve_repo_cache_dir(entry.repo)
    if cache_dir is None:
      return False
    hub_root = self._resolve_hf_hub_cache_root()
    if not str(cache_dir).startswith(str(hub_root)):
      raise RuntimeError("Некорректный путь к локальному кэшу модели.")
    if not cache_dir.exists():
      return False
    shutil.rmtree(cache_dir, ignore_errors=False)
    return True

  def unload_model(self) -> bool:
    with self._generation_lock:
      had_model = self._model is not None or self._tokenizer is not None
      self._model = None
      self._tokenizer = None
      self._generate_fn = None
      self._stream_generate_fn = None
      self._make_sampler_fn = None
      self._make_logits_processors_fn = None
    with self._state_lock:
      self._loaded_tier = ""
      self._loaded_model_id = ""
      self._pending_tier = ""
      self._pending_model_id = ""
    self._startup.set(
      status="idle",
      stage="unloaded",
      message="Модель выгружена. Загрузится при следующем запросе.",
      details={
        "progress_percent": STARTUP_STAGE_PROGRESS["unloaded"],
      },
    )
    return had_model

  def wait_until_ready(
    self,
    *,
    expected_tier: str,
    expected_model_id: str,
    timeout_seconds: float = 180.0,
    poll_interval_seconds: float = 0.25,
  ) -> tuple[bool, dict[str, Any]]:
    started_at = time.time()
    expected_tier_key = normalize_model_tier_key(expected_tier, "lite")
    expected_model = normalize_model_id(expected_model_id, "")
    while time.time() - started_at <= max(1.0, float(timeout_seconds)):
      snapshot = self.get_runtime_snapshot()
      startup = snapshot.get("startup") if isinstance(snapshot, dict) else {}
      status = str((startup or {}).get("status") or "").strip().lower()
      loaded_tier = str(snapshot.get("loaded_tier") or "").strip().lower()
      loaded_model_id = normalize_model_id(str(snapshot.get("loaded_model_id") or "").strip().lower(), "")
      if status == "ready" and loaded_tier == expected_tier_key and loaded_model_id == expected_model:
        return True, snapshot
      if status == "error":
        return False, snapshot
      time.sleep(max(0.05, float(poll_interval_seconds)))
    return False, self.get_runtime_snapshot()

  def build_compatibility_payload(self) -> dict[str, dict[str, Any]]:
    total_memory, total_source = resolve_total_memory_bytes()
    available_memory, available_source = resolve_available_memory_bytes()
    payload: dict[str, dict[str, Any]] = {}
    for model in self.list_models_catalog():
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
    selected_tier = self.get_selected_tier()
    cache_map = self.get_local_cache_map()
    compatibility_map = self.build_compatibility_payload()
    runtime = self.get_runtime_snapshot()
    selected_model_id = normalize_model_id(self.get_selected_model_id(selected_tier), "")
    loaded_model_id = normalize_model_id(runtime.get("loaded_model_id"), "")
    loading_tier = str(runtime.get("loading_tier") or "").strip().lower()
    startup = runtime.get("startup") if isinstance(runtime, dict) else {}
    startup_details = startup.get("details") if isinstance(startup, dict) and isinstance(startup.get("details"), dict) else {}
    startup_model_id = normalize_model_id(startup_details.get("model_id"), "")

    payload: list[dict[str, Any]] = []
    for model in list_model_catalog_payload():
      model_id = str(model.get("id") or "").strip()
      recommended_tier = normalize_model_tier_key(str(model.get("recommended_tier") or ""), "lite")
      params = self.get_model_params(model_id, tier_key=recommended_tier)
      model_cache = cache_map.get(model_id, {"cached": False})
      compatibility = compatibility_map.get(model_id, {
        "compatible": True,
        "level": "ok",
        "reason": "",
      })
      payload.append(
        {
          **model,
          "params": params,
          "cache": model_cache,
          "compatibility": compatibility,
          "selected": model_id == selected_model_id,
          "loaded": model_id == loaded_model_id and self.is_ready(),
          "loading": (
            loading_tier == recommended_tier
            and model_id == startup_model_id
            and str(startup.get("status") or "").strip().lower() == "loading"
          ),
        }
      )
    return payload

  def get_model_repo_for_tier(self, tier: str | None = None) -> str:
    key = normalize_model_tier_key(tier, "lite")
    selected_model_id = self.get_selected_model_id(key)
    selected_model = get_model_entry(selected_model_id)
    fallback_model = get_model_entry(DEFAULT_MODEL_ID_BY_TIER.get(key, DEFAULT_MODEL_ID_BY_TIER["lite"]))
    fallback_repo = fallback_model.repo if fallback_model is not None else ""
    selected_repo = selected_model.repo if selected_model is not None else fallback_repo
    override_repo = self._model_repo_override_by_tier.get(key, "")
    return override_repo or normalize_model_repo(selected_repo, fallback_repo)

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
    self._storage.set_setting(self._model_setting_key_for_tier(safe_tier), normalized_model_id)

    active_tier = self.get_selected_tier()
    if auto_load and safe_tier == active_tier:
      target_repo = self.get_model_repo_for_tier(safe_tier)
      if self.model_repo != target_repo or not self.is_ready():
        self.start_background_load(safe_tier)
    return normalized_model_id

  def list_tiers(self) -> list[dict[str, Any]]:
    active_tier = self.get_selected_tier()
    loaded_tier = self.get_loaded_tier()
    loaded_model_id = self.get_loaded_model_id()
    result: list[dict[str, Any]] = []
    for key in ["lite", "standart", "plus"]:
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
          "supports_vision": bool(model_entry and model_entry.supports_vision),
          "supports_documents": bool(model_entry and model_entry.supports_documents),
          "repo": self.get_model_repo_for_tier(tier.key),
        }
      )
    return result

  def _validate_environment(self) -> None:
    if platform.system() != "Darwin" or platform.machine() not in {"arm64", "aarch64"}:
      raise RuntimeError("MLX-модель поддерживается только на macOS с Apple Silicon (arm64).")

    python_version = sys.version_info[:2]
    allow_unsupported_python = os.getenv("ANCIA_ALLOW_UNSUPPORTED_PYTHON", "").strip() == "1"
    if not allow_unsupported_python:
      if not (self.SUPPORTED_PYTHON_MIN <= python_version < self.SUPPORTED_PYTHON_MAX_EXCLUSIVE):
        min_label = ".".join(str(x) for x in self.SUPPORTED_PYTHON_MIN)
        max_label = ".".join(str(x) for x in self.SUPPORTED_PYTHON_MAX_EXCLUSIVE)
        raise RuntimeError(
          f"Неподдерживаемая версия Python {sys.version.split()[0]} для MLX. "
          f"Нужен Python >= {min_label} и < {max_label}."
        )

  def _check_memory(self) -> dict[str, Any]:
    required_raw = os.getenv(
      "ANCIA_MODEL_MIN_UNIFIED_MEMORY_BYTES",
      str(self.MIN_REQUIRED_UNIFIED_MEMORY_BYTES),
    ).strip()
    try:
      required = max(256 * 1024 * 1024, int(required_raw))
    except ValueError:
      required = self.MIN_REQUIRED_UNIFIED_MEMORY_BYTES

    available, available_source = resolve_available_memory_bytes()
    total, total_source = resolve_total_memory_bytes()

    details = {
      "required_unified_memory_bytes": required,
      "required_unified_memory_human": format_bytes(required),
      "available_unified_memory_bytes": available,
      "available_unified_memory_human": format_bytes(available),
      "available_source": available_source,
      "total_unified_memory_bytes": total,
      "total_unified_memory_human": format_bytes(total),
      "total_source": total_source,
    }

    strict_available_check = os.getenv("ANCIA_STRICT_AVAILABLE_MEMORY_CHECK", "").strip() == "1"
    details["available_memory_check_mode"] = "strict" if strict_available_check else "soft"

    if total is not None and total < required:
      raise RuntimeError(
        "Недостаточно общей unified-памяти устройства для загрузки модели. "
        f"Нужно минимум {format_bytes(required)}, на устройстве всего {format_bytes(total)}."
      )

    if available is not None and available < required:
      warning_message = (
        "Низкий объём доступной памяти на момент запуска. "
        f"Требуется ~{format_bytes(required)}, сейчас доступно {format_bytes(available)}. "
        "Попробуем загрузить модель, но возможны ошибки OOM."
      )
      details["memory_warning"] = warning_message
      details["memory_warning_code"] = "low_available_memory"
      if strict_available_check:
        raise RuntimeError(
          "Недостаточно доступной unified-памяти для загрузки модели (strict check). "
          f"Нужно минимум {format_bytes(required)}, сейчас доступно {format_bytes(available)}."
        )

    return details

  def _set_error(self, message: str, details: dict[str, Any] | None = None) -> None:
    payload = dict(details or {})
    payload.setdefault("model_tier", self.get_selected_tier())
    payload.setdefault("model_id", self.get_selected_model_id(payload.get("model_tier")))
    payload.setdefault("loaded_tier", self.get_loaded_tier())
    payload.setdefault("loaded_model_id", self.get_loaded_model_id())
    payload.setdefault("model_repo", self.model_repo)
    payload.setdefault("python_version", sys.version.split()[0])
    payload.setdefault("platform", f"{platform.system()} {platform.machine()}")
    payload.setdefault("progress_percent", STARTUP_STAGE_PROGRESS["error"])
    self._startup.set(
      status="error",
      stage="error",
      message=message,
      details=payload,
    )

  def _load_model(self, target_tier: str, target_model_id: str, target_repo: str) -> None:
    next_tier = ""
    tier_label = MODEL_TIERS[target_tier].label
    target_model_entry = get_model_entry(target_model_id)
    model_label = target_model_entry.label if target_model_entry is not None else target_model_id
    try:
      self._startup.set(
        status="loading",
        stage="environment_check",
        message="Проверяем окружение Python и поддержку MLX...",
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["environment_check"],
          "model_tier": target_tier,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
        },
      )
      self._validate_environment()

      self._startup.set(
        status="loading",
        stage="checking_gpu_memory",
        message="Проверяем доступную GPU/unified память...",
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["checking_gpu_memory"],
          "model_tier": target_tier,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
        },
      )
      self._memory_details = self._check_memory()

      self._startup.set(
        status="loading",
        stage="loading_model",
        message=f"Загружаем модель {model_label} ({target_repo})...",
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["loading_model"],
          **self._memory_details,
          "model_tier": target_tier,
          "tier_label": tier_label,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
        },
      )

      from mlx_lm import generate as mlx_generate  # type: ignore
      from mlx_lm import load as mlx_load  # type: ignore
      from mlx_lm.sample_utils import make_logits_processors as mlx_make_logits_processors  # type: ignore
      from mlx_lm.sample_utils import make_sampler as mlx_make_sampler  # type: ignore
      try:
        from mlx_lm import stream_generate as mlx_stream_generate  # type: ignore
      except Exception:
        try:
          from mlx_lm.generate import stream_generate as mlx_stream_generate  # type: ignore
        except Exception:
          mlx_stream_generate = None

      # mlx_lm.load() пишет прогресс в stdout — при запуске через Tauri pipe
      # может закрыться и вызвать BrokenPipeError. Перенаправляем на devnull.
      import io as _io
      _old_stdout, _old_stderr = sys.stdout, sys.stderr
      try:
        sys.stdout = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
        sys.stderr = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
        model, tokenizer = mlx_load(target_repo)
      finally:
        sys.stdout, sys.stderr = _old_stdout, _old_stderr
      with self._generation_lock:
        self._model = model
        self._tokenizer = tokenizer
        self._generate_fn = mlx_generate
        self._stream_generate_fn = mlx_stream_generate
        self._make_sampler_fn = mlx_make_sampler
        self._make_logits_processors_fn = mlx_make_logits_processors
        self.model_repo = target_repo
        self.model_name = model_label
      with self._state_lock:
        self._loaded_tier = target_tier
        self._loaded_model_id = target_model_id

      self._startup.set(
        status="ready",
        stage="ready",
        message="Модель загружена и готова к работе.",
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["ready"],
          **self._memory_details,
          "model_tier": target_tier,
          "tier_label": tier_label,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
          "python_version": sys.version.split()[0],
          "platform": f"{platform.system()} {platform.machine()}",
        },
      )
    except Exception as exc:
      self._set_error(
        f"Не удалось загрузить модель: {exc}",
        details={
          "model_tier": target_tier,
          "tier_label": tier_label,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
        },
      )
    finally:
      with self._state_lock:
        if self._pending_tier and (
          self._pending_tier != target_tier
          or self._pending_model_id != target_model_id
        ):
          next_tier = self._pending_tier
        self._pending_tier = ""
        self._pending_model_id = ""
        self._loading_tier = ""
      if next_tier:
        self.start_background_load(next_tier)

  @staticmethod
  def _truncate_text(value: str, limit: int = 3500) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
      return text
    return text[: max(0, limit - 1)].rstrip() + "…"

  @classmethod
  def _summarize_tool_event(cls, event: ToolEvent) -> str:
    if event.name == "web.search.duckduckgo":
      query = str(event.output.get("query") or "").strip()
      results = event.output.get("results") if isinstance(event.output, dict) else []
      if not isinstance(results, list):
        results = []
      lines = [f"query={query}"] if query else []
      for index, item in enumerate(results[:5], start=1):
        if not isinstance(item, dict):
          continue
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "").strip()
        if title or url:
          lines.append(f"{index}. {title} — {url}".strip(" —"))
      if not lines:
        lines.append(json.dumps(event.output, ensure_ascii=False))
      return "\n".join(lines)

    if event.name == "web.visit.website":
      title = str(event.output.get("title") or "").strip()
      url = str(event.output.get("url") or event.output.get("requested_url") or "").strip()
      content = cls._truncate_text(str(event.output.get("content") or "").strip(), 2800)
      links = event.output.get("links") if isinstance(event.output, dict) else []
      lines = []
      if title:
        lines.append(f"title={title}")
      if url:
        lines.append(f"url={url}")
      if content:
        lines.append(f"content={content}")
      if isinstance(links, list) and links:
        link_lines = [str(link).strip() for link in links[:8] if str(link).strip()]
        if link_lines:
          lines.append("links:\n- " + "\n- ".join(link_lines))
      if not lines:
        lines.append(json.dumps(event.output, ensure_ascii=False))
      return "\n".join(lines)

    return json.dumps(event.output, ensure_ascii=False)

  @staticmethod
  def _build_tool_schemas(active_tools: set[str]) -> list[dict[str, Any]]:
    return [TOOL_SCHEMAS[name] for name in active_tools if name in TOOL_SCHEMAS]

  @staticmethod
  def _convert_turns_for_compat(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Конвертирует tool/assistant-with-tool_calls сообщения в совместимый формат для токенизаторов без поддержки tool role."""
    result: list[dict[str, Any]] = []
    for msg in messages:
      role = msg.get("role", "user")
      if role == "tool":
        content = str(msg.get("content") or "")
        result.append({"role": "user", "content": f"[Результат инструмента]\n{content}"})
      elif role == "assistant" and msg.get("tool_calls"):
        calls_text = "\n".join(
          f'<tool_call>{json.dumps({"name": tc["function"]["name"], "args": json.loads(tc["function"].get("arguments", "{}"))}, ensure_ascii=False)}</tool_call>'
          for tc in (msg.get("tool_calls") or [])
          if isinstance(tc, dict) and isinstance(tc.get("function"), dict)
        )
        content = str(msg.get("content") or "").strip()
        result.append({"role": "assistant", "content": f"{content}\n{calls_text}".strip()})
      else:
        result.append(msg)
    return result

  @staticmethod
  def _execute_tool_event(
    tool_registry: ToolRegistry,
    runtime: RuntimeChatContext,
    *,
    name: str,
    args: dict[str, Any],
  ) -> ToolEvent:
    try:
      output = tool_registry.execute(name, args, runtime)
      return ToolEvent(name=name, status="ok", output=output)
    except Exception as exc:
      return ToolEvent(
        name=name,
        status="error",
        output={
          "error": str(exc),
        },
      )

  @staticmethod
  def _normalize_attachment_kind(kind: str) -> str:
    normalized = str(kind or "").strip().lower()
    if normalized in {"image", "document", "text", "audio", "video"}:
      return normalized
    return "file"

  @classmethod
  def _build_attachment_context(cls, request: ChatRequest) -> str:
    attachments = list(request.attachments or [])
    if not attachments:
      return ""

    lines: list[str] = ["Вложения пользователя:"]
    total_text_budget = 9000
    used_budget = 0
    selected_model = get_model_entry(resolve_model_id_for_tier(
      normalize_model_tier_key(getattr(request.context.ui, "modelTier", ""), "lite"),
      getattr(request.context.ui, "modelId", ""),
    ))
    supports_vision = bool(selected_model and selected_model.supports_vision)

    for index, attachment in enumerate(attachments[:10], start=1):
      item = attachment.model_dump() if hasattr(attachment, "model_dump") else dict(attachment)
      name = str(item.get("name") or f"file-{index}").strip()
      kind = cls._normalize_attachment_kind(str(item.get("kind") or "file"))
      mime_type = str(item.get("mimeType") or "").strip()
      size = max(0, int(item.get("size") or 0))
      size_label = f"{size} bytes" if size > 0 else "unknown size"
      suffix_parts = [kind]
      if mime_type:
        suffix_parts.append(mime_type)
      suffix_parts.append(size_label)
      lines.append(f"{index}. {name} ({', '.join(suffix_parts)})")

      text_content = str(item.get("textContent") or "").strip()
      if text_content and used_budget < total_text_budget:
        remaining = max(0, total_text_budget - used_budget)
        excerpt = cls._truncate_text(text_content, max(600, min(3500, remaining)))
        used_budget += len(excerpt)
        lines.append("```text")
        lines.append(excerpt)
        lines.append("```")
        continue

      if kind == "image":
        data_url = str(item.get("dataUrl") or "").strip()
        if supports_vision:
          lines.append("Изображение приложено. Модель vision-capable: можно использовать визуальный анализ.")
          if data_url and used_budget < total_text_budget:
            remaining = max(0, total_text_budget - used_budget)
            excerpt = cls._truncate_text(data_url, max(420, min(1800, remaining)))
            used_budget += len(excerpt)
            lines.append("```text")
            lines.append(f"image_data_url={excerpt}")
            lines.append("```")
        else:
          lines.append("Изображение приложено. Текущая модель text-only, требуется описание изображения текстом.")

    return "\n".join(lines).strip()

  def _build_messages(
    self,
    request: ChatRequest,
    turns: list[dict[str, Any]] | None = None,
    active_tools: set[str] | None = None,
  ) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    system_prompt = build_system_prompt(
      self._base_system_prompt,
      request,
      active_tools=active_tools or set(),
    )
    if system_prompt.strip():
      messages.append({"role": "system", "content": system_prompt.strip()})

    selected_history: list[dict[str, Any]] = []
    total_chars = 0
    for entry in reversed(request.context.history or []):
      role = str(entry.role or "").strip().lower()
      if role not in {"user", "assistant", "system"}:
        continue
      text = self._truncate_text(str(entry.text or "").strip(), self.MAX_HISTORY_ENTRY_CHARS)
      if not text:
        continue
      projected_total = total_chars + len(text)
      if projected_total > self.MAX_HISTORY_TOTAL_CHARS and selected_history:
        break
      total_chars = projected_total
      selected_history.append({"role": role, "content": text})
      if len(selected_history) >= self.MAX_HISTORY_MESSAGES:
        break

    selected_history.reverse()
    messages.extend(selected_history)

    # Текущий запрос пользователя
    user_text = request.message.strip()
    attachment_context = self._build_attachment_context(request)
    if attachment_context:
      user_text = f"{user_text}\n\n{attachment_context}".strip()
    messages.append({"role": "user", "content": user_text})

    # Туры предыдущих раундов (assistant tool_calls + tool results)
    if turns:
      messages.extend(turns)

    return messages

  def _render_prompt(
    self,
    messages: list[dict[str, Any]],
    active_tools: set[str] | None = None,
  ) -> str:
    tokenizer = self._tokenizer
    if tokenizer is not None and hasattr(tokenizer, "apply_chat_template"):
      tools_schema = self._build_tool_schemas(active_tools or set())
      # Пробуем с JSON-схемами инструментов (Qwen2.5, Llama3.1 и др.)
      if tools_schema:
        try:
          return tokenizer.apply_chat_template(
            messages,
            tools=tools_schema,
            tokenize=False,
            add_generation_prompt=True,
          )
        except Exception:
          pass
      # Пробуем без схем (раунды с результатами инструментов)
      try:
        return tokenizer.apply_chat_template(
          messages,
          tokenize=False,
          add_generation_prompt=True,
        )
      except Exception:
        # Конвертируем tool role → user для несовместимых токенизаторов
        compat = self._convert_turns_for_compat(messages)
        try:
          return tokenizer.apply_chat_template(
            compat,
            tokenize=False,
            add_generation_prompt=True,
          )
        except Exception:
          pass

    blocks: list[str] = []
    for message in messages:
      role = message.get("role", "user")
      content = message.get("content") or ""
      blocks.append(f"[{role}]\n{content}")
    blocks.append("[assistant]")
    return "\n\n".join(blocks)

  def _build_generation_attempts(self, prompt: str, plan: GenerationPlan) -> list[dict[str, Any]]:
    tier = plan.tier
    effective_context_window = int(plan.context_window_override or tier.max_context)
    effective_context_window = max(256, min(32768, effective_context_window))
    context_cap = max(96, min(2048, effective_context_window // 8))
    default_cap_by_tier = {
      "lite": 220,
      "standart": 320,
      "plus": 420,
    }
    default_cap = default_cap_by_tier.get(tier.key, 320)
    env_cap_raw = os.getenv("ANCIA_MODEL_MAX_TOKENS", "").strip()
    if env_cap_raw:
      try:
        default_cap = max(64, min(1024, int(env_cap_raw)))
      except ValueError:
        pass
    max_tokens = max(64, min(context_cap, default_cap))
    if plan.max_tokens_override is not None:
      max_tokens = max(16, min(context_cap, int(plan.max_tokens_override)))

    temperature = float(plan.temperature_override if plan.temperature_override is not None else tier.temperature)
    temperature = max(0.0, min(2.0, temperature))
    top_p = float(plan.top_p_override if plan.top_p_override is not None else 0.9)
    top_p = max(0.0, min(1.0, top_p))
    top_k = int(plan.top_k_override if plan.top_k_override is not None else 40)
    top_k = max(1, min(400, top_k))
    attempts: list[dict[str, Any]] = []

    sampler = None
    if self._make_sampler_fn is not None:
      sampler_attempts = [
        {"temp": temperature, "top_p": top_p, "top_k": top_k},
        {"temperature": temperature, "top_p": top_p, "top_k": top_k},
        {"temp": temperature},
        {"temperature": temperature},
      ]
      for sampler_kwargs in sampler_attempts:
        try:
          sampler = self._make_sampler_fn(**sampler_kwargs)
          if sampler is not None:
            break
        except Exception:
          continue

    if sampler is not None:
      attempts.append(
        {
          "prompt": prompt,
          "max_tokens": max_tokens,
          "sampler": sampler,
        }
      )

    attempts.append(
      {
        "prompt": prompt,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "top_k": top_k,
      }
    )
    attempts.append(
      {
        "prompt": prompt,
        "max_tokens": max_tokens,
      }
    )

    return attempts

  def request_stop_generation(self) -> bool:
    self._generation_stop_event.set()
    return True

  @staticmethod
  def _extract_stream_text(payload: Any) -> str:
    if payload is None:
      return ""
    if isinstance(payload, str):
      return payload
    if isinstance(payload, dict):
      for key in ("delta", "text", "content", "token", "response"):
        candidate = payload.get(key)
        if isinstance(candidate, str):
          return candidate
      return ""
    for attr in ("delta", "text", "content", "token", "response"):
      candidate = getattr(payload, attr, None)
      if isinstance(candidate, str):
        return candidate
    return str(payload or "")

  @staticmethod
  def _drop_unexpected_kwarg(kwargs: dict[str, Any], error: TypeError) -> bool:
    match = re.search(r"unexpected keyword argument ['\"]([A-Za-z_][A-Za-z0-9_]*)['\"]", str(error or ""))
    if not match:
      return False
    key = match.group(1)
    if key not in kwargs:
      return False
    kwargs.pop(key, None)
    return True

  @staticmethod
  def _normalize_for_dedupe(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()

  @classmethod
  def _is_repetition_runaway(cls, text: str) -> bool:
    normalized = cls._normalize_for_dedupe(text)
    if len(normalized) < 180:
      return False

    if re.search(r"(.{24,120}?)(?:\s+\1){2,}", normalized):
      return True

    tokens = [token for token in normalized.split(" ") if token]
    for width in (8, 12, 16):
      if len(tokens) < width * 3:
        continue
      if tokens[-width:] == tokens[-2 * width: -width] == tokens[-3 * width: -2 * width]:
        return True

    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", normalized) if part.strip()]
    if len(sentences) >= 3:
      last = sentences[-1]
      if len(last) >= 24 and last == sentences[-2] == sentences[-3]:
        return True

    return False

  @classmethod
  def _compact_repetitions(cls, text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
      return ""

    # Инлайн-повторы: «X — это X — это X» → «X»
    raw = re.sub(r"(.{3,80})\s*(?:[—–-]\s+(?:\w+\s+)*\1){2,}", r"\1", raw, flags=re.IGNORECASE)
    # Прямые повторы: «phrase phrase phrase» → «phrase»
    raw = re.sub(r"(.{4,120})(?:\s+\1){2,}", r"\1", raw, flags=re.IGNORECASE)

    paragraphs = [part.strip() for part in re.split(r"\n{2,}", raw) if part.strip()]
    if not paragraphs:
      return raw

    unique_paragraphs: list[str] = []
    seen: set[str] = set()
    for paragraph in paragraphs:
      key = cls._normalize_for_dedupe(paragraph)
      if not key:
        continue
      if key in seen:
        continue
      seen.add(key)

      sentences = re.split(r"(?<=[.!?])\s+", paragraph)
      filtered_sentences: list[str] = []
      prev_key = ""
      for sentence in sentences:
        sentence_text = sentence.strip()
        if not sentence_text:
          continue
        sentence_key = cls._normalize_for_dedupe(sentence_text)
        if sentence_key and sentence_key == prev_key:
          continue
        filtered_sentences.append(sentence_text)
        prev_key = sentence_key

      compact_paragraph = " ".join(filtered_sentences).strip() or paragraph
      unique_paragraphs.append(compact_paragraph)

    return "\n\n".join(unique_paragraphs).strip() or raw

  @staticmethod
  def _extract_reply_mood_directive(text: str) -> tuple[str, str]:
    raw = str(text or "")
    requested_mood = ""
    for match in CHAT_MOOD_DIRECTIVE_PATTERN.finditer(raw):
      requested_mood = normalize_mood(match.group(1), requested_mood)
    cleaned = CHAT_MOOD_DIRECTIVE_PATTERN.sub("", raw).strip()
    cleaned = re.sub(r"</?tool_call>", "", cleaned, flags=re.IGNORECASE).strip()
    return requested_mood, cleaned

  @staticmethod
  def _strip_markdown_fence(value: str) -> str:
    raw = str(value or "").strip()
    if not raw.startswith("```"):
      return raw
    lines = raw.splitlines()
    if not lines:
      return raw
    if lines[-1].strip() == "```":
      lines = lines[1:-1]
    else:
      lines = lines[1:]
    return "\n".join(lines).strip()

  @staticmethod
  def _normalize_tool_call_payload(payload: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    function_payload = payload.get("function")
    function_payload = function_payload if isinstance(function_payload, dict) else {}
    name = str(
      payload.get("name")
      or payload.get("tool")
      or payload.get("tool_name")
      or payload.get("function_name")
      or function_payload.get("name")
      or ""
    ).strip().lower()
    if not name:
      return None

    args_candidate = payload.get("args")
    if args_candidate is None:
      args_candidate = payload.get("arguments")
    if args_candidate is None:
      args_candidate = payload.get("parameters")
    if args_candidate is None:
      args_candidate = payload.get("input")
    if args_candidate is None and function_payload:
      args_candidate = (
        function_payload.get("arguments")
        if "arguments" in function_payload
        else function_payload.get("args")
      )

    if args_candidate is None:
      args: dict[str, Any] = {}
    elif isinstance(args_candidate, dict):
      args = dict(args_candidate)
    elif isinstance(args_candidate, str):
      raw_args = args_candidate.strip()
      if not raw_args:
        args = {}
      else:
        try:
          parsed_args = json.loads(raw_args)
        except json.JSONDecodeError:
          return None
        if isinstance(parsed_args, dict):
          args = dict(parsed_args)
        else:
          return None
    else:
      return None

    return name, args

  @classmethod
  def _extract_tool_calls_from_json_payload(cls, payload: Any) -> list[tuple[str, dict[str, Any]]]:
    calls: list[tuple[str, dict[str, Any]]] = []
    seen: set[tuple[str, str]] = set()
    queue: list[Any] = [payload]

    def _append(call_items: list[tuple[str, dict[str, Any]]]) -> None:
      for call_name, call_args in call_items:
        signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
        if signature in seen:
          continue
        seen.add(signature)
        calls.append((call_name, call_args))

    while queue:
      current = queue.pop(0)
      if isinstance(current, list):
        queue.extend(current)
        continue
      if not isinstance(current, dict):
        continue

      normalized = cls._normalize_tool_call_payload(current)
      if normalized is not None:
        _append([normalized])

      function_payload = current.get("function")
      if isinstance(function_payload, dict):
        normalized_function = cls._normalize_tool_call_payload(
          {
            "name": function_payload.get("name"),
            "arguments": function_payload.get("arguments"),
          }
        )
        if normalized_function is not None:
          _append([normalized_function])

      for key in ("tool_calls", "calls", "actions", "tools"):
        nested = current.get(key)
        if isinstance(nested, list):
          queue.extend(nested)

    return calls

  @classmethod
  def _extract_tool_calls_from_json_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    payload_text = cls._strip_markdown_fence(raw_text)
    if not payload_text:
      return []
    for candidate in cls._build_json_parse_candidates(payload_text):
      parsed = cls._parse_json_like(candidate)
      if parsed is None:
        continue
      calls = cls._extract_tool_calls_from_json_payload(parsed)
      if calls:
        return calls
    return []

  @staticmethod
  def _build_json_parse_candidates(payload_text: str) -> list[str]:
    text = str(payload_text or "").strip()
    if not text:
      return []

    candidates: list[str] = [text]
    balanced_prefix = PythonModelEngine._extract_balanced_json_prefix(text)
    if balanced_prefix and balanced_prefix not in candidates:
      candidates.insert(0, balanced_prefix)

    translated = text.translate(SMART_QUOTES_TRANSLATION).strip()
    if translated and translated not in candidates:
      candidates.append(translated)
      translated_prefix = PythonModelEngine._extract_balanced_json_prefix(translated)
      if translated_prefix and translated_prefix not in candidates:
        candidates.insert(1, translated_prefix)

    return candidates

  @staticmethod
  def _parse_json_like(payload_text: str) -> Any | None:
    text = str(payload_text or "").strip()
    if not text:
      return None
    try:
      return json.loads(text)
    except json.JSONDecodeError:
      pass

    try:
      parsed_literal = ast.literal_eval(text)
    except (SyntaxError, ValueError):
      return None
    return parsed_literal if isinstance(parsed_literal, (dict, list)) else None

  @staticmethod
  def _extract_balanced_json_prefix(payload_text: str) -> str:
    text = str(payload_text or "").strip()
    if not text or text[0] not in "{[":
      return ""

    stack: list[str] = []
    in_string = False
    escaped = False
    quote_char = ""

    for index, char in enumerate(text):
      if in_string:
        if escaped:
          escaped = False
        elif char == "\\":
          escaped = True
        elif char == quote_char:
          in_string = False
          quote_char = ""
        continue

      if char in ("\"", "'"):
        in_string = True
        quote_char = char
        continue

      if char == "{":
        stack.append("}")
        continue
      if char == "[":
        stack.append("]")
        continue
      if char in ("}", "]"):
        if not stack or char != stack[-1]:
          return ""
        stack.pop()
        if not stack:
          return text[:index + 1]

    return ""

  @classmethod
  def _normalize_tool_call_candidate(cls, raw_text: str) -> str:
    candidate = cls._strip_markdown_fence(raw_text).strip()
    if not candidate:
      return ""

    candidate = TOOL_CALL_INVISIBLE_PREFIX_PATTERN.sub("", candidate)
    if not candidate:
      return ""

    while len(candidate) >= 2 and candidate.startswith("`") and candidate.endswith("`"):
      candidate = candidate[1:-1].strip()
      if not candidate:
        return ""

    previous = None
    while candidate and candidate != previous:
      previous = candidate
      candidate = TOOL_CALL_LINE_PREFIX_PATTERN.sub("", candidate).strip()
    candidate = TOOL_CALL_LABEL_PREFIX_PATTERN.sub("", candidate).strip()

    while len(candidate) >= 2 and candidate.startswith("`") and candidate.endswith("`"):
      candidate = candidate[1:-1].strip()
      if not candidate:
        return ""

    return candidate

  @classmethod
  def _extract_tool_calls_from_candidate_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    candidate = cls._normalize_tool_call_candidate(raw_text)
    if not candidate:
      return []

    if candidate[0] not in "{[":
      first_object = candidate.find("{")
      first_array = candidate.find("[")
      first_indices = [idx for idx in (first_object, first_array) if idx >= 0]
      if not first_indices:
        return []
      candidate = candidate[min(first_indices):].strip()
      if not candidate:
        return []

    return cls._extract_tool_calls_from_json_text(candidate)

  @classmethod
  def _extract_tool_calls_from_mixed_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    direct_calls = cls._extract_tool_calls_from_json_text(raw_text)
    if direct_calls:
      return direct_calls

    calls: list[tuple[str, dict[str, Any]]] = []
    seen: set[tuple[str, str]] = set()
    for line in str(raw_text or "").splitlines():
      for call_name, call_args in cls._extract_tool_calls_from_candidate_text(line):
        signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
        if signature in seen:
          continue
        seen.add(signature)
        calls.append((call_name, call_args))
    return calls

  @classmethod
  def _extract_tool_calls_from_reply(cls, text: str) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
    raw = str(text or "")
    calls: list[tuple[str, dict[str, Any]]] = []
    seen_calls: set[tuple[str, str]] = set()

    def _append_calls(found_calls: list[tuple[str, dict[str, Any]]]) -> None:
      for call_name, call_args in found_calls:
        signature = (call_name, json.dumps(call_args, ensure_ascii=False, sort_keys=True))
        if signature in seen_calls:
          continue
        seen_calls.add(signature)
        calls.append((call_name, call_args))

    def _replace(match: re.Match[str]) -> str:
      found_calls = cls._extract_tool_calls_from_mixed_text(match.group(1))
      _append_calls(found_calls)
      return ""

    cleaned_text = TOOL_CALL_BLOCK_PATTERN.sub(_replace, raw)

    code_block_pattern = re.compile(r"```(?:json|tool_call)?\s*([\s\S]*?)```", flags=re.IGNORECASE)

    def _replace_code_block(match: re.Match[str]) -> str:
      block_inner = str(match.group(1) or "")
      found_calls = cls._extract_tool_calls_from_mixed_text(block_inner)
      if found_calls:
        _append_calls(found_calls)
        return ""
      return match.group(0)

    cleaned_text = code_block_pattern.sub(_replace_code_block, cleaned_text)

    kept_lines: list[str] = []
    for line in cleaned_text.splitlines():
      stripped_line = line.strip()
      found_calls = cls._extract_tool_calls_from_candidate_text(stripped_line)
      if found_calls:
        _append_calls(found_calls)
        continue
      kept_lines.append(line)
    cleaned_text = "\n".join(kept_lines)

    trimmed_text = cleaned_text.strip()
    found_calls = cls._extract_tool_calls_from_candidate_text(trimmed_text)
    if found_calls:
      _append_calls(found_calls)
      cleaned_text = ""

    cleaned_text = cls._compact_repetitions(cleaned_text).strip()
    return cleaned_text, calls

  @classmethod
  def _sanitize_stream_preview(cls, text: str, *, final: bool) -> str:
    cleaned = str(text or "")
    cleaned = CHAT_MOOD_DIRECTIVE_PATTERN.sub("", cleaned)
    cleaned = TOOL_CALL_BLOCK_PATTERN.sub("", cleaned)

    lowered = cleaned.lower()
    tool_block_start = lowered.find("<tool_call>")
    if tool_block_start >= 0:
      cleaned = cleaned[:tool_block_start]

    mood_block_start = lowered.find("[[mood:")
    if mood_block_start >= 0 and "]]" not in lowered[mood_block_start:]:
      cleaned = cleaned[:mood_block_start]

    lines = cleaned.splitlines(keepends=True)
    trailing = ""
    if lines and not cleaned.endswith(("\n", "\r")):
      trailing = lines.pop()

    filtered_lines: list[str] = []
    for line in lines:
      stripped_line = line.strip()
      found_calls = cls._extract_tool_calls_from_candidate_text(stripped_line)
      if found_calls:
        continue
      filtered_lines.append(line)

    if trailing:
      stripped_trailing = trailing.strip()
      trailing_calls = cls._extract_tool_calls_from_candidate_text(stripped_trailing)
      if trailing_calls:
        trailing = ""
      elif not final:
        trailing_lower = stripped_trailing.lower()
        normalized_trailing = cls._normalize_tool_call_candidate(stripped_trailing).lower()
        looks_like_control_prefix = (
          "<tool_call" in trailing_lower
          or trailing_lower.startswith("{")
          or trailing_lower.startswith("[[mood:")
          or normalized_trailing.startswith("{")
          or normalized_trailing.startswith("[")
        )
        if looks_like_control_prefix:
          trailing = ""

    return "".join(filtered_lines) + trailing

  @staticmethod
  def _chunk_text_for_streaming(text: str, max_chunk_size: int = 42) -> Generator[str, None, None]:
    tokens = re.findall(r"\S+\s*|\s+", text)
    if not tokens:
      return
    buffer = ""
    for token in tokens:
      candidate = buffer + token
      if buffer and len(candidate) > max_chunk_size:
        yield buffer
        buffer = token
      else:
        buffer = candidate
    if buffer:
      yield buffer

  @staticmethod
  def _resolve_stream_delta(payload_text: str, emitted_text: str) -> str:
    current = str(payload_text or "")
    if not current:
      return ""
    emitted = str(emitted_text or "")
    if not emitted:
      return current

    # Cumulative mode: payload содержит весь текст ответа на текущем шаге.
    if current.startswith(emitted):
      return current[len(emitted):]

    # Уже полученный дубликат/ретрай без новых токенов.
    if emitted.endswith(current) or current in emitted:
      return ""

    # Partial overlap mode: payload возвращает кусок с пересечением хвоста.
    max_overlap = min(len(current), len(emitted))
    for overlap in range(max_overlap, 0, -1):
      if emitted.endswith(current[:overlap]):
        return current[overlap:]

    return current

  def _iter_generation_chunks(self, prompt: str, plan: GenerationPlan) -> Generator[str, None, None]:
    with self._generation_lock:
      self._generation_stop_event.clear()
      if self._model is None or self._tokenizer is None or self._generate_fn is None:
        raise RuntimeError(self.get_unavailable_message())

      attempts = self._build_generation_attempts(prompt, plan)
      if self._stream_generate_fn is not None:
        stream_last_error: Exception | None = None
        for base_kwargs in attempts:
          kwargs = dict(base_kwargs)
          while True:
            response_chunks: list[str] = []
            generated_text = ""
            try:
              stream_iterable = self._stream_generate_fn(
                self._model,
                self._tokenizer,
                **kwargs,
              )
              for payload in stream_iterable:
                if self._generation_stop_event.is_set():
                  raise RuntimeError("Генерация остановлена пользователем.")
                text = self._extract_stream_text(payload)
                if not text:
                  continue
                delta = self._resolve_stream_delta(text, generated_text)
                if not delta:
                  continue
                response_chunks.append(delta)
                generated_text += delta
                yield delta
                if self._is_repetition_runaway(generated_text):
                  break

              if response_chunks:
                return
              stream_last_error = RuntimeError("Поток генерации вернул пустой ответ.")
              break
            except TypeError as exc:
              if response_chunks:
                raise RuntimeError(f"Ошибка потоковой генерации модели: {exc}") from exc
              if self._drop_unexpected_kwarg(kwargs, exc):
                continue
              stream_last_error = exc
              break
            except Exception as exc:
              raise RuntimeError(f"Ошибка потоковой генерации модели: {exc}") from exc
        if stream_last_error is not None:
          # Переходим к non-stream fallback, если stream API недоступен.
          pass

      output = ""
      last_error: Exception | None = None
      for base_kwargs in attempts:
        kwargs = dict(base_kwargs)
        if self._generation_stop_event.is_set():
          raise RuntimeError("Генерация остановлена пользователем.")
        while True:
          try:
            output = self._generate_fn(
              self._model,
              self._tokenizer,
              **kwargs,
            )
            last_error = None
            break
          except TypeError as exc:
            if self._drop_unexpected_kwarg(kwargs, exc):
              continue
            last_error = exc
            break
          except Exception as exc:
            raise RuntimeError(f"Ошибка генерации модели: {exc}") from exc
        if last_error is None:
          break

      if last_error is not None:
        raise RuntimeError(f"Несовместимый API mlx_lm.generate: {last_error}")

      reply = self._compact_repetitions(str(output or "").strip())
      if not reply:
        raise RuntimeError("Модель вернула пустой ответ.")
      for chunk in self._chunk_text_for_streaming(reply):
        if self._generation_stop_event.is_set():
          raise RuntimeError("Генерация остановлена пользователем.")
        yield chunk

  def _run_generation(self, prompt: str, plan: GenerationPlan) -> str:
    chunks = [chunk for chunk in self._iter_generation_chunks(prompt, plan)]
    reply = "".join(chunks).strip()
    if not reply:
      raise RuntimeError("Модель вернула пустой ответ.")
    return reply

  @staticmethod
  def _fallback_chat_title(user_text: str, max_chars: int = 72) -> str:
    normalized = re.sub(r"\s+", " ", str(user_text or "").strip())
    if not normalized:
      return "Новая сессия"
    title = " ".join(normalized.split(" ")[:8]).strip()
    if not title:
      title = normalized
    if len(title) > max_chars:
      title = title[:max_chars].rstrip(" ,.;:-")
    return title or "Новая сессия"

  def suggest_chat_title(self, user_text: str, max_chars: int = 72) -> str:
    source = re.sub(r"\s+", " ", str(user_text or "").strip())
    if not source:
      return "Новая сессия"

    if not self.is_ready():
      return self._fallback_chat_title(source, max_chars=max_chars)

    prompt = (
      "Ты придумываешь короткое название диалога.\n"
      "Правила:\n"
      "- Верни только одно название, без пояснений.\n"
      "- 2-6 слов, без кавычек и без точки в конце.\n"
      "- Используй язык сообщения пользователя.\n\n"
      f"Сообщение пользователя: {source}\n"
      "Название:"
    )
    title_plan = GenerationPlan(
      tier=MODEL_TIERS["lite"],
      user_text=source,
      context_mood="neutral",
      active_tools=set(),
      context_window_override=1024,
      max_tokens_override=24,
      temperature_override=0.15,
      top_p_override=0.9,
      top_k_override=30,
    )
    try:
      raw_title = self._run_generation(prompt, title_plan)
    except Exception:
      return self._fallback_chat_title(source, max_chars=max_chars)

    _, cleaned_title = self._extract_reply_mood_directive(raw_title)
    cleaned_title = TOOL_CALL_BLOCK_PATTERN.sub("", cleaned_title)
    cleaned_title = self._compact_repetitions(cleaned_title)
    cleaned_title = cleaned_title.splitlines()[0].strip() if cleaned_title.strip() else ""
    cleaned_title = re.sub(r"^\s*(?:title|название|заголовок)\s*[:\-]\s*", "", cleaned_title, flags=re.IGNORECASE)
    cleaned_title = cleaned_title.strip("`\"' ")
    cleaned_title = cleaned_title.rstrip(".")
    cleaned_title = re.sub(r"\s+", " ", cleaned_title).strip()
    if not cleaned_title:
      return self._fallback_chat_title(source, max_chars=max_chars)
    if len(cleaned_title) > max_chars:
      cleaned_title = cleaned_title[:max_chars].rstrip(" ,.;:-")
    if not cleaned_title:
      return self._fallback_chat_title(source, max_chars=max_chars)
    return cleaned_title

  def _prepare_generation(
    self,
    *,
    request: ChatRequest,
    active_tools: set[str],
  ) -> GenerationPlan:
    def _read_int(value: Any, *, min_value: int, max_value: int) -> int | None:
      try:
        if value is None:
          return None
        parsed = int(value)
      except (TypeError, ValueError):
        return None
      if parsed <= 0:
        return None
      return max(min_value, min(max_value, parsed))

    def _read_float(value: Any, *, min_value: float, max_value: float) -> float | None:
      try:
        if value is None:
          return None
        parsed = float(value)
      except (TypeError, ValueError):
        return None
      if parsed < min_value or parsed > max_value:
        return None
      return parsed

    tier_key = self.get_selected_tier()
    tier = MODEL_TIERS[tier_key]
    selected_model_id = self.get_selected_model_id(tier_key)
    model_params = self.get_model_params(selected_model_id, tier_key=tier_key)
    user_text = request.message.strip()
    context_mood = normalize_mood(str(request.context.mood or ""), "neutral")
    ui = getattr(request.context, "ui", None)
    context_window_override = _read_int(getattr(ui, "contextWindow", None), min_value=256, max_value=32768)
    max_tokens_override = _read_int(getattr(ui, "maxTokens", None), min_value=16, max_value=4096)
    temperature_override = _read_float(getattr(ui, "temperature", None), min_value=0.0, max_value=2.0)
    top_p_override = _read_float(getattr(ui, "topP", None), min_value=0.0, max_value=1.0)
    top_k_override = _read_int(getattr(ui, "topK", None), min_value=1, max_value=400)
    if context_window_override is None:
      context_window_override = int(model_params.get("context_window") or tier.max_context)
    if max_tokens_override is None:
      max_tokens_override = int(model_params.get("max_tokens") or 256)
    if temperature_override is None:
      temperature_override = float(model_params.get("temperature") or tier.temperature)
    if top_p_override is None:
      top_p_override = float(model_params.get("top_p") or 0.9)
    if top_k_override is None:
      top_k_override = int(model_params.get("top_k") or 40)
    return GenerationPlan(
      tier=tier,
      user_text=user_text,
      context_mood=context_mood,
      active_tools=active_tools,
      context_window_override=context_window_override,
      max_tokens_override=max_tokens_override,
      temperature_override=temperature_override,
      top_p_override=top_p_override,
      top_k_override=top_k_override,
    )

  def _build_result_from_reply(
    self,
    plan: GenerationPlan,
    reply: str,
    *,
    tool_events: list[ToolEvent],
    fallback_mood: str = "",
  ) -> ModelResult:
    requested_mood, stripped_reply = self._extract_reply_mood_directive(reply)
    clean_reply = self._compact_repetitions(stripped_reply)
    if not clean_reply:
      clean_reply = stripped_reply or str(reply or "").strip()
    mood = normalize_mood(requested_mood, "") if requested_mood else normalize_mood(fallback_mood, "")
    if not mood:
      mood = self._resolve_mood(f"{plan.user_text}\n{clean_reply}", plan.context_mood)
    return ModelResult(
      reply=clean_reply,
      mood=mood,
      tool_events=list(tool_events),
      model_name=self.model_name,
    )

  def _build_tool_start_payload(
    self,
    *,
    name: str,
    args: dict[str, Any],
    round_index: int,
    call_index: int,
  ) -> dict[str, Any]:
    invocation_id = f"r{round_index + 1}-c{call_index + 1}"
    args_json = self._truncate_text(json.dumps(args or {}, ensure_ascii=False), 1200)
    text = (
      f"{name}\n"
      "Запуск инструмента.\n"
      f"```json\n{args_json}\n```"
    )
    return {
      "invocation_id": invocation_id,
      "round": round_index + 1,
      "index": call_index + 1,
      "name": name,
      "args": args or {},
      "status": "running",
      "text": text,
      "meta_suffix": "инструмент • запуск",
    }

  def _build_tool_result_payload(
    self,
    *,
    event: ToolEvent,
    args: dict[str, Any],
    round_index: int,
    call_index: int,
  ) -> dict[str, Any]:
    invocation_id = f"r{round_index + 1}-c{call_index + 1}"
    summary = self._truncate_text(self._summarize_tool_event(event), 2600)
    text = f"{event.name}\n{summary}".strip()
    status = str(event.status or "ok").strip().lower() or "ok"
    return {
      "invocation_id": invocation_id,
      "round": round_index + 1,
      "index": call_index + 1,
      "name": event.name,
      "args": args or {},
      "status": status,
      "output": event.output,
      "text": text,
      "meta_suffix": f"инструмент • {status}",
    }

  def _iter_model_tool_resolution(
    self,
    *,
    request: ChatRequest,
    runtime: RuntimeChatContext,
    tool_registry: ToolRegistry,
    active_tools: set[str],
    plan: GenerationPlan,
    stream_final_reply: bool = False,
  ) -> Generator[Any, None, ModelResult]:
    turns: list[dict[str, Any]] = []
    tool_events: list[ToolEvent] = []
    latest_reply = ""
    latest_mood = ""
    tools_are_allowed = bool(active_tools)

    for round_index in range(self.MAX_TOOL_CALL_ROUNDS):
      generation_active_tools = active_tools if tools_are_allowed else set()
      messages = self._build_messages(request, turns or None, generation_active_tools)
      prompt = self._render_prompt(messages, generation_active_tools)
      should_stream_this_round = stream_final_reply and (not generation_active_tools or round_index == 0)

      if should_stream_this_round:
        streamed_preview = ""
        raw_reply = ""
        for chunk in self._iter_generation_chunks(prompt, plan):
          raw_reply += chunk
          preview = self._sanitize_stream_preview(raw_reply, final=False)
          if len(preview) > len(streamed_preview):
            delta = preview[len(streamed_preview):]
            if delta:
              yield delta
            streamed_preview = preview
        reply = raw_reply.strip()
        preview_final = self._sanitize_stream_preview(reply, final=True)
        if len(preview_final) > len(streamed_preview):
          tail_delta = preview_final[len(streamed_preview):]
          if tail_delta:
            yield tail_delta
      else:
        reply = self._run_generation(prompt, plan)

      requested_mood, reply_no_mood = self._extract_reply_mood_directive(reply)
      if requested_mood:
        latest_mood = requested_mood

      clean_reply, model_tool_calls = self._extract_tool_calls_from_reply(reply_no_mood)
      if clean_reply:
        latest_reply = clean_reply

      if model_tool_calls:
        LOGGER.info(
          "Parsed tool calls round=%s chat=%s: %s",
          round_index + 1,
          runtime.chat_id,
          [name for name, _ in model_tool_calls],
        )

      if not tools_are_allowed or not model_tool_calls:
        final = clean_reply or latest_reply or "Не удалось сформировать ответ."
        return self._build_result_from_reply(
          plan, final, tool_events=tool_events, fallback_mood=latest_mood,
        )

      call_entries: list[tuple[str, str, dict[str, Any]]] = []
      tool_calls_payload: list[dict[str, Any]] = []
      for ci, (name, args) in enumerate(model_tool_calls[: self.MAX_TOOL_CALLS_PER_ROUND]):
        cid = f"r{round_index + 1}-c{ci + 1}"
        call_entries.append((cid, name, args))
        tool_calls_payload.append({
          "id": cid, "type": "function",
          "function": {"name": name, "arguments": json.dumps(args, ensure_ascii=False)},
        })

      turns.append({"role": "assistant", "content": clean_reply or "", "tool_calls": tool_calls_payload})

      for ci, (cid, name, args) in enumerate(call_entries):
        yield {"kind": "tool_start", "payload": self._build_tool_start_payload(
          name=name, args=args, round_index=round_index, call_index=ci,
        )}
        ev = (
          self._execute_tool_event(tool_registry, runtime, name=name, args=args)
          if name in active_tools and tool_registry.has_tool(name)
          else ToolEvent(name=name or "unknown", status="error", output={"error": f"Инструмент '{name}' недоступен."})
        )
        LOGGER.info(
          "Tool call completed round=%s chat=%s name=%s status=%s",
          round_index + 1,
          runtime.chat_id,
          name,
          ev.status,
        )
        tool_events.append(ev)
        yield {"kind": "tool_result", "payload": self._build_tool_result_payload(
          event=ev, args=args, round_index=round_index, call_index=ci,
        )}
        turns.append({"role": "tool", "tool_call_id": cid, "name": name, "content": self._summarize_tool_event(ev)})
      # После хотя бы одного раунда tool-calling следующая генерация должна дать финальный ответ.
      tools_are_allowed = False

    final = latest_reply or "Не удалось завершить вызов инструментов."
    return self._build_result_from_reply(
      plan, final, tool_events=tool_events, fallback_mood=latest_mood,
    )

  def _resolve_with_model_tool_calls(
    self,
    *,
    request: ChatRequest,
    runtime: RuntimeChatContext,
    tool_registry: ToolRegistry,
    active_tools: set[str],
    plan: GenerationPlan,
  ) -> ModelResult:
    iterator = self._iter_model_tool_resolution(
      request=request,
      runtime=runtime,
      tool_registry=tool_registry,
      active_tools=active_tools,
      plan=plan,
    )
    while True:
      try:
        next(iterator)
      except StopIteration as stop:
        return stop.value

  def complete(
    self,
    *,
    request: ChatRequest,
    runtime: RuntimeChatContext,
    tool_registry: ToolRegistry,
    active_tools: set[str],
  ) -> ModelResult:
    if not self.is_ready():
      raise RuntimeError(self.get_unavailable_message())

    plan = self._prepare_generation(
      request=request,
      active_tools=active_tools,
    )
    return self._resolve_with_model_tool_calls(
      request=request,
      runtime=runtime,
      tool_registry=tool_registry,
      active_tools=active_tools,
      plan=plan,
    )

  def iter_complete(
    self,
    *,
    request: ChatRequest,
    runtime: RuntimeChatContext,
    tool_registry: ToolRegistry,
    active_tools: set[str],
  ) -> Generator[Any, None, ModelResult]:
    if not self.is_ready():
      raise RuntimeError(self.get_unavailable_message())

    plan = self._prepare_generation(
      request=request,
      active_tools=active_tools,
    )
    iterator = self._iter_model_tool_resolution(
      request=request,
      runtime=runtime,
      tool_registry=tool_registry,
      active_tools=active_tools,
      plan=plan,
      stream_final_reply=True,
    )
    result: ModelResult | None = None
    streamed_directly = False
    while True:
      try:
        event_payload = next(iterator)
      except StopIteration as stop:
        result = stop.value
        break
      if isinstance(event_payload, str):
        if event_payload:
          streamed_directly = True
          yield event_payload
        continue
      yield event_payload

    if result is None:
      raise RuntimeError("Не удалось получить итог генерации.")
    if not streamed_directly:
      for delta in self._chunk_text_for_streaming(result.reply):
        if not delta:
          continue
        yield delta
    return result


def build_system_prompt(
  base_prompt: str,
  request: ChatRequest,
  *,
  active_tools: set[str] | None = None,
) -> str:
  safe_active_tools = active_tools or set()
  prompt_with_tools = apply_enabled_tools_prompt(base_prompt, safe_active_tools)
  blocks = [prompt_with_tools] if prompt_with_tools else []
  blocks.append(build_chat_mood_prompt())

  user = request.context.user
  if user.name.strip() or user.context.strip():
    blocks.append(
      "Профиль пользователя: "
      + ", ".join(
        part
        for part in [
          f"имя={user.name.strip()}" if user.name.strip() else "",
          f"контекст={user.context.strip()}" if user.context.strip() else "",
          f"язык={user.language.strip() or 'ru'}",
          f"часовой_пояс={user.timezone.strip() or 'UTC'}",
        ]
        if part
      )
    )

  if request.context.system_prompt.strip():
    blocks.append("Дополнительный системный промпт: " + request.context.system_prompt.strip())

  return "\n\n".join(block for block in blocks if block)
