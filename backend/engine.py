from __future__ import annotations

import json
import logging
import os
import platform
import re
import sys
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
    build_tool_schemas as build_tool_schemas_fn,
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
  from backend.tooling import TOOL_SCHEMAS, ToolRegistry
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore
  from engine_generation_prep import (  # type: ignore
    build_attachment_context as build_attachment_context_fn,
    build_generation_attempts as build_generation_attempts_fn,
    build_messages as build_messages_fn,
    build_tool_schemas as build_tool_schemas_fn,
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
  from tooling import TOOL_SCHEMAS, ToolRegistry  # type: ignore

LOGGER = logging.getLogger("ancia.engine")


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

  def __init__(self, storage: AppStorage, *, base_system_prompt: str) -> None:
    self._storage = storage
    self._base_system_prompt = base_system_prompt
    _models_dir = (
      Path(os.getenv("ANCIA_MODELS_DIR", "")).expanduser().resolve()
      if os.getenv("ANCIA_MODELS_DIR") else
      Path.home() / ".cache" / "ancia"
    )
    os.environ.setdefault("HF_HOME", str(_models_dir))
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

  def start_background_load(self, tier: str | None = None) -> None:
    target_model_id = self.get_selected_model_id()
    target_model_entry = get_model_entry(target_model_id)
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
    return build_tool_schemas_fn(active_tools, TOOL_SCHEMAS)

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

  @classmethod
  def _build_attachment_context(cls, request: ChatRequest) -> str:
    return build_attachment_context_fn(
      request,
      truncate_text_fn=cls._truncate_text,
      get_model_entry_fn=get_model_entry,
      normalize_model_id_fn=normalize_model_id,
    )

  def _build_messages(
    self,
    request: ChatRequest,
    turns: list[dict[str, Any]] | None = None,
    active_tools: set[str] | None = None,
  ) -> list[dict[str, Any]]:
    return build_messages_fn(
      request,
      base_system_prompt=self._base_system_prompt,
      active_tools=active_tools or set(),
      turns=turns,
      build_system_prompt_fn=build_system_prompt,
      truncate_text_fn=self._truncate_text,
      build_attachment_context_fn=self._build_attachment_context,
      max_history_messages=self.MAX_HISTORY_MESSAGES,
      max_history_total_chars=self.MAX_HISTORY_TOTAL_CHARS,
      max_history_entry_chars=self.MAX_HISTORY_ENTRY_CHARS,
    )

  def _render_prompt(
    self,
    messages: list[dict[str, Any]],
    active_tools: set[str] | None = None,
  ) -> str:
    return render_prompt_fn(
      messages,
      tokenizer=self._tokenizer,
      active_tools=active_tools or set(),
      tool_schemas=TOOL_SCHEMAS,
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
    turns: list[dict[str, Any]] = []
    tool_events: list[ToolEvent] = []
    latest_reply = ""
    latest_mood = ""
    tools_are_allowed = bool(active_tools)

    for round_index in range(self.MAX_TOOL_CALL_ROUNDS):
      generation_active_tools = active_tools if tools_are_allowed else set()
      messages = self._build_messages(request, turns or None, generation_active_tools)
      prompt = self._render_prompt(messages, generation_active_tools)
      should_stream_this_round = stream_final_reply and not generation_active_tools
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
        for chunk in self._iter_generation_chunks(prompt, round_plan):
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
        reply = self._run_generation(prompt, round_plan)

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
        tool_meta = tool_registry.get_tool_meta(name) if hasattr(tool_registry, "get_tool_meta") else {}
        display_name = str(tool_meta.get("display_name") or name or "Инструмент").strip() or "Инструмент"
        yield {"kind": "tool_start", "payload": self._build_tool_start_payload(
          name=name, display_name=display_name, args=args, round_index=round_index, call_index=ci,
        )}
        if name in active_tools and tool_registry.has_tool(name):
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
