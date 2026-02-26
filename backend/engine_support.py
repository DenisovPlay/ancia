from __future__ import annotations

import os
import platform
import re
import subprocess
import threading
import math
import sys
from dataclasses import dataclass
from typing import Any
from urllib import parse as url_parse

try:
  from backend.common import utc_now_iso
  from backend.schemas import MODEL_TIER_ALIASES, MODEL_TIERS, ModelTier
except ModuleNotFoundError:
  from common import utc_now_iso  # type: ignore
  from schemas import MODEL_TIER_ALIASES, MODEL_TIERS, ModelTier  # type: ignore

STARTUP_STAGE_PROGRESS = {
  "backend_boot": 4,
  "environment_check": 15,
  "checking_gpu_memory": 30,
  "loading_model": 72,
  "ready": 100,
  "error": 100,
  "unloaded": 0,
}

VALID_PERF_MODES = {"balanced", "latency", "throughput"}
THREAD_ENV_KEYS = (
  "OMP_NUM_THREADS",
  "MKL_NUM_THREADS",
  "OPENBLAS_NUM_THREADS",
  "NUMEXPR_NUM_THREADS",
)


def build_chat_mood_prompt() -> str:
  return (
    "## Настроение и фон чата\n"
    "Фон чата зависит от настроения ответа модели.\n"
    "Если доступен инструмент смены состояния чата, используй его для явной смены состояния.\n"
    "Не добавляй технические маркеры `[[mood:...]]` в обычный ответ пользователю.\n"
    "Поддерживаемые состояния: neutral, success, error, warning, thinking, planning, coding, researching, "
    "creative, friendly, waiting, offline.\n"
    "Выбирай состояние строго по контексту ответа."
  )


@dataclass
class ModelResult:
  reply: str
  mood: str
  tool_events: list[Any]
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
      output = subprocess.check_output(
        ["sysctl", "-n", "hw.memsize"],
        text=True,
        stderr=subprocess.DEVNULL,
      ).strip()
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


def normalize_model_tier_key(value: str | None, fallback: str = "compact") -> str:
  raw = str(value or "").strip().lower()
  legacy_token = re.sub(r"[^a-z]", "", raw)
  if legacy_token.startswith("li"):
    raw = "compact"
  elif legacy_token.startswith("st"):
    raw = "balanced"
  elif legacy_token.startswith("pl"):
    raw = "performance"
  if raw in MODEL_TIER_ALIASES:
    raw = MODEL_TIER_ALIASES[raw]
  if raw in MODEL_TIERS:
    return raw
  return fallback


def normalize_model_repo(value: str | None, fallback: str = "") -> str:
  aliases = {
    "qwen/qwen3-vl-4b": "lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit",
    "mistralai/ministral-3-3b": "mlx-community/Ministral-3-3B-Instruct-2512-4bit",
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


def _resolve_perf_mode() -> str:
  raw = str(os.getenv("ANCIA_PERF_MODE", "balanced") or "").strip().lower()
  if raw in VALID_PERF_MODES:
    return raw
  return "balanced"


def _probe_mlx_runtime_stability() -> dict[str, Any]:
  if os.getenv("ANCIA_DISABLE_MLX_RUNTIME", "").strip() == "1":
    return {
      "ok": True,
      "skipped": True,
      "reason": "disabled_by_env",
      "exit_code": None,
      "stderr_preview": "",
    }
  if os.getenv("ANCIA_SKIP_MLX_STABILITY_PROBE", "").strip() == "1":
    return {
      "ok": True,
      "skipped": True,
      "reason": "skipped_by_env",
      "exit_code": None,
      "stderr_preview": "",
    }

  timeout_raw = str(os.getenv("ANCIA_MLX_STABILITY_PROBE_TIMEOUT_SECONDS", "8") or "").strip()
  try:
    timeout_sec = max(1.0, min(25.0, float(timeout_raw)))
  except ValueError:
    timeout_sec = 8.0

  probe_code = (
    "import mlx.core as mx\n"
    "_ = mx.array([0], dtype=mx.int32)\n"
    "print('ok')\n"
  )
  try:
    result = subprocess.run(
      [sys.executable, "-c", probe_code],
      capture_output=True,
      text=True,
      timeout=timeout_sec,
      check=False,
    )
  except subprocess.TimeoutExpired:
    return {
      "ok": False,
      "skipped": False,
      "reason": "timeout",
      "exit_code": None,
      "stderr_preview": f"timeout after {timeout_sec:.1f}s",
    }
  except Exception as exc:
    return {
      "ok": False,
      "skipped": False,
      "reason": "spawn_error",
      "exit_code": None,
      "stderr_preview": str(exc),
    }

  stdout = str(result.stdout or "")
  stderr = str(result.stderr or "")
  ok = int(result.returncode) == 0 and "ok" in stdout
  return {
    "ok": ok,
    "skipped": False,
    "reason": "ok" if ok else "probe_failed",
    "exit_code": int(result.returncode),
    "stderr_preview": stderr[:700].strip(),
  }


def _resolve_cpu_counts() -> tuple[int, int]:
  logical = max(1, int(os.cpu_count() or 1))
  physical = 0
  try:
    import psutil  # type: ignore

    physical = int(psutil.cpu_count(logical=False) or 0)
  except Exception:
    physical = 0
  effective_logical = logical
  if hasattr(os, "sched_getaffinity"):
    try:
      affinity_count = len(os.sched_getaffinity(0))  # type: ignore[attr-defined]
      if affinity_count > 0:
        effective_logical = min(effective_logical, affinity_count)
    except Exception:
      pass
  cgroup_quota_cores = _resolve_cgroup_cpu_quota_cores()
  if cgroup_quota_cores > 0:
    effective_logical = min(effective_logical, cgroup_quota_cores)
  if physical <= 0:
    physical = effective_logical
  if physical > effective_logical:
    physical = effective_logical
  return physical, effective_logical


def _resolve_cgroup_cpu_quota_cores() -> int:
  cpu_max_path = "/sys/fs/cgroup/cpu.max"
  try:
    if os.path.isfile(cpu_max_path):
      with open(cpu_max_path, "r", encoding="utf-8") as handle:
        raw = str(handle.read().strip() or "")
      if raw:
        parts = raw.split()
        if len(parts) >= 2 and parts[0] != "max":
          quota = int(parts[0])
          period = int(parts[1])
          if quota > 0 and period > 0:
            return max(1, int(math.ceil(quota / period)))
  except Exception:
    pass

  quota_path = "/sys/fs/cgroup/cpu/cpu.cfs_quota_us"
  period_path = "/sys/fs/cgroup/cpu/cpu.cfs_period_us"
  try:
    if os.path.isfile(quota_path) and os.path.isfile(period_path):
      with open(quota_path, "r", encoding="utf-8") as quota_handle:
        quota_raw = str(quota_handle.read().strip() or "")
      with open(period_path, "r", encoding="utf-8") as period_handle:
        period_raw = str(period_handle.read().strip() or "")
      quota = int(quota_raw)
      period = int(period_raw)
      if quota > 0 and period > 0:
        return max(1, int(math.ceil(quota / period)))
  except Exception:
    pass

  return 0


def _recommend_thread_budget(*, perf_mode: str, physical_cores: int, logical_cores: int) -> int:
  if perf_mode == "latency":
    budget = max(1, min(physical_cores, 8))
  elif perf_mode == "throughput":
    budget = max(1, min(logical_cores, 24))
  else:
    # balanced
    budget = max(1, min(max(physical_cores, logical_cores // 2), 16))
  return budget


def _resolve_thread_budget_override(max_logical_cores: int) -> int | None:
  raw = str(os.getenv("ANCIA_THREAD_BUDGET", "") or "").strip()
  if not raw:
    return None
  try:
    value = int(raw)
  except ValueError:
    return None
  return max(1, min(max(1, max_logical_cores), value))


def resolve_runtime_profile() -> dict[str, Any]:
  system = str(platform.system() or "").strip() or "Unknown"
  machine = str(platform.machine() or "").strip().lower()
  os_family = system.lower()
  physical_cores, logical_cores = _resolve_cpu_counts()
  perf_mode = _resolve_perf_mode()
  auto_thread_budget = _recommend_thread_budget(
    perf_mode=perf_mode,
    physical_cores=physical_cores,
    logical_cores=logical_cores,
  )
  override_thread_budget = _resolve_thread_budget_override(logical_cores)
  thread_budget = override_thread_budget if override_thread_budget is not None else auto_thread_budget
  thread_budget_source = "override" if override_thread_budget is not None else "auto"
  supports_mlx = bool(os_family == "darwin" and machine in {"arm64", "aarch64"})
  if supports_mlx:
    mlx_runtime_probe = _probe_mlx_runtime_stability()
  else:
    mlx_runtime_probe = {
      "ok": False,
      "skipped": True,
      "reason": "unsupported_platform",
      "exit_code": None,
      "stderr_preview": "",
    }
  return {
    "system": system,
    "machine": machine,
    "os_family": os_family,
    "python": platform.python_version(),
    "cpu_physical_cores": physical_cores,
    "cpu_logical_cores": logical_cores,
    "perf_mode": perf_mode,
    "thread_budget": thread_budget,
    "thread_budget_source": thread_budget_source,
    "supports_mlx": supports_mlx,
    "mlx_runtime_probe": mlx_runtime_probe,
  }


def apply_runtime_env_tuning(profile: dict[str, Any]) -> dict[str, Any]:
  safe_profile = dict(profile or {})
  perf_mode = str(safe_profile.get("perf_mode") or "balanced").strip().lower()
  if perf_mode not in VALID_PERF_MODES:
    perf_mode = "balanced"
  thread_budget = max(1, int(safe_profile.get("thread_budget") or 1))
  supports_mlx = bool(safe_profile.get("supports_mlx"))
  os_family = str(safe_profile.get("os_family") or "").strip().lower()

  desired: dict[str, str] = {
    "HF_HUB_ENABLE_HF_TRANSFER": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1",
  }
  if perf_mode == "throughput":
    desired["TOKENIZERS_PARALLELISM"] = "true"
  else:
    desired["TOKENIZERS_PARALLELISM"] = "false"

  for key in THREAD_ENV_KEYS:
    desired[key] = str(thread_budget)
  if os_family == "darwin" or supports_mlx:
    desired["VECLIB_MAXIMUM_THREADS"] = str(thread_budget)

  applied: dict[str, str] = {}
  respected_existing: dict[str, str] = {}
  for key, value in desired.items():
    existing = str(os.getenv(key) or "").strip()
    if existing:
      respected_existing[key] = existing
      continue
    os.environ[key] = value
    applied[key] = value

  effective: dict[str, str] = {}
  for key in list(desired.keys()):
    value = str(os.getenv(key) or "").strip()
    if value:
      effective[key] = value

  return {
    "perf_mode": perf_mode,
    "thread_budget": thread_budget,
    "applied_env": applied,
    "respected_existing_env": respected_existing,
    "effective_env": effective,
  }
