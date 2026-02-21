from __future__ import annotations

import os
import platform
import re
import subprocess
import threading
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


def build_chat_mood_prompt() -> str:
  return (
    "## Настроение и фон чата\n"
    "Фон чата зависит от настроения ответа модели.\n"
    "Если доступен инструмент `chat.set_mood`, используй именно его для явной смены состояния.\n"
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
