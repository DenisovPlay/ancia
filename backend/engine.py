from __future__ import annotations

import base64
import binascii
import importlib.util
import json
import logging
import mimetypes
import os
import platform
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Generator

try:
  from backend.common import normalize_mood, utc_now_iso
  from backend.engine_model_storage import EngineModelStorage
  from backend.engine_models_mixin import EngineModelsMixin
  from backend.prompt_builder import build_system_prompt
  from backend.engine_generation_prep import (
    build_attachment_context as build_attachment_context_fn,
    build_generation_attempts as build_generation_attempts_fn,
    build_messages as build_messages_fn,
    convert_turns_for_compat as convert_turns_for_compat_fn,
    normalize_attachment_kind as normalize_attachment_kind_fn,
    render_prompt as render_prompt_fn,
  )
  from backend.text_stream_utils import (
    chunk_text_for_streaming as chunk_text_for_streaming_fn,
    compact_repetitions as compact_repetitions_fn,
    is_repetition_runaway as is_repetition_runaway_fn,
    normalize_for_dedupe as normalize_for_dedupe_fn,
    resolve_stream_delta as resolve_stream_delta_fn,
  )
  from backend.tool_call_parser import (
    TOOL_CALL_BLOCK_PATTERN,
    extract_reply_mood_directive as extract_reply_mood_directive_fn,
    strip_markdown_fence as strip_markdown_fence_fn,
    normalize_tool_call_payload as normalize_tool_call_payload_fn,
    extract_tool_calls_from_json_payload as extract_tool_calls_from_json_payload_fn,
    extract_tool_calls_from_json_text as extract_tool_calls_from_json_text_fn,
    build_json_parse_candidates as build_json_parse_candidates_fn,
    parse_json_like as parse_json_like_fn,
    extract_balanced_json_prefix as extract_balanced_json_prefix_fn,
    normalize_tool_call_candidate as normalize_tool_call_candidate_fn,
    extract_tool_calls_from_candidate_text as extract_tool_calls_from_candidate_text_fn,
    extract_tool_calls_from_mixed_text as extract_tool_calls_from_mixed_text_fn,
    extract_tool_calls_from_reply as extract_tool_calls_from_reply_fn,
    sanitize_stream_preview as sanitize_stream_preview_fn,
  )
  from backend.engine_support import (
    GenerationPlan,
    ModelResult,
    ModelStartupState,
    STARTUP_STAGE_PROGRESS,
    format_bytes,
    normalize_model_repo,
    normalize_model_tier_key,
    resolve_available_memory_bytes,
    resolve_total_memory_bytes,
  )
  from backend.model_catalog import (
    DEFAULT_MODEL_ID_BY_TIER,
    get_model_entry,
    list_model_catalog_payload,
    normalize_model_id,
    resolve_model_id_for_tier,
  )
  from backend.schemas import MODEL_TIERS, ChatRequest, RuntimeChatContext, ToolEvent
  from backend.storage import AppStorage
  from backend.tooling import ToolRegistry
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore
  from engine_generation_prep import (  # type: ignore
    build_attachment_context as build_attachment_context_fn,
    build_generation_attempts as build_generation_attempts_fn,
    build_messages as build_messages_fn,
    convert_turns_for_compat as convert_turns_for_compat_fn,
    normalize_attachment_kind as normalize_attachment_kind_fn,
    render_prompt as render_prompt_fn,
  )
  from engine_model_storage import EngineModelStorage  # type: ignore
  from engine_models_mixin import EngineModelsMixin  # type: ignore
  from text_stream_utils import (  # type: ignore
    chunk_text_for_streaming as chunk_text_for_streaming_fn,
    compact_repetitions as compact_repetitions_fn,
    is_repetition_runaway as is_repetition_runaway_fn,
    normalize_for_dedupe as normalize_for_dedupe_fn,
    resolve_stream_delta as resolve_stream_delta_fn,
  )
  from tool_call_parser import (  # type: ignore
    TOOL_CALL_BLOCK_PATTERN,
    extract_reply_mood_directive as extract_reply_mood_directive_fn,
    strip_markdown_fence as strip_markdown_fence_fn,
    normalize_tool_call_payload as normalize_tool_call_payload_fn,
    extract_tool_calls_from_json_payload as extract_tool_calls_from_json_payload_fn,
    extract_tool_calls_from_json_text as extract_tool_calls_from_json_text_fn,
    build_json_parse_candidates as build_json_parse_candidates_fn,
    parse_json_like as parse_json_like_fn,
    extract_balanced_json_prefix as extract_balanced_json_prefix_fn,
    normalize_tool_call_candidate as normalize_tool_call_candidate_fn,
    extract_tool_calls_from_candidate_text as extract_tool_calls_from_candidate_text_fn,
    extract_tool_calls_from_mixed_text as extract_tool_calls_from_mixed_text_fn,
    extract_tool_calls_from_reply as extract_tool_calls_from_reply_fn,
    sanitize_stream_preview as sanitize_stream_preview_fn,
  )
  from prompt_builder import build_system_prompt  # type: ignore
  from engine_support import (  # type: ignore
    GenerationPlan,
    ModelResult,
    ModelStartupState,
    STARTUP_STAGE_PROGRESS,
    format_bytes,
    normalize_model_repo,
    normalize_model_tier_key,
    resolve_available_memory_bytes,
    resolve_total_memory_bytes,
  )
  from model_catalog import (  # type: ignore
    DEFAULT_MODEL_ID_BY_TIER,
    get_model_entry,
    list_model_catalog_payload,
    normalize_model_id,
    resolve_model_id_for_tier,
  )
  from schemas import MODEL_TIERS, ChatRequest, RuntimeChatContext, ToolEvent  # type: ignore
  from storage import AppStorage  # type: ignore
  from tooling import ToolRegistry  # type: ignore

LOGGER = logging.getLogger("ancia.engine")

IMAGE_ANALYSIS_INTENT_PATTERN = re.compile(
  r"("
  r"что\s+на\s+(фото|изображени[ияе]|картинк[аеуи])|"
  r"что\s+видно\s+на\s+(фото|изображени[ияе]|картинк[аеуи])|"
  r"опиши\s+(фото|изображени[ея]|картинк[ауе])|"
  r"что\s+изображен[оа]?\s+на|"
  r"analy[sz]e\s+(the\s+)?(image|photo|picture)|"
  r"what(?:'s| is)\s+in\s+(the\s+)?(image|photo|picture)|"
  r"describe\s+(the\s+)?(image|photo|picture)"
  r")",
  flags=re.IGNORECASE,
)
IMAGE_REFERENCE_PATTERN = re.compile(
  r"("
  r"фото|фотографи[яеию]|изображени[еяию]|картинк[аеуиой]|"
  r"скриншот|скрин|"
  r"image|photo|picture|screenshot"
  r")",
  flags=re.IGNORECASE,
)
EXPLICIT_WEB_INTENT_PATTERN = re.compile(
  r"("
  r"в\s+интернет[еау]|"
  r"найд[ии]\s+в\s+интернет[еау]|"
  r"поищи|поиск|"
  r"search|google|duckduckgo|web|"
  r"сайт|url|ссылк|источник|"
  r"visit\s+website|open\s+url"
  r")",
  flags=re.IGNORECASE,
)
GENERIC_ATTACHMENT_PROMPTS = {
  "",
  "проанализируй вложения пользователя",
  "проанализируй вложения пользователя.",
}
VISION_UNAVAILABLE_REPLY = (
  "Я получил изображение, но текущий backend-рантайм сейчас работает в text-only режиме "
  "и не может анализировать содержимое фото. "
  "Поэтому я не буду выдумывать детали изображения.\n\n"
  "Что можно сделать сейчас:\n"
  "- установить и подключить multimodal runtime (например, пакет mlx-vlm);\n"
  "- или описать изображение текстом, и я помогу по этому описанию."
)
MAX_IMAGE_DATA_URL_CHARS = 2_000_000


class PythonModelEngine(EngineModelsMixin):
  MODEL_SETTING_PREFIX = "model_id_"
  MODEL_SELECTED_SETTING_KEY = "selected_model_id"
  MODEL_PARAMS_SETTING_KEY = "model_params_by_id"
  MIN_REQUIRED_UNIFIED_MEMORY_BYTES = 2 * 1024 * 1024 * 1024
  SUPPORTED_PYTHON_MIN = (3, 10)
  SUPPORTED_PYTHON_MAX_EXCLUSIVE = (3, 13)
  MAX_HISTORY_MESSAGES = 12
  MAX_HISTORY_TOTAL_CHARS = 5200
  MAX_HISTORY_ENTRY_CHARS = 900
  MAX_TOOL_CALL_ROUNDS = 4
  MAX_TOOL_CALLS_PER_ROUND = 4
  MAX_CONTEXT_WINDOW_LIMIT = 262_144
  MAX_COMPLETION_TOKENS_LIMIT = 131_072

  def __init__(self, storage: AppStorage, *, base_system_prompt: str) -> None:
    self._storage = storage
    self._base_system_prompt = base_system_prompt
    project_models_dir = (Path(__file__).resolve().parent / "data" / "models").resolve()
    _models_dir = (
      Path(os.getenv("ANCIA_MODELS_DIR", "")).expanduser().resolve()
      if os.getenv("ANCIA_MODELS_DIR") else
      project_models_dir
    )
    _models_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(_models_dir))
    os.environ.setdefault("HF_HUB_CACHE", str((_models_dir / "hub").resolve()))
    self._models_dir = _models_dir
    self._startup = ModelStartupState()
    self._load_thread: threading.Thread | None = None
    self._state_lock = threading.Lock()
    self._generation_lock = threading.Lock()
    self._generation_stop_event = threading.Event()
    self._model: Any = None
    self._tokenizer: Any = None
    self._generate_fn: Callable[..., Any] | None = None
    self._stream_generate_fn: Callable[..., Any] | None = None
    self._vlm_processor: Any = None
    self._vlm_model_config: Any = None
    self._vlm_generate_fn: Callable[..., Any] | None = None
    self._vlm_stream_generate_fn: Callable[..., Any] | None = None
    self._make_sampler_fn: Callable[..., Any] | None = None
    self._make_logits_processors_fn: Callable[..., Any] | None = None
    self._runtime_backend_kind = "mlx_lm"
    self._vision_runtime_probe_failed = False
    self._vision_runtime_error = ""
    self._memory_details: dict[str, Any] = {}
    self._loading_tier = ""
    self._pending_tier = ""
    self._pending_model_id = ""
    self._pending_prefer_vision_runtime: bool | None = None
    self._loaded_tier = ""
    self._loaded_model_id = ""
    self._model_storage = EngineModelStorage(
      storage=self._storage,
      model_params_setting_key=self.MODEL_PARAMS_SETTING_KEY,
      model_tiers=MODEL_TIERS,
      normalize_model_id_fn=normalize_model_id,
      get_model_entry_fn=get_model_entry,
      list_model_catalog_payload_fn=list_model_catalog_payload,
      format_bytes_fn=format_bytes,
      get_loaded_model_id_fn=self.get_loaded_model_id,
    )

    selected_tier = self.get_selected_tier()
    selected_model = self.get_selected_model_id()
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

  def start_background_load(
    self,
    tier: str | None = None,
    *,
    prefer_vision_runtime: bool | None = None,
  ) -> None:
    target_model_id = self.get_selected_model_id()
    target_model_entry = get_model_entry(target_model_id)
    supports_vision = bool(target_model_entry and getattr(target_model_entry, "supports_vision", False))
    resolved_prefer_vision_runtime: bool | None
    if prefer_vision_runtime is None:
      resolved_prefer_vision_runtime = None
    else:
      resolved_prefer_vision_runtime = bool(prefer_vision_runtime and supports_vision)
    target_tier = normalize_model_tier_key(
      getattr(target_model_entry, "recommended_tier", "") if target_model_entry is not None else "",
      normalize_model_tier_key(tier, self.get_selected_tier()),
    )
    target_repo = (
      normalize_model_repo(getattr(target_model_entry, "repo", ""), "")
      if target_model_entry is not None
      else self.get_model_repo_for_tier(target_tier)
    )
    load_thread = threading.Thread(
      target=self._load_model,
      args=(target_tier, target_model_id, target_repo, resolved_prefer_vision_runtime),
      name="ancia-model-loader",
      daemon=True,
    )
    with self._state_lock:
      if self._load_thread and self._load_thread.is_alive():
        self._pending_tier = target_tier
        self._pending_model_id = target_model_id
        self._pending_prefer_vision_runtime = resolved_prefer_vision_runtime
        return
      self._loading_tier = target_tier
      self._pending_tier = ""
      self._pending_model_id = ""
      self._pending_prefer_vision_runtime = None
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
        "prefer_vision_runtime": resolved_prefer_vision_runtime,
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

  def unload_model(self) -> bool:
    with self._generation_lock:
      had_model = self._model is not None or self._tokenizer is not None
      self._model = None
      self._tokenizer = None
      self._generate_fn = None
      self._stream_generate_fn = None
      self._vlm_processor = None
      self._vlm_generate_fn = None
      self._vlm_stream_generate_fn = None
      self._make_sampler_fn = None
      self._make_logits_processors_fn = None
      self._runtime_backend_kind = "mlx_lm"
    with self._state_lock:
      self._loaded_tier = ""
      self._loaded_model_id = ""
      self._pending_tier = ""
      self._pending_model_id = ""
      self._pending_prefer_vision_runtime = None
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
    expected_tier: str | None = None,
    expected_model_id: str,
    timeout_seconds: float = 180.0,
    poll_interval_seconds: float = 0.25,
  ) -> tuple[bool, dict[str, Any]]:
    started_at = time.time()
    expected_tier_key = normalize_model_tier_key(expected_tier, "") if expected_tier else ""
    expected_model = normalize_model_id(expected_model_id, "")
    while time.time() - started_at <= max(1.0, float(timeout_seconds)):
      snapshot = self.get_runtime_snapshot()
      startup = snapshot.get("startup") if isinstance(snapshot, dict) else {}
      status = str((startup or {}).get("status") or "").strip().lower()
      loaded_tier = str(snapshot.get("loaded_tier") or "").strip().lower()
      loaded_model_id = normalize_model_id(str(snapshot.get("loaded_model_id") or "").strip().lower(), "")
      if (
        status == "ready"
        and loaded_model_id == expected_model
        and (not expected_tier_key or loaded_tier == expected_tier_key)
      ):
        return True, snapshot
      if status == "error":
        return False, snapshot
      time.sleep(max(0.05, float(poll_interval_seconds)))
    return False, self.get_runtime_snapshot()

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
    payload.setdefault("model_id", self.get_selected_model_id())
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

  @staticmethod
  def _format_eta_label(seconds: float | int | None) -> str:
    try:
      total_seconds = int(float(seconds or 0))
    except (TypeError, ValueError):
      return ""
    if total_seconds <= 0:
      return ""
    if total_seconds < 60:
      return f"{total_seconds}s"
    minutes, seconds_remainder = divmod(total_seconds, 60)
    if minutes < 60:
      return f"{minutes}m {seconds_remainder:02d}s"
    hours, minutes_remainder = divmod(minutes, 60)
    if hours < 24:
      return f"{hours}h {minutes_remainder:02d}m"
    days, hours_remainder = divmod(hours, 24)
    return f"{days}d {hours_remainder}h"

  @staticmethod
  def _loading_stage_progress_for_ratio(ratio: float) -> int:
    start = int(STARTUP_STAGE_PROGRESS["loading_model"])
    safe_ratio = max(0.0, min(1.0, float(ratio or 0.0)))
    # Для этапа loading_model оставляем зазор до 100, чтобы ready выставлялся отдельно.
    return max(start, min(97, int(round(start + safe_ratio * 25.0))))

  def _prefetch_snapshot_with_progress(
    self,
    *,
    model_repo: str,
    model_label: str,
    details_base: dict[str, Any],
  ) -> str:
    safe_repo = normalize_model_repo(model_repo, "")
    if not safe_repo:
      return safe_repo

    try:
      from huggingface_hub import snapshot_download  # type: ignore
      from tqdm.auto import tqdm as tqdm_auto  # type: ignore
    except Exception:
      return safe_repo

    repo_cache_dir = self._model_storage.resolve_repo_cache_dir(safe_repo)
    cached_bytes_before = (
      self._model_storage.directory_size_bytes(repo_cache_dir)
      if repo_cache_dir is not None and repo_cache_dir.exists()
      else 0
    )
    state: dict[str, Any] = {
      "phase": "preparing",
      "complete": False,
      "files_total": 0,
      "files_to_download": 0,
      "cached_bytes": max(0, int(cached_bytes_before)),
      "network_total_bytes": 0,
      "network_downloaded_bytes": 0,
      "model_total_bytes": 0,
      "speed_bytes_per_second": 0.0,
      "eta_seconds": None,
    }
    last_emit_at = 0.0
    speed_ref_at = time.monotonic()
    speed_ref_downloaded = 0

    def emit_progress(*, force: bool = False, phase: str | None = None) -> None:
      nonlocal last_emit_at, speed_ref_at, speed_ref_downloaded
      now = time.monotonic()
      if phase:
        state["phase"] = phase
      if not force and (now - last_emit_at) < 0.25:
        return

      cached_bytes = max(0, int(state.get("cached_bytes") or 0))
      network_total_bytes = max(0, int(state.get("network_total_bytes") or 0))
      network_downloaded_bytes = max(0, int(state.get("network_downloaded_bytes") or 0))
      model_total_bytes = max(0, int(state.get("model_total_bytes") or 0))
      if model_total_bytes <= 0:
        model_total_bytes = cached_bytes + network_total_bytes
      model_downloaded_bytes = cached_bytes + network_downloaded_bytes
      if model_total_bytes > 0:
        model_downloaded_bytes = min(model_total_bytes, model_downloaded_bytes)
      else:
        model_downloaded_bytes = max(0, model_downloaded_bytes)

      elapsed_for_speed = now - speed_ref_at
      if elapsed_for_speed >= 0.35:
        speed_delta = max(0, network_downloaded_bytes - speed_ref_downloaded)
        state["speed_bytes_per_second"] = (
          float(speed_delta) / elapsed_for_speed
          if speed_delta > 0
          else 0.0
        )
        speed_ref_downloaded = network_downloaded_bytes
        speed_ref_at = now

      speed_bytes_per_second = float(state.get("speed_bytes_per_second") or 0.0)
      eta_seconds: int | None = None
      if network_total_bytes > 0 and speed_bytes_per_second > 0:
        remaining = max(0, network_total_bytes - network_downloaded_bytes)
        eta_seconds = int(round(remaining / max(speed_bytes_per_second, 1e-6)))
      state["eta_seconds"] = eta_seconds

      ratio = 0.0
      if model_total_bytes > 0:
        ratio = float(model_downloaded_bytes) / float(model_total_bytes)
      elif network_total_bytes > 0:
        ratio = float(network_downloaded_bytes) / float(network_total_bytes)
      elif bool(state.get("complete")):
        ratio = 1.0
      progress_percent = self._loading_stage_progress_for_ratio(ratio)
      if bool(state.get("complete")):
        progress_percent = 97

      phase_token = str(state.get("phase") or "").strip().lower()
      if phase_token == "complete":
        message = f"Файлы {model_label} готовы. Инициализируем модель..."
      elif network_total_bytes > 0 and model_total_bytes > 0:
        ratio_percent = max(0.0, min(100.0, (float(model_downloaded_bytes) / float(model_total_bytes)) * 100.0))
        suffix_parts: list[str] = []
        if speed_bytes_per_second > 0:
          suffix_parts.append(f"{format_bytes(int(speed_bytes_per_second))}/s")
        eta_label = self._format_eta_label(eta_seconds)
        if eta_label:
          suffix_parts.append(f"ETA {eta_label}")
        suffix = f" · {' · '.join(suffix_parts)}" if suffix_parts else ""
        message = (
          f"Скачиваем {model_label}: "
          f"{format_bytes(model_downloaded_bytes)} / {format_bytes(model_total_bytes)} "
          f"({ratio_percent:.1f}%){suffix}"
        )
      elif int(state.get("files_to_download") or 0) > 0:
        message = f"Скачиваем {model_label}..."
      else:
        message = f"Файлы {model_label} уже в кэше. Инициализируем модель..."

      details_payload = {
        **details_base,
        "progress_percent": progress_percent,
        "download_phase": phase_token or "preparing",
        "download_complete": bool(state.get("complete")),
        "download_files_total": int(state.get("files_total") or 0),
        "download_files_to_download": int(state.get("files_to_download") or 0),
        "download_total_bytes": model_total_bytes,
        "download_total_human": format_bytes(model_total_bytes),
        "download_downloaded_bytes": model_downloaded_bytes,
        "download_downloaded_human": format_bytes(model_downloaded_bytes),
        "download_cached_bytes": cached_bytes,
        "download_cached_human": format_bytes(cached_bytes),
        "download_network_total_bytes": network_total_bytes,
        "download_network_total_human": format_bytes(network_total_bytes),
        "download_network_bytes": network_downloaded_bytes,
        "download_network_human": format_bytes(network_downloaded_bytes),
        "download_speed_bytes_per_second": int(speed_bytes_per_second) if speed_bytes_per_second > 0 else 0,
        "download_speed_human_per_second": f"{format_bytes(int(speed_bytes_per_second))}/s" if speed_bytes_per_second > 0 else "",
        "download_eta_seconds": eta_seconds,
        "download_eta_human": self._format_eta_label(eta_seconds),
      }
      self._startup.set(
        status="loading",
        stage="loading_model",
        message=message,
        details=details_payload,
      )
      last_emit_at = now

    def on_download_chunk(delta_bytes: int) -> None:
      if delta_bytes <= 0:
        return
      network_total_bytes = int(state.get("network_total_bytes") or 0)
      if network_total_bytes <= 0:
        return
      downloaded = int(state.get("network_downloaded_bytes") or 0)
      state["network_downloaded_bytes"] = min(network_total_bytes, downloaded + delta_bytes)
      emit_progress(force=False, phase="downloading")

    class _SilentTqdm(tqdm_auto):  # type: ignore[misc,valid-type]
      def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs.setdefault("disable", True)
        super().__init__(*args, **kwargs)

    class _StartupDownloadTqdm(_SilentTqdm):
      def update(self, n: int = 1) -> bool:
        result = super().update(n)
        try:
          delta_bytes = int(n)
        except (TypeError, ValueError):
          delta_bytes = 0
        if delta_bytes > 0:
          on_download_chunk(delta_bytes)
        return result

    hub_cache_dir = str((self._models_dir / "hub").resolve())
    emit_progress(force=True, phase="preparing")
    try:
      dry_run_files = snapshot_download(
        repo_id=safe_repo,
        cache_dir=hub_cache_dir,
        dry_run=True,
        tqdm_class=_SilentTqdm,
      )
      if isinstance(dry_run_files, list):
        files_total = len(dry_run_files)
        files_to_download = sum(
          1
          for item in dry_run_files
          if bool(getattr(item, "will_download", False))
        )
        network_total_bytes = sum(
          max(0, int(getattr(item, "file_size", 0) or 0))
          for item in dry_run_files
          if bool(getattr(item, "will_download", False))
        )
        model_total_bytes = sum(
          max(0, int(getattr(item, "file_size", 0) or 0))
          for item in dry_run_files
        )
        state["files_total"] = files_total
        state["files_to_download"] = files_to_download
        state["network_total_bytes"] = network_total_bytes
        state["model_total_bytes"] = model_total_bytes
    except Exception as exc:
      LOGGER.debug("HF dry-run unavailable for %s: %s", safe_repo, exc)

    if int(state.get("model_total_bytes") or 0) <= 0:
      state["model_total_bytes"] = int(state.get("cached_bytes") or 0) + int(state.get("network_total_bytes") or 0)

    if int(state.get("network_total_bytes") or 0) > 0:
      emit_progress(force=True, phase="downloading")
    else:
      emit_progress(force=True, phase="cached")

    try:
      snapshot_path = snapshot_download(
        repo_id=safe_repo,
        cache_dir=hub_cache_dir,
        tqdm_class=_StartupDownloadTqdm,
      )
      if int(state.get("network_total_bytes") or 0) > 0:
        state["network_downloaded_bytes"] = int(state.get("network_total_bytes") or 0)
      state["complete"] = True
      emit_progress(force=True, phase="complete")
      return str(snapshot_path)
    except Exception as exc:
      LOGGER.warning("Snapshot prefetch with progress failed for %s: %s", safe_repo, exc)
      fallback_details = {
        **details_base,
        "progress_percent": STARTUP_STAGE_PROGRESS["loading_model"],
        "download_phase": "fallback",
        "download_error": str(exc),
      }
      self._startup.set(
        status="loading",
        stage="loading_model",
        message=f"Загружаем {model_label}...",
        details=fallback_details,
      )
      return safe_repo

  def _load_model(
    self,
    target_tier: str,
    target_model_id: str,
    target_repo: str,
    prefer_vision_runtime: bool | None = None,
  ) -> None:
    next_tier = ""
    next_prefer_vision_runtime: bool | None = None
    tier_label = MODEL_TIERS[target_tier].label
    target_model_entry = get_model_entry(target_model_id)
    target_supports_vision = bool(target_model_entry and getattr(target_model_entry, "supports_vision", False))
    requested_vision_runtime = (
      target_supports_vision
      if prefer_vision_runtime is None
      else bool(prefer_vision_runtime and target_supports_vision)
    )
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

      loading_details_base = {
        **self._memory_details,
        "model_tier": target_tier,
        "tier_label": tier_label,
        "model_id": target_model_id,
        "model_label": model_label,
        "model_repo": target_repo,
      }
      self._startup.set(
        status="loading",
        stage="loading_model",
        message=f"Загружаем {model_label}...",
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["loading_model"],
          **loading_details_base,
        },
      )
      load_target = self._prefetch_snapshot_with_progress(
        model_repo=target_repo,
        model_label=model_label,
        details_base=loading_details_base,
      ) or target_repo

      # mlx_lm.load()/mlx_vlm.load() пишут прогресс в stdout. При запуске через Tauri pipe
      # stdout может быть закрыт и вызывать BrokenPipeError. Перенаправляем на devnull.
      import io as _io

      use_vlm_runtime = bool(
        target_supports_vision
        and requested_vision_runtime
        and self._runtime_supports_vision_inputs()
      )
      runtime_backend_kind = "mlx_lm"
      runtime_warning = ""

      if use_vlm_runtime:
        try:
          from mlx_vlm import generate as mlx_vlm_generate  # type: ignore
          from mlx_vlm import load as mlx_vlm_load  # type: ignore
          try:
            from mlx_vlm import stream_generate as mlx_vlm_stream_generate  # type: ignore
          except Exception:
            mlx_vlm_stream_generate = None

          vlm_load_target, vlm_patch_applied = self._resolve_vlm_load_target(
            model_id=target_model_id,
            model_repo=target_repo,
            preloaded_snapshot_path=load_target,
          )
          if not vlm_load_target:
            vlm_load_target = load_target

          _old_stdout, _old_stderr = sys.stdout, sys.stderr
          try:
            sys.stdout = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
            sys.stderr = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
            model, processor = mlx_vlm_load(vlm_load_target)
          finally:
            sys.stdout, sys.stderr = _old_stdout, _old_stderr

          tokenizer = getattr(processor, "tokenizer", None) or processor
          with self._generation_lock:
            self._model = model
            self._tokenizer = tokenizer
            self._generate_fn = None
            self._stream_generate_fn = None
            self._vlm_processor = processor
            self._vlm_model_config = getattr(model, "config", None)
            self._vlm_generate_fn = mlx_vlm_generate
            self._vlm_stream_generate_fn = mlx_vlm_stream_generate
            self._make_sampler_fn = None
            self._make_logits_processors_fn = None
            self._runtime_backend_kind = "mlx_vlm"
            self.model_repo = target_repo
            self.model_name = model_label
          runtime_backend_kind = "mlx_vlm"
          self._vision_runtime_probe_failed = False
          self._vision_runtime_error = ""
          if vlm_patch_applied:
            runtime_warning = "Qwen3-VL config patch applied for mlx_vlm compatibility."
        except Exception as vision_error:
          runtime_warning = str(vision_error)
          self._vision_runtime_probe_failed = True
          self._vision_runtime_error = runtime_warning
          LOGGER.warning(
            "Vision runtime unavailable for %s (%s): %s",
            target_model_id,
            target_repo,
            runtime_warning,
          )

      if runtime_backend_kind != "mlx_vlm":
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

        _old_stdout, _old_stderr = sys.stdout, sys.stderr
        try:
          sys.stdout = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
          sys.stderr = _io.TextIOWrapper(_io.FileIO(os.devnull, "w"), errors="replace")
          model, tokenizer = mlx_load(load_target)
        finally:
          sys.stdout, sys.stderr = _old_stdout, _old_stderr
        with self._generation_lock:
          self._model = model
          self._tokenizer = tokenizer
          self._generate_fn = mlx_generate
          self._stream_generate_fn = mlx_stream_generate
          self._vlm_processor = None
          self._vlm_generate_fn = None
          self._vlm_stream_generate_fn = None
          self._make_sampler_fn = mlx_make_sampler
          self._make_logits_processors_fn = mlx_make_logits_processors
          self._runtime_backend_kind = "mlx_lm"
          self.model_repo = target_repo
          self.model_name = model_label
      with self._state_lock:
        self._loaded_tier = target_tier
        self._loaded_model_id = target_model_id

      ready_message = "Модель загружена и готова к работе."
      if (
        target_supports_vision
        and runtime_backend_kind != "mlx_vlm"
      ):
        if requested_vision_runtime:
          ready_message = "Модель загружена в text-only режиме (vision runtime недоступен)."
        else:
          ready_message = "Модель загружена в текстовом режиме."

      self._startup.set(
        status="ready",
        stage="ready",
        message=ready_message,
        details={
          "progress_percent": STARTUP_STAGE_PROGRESS["ready"],
          **self._memory_details,
          "model_tier": target_tier,
          "tier_label": tier_label,
          "model_id": target_model_id,
          "model_label": model_label,
          "model_repo": target_repo,
          "runtime_backend": runtime_backend_kind,
          "prefer_vision_runtime": requested_vision_runtime,
          "vision_runtime_warning": runtime_warning,
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
          or self._pending_prefer_vision_runtime != prefer_vision_runtime
        ):
          next_tier = self._pending_tier
          next_prefer_vision_runtime = self._pending_prefer_vision_runtime
        self._pending_tier = ""
        self._pending_model_id = ""
        self._pending_prefer_vision_runtime = None
        self._loading_tier = ""
      if next_tier:
        self.start_background_load(next_tier, prefer_vision_runtime=next_prefer_vision_runtime)

  @staticmethod
  def _truncate_text(value: str, limit: int = 3500) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
      return text
    return text[: max(0, limit - 1)].rstrip() + "…"

  @staticmethod
  def _fallback_token_estimate(text: str) -> int:
    safe = str(text or "")
    if not safe:
      return 0
    return max(1, (len(safe) + 3) // 4)

  def _estimate_token_count(self, text: str) -> tuple[int, str]:
    safe_text = str(text or "")
    if not safe_text:
      return 0, "empty"

    tokenizer = self._tokenizer
    if tokenizer is not None:
      try:
        encode_fn = getattr(tokenizer, "encode", None)
        if callable(encode_fn):
          encoded = encode_fn(safe_text)
          if isinstance(encoded, list):
            return len(encoded), "tokenizer.encode"
          if isinstance(encoded, tuple):
            return len(encoded), "tokenizer.encode"
          if hasattr(encoded, "__len__"):
            return int(len(encoded)), "tokenizer.encode"
      except Exception:
        pass

      try:
        if callable(tokenizer):
          encoded = tokenizer(safe_text)
          if isinstance(encoded, dict):
            input_ids = encoded.get("input_ids")
            if isinstance(input_ids, list):
              if input_ids and isinstance(input_ids[0], list):
                return len(input_ids[0]), "tokenizer.__call__"
              return len(input_ids), "tokenizer.__call__"
      except Exception:
        pass

    return self._fallback_token_estimate(safe_text), "chars/4"

  def get_context_window_requirements(
    self,
    *,
    active_tools: set[str],
    tool_definitions: dict[str, dict[str, Any]] | None = None,
  ) -> dict[str, Any]:
    safe_active_tools = {str(name or "").strip().lower() for name in active_tools if str(name or "").strip()}
    safe_tool_definitions = tool_definitions if isinstance(tool_definitions, dict) else {}

    history_budget_env = os.getenv("ANCIA_CONTEXT_MIN_HISTORY_CHARS", "").strip()
    reserve_tokens_env = os.getenv("ANCIA_CONTEXT_MIN_RESERVE_TOKENS", "").strip()

    try:
      history_budget_chars_raw = int(history_budget_env) if history_budget_env else 3600
    except ValueError:
      history_budget_chars_raw = 3600
    history_budget_chars = max(1200, min(self.MAX_HISTORY_TOTAL_CHARS, history_budget_chars_raw))

    try:
      reserve_tokens_raw = int(reserve_tokens_env) if reserve_tokens_env else 192
    except ValueError:
      reserve_tokens_raw = 192
    reserve_tokens = max(64, min(768, reserve_tokens_raw))

    synthetic_request = ChatRequest.model_validate(
      {
        "message": "",
        "context": {
          "chat_id": "context-window-guard",
          "mood": "neutral",
          "user": {
            "name": "",
            "context": "",
            "language": "ru",
            "timezone": "UTC",
          },
          "history": [],
          "system_prompt": "",
        },
      }
    )

    system_prompt_text = build_system_prompt(
      self._base_system_prompt,
      synthetic_request,
      active_tools=safe_active_tools,
      tool_definitions=safe_tool_definitions,
    )
    system_prompt_tokens, token_estimation_mode = self._estimate_token_count(system_prompt_text)

    history_tokens = max(64, (history_budget_chars + 3) // 4)
    history_overhead_tokens = max(24, min(192, int(self.MAX_HISTORY_MESSAGES) * 4))
    selected_model_id = self.get_selected_model_id()
    selected_model_entry = get_model_entry(selected_model_id)
    model_context_limit = max(
      512,
      min(
        self.MAX_CONTEXT_WINDOW_LIMIT,
        int(
          getattr(selected_model_entry, "max_context", 0)
          or MODEL_TIERS[self.get_selected_tier()].max_context
          or 8192
        ),
      ),
    )
    minimum_context_window = system_prompt_tokens + history_tokens + history_overhead_tokens + reserve_tokens
    minimum_context_window = max(512, min(model_context_limit, minimum_context_window))

    return {
      "min_context_window": int(minimum_context_window),
      "model_context_limit": int(model_context_limit),
      "system_prompt_tokens": int(system_prompt_tokens),
      "history_budget_tokens": int(history_tokens),
      "history_budget_chars": int(history_budget_chars),
      "history_overhead_tokens": int(history_overhead_tokens),
      "reserve_tokens": int(reserve_tokens),
      "token_estimation_mode": token_estimation_mode,
      "active_tools_count": len(safe_active_tools),
      "tokenizer_loaded": bool(self._tokenizer is not None),
    }

  @classmethod
  def _summarize_tool_event(cls, event: ToolEvent) -> str:
    payload = event.output if isinstance(event.output, dict) else {}
    if not payload:
      return json.dumps(event.output, ensure_ascii=False)

    if isinstance(payload.get("error"), str) and str(payload.get("error") or "").strip():
      return f"error={str(payload.get('error') or '').strip()}"

    lines: list[str] = []
    for key, value in payload.items():
      safe_key = str(key or "").strip()
      if not safe_key:
        continue
      if isinstance(value, str):
        text = cls._truncate_text(value, 1200)
        if text:
          lines.append(f"{safe_key}={text}")
      elif isinstance(value, (int, float, bool)):
        lines.append(f"{safe_key}={value}")
      elif isinstance(value, list):
        if not value:
          continue
        if all(isinstance(item, str) for item in value[:8]):
          items = [cls._truncate_text(str(item), 220) for item in value[:8]]
          lines.append(f"{safe_key}=[{'; '.join(items)}]")
        else:
          compact_json = cls._truncate_text(json.dumps(value, ensure_ascii=False), 1400)
          lines.append(f"{safe_key}={compact_json}")
      elif isinstance(value, dict):
        compact_json = cls._truncate_text(json.dumps(value, ensure_ascii=False), 1200)
        lines.append(f"{safe_key}={compact_json}")
      else:
        lines.append(f"{safe_key}={value}")

    if lines:
      return "\n".join(lines[:24])
    return json.dumps(payload, ensure_ascii=False)

  @staticmethod
  def _convert_turns_for_compat(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return convert_turns_for_compat_fn(messages)

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
    return normalize_attachment_kind_fn(kind)

  def _has_image_attachments(self, request: ChatRequest) -> bool:
    attachments = list(getattr(request, "attachments", None) or [])
    for attachment in attachments:
      item = attachment.model_dump() if hasattr(attachment, "model_dump") else dict(attachment)
      kind = self._normalize_attachment_kind(str(item.get("kind") or "file"))
      if kind == "image":
        return True
      mime_type = str(item.get("mimeType") or "").strip().lower()
      if mime_type.startswith("image/"):
        return True
      data_url = str(item.get("dataUrl") or "").strip().lower()
      if data_url.startswith("data:image/"):
        return True
    return False

  @staticmethod
  def _is_image_analysis_intent(user_text: str) -> bool:
    safe_text = str(user_text or "").strip()
    if not safe_text:
      return False
    return IMAGE_ANALYSIS_INTENT_PATTERN.search(safe_text) is not None

  @staticmethod
  def _is_explicit_web_intent(user_text: str) -> bool:
    safe_text = str(user_text or "").strip()
    if not safe_text:
      return False
    return EXPLICIT_WEB_INTENT_PATTERN.search(safe_text) is not None

  @staticmethod
  def _mentions_image_reference(user_text: str) -> bool:
    safe_text = str(user_text or "").strip()
    if not safe_text:
      return False
    return IMAGE_REFERENCE_PATTERN.search(safe_text) is not None

  @staticmethod
  def _is_generic_attachment_prompt(user_text: str) -> bool:
    return str(user_text or "").strip().lower() in GENERIC_ATTACHMENT_PROMPTS

  @staticmethod
  def _auto_invoke_contains_trigger(user_text: str, trigger: str) -> bool:
    safe_user_text = str(user_text or "").strip().lower()
    safe_trigger = str(trigger or "").strip().lower()
    if not safe_user_text or not safe_trigger:
      return False
    if len(safe_trigger) <= 3:
      return re.search(
        rf"(?<![a-zа-я0-9_]){re.escape(safe_trigger)}(?![a-zа-я0-9_])",
        safe_user_text,
        flags=re.IGNORECASE,
      ) is not None
    return re.search(
      rf"(?<![a-zа-я0-9_]){re.escape(safe_trigger)}(?![a-zа-я0-9_])",
      safe_user_text,
      flags=re.IGNORECASE,
    ) is not None

  @staticmethod
  def _auto_invoke_strip_prefix(value: str, prefixes: list[str]) -> str:
    safe_value = str(value or "").strip()
    if not safe_value:
      return ""
    lowered = safe_value.lower()
    best_prefix = ""
    for raw_prefix in prefixes:
      safe_prefix = str(raw_prefix or "").strip().lower()
      if not safe_prefix:
        continue
      if lowered.startswith(safe_prefix) and len(safe_prefix) > len(best_prefix):
        best_prefix = safe_prefix
    if best_prefix:
      safe_value = safe_value[len(best_prefix):].lstrip()
    safe_value = re.sub(r"^[\s,;:.\-—–\"'`]+", "", safe_value)
    safe_value = re.sub(r"[\s\"'`]+$", "", safe_value)
    return safe_value.strip()

  @classmethod
  def _build_auto_invoke_args(
    cls,
    user_text: str,
    *,
    auto_invoke: dict[str, Any],
    input_schema: dict[str, Any],
  ) -> dict[str, Any] | None:
    schema = input_schema if isinstance(input_schema, dict) else {}
    properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    additional_props = bool(schema.get("additionalProperties", False))
    args_cfg = auto_invoke.get("args") if isinstance(auto_invoke.get("args"), dict) else {}

    args: dict[str, Any] = {}
    for raw_arg_name, raw_arg_cfg in args_cfg.items():
      arg_name = str(raw_arg_name or "").strip()
      if not arg_name:
        continue
      if not additional_props and properties and arg_name not in properties:
        continue
      if not isinstance(raw_arg_cfg, dict):
        continue
      source = str(raw_arg_cfg.get("source") or "").strip().lower()
      if source != "user_text":
        continue
      strip_prefixes_raw = raw_arg_cfg.get("strip_prefixes")
      strip_prefixes = [str(item or "") for item in strip_prefixes_raw] if isinstance(strip_prefixes_raw, list) else []
      value = cls._auto_invoke_strip_prefix(user_text, strip_prefixes)
      if not value:
        value = str(user_text or "").strip()
      if value:
        args[arg_name] = value

    # Подставляем schema default для отсутствующих аргументов.
    for prop_name, prop_schema in properties.items():
      safe_prop_name = str(prop_name or "").strip()
      if not safe_prop_name or safe_prop_name in args:
        continue
      if isinstance(prop_schema, dict) and "default" in prop_schema:
        args[safe_prop_name] = prop_schema.get("default")

    required_raw = schema.get("required")
    required = [str(item or "").strip() for item in required_raw] if isinstance(required_raw, list) else []
    missing_required = [name for name in required if name and name not in args]
    if missing_required:
      return None

    if not additional_props and properties:
      args = {
        key: value
        for key, value in args.items()
        if key in properties
      }
    return args

  def _resolve_auto_invoke_tool_call(
    self,
    *,
    user_text: str,
    active_tools: set[str],
    tool_registry: ToolRegistry,
  ) -> tuple[str, dict[str, Any]] | None:
    safe_user_text = str(user_text or "").strip()
    if not safe_user_text:
      return None

    candidates: list[tuple[str, dict[str, Any], int]] = []
    for tool_name in sorted(active_tools):
      if not tool_registry.has_tool(tool_name):
        continue
      meta = tool_registry.get_tool_meta(tool_name) if hasattr(tool_registry, "get_tool_meta") else {}
      auto_invoke = meta.get("auto_invoke") if isinstance(meta, dict) else None
      if not isinstance(auto_invoke, dict) or not bool(auto_invoke.get("enabled", False)):
        continue
      raw_triggers = auto_invoke.get("triggers")
      triggers = [str(item or "").strip() for item in raw_triggers] if isinstance(raw_triggers, list) else []
      triggers = [item for item in triggers if item]
      if not triggers:
        continue
      if not any(self._auto_invoke_contains_trigger(safe_user_text, trigger) for trigger in triggers):
        continue
      input_schema = meta.get("input_schema") if isinstance(meta.get("input_schema"), dict) else {}
      args = self._build_auto_invoke_args(
        safe_user_text,
        auto_invoke=auto_invoke,
        input_schema=input_schema,
      )
      if args is None:
        continue
      strongest_trigger_len = max((len(item) for item in triggers), default=0)
      candidates.append((tool_name, args, strongest_trigger_len))

    if not candidates:
      return None
    candidates.sort(key=lambda item: (item[2], len(item[0])), reverse=True)
    top_tool, top_args, _top_score = candidates[0]
    return top_tool, top_args

  @staticmethod
  def _resolve_vision_runtime_override() -> bool | None:
    raw = os.getenv("ANCIA_EXPERIMENTAL_ENABLE_VISION", "").strip().lower()
    if not raw:
      return None
    if raw in {"1", "true", "yes", "on"}:
      return True
    if raw in {"0", "false", "no", "off"}:
      return False
    return None

  @staticmethod
  def _is_mlx_vlm_installed() -> bool:
    try:
      return importlib.util.find_spec("mlx_vlm") is not None
    except Exception:
      return False

  @staticmethod
  def _is_qwen3_vl_family(model_id: str, model_repo: str) -> bool:
    probe = f"{model_id} {model_repo}".strip().lower().replace("_", "-")
    return "qwen3-vl" in probe

  def _resolve_vlm_load_target(
    self,
    *,
    model_id: str,
    model_repo: str,
    preloaded_snapshot_path: str | None = None,
  ) -> tuple[str, bool]:
    """Return repo/path for mlx_vlm.load and whether config compatibility patch was applied."""
    safe_repo = str(model_repo or "").strip()
    safe_preloaded_snapshot_path = str(preloaded_snapshot_path or "").strip()
    if not safe_repo:
      return safe_preloaded_snapshot_path, False
    if safe_preloaded_snapshot_path and not self._is_qwen3_vl_family(model_id, safe_repo):
      return safe_preloaded_snapshot_path, False
    if not self._is_qwen3_vl_family(model_id, safe_repo):
      return safe_repo, False

    snapshot_path: Path | None = None
    if safe_preloaded_snapshot_path:
      try:
        preloaded_path = Path(safe_preloaded_snapshot_path).expanduser()
        if preloaded_path.exists():
          snapshot_path = preloaded_path.resolve()
      except Exception:
        snapshot_path = None

    try:
      from huggingface_hub import snapshot_download  # type: ignore
    except Exception as exc:
      LOGGER.warning("Qwen3-VL patch skipped: snapshot_download unavailable (%s)", exc)
      return safe_preloaded_snapshot_path or safe_repo, False

    if snapshot_path is None:
      # HF_HUB_CACHE указывает на <models_dir>/hub — именно там лежат загруженные модели.
      # cache_dir в snapshot_download должен совпадать, иначе local_files_only=True упадёт
      # и придётся идти в сеть.
      hub_cache_dir = str((self._models_dir / "hub").resolve())
      for cache_dir_candidate in [hub_cache_dir, str(self._models_dir)]:
        try:
          snapshot_path = Path(
            snapshot_download(
              repo_id=safe_repo,
              cache_dir=cache_dir_candidate,
              local_files_only=True,
            )
          )
          break
        except Exception:
          continue

    if snapshot_path is None:
      LOGGER.warning("Qwen3-VL patch skipped: model not found in local cache for %s", safe_repo)
      return safe_preloaded_snapshot_path or safe_repo, False

    config_path = snapshot_path / "config.json"
    if not config_path.is_file():
      return str(snapshot_path), False

    try:
      payload = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:
      LOGGER.warning("Qwen3-VL patch skipped: cannot read %s (%s)", config_path, exc)
      return str(snapshot_path), False

    if not isinstance(payload, dict):
      return str(snapshot_path), False

    text_config = payload.get("text_config")
    text_rope_scaling = text_config.get("rope_scaling") if isinstance(text_config, dict) else None
    top_rope_scaling = payload.get("rope_scaling")
    if isinstance(top_rope_scaling, dict):
      return str(snapshot_path), False
    if not isinstance(text_rope_scaling, dict):
      return str(snapshot_path), False

    payload["rope_scaling"] = dict(text_rope_scaling)
    try:
      config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
      LOGGER.warning("Qwen3-VL patch failed: cannot write %s (%s)", config_path, exc)
      return str(snapshot_path), False

    LOGGER.info("Applied Qwen3-VL rope_scaling compatibility patch: %s", config_path)
    return str(snapshot_path), True

  def _runtime_supports_vision_inputs(self) -> bool:
    override = self._resolve_vision_runtime_override()
    if override is not None:
      return override

    if self._vision_runtime_probe_failed:
      return False
    if not self._is_mlx_vlm_installed():
      return False
    return True

  def _build_vlm_media_kwargs_variants(self, image_inputs: list[str] | None = None) -> list[dict[str, Any]]:
    safe_images = [str(item).strip() for item in (image_inputs or []) if str(item).strip()]
    if not safe_images:
      return [{}]
    single_or_many: str | list[str] = safe_images[0] if len(safe_images) == 1 else list(safe_images)
    variants = [
      {"image": single_or_many},
      {"image": list(safe_images)},
      {"images": list(safe_images)},
    ]
    unique: list[dict[str, Any]] = []
    seen_keys: set[tuple[tuple[str, str], ...]] = set()
    for variant in variants:
      key_parts: list[tuple[str, str]] = []
      for key, value in sorted(variant.items()):
        if isinstance(value, list):
          rendered = "|".join(value)
        else:
          rendered = str(value)
        key_parts.append((key, rendered))
      token = tuple(key_parts)
      if token in seen_keys:
        continue
      seen_keys.add(token)
      unique.append(variant)
    return unique

  @staticmethod
  def _attachment_to_dict(attachment: Any) -> dict[str, Any]:
    if hasattr(attachment, "model_dump"):
      return attachment.model_dump()
    if isinstance(attachment, dict):
      return dict(attachment)
    return {}

  @staticmethod
  def _decode_image_data_url_to_temp_file(data_url: str, *, file_name_hint: str = "") -> str:
    safe_data_url = str(data_url or "").strip()
    if not safe_data_url.startswith("data:image/"):
      return ""
    if len(safe_data_url) > MAX_IMAGE_DATA_URL_CHARS:
      return ""
    try:
      header, payload = safe_data_url.split(",", 1)
    except ValueError:
      return ""
    if ";base64" not in header.lower():
      return ""
    mime_part = header[5:].split(";", 1)[0].strip().lower()
    if not mime_part.startswith("image/"):
      return ""
    try:
      raw_bytes = base64.b64decode(payload, validate=False)
    except (ValueError, binascii.Error):
      return ""
    if not raw_bytes:
      return ""
    guessed_suffix = mimetypes.guess_extension(mime_part) or ""
    if not guessed_suffix:
      lower_hint = str(file_name_hint or "").strip().lower()
      if "." in lower_hint:
        guessed_suffix = f".{lower_hint.rsplit('.', 1)[-1][:8]}"
    if not guessed_suffix:
      guessed_suffix = ".img"
    with tempfile.NamedTemporaryFile(
      mode="wb",
      suffix=guessed_suffix,
      prefix="ancia-vision-",
      delete=False,
    ) as handle:
      handle.write(raw_bytes)
      return handle.name

  def _resolve_request_image_inputs(self, request: ChatRequest) -> tuple[list[str], list[str]]:
    attachments = list(getattr(request, "attachments", None) or [])
    inputs: list[str] = []
    temp_files: list[str] = []
    for attachment in attachments[:6]:
      item = self._attachment_to_dict(attachment)
      kind = self._normalize_attachment_kind(str(item.get("kind") or "file"))
      mime_type = str(item.get("mimeType") or "").strip().lower()
      data_url = str(item.get("dataUrl") or "").strip()
      if kind != "image" and not mime_type.startswith("image/"):
        continue
      path = self._decode_image_data_url_to_temp_file(
        data_url,
        file_name_hint=str(item.get("name") or ""),
      )
      if not path:
        continue
      inputs.append(path)
      temp_files.append(path)
    return inputs, temp_files

  @staticmethod
  def _cleanup_temp_files(paths: list[str]) -> None:
    for path in paths:
      safe_path = str(path or "").strip()
      if not safe_path:
        continue
      try:
        os.remove(safe_path)
      except OSError:
        continue

  def _should_short_circuit_image_analysis(self, *, request: ChatRequest, plan: GenerationPlan) -> bool:
    if not self._has_image_attachments(request):
      return False
    if self._supports_selected_model_vision():
      return False
    safe_query = str(getattr(plan, "user_text", "") or "").strip()
    if self._is_generic_attachment_prompt(safe_query):
      return True
    if self._is_image_analysis_intent(safe_query):
      return True
    if self._mentions_image_reference(safe_query):
      return True
    return False

  def _filter_active_tools_for_request(
    self,
    *,
    request: ChatRequest,
    plan: GenerationPlan,
    tool_registry: ToolRegistry,
    active_tools: set[str],
  ) -> set[str]:
    safe_active_tools = {str(name or "").strip().lower() for name in active_tools if str(name or "").strip()}
    if not safe_active_tools:
      return set()
    has_images = self._has_image_attachments(request)
    if not has_images:
      return safe_active_tools
    if not self._supports_selected_model_vision():
      safe_query = str(getattr(plan, "user_text", "") or "").strip()
      if (
        self._is_generic_attachment_prompt(safe_query)
        or self._is_image_analysis_intent(safe_query)
        or self._mentions_image_reference(safe_query)
      ):
        LOGGER.info(
          "Image turn detected on text-only runtime: disabling all tools query=%s dropped=%s",
          safe_query[:64],
          sorted(safe_active_tools),
        )
        return set()
      return safe_active_tools
    safe_query = str(getattr(plan, "user_text", "") or "").strip()
    if not self._is_image_analysis_intent(safe_query):
      is_generic_attachment_prompt = self._is_generic_attachment_prompt(safe_query)
      if not is_generic_attachment_prompt and not self._mentions_image_reference(safe_query):
        return safe_active_tools
    # Для "что на фото/изображении" по умолчанию отключаем инструменты полностью:
    # модель должна сначала анализировать вложенное изображение напрямую, а не уходить в tool-calling.
    if not self._is_explicit_web_intent(safe_query):
      LOGGER.info(
        "Vision turn detected: disabling all tools for direct image analysis query=%s dropped=%s",
        safe_query[:64],
        sorted(safe_active_tools),
      )
      return set()

    # Если пользователь явно просит веб-поиск/источники, оставляем только web/network-инструменты.
    filtered_tools: set[str] = set()
    dropped_tools: list[str] = []
    for name in sorted(safe_active_tools):
      meta = tool_registry.get_tool_meta(name) if hasattr(tool_registry, "get_tool_meta") else {}
      requires_network = bool(meta.get("requires_network", False))
      category = str(meta.get("category") or "").strip().lower()
      if requires_network or category == "web" or name.startswith("web."):
        filtered_tools.add(name)
        continue
      dropped_tools.append(name)

    if dropped_tools:
      LOGGER.info(
        "Vision turn with explicit web intent: disabling non-web tools query=%s dropped=%s",
        safe_query[:64],
        dropped_tools,
      )
    return filtered_tools

  def _supports_selected_model_vision(self) -> bool:
    selected_model = get_model_entry(self.get_selected_model_id())
    catalog_support = bool(selected_model and getattr(selected_model, "supports_vision", False))
    return catalog_support and self._runtime_supports_vision_inputs()

  def _build_attachment_context(self, request: ChatRequest) -> str:
    return build_attachment_context_fn(
      request,
      truncate_text_fn=self._truncate_text,
      supports_vision=self._supports_selected_model_vision(),
    )

  def _build_messages(
    self,
    request: ChatRequest,
    turns: list[dict[str, Any]] | None = None,
    active_tools: set[str] | None = None,
    tool_definitions: dict[str, dict[str, Any]] | None = None,
  ) -> list[dict[str, Any]]:
    return build_messages_fn(
      request,
      base_system_prompt=self._base_system_prompt,
      active_tools=active_tools or set(),
      tool_definitions=tool_definitions or {},
      turns=turns,
      build_system_prompt_fn=build_system_prompt,
      truncate_text_fn=self._truncate_text,
      build_attachment_context_fn=self._build_attachment_context,
      supports_vision=self._supports_selected_model_vision(),
      max_history_messages=self.MAX_HISTORY_MESSAGES,
      max_history_total_chars=self.MAX_HISTORY_TOTAL_CHARS,
      max_history_entry_chars=self.MAX_HISTORY_ENTRY_CHARS,
    )

  def _render_vlm_prompt(
    self,
    messages: list[dict[str, Any]],
    *,
    tool_schemas: dict[str, dict[str, Any]],
    active_tools: set[str],
  ) -> str:
    """Рендерит промпт для mlx_vlm с корректными image-токенами."""
    processor = self._vlm_processor
    model_config = self._vlm_model_config

    num_images = 0
    for msg in messages:
      content = msg.get("content")
      if isinstance(content, list):
        for block in content:
          if isinstance(block, dict) and block.get("type") == "image_url":
            num_images += 1

    if num_images > 0 and model_config is not None:
      try:
        from mlx_vlm.prompt_utils import apply_chat_template as vlm_apply_chat_template  # type: ignore
        raw_config = model_config if isinstance(model_config, dict) else model_config.__dict__
        result = vlm_apply_chat_template(
          processor,
          raw_config,
          messages,
          num_images=num_images,
          add_generation_prompt=True,
        )
        if isinstance(result, str) and result.strip():
          return result
      except Exception as exc:
        LOGGER.debug("vlm apply_chat_template failed, falling back: %s", exc)

    # Фолбэк: processor.apply_chat_template (Qwen2-VL и аналоги)
    try:
      if num_images > 0 and hasattr(processor, "apply_chat_template"):
        result = processor.apply_chat_template(
          messages,
          tokenize=False,
          add_generation_prompt=True,
        )
        if isinstance(result, str) and result.strip():
          return result
    except Exception as exc:
      LOGGER.debug("processor.apply_chat_template failed, falling back: %s", exc)

    # Если ничего не сработало или нет картинок, рендерим как текст
    text_messages: list[dict[str, Any]] = []
    for msg in messages:
      content = msg.get("content")
      if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
          if isinstance(block, dict):
            if block.get("type") == "text":
              text_val = str(block.get("text") or "").strip()
              if text_val:
                text_parts.append(text_val)
        text_messages.append({**msg, "content": "\n".join(text_parts).strip()})
      else:
        text_messages.append(msg)

    return render_prompt_fn(
      text_messages,
      tokenizer=processor,
      active_tools=active_tools,
      tool_schemas=tool_schemas,
    )

  def _render_prompt(
    self,
    messages: list[dict[str, Any]],
    active_tools: set[str] | None = None,
    tool_registry: ToolRegistry | None = None,
  ) -> str:
    tool_schema_map = {}
    if tool_registry is not None and hasattr(tool_registry, "build_llm_schema_map"):
      tool_schema_map = tool_registry.build_llm_schema_map(active_tools or set())
    if self._runtime_backend_kind == "mlx_vlm" and self._vlm_processor is not None:
      return self._render_vlm_prompt(
        messages,
        tool_schemas=tool_schema_map,
        active_tools=active_tools or set(),
      )
    return render_prompt_fn(
      messages,
      tokenizer=self._tokenizer,
      active_tools=active_tools or set(),
      tool_schemas=tool_schema_map,
    )

  def _build_generation_attempts(self, prompt: str, plan: GenerationPlan) -> list[dict[str, Any]]:
    return build_generation_attempts_fn(
      prompt,
      plan,
      make_sampler_fn=self._make_sampler_fn,
    )

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
  def _is_non_fatal_stream_error(error: Exception) -> bool:
    if isinstance(error, BrokenPipeError):
      return True
    if isinstance(error, OSError):
      error_no = getattr(error, "errno", None)
      if error_no in {32, 104}:
        return True
    safe_message = str(error or "").strip().lower()
    return "broken pipe" in safe_message or "errno 32" in safe_message

  def _disable_stream_generate_fn_unlocked(self, *, vlm: bool, reason: Exception) -> None:
    if vlm:
      if self._vlm_stream_generate_fn is None:
        return
      self._vlm_stream_generate_fn = None
      backend_label = "mlx_vlm"
    else:
      if self._stream_generate_fn is None:
        return
      self._stream_generate_fn = None
      backend_label = "mlx_lm"
    LOGGER.warning(
      "Disabling %s stream_generate and falling back to non-stream generation: %s",
      backend_label,
      reason,
    )

  @staticmethod
  def _normalize_for_dedupe(value: str) -> str:
    return normalize_for_dedupe_fn(value)

  @classmethod
  def _is_repetition_runaway(cls, text: str) -> bool:
    return is_repetition_runaway_fn(text)

  @classmethod
  def _compact_repetitions(cls, text: str) -> str:
    return compact_repetitions_fn(text)

  @staticmethod
  def _extract_reply_mood_directive(text: str) -> tuple[str, str]:
    return extract_reply_mood_directive_fn(text, normalize_mood)

  @staticmethod
  def _strip_markdown_fence(value: str) -> str:
    return strip_markdown_fence_fn(value)

  @staticmethod
  def _normalize_tool_call_payload(payload: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    return normalize_tool_call_payload_fn(payload)

  @classmethod
  def _extract_tool_calls_from_json_payload(cls, payload: Any) -> list[tuple[str, dict[str, Any]]]:
    return extract_tool_calls_from_json_payload_fn(payload)

  @classmethod
  def _extract_tool_calls_from_json_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    return extract_tool_calls_from_json_text_fn(raw_text)

  @staticmethod
  def _build_json_parse_candidates(payload_text: str) -> list[str]:
    return build_json_parse_candidates_fn(payload_text)

  @staticmethod
  def _parse_json_like(payload_text: str) -> Any | None:
    return parse_json_like_fn(payload_text)

  @staticmethod
  def _extract_balanced_json_prefix(payload_text: str) -> str:
    return extract_balanced_json_prefix_fn(payload_text)

  @classmethod
  def _normalize_tool_call_candidate(cls, raw_text: str) -> str:
    return normalize_tool_call_candidate_fn(raw_text)

  @classmethod
  def _extract_tool_calls_from_candidate_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    return extract_tool_calls_from_candidate_text_fn(raw_text)

  @classmethod
  def _extract_tool_calls_from_mixed_text(cls, raw_text: str) -> list[tuple[str, dict[str, Any]]]:
    return extract_tool_calls_from_mixed_text_fn(raw_text)

  @classmethod
  def _extract_tool_calls_from_reply(cls, text: str) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
    return extract_tool_calls_from_reply_fn(
      text,
      compact_repetitions_fn=cls._compact_repetitions,
    )

  @classmethod
  def _sanitize_stream_preview(cls, text: str, *, final: bool) -> str:
    return sanitize_stream_preview_fn(text, final=final)

  @staticmethod
  def _chunk_text_for_streaming(text: str, max_chunk_size: int = 42) -> Generator[str, None, None]:
    yield from chunk_text_for_streaming_fn(text, max_chunk_size=max_chunk_size)

  @staticmethod
  def _resolve_stream_delta(payload_text: str, emitted_text: str) -> str:
    return resolve_stream_delta_fn(payload_text, emitted_text)

  def _iter_generation_chunks(
    self,
    prompt: str,
    plan: GenerationPlan,
    *,
    image_inputs: list[str] | None = None,
  ) -> Generator[str, None, None]:
    with self._generation_lock:
      self._generation_stop_event.clear()
      if self._model is None or self._tokenizer is None:
        raise RuntimeError(self.get_unavailable_message())

      attempts = self._build_generation_attempts(prompt, plan)
      is_vlm_backend = bool(
        self._runtime_backend_kind == "mlx_vlm"
        and self._vlm_generate_fn is not None
        and self._vlm_processor is not None
      )
      if is_vlm_backend:
        media_variants = self._build_vlm_media_kwargs_variants(image_inputs)
        if self._vlm_stream_generate_fn is not None:
          stream_last_error: Exception | None = None
          for base_kwargs in attempts:
            prompt_value = str(base_kwargs.get("prompt") or prompt)
            generation_kwargs = {
              key: value
              for key, value in base_kwargs.items()
              if key != "prompt"
            }
            for media_kwargs in media_variants:
              kwargs = dict(generation_kwargs)
              kwargs.update(media_kwargs)
              while True:
                response_chunks: list[str] = []
                generated_text = ""
                try:
                  stream_iterable = self._vlm_stream_generate_fn(
                    self._model,
                    self._vlm_processor,
                    prompt_value,
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
                    raise RuntimeError(f"Ошибка потоковой генерации vision-модели: {exc}") from exc
                  if self._drop_unexpected_kwarg(kwargs, exc):
                    continue
                  stream_last_error = exc
                  break
                except Exception as exc:
                  if self._generation_stop_event.is_set() or "Генерация остановлена пользователем." in str(exc):
                    raise RuntimeError("Генерация остановлена пользователем.") from exc
                  if self._is_non_fatal_stream_error(exc):
                    stream_last_error = exc
                    break
                  if isinstance(exc, RuntimeError):
                    raise
                  raise RuntimeError(f"Ошибка потоковой генерации vision-модели: {exc}") from exc
          if stream_last_error is not None:
            # Переходим к non-stream fallback, если stream API недоступен.
            self._disable_stream_generate_fn_unlocked(vlm=True, reason=stream_last_error)

        output: Any = ""
        last_error: Exception | None = None
        generated = False
        for base_kwargs in attempts:
          prompt_value = str(base_kwargs.get("prompt") or prompt)
          generation_kwargs = {
            key: value
            for key, value in base_kwargs.items()
            if key != "prompt"
          }
          for media_kwargs in media_variants:
            kwargs = dict(generation_kwargs)
            kwargs.update(media_kwargs)
            if self._generation_stop_event.is_set():
              raise RuntimeError("Генерация остановлена пользователем.")
            while True:
              try:
                output = self._vlm_generate_fn(
                  self._model,
                  self._vlm_processor,
                  prompt_value,
                  **kwargs,
                )
                last_error = None
                generated = True
                break
              except TypeError as exc:
                if self._drop_unexpected_kwarg(kwargs, exc):
                  continue
                last_error = exc
                break
              except Exception as exc:
                raise RuntimeError(f"Ошибка генерации vision-модели: {exc}") from exc
            if generated:
              break
          if generated:
            break

        if not generated:
          if last_error is not None:
            raise RuntimeError(f"Несовместимый API mlx_vlm.generate: {last_error}")
          raise RuntimeError("Vision-модель не вернула ответ.")

        raw_output = self._extract_stream_text(output)
        if not raw_output and output is not None:
          raw_output = str(output)
        reply = self._compact_repetitions(str(raw_output or "").strip())
        if not reply:
          raise RuntimeError("Vision-модель вернула пустой ответ.")
        if self._generation_stop_event.is_set():
          raise RuntimeError("Генерация остановлена пользователем.")
        # Non-stream fallback: отдаём ответ единым блоком без имитации токенов.
        yield reply
        return

      if self._generate_fn is None:
        raise RuntimeError(self.get_unavailable_message())

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
              if self._generation_stop_event.is_set() or "Генерация остановлена пользователем." in str(exc):
                raise RuntimeError("Генерация остановлена пользователем.") from exc
              if self._is_non_fatal_stream_error(exc):
                stream_last_error = exc
                break
              if isinstance(exc, RuntimeError):
                raise
              raise RuntimeError(f"Ошибка потоковой генерации модели: {exc}") from exc
        if stream_last_error is not None:
          # Переходим к non-stream fallback, если stream API недоступен.
          self._disable_stream_generate_fn_unlocked(vlm=False, reason=stream_last_error)

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
      if self._generation_stop_event.is_set():
        raise RuntimeError("Генерация остановлена пользователем.")
      # Non-stream fallback: отдаём ответ единым блоком без имитации токенов.
      yield reply

  def _run_generation(
    self,
    prompt: str,
    plan: GenerationPlan,
    *,
    image_inputs: list[str] | None = None,
  ) -> str:
    chunks = [chunk for chunk in self._iter_generation_chunks(prompt, plan, image_inputs=image_inputs)]
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

  def _resolve_weakest_model_id(self) -> str:
    weakest_id = ""
    weakest_score: tuple[int, int, str] | None = None
    for item in list_model_catalog_payload():
      model_id = normalize_model_id(item.get("id"), "")
      if not model_id:
        continue
      raw_required = int(item.get("estimated_unified_memory_bytes") or 0)
      required_memory = raw_required if raw_required > 0 else 2**62
      max_context = int(item.get("max_context") or 0)
      score = (required_memory, max_context if max_context > 0 else 2**30, model_id)
      if weakest_score is None or score < weakest_score:
        weakest_score = score
        weakest_id = model_id
    return weakest_id or self.get_selected_model_id()

  def suggest_chat_title(self, user_text: str, max_chars: int = 72) -> str:
    source = re.sub(r"\s+", " ", str(user_text or "").strip())
    if not source:
      return "Новая сессия"

    weakest_model_id = self._resolve_weakest_model_id()
    loaded_model_id = normalize_model_id(self.get_loaded_model_id(), "")
    if not self.is_ready() or loaded_model_id != weakest_model_id:
      return self._fallback_chat_title(source, max_chars=max_chars)

    weakest_model_entry = get_model_entry(weakest_model_id)
    weakest_tier_key = normalize_model_tier_key(
      getattr(weakest_model_entry, "recommended_tier", "") if weakest_model_entry is not None else "",
      "compact",
    )

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
      tier=MODEL_TIERS[weakest_tier_key],
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

    selected_model_id = self.get_selected_model_id()
    selected_model_entry = get_model_entry(selected_model_id)
    tier_key = normalize_model_tier_key(
      getattr(selected_model_entry, "recommended_tier", "") if selected_model_entry is not None else "",
      self.get_selected_tier(),
    )
    tier = MODEL_TIERS[tier_key]
    model_params = self.get_model_params(selected_model_id, tier_key=tier_key)
    user_text = request.message.strip()
    context_mood = normalize_mood(str(request.context.mood or ""), "neutral")
    ui = getattr(request.context, "ui", None)
    allow_ui_model_overrides = os.getenv("ANCIA_ALLOW_UI_MODEL_PARAM_OVERRIDES", "").strip() == "1"
    model_context_limit = max(
      512,
      min(
        self.MAX_CONTEXT_WINDOW_LIMIT,
        int(getattr(selected_model_entry, "max_context", 0) or tier.max_context or 8192),
      ),
    )
    model_completion_limit = max(
      64,
      min(self.MAX_COMPLETION_TOKENS_LIMIT, model_context_limit),
    )

    if allow_ui_model_overrides:
      context_window_override = _read_int(
        getattr(ui, "contextWindow", None),
        min_value=256,
        max_value=model_context_limit,
      )
      max_tokens_override = _read_int(
        getattr(ui, "maxTokens", None),
        min_value=16,
        max_value=model_completion_limit,
      )
      temperature_override = _read_float(getattr(ui, "temperature", None), min_value=0.0, max_value=2.0)
      top_p_override = _read_float(getattr(ui, "topP", None), min_value=0.0, max_value=1.0)
      top_k_override = _read_int(getattr(ui, "topK", None), min_value=1, max_value=400)
    else:
      context_window_override = None
      max_tokens_override = None
      temperature_override = None
      top_p_override = None
      top_k_override = None
    if context_window_override is None:
      context_window_override = int(model_params.get("context_window") or tier.max_context)
    if max_tokens_override is None:
      max_tokens_override = int(model_params.get("max_tokens") or 256)
    context_window_override = max(256, min(model_context_limit, int(context_window_override or model_context_limit)))
    max_tokens_override = max(16, min(model_completion_limit, int(max_tokens_override or 256)))
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
    display_name: str,
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
      "display_name": display_name,
      "args": args or {},
      "status": "running",
      "text": text,
      "meta_suffix": "инструмент • запуск",
    }

  def _build_tool_result_payload(
    self,
    *,
    event: ToolEvent,
    display_name: str,
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
      "display_name": display_name,
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
    if self._should_short_circuit_image_analysis(request=request, plan=plan):
      LOGGER.info(
        "Short-circuiting image analysis on text-only runtime chat=%s model=%s",
        runtime.chat_id,
        self.get_selected_model_id(),
      )
      return self._build_result_from_reply(
        plan,
        VISION_UNAVAILABLE_REPLY,
        tool_events=[],
        fallback_mood="warning",
      )

    turns: list[dict[str, Any]] = []
    tool_events: list[ToolEvent] = []
    latest_reply = ""
    latest_mood = ""
    effective_active_tools = self._filter_active_tools_for_request(
      request=request,
      plan=plan,
      tool_registry=tool_registry,
      active_tools=active_tools,
    )
    tools_are_allowed = bool(effective_active_tools)
    image_inputs: list[str] = []
    temp_image_files: list[str] = []
    if self._supports_selected_model_vision():
      image_inputs, temp_image_files = self._resolve_request_image_inputs(request)

    try:
      for round_index in range(self.MAX_TOOL_CALL_ROUNDS):
        generation_active_tools = effective_active_tools if tools_are_allowed else set()
        tool_definitions = (
          tool_registry.build_tool_definition_map(generation_active_tools)
          if hasattr(tool_registry, "build_tool_definition_map")
          else {}
        )
        messages = self._build_messages(
          request,
          turns or None,
          generation_active_tools,
          tool_definitions=tool_definitions,
        )
        prompt = self._render_prompt(
          messages,
          generation_active_tools,
          tool_registry=tool_registry,
        )
        # Стримим ответ в каждом раунде: sanitize_stream_preview скрывает tool-call
        # управляющие блоки, поэтому пользователь видит только человекочитаемый текст.
        should_stream_this_round = bool(stream_final_reply)
        round_plan = plan
        if tools_are_allowed:
          base_max_tokens = int(plan.max_tokens_override or 256)
          constrained_max_tokens = max(48, min(160, base_max_tokens))
          base_temperature = float(plan.temperature_override if plan.temperature_override is not None else plan.tier.temperature)
          constrained_temperature = max(0.0, min(0.35, base_temperature))
          round_plan = GenerationPlan(
            tier=plan.tier,
            user_text=plan.user_text,
            context_mood=plan.context_mood,
            active_tools=plan.active_tools,
            context_window_override=plan.context_window_override,
            max_tokens_override=constrained_max_tokens,
            temperature_override=constrained_temperature,
            top_p_override=plan.top_p_override,
            top_k_override=plan.top_k_override,
          )

        if should_stream_this_round:
          streamed_preview = ""
          raw_reply = ""
          for chunk in self._iter_generation_chunks(prompt, round_plan, image_inputs=image_inputs):
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
          reply = self._run_generation(prompt, round_plan, image_inputs=image_inputs)

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
          if tools_are_allowed and not model_tool_calls:
            auto_call = self._resolve_auto_invoke_tool_call(
              user_text=str(getattr(plan, "user_text", "") or ""),
              active_tools=effective_active_tools,
              tool_registry=tool_registry,
            )
            if auto_call is not None:
              auto_name, auto_args = auto_call
              auto_meta = tool_registry.get_tool_meta(auto_name) if hasattr(tool_registry, "get_tool_meta") else {}
              auto_display_name = str(auto_meta.get("display_name") or auto_name or "Инструмент").strip() or "Инструмент"
              LOGGER.info(
                "Auto-invoking tool due to plugin trigger chat=%s tool=%s args=%s",
                runtime.chat_id,
                auto_name,
                json.dumps(auto_args, ensure_ascii=False),
              )
              yield {"kind": "tool_start", "payload": self._build_tool_start_payload(
                name=auto_name,
                display_name=auto_display_name,
                args=auto_args,
                round_index=round_index,
                call_index=0,
              )}
              auto_event = self._execute_tool_event(tool_registry, runtime, name=auto_name, args=auto_args)
              tool_events.append(auto_event)
              yield {"kind": "tool_result", "payload": self._build_tool_result_payload(
                event=auto_event,
                display_name=auto_display_name,
                args=auto_args,
                round_index=round_index,
                call_index=0,
              )}
              auto_cid = f"r{round_index + 1}-auto-1"
              turns.append({
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                  "id": auto_cid,
                  "type": "function",
                  "function": {
                    "name": auto_name,
                    "arguments": json.dumps(auto_args, ensure_ascii=False),
                  },
                }],
              })
              turns.append({
                "role": "tool",
                "tool_call_id": auto_cid,
                "name": auto_name,
                "content": self._summarize_tool_event(auto_event),
              })
              tools_are_allowed = False
              latest_reply = ""
              continue
          final = clean_reply or latest_reply or "Не удалось сформировать ответ."
          return self._build_result_from_reply(
            plan, final, tool_events=tool_events, fallback_mood=latest_mood,
          )

        call_entries: list[tuple[str, str, dict[str, Any]]] = []
        tool_calls_payload: list[dict[str, Any]] = []
        for ci, (name, args) in enumerate(model_tool_calls[: self.MAX_TOOL_CALLS_PER_ROUND]):
          canonical_name = (
            tool_registry.resolve_tool_name(name)
            if hasattr(tool_registry, "resolve_tool_name")
            else name
          )
          cid = f"r{round_index + 1}-c{ci + 1}"
          call_entries.append((cid, canonical_name, args))
          tool_calls_payload.append({
            "id": cid, "type": "function",
            "function": {"name": canonical_name, "arguments": json.dumps(args, ensure_ascii=False)},
          })

        turns.append({"role": "assistant", "content": clean_reply or "", "tool_calls": tool_calls_payload})

        for ci, (cid, name, args) in enumerate(call_entries):
          tool_meta = tool_registry.get_tool_meta(name) if hasattr(tool_registry, "get_tool_meta") else {}
          display_name = str(tool_meta.get("display_name") or name or "Инструмент").strip() or "Инструмент"
          yield {"kind": "tool_start", "payload": self._build_tool_start_payload(
            name=name, display_name=display_name, args=args, round_index=round_index, call_index=ci,
          )}
          if name in effective_active_tools and tool_registry.has_tool(name):
            ev = self._execute_tool_event(tool_registry, runtime, name=name, args=args)
          elif tool_registry.has_tool(name):
            ev = ToolEvent(
              name=name or "unknown",
              status="error",
              output={"error": f"Инструмент '{name}' отключен в настройках плагинов или недоступен в автономном режиме."},
            )
          else:
            ev = ToolEvent(
              name=name or "unknown",
              status="error",
              output={"error": f"Инструмент '{name}' не зарегистрирован в backend."},
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
            event=ev, display_name=display_name, args=args, round_index=round_index, call_index=ci,
          )}
          turns.append({"role": "tool", "tool_call_id": cid, "name": name, "content": self._summarize_tool_event(ev)})

      final = latest_reply or "Не удалось завершить вызов инструментов."
      return self._build_result_from_reply(
        plan, final, tool_events=tool_events, fallback_mood=latest_mood,
      )
    finally:
      self._cleanup_temp_files(temp_image_files)

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
    return result
