from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger("ancia.model_catalog")

_CATALOG_PATH = Path(__file__).resolve().parent / "data" / "model_catalog.json"

_TOOL_CAPABLE_FAMILIES = re.compile(
    r"qwen|mistral|ministral|mixtral|llama-3|llama3|hermes|functionary|"
    r"xtuner|gorilla|nexus|toolbench|toolalpaca",
    re.IGNORECASE,
)
_VISION_FAMILIES = re.compile(
    r"qwen.*vl|llava|idefics|intern.*vl|phi.*vision|pixtral|moondream|minicpm.*v",
    re.IGNORECASE,
)

_catalog_lock = threading.Lock()
_RECOMMENDED_TIER_ALIASES: dict[str, str] = {
  "compact": "compact",
  "balanced": "balanced",
  "performance": "performance",
  "standard": "balanced",
  "max": "performance",
}


def normalize_recommended_tier(value: str | None, fallback: str = "compact") -> str:
  raw = str(value or "").strip().lower()
  legacy_token = re.sub(r"[^a-z]", "", raw)
  if legacy_token.startswith("li"):
    raw = "compact"
  elif legacy_token.startswith("st"):
    raw = "balanced"
  elif legacy_token.startswith("pl"):
    raw = "performance"
  normalized = _RECOMMENDED_TIER_ALIASES.get(raw, raw)
  return normalized if normalized in {"compact", "balanced", "performance"} else fallback


@dataclass(frozen=True)
class ModelCatalogEntry:
  id: str
  label: str
  repo: str
  source: str
  homepage: str
  family: str
  size: str
  quantization: str
  description: str
  supports_tools: bool
  supports_vision: bool
  supports_documents: bool
  recommended_tier: str
  max_context: int
  estimated_unified_memory_bytes: int


def _load_catalog_from_disk() -> list[ModelCatalogEntry]:
  if not _CATALOG_PATH.exists():
    return []
  try:
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    entries = []
    for item in raw.get("models") or []:
      try:
        entries.append(ModelCatalogEntry(
          id=str(item["id"]).strip().lower(),
          label=str(item.get("label") or item["id"]).strip(),
          repo=str(item.get("repo") or "").strip(),
          source=str(item.get("source") or "huggingface").strip(),
          homepage=str(item.get("homepage") or "").strip(),
          family=str(item.get("family") or "").strip(),
          size=str(item.get("size") or "").strip(),
          quantization=str(item.get("quantization") or "").strip(),
          description=str(item.get("description") or "").strip(),
          supports_tools=bool(item.get("supports_tools", True)),
          supports_vision=bool(item.get("supports_vision", False)),
          supports_documents=bool(item.get("supports_documents", True)),
          recommended_tier=normalize_recommended_tier(str(item.get("recommended_tier") or "compact").strip(), "compact"),
          max_context=int(item.get("max_context") or 4096),
          estimated_unified_memory_bytes=int(item.get("estimated_unified_memory_bytes") or 0),
        ))
      except (KeyError, TypeError, ValueError) as exc:
        LOGGER.warning("Пропускаем запись каталога: %s | %s", item.get("id"), exc)
    return entries
  except Exception as exc:
    LOGGER.error("Не удалось загрузить model_catalog.json: %s", exc)
    return []


def _save_catalog_to_disk(entries: list[ModelCatalogEntry]) -> None:
  _CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
  payload = {"version": 1, "models": [asdict(e) for e in entries]}
  _CATALOG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Глобальное состояние ──────────────────────────────────────────────────────

MODEL_CATALOG: list[ModelCatalogEntry] = _load_catalog_from_disk()
MODEL_BY_ID: dict[str, ModelCatalogEntry] = {e.id: e for e in MODEL_CATALOG}

MODEL_ID_ALIASES: dict[str, str] = {
  "qwen2.5-0.5b": "qwen2.5-0.5b-instruct-mlx-4bit",
  "qwen2.5-1.5b": "qwen2.5-1.5b-instruct-mlx-4bit",
  "qwen2.5-3b": "qwen2.5-3b-instruct-mlx-4bit",
  "qwen2.5-7b": "qwen2.5-7b-instruct-mlx-4bit",
  "qwen3-vl-4b": "qwen3-vl-4b-instruct-mlx-4bit",
  "ministral-3-3b": "ministral-3-3b-instruct-mlx-4bit",
  "mistralai/ministral-3-3b": "ministral-3-3b-instruct-mlx-4bit",
  "mlx-community/ministral-3-3b-instruct-2512-4bit": "ministral-3-3b-instruct-mlx-4bit",
}
DEFAULT_MODEL_ID_BY_TIER: dict[str, str] = {
  "compact": "qwen2.5-0.5b-instruct-mlx-4bit",
  "balanced": "qwen3-vl-4b-instruct-mlx-4bit",
  "performance": "qwen3-vl-4b-instruct-mlx-4bit",
}


def _rebuild_globals(entries: list[ModelCatalogEntry]) -> None:
  global MODEL_CATALOG, MODEL_BY_ID
  MODEL_CATALOG = entries
  MODEL_BY_ID = {e.id: e for e in entries}


def reload_catalog() -> int:
  with _catalog_lock:
    entries = _load_catalog_from_disk()
    _rebuild_globals(entries)
  return len(entries)


# ── HuggingFace discovery ─────────────────────────────────────────────────────

_HF_REPO_ID_RE = re.compile(r"^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.\-]+$")
_SIZE_RE = re.compile(r"(\d+\.?\d*)\s*([bBmM])", re.IGNORECASE)
_QUANT_RE = re.compile(r"(4bit|8bit|fp16|bf16|q4|q8|f16|f32)", re.IGNORECASE)


def _hf_model_id_from_repo(repo_id: str) -> str:
  name = repo_id.split("/")[-1].lower()
  return re.sub(r"[^a-z0-9]+", "-", name).strip("-")

def _guess_size_label(repo_id: str) -> str:
  m = _SIZE_RE.search(repo_id)
  if not m: return ""
  val = float(m.group(1)); unit = m.group(2).upper()
  return f"{val:.0f}M" if unit == "M" else f"{val}B"

def _guess_quant_label(repo_id: str) -> str:
  m = _QUANT_RE.search(repo_id)
  return f"MLX {m.group(1)}" if m else "MLX"

def _guess_memory_bytes(size_label: str) -> int:
  m = re.match(r"([\d.]+)\s*([bBmM])", size_label)
  if not m: return 0
  val = float(m.group(1)); unit = m.group(2).upper()
  params = val * 1_000_000 if unit == "M" else val * 1_000_000_000
  return int(params * 0.65 + 300_000_000)

def _guess_context(repo_id: str) -> int:
  lower = repo_id.lower()
  if "128k" in lower: return 131072
  if "32k" in lower: return 32768
  if "16k" in lower: return 16384
  return 8192

def _guess_tier(size_label: str) -> str:
  m = re.match(r"([\d.]+)\s*([bBmM])", size_label)
  if not m: return "compact"
  val = float(m.group(1)); unit = m.group(2).upper()
  params_b = val / 1000 if unit == "M" else val
  if params_b >= 6: return "performance"
  if params_b >= 2.5: return "balanced"
  return "compact"

def _guess_family(repo_id: str) -> str:
  lower = repo_id.lower()
  for pat, name in [
    ("qwen3-vl", "Qwen3-VL"), ("qwen3", "Qwen3"), ("qwen2.5", "Qwen2.5"), ("qwen", "Qwen"),
    ("mistral", "Mistral"), ("ministral", "Ministral"), ("mixtral", "Mixtral"),
    ("llama-3", "Llama 3"), ("llama", "Llama"), ("gemma", "Gemma"),
    ("phi-3", "Phi-3"), ("phi", "Phi"), ("deepseek", "DeepSeek"),
    ("hermes", "Hermes"), ("smollm", "SmolLM"),
  ]:
    if pat in lower: return name
  return ""


def fetch_catalog_from_hf(*, limit: int = 60, search_queries: list[str] | None = None) -> list[ModelCatalogEntry]:
  try:
    from huggingface_hub import list_models
  except ImportError:
    LOGGER.warning("huggingface_hub не установлен"); return []

  queries = search_queries or [
    "MLX instruct 4bit", "MLX chat tool",
    "mlx-community instruct", "lmstudio-community MLX instruct",
  ]
  existing_repos = {e.repo.lower() for e in MODEL_CATALOG}
  existing_ids = {e.id for e in MODEL_CATALOG}
  discovered: dict[str, ModelCatalogEntry] = {}

  for query in queries:
    try:
      for info in list_models(search=query, limit=limit, sort="downloads"):
        repo_id = str(info.id or "").strip()
        if not repo_id or not _HF_REPO_ID_RE.match(repo_id): continue
        if repo_id.lower() in existing_repos: continue
        lower_repo = repo_id.lower()
        if not _TOOL_CAPABLE_FAMILIES.search(lower_repo): continue
        if not re.search(r"instruct|chat|it\b", lower_repo): continue
        if not re.search(r"4bit|8bit|q4|q8", lower_repo): continue
        model_id = _hf_model_id_from_repo(repo_id)
        if model_id in existing_ids or model_id in discovered: continue
        size_label = _guess_size_label(repo_id)
        family = _guess_family(repo_id)
        short_name = repo_id.split("/")[-1]
        label_parts = [family or short_name.split("-")[0].capitalize()]
        if size_label: label_parts.append(size_label)
        label_parts.append("Instruct")
        supports_vision = bool(_VISION_FAMILIES.search(lower_repo))
        tags = list(info.tags or [])
        description = (
          f"Обнаружена на HuggingFace: {repo_id}. "
          f"{'Vision + ' if supports_vision else ''}Tool-calling. "
          + (f"Теги: {', '.join(tags[:6])}." if tags else "")
        ).strip()
        discovered[model_id] = ModelCatalogEntry(
          id=model_id, label=" ".join(label_parts), repo=repo_id,
          source="huggingface", homepage=f"https://huggingface.co/{repo_id}",
          family=family, size=size_label, quantization=_guess_quant_label(repo_id),
          description=description, supports_tools=True,
          supports_vision=supports_vision, supports_documents=True,
          recommended_tier=_guess_tier(size_label),
          max_context=_guess_context(repo_id),
          estimated_unified_memory_bytes=_guess_memory_bytes(size_label),
        )
    except Exception as exc:
      LOGGER.warning("HF поиск '%s': %s", query, exc)
  return list(discovered.values())


def merge_and_save_catalog(new_entries: list[ModelCatalogEntry]) -> int:
  with _catalog_lock:
    existing_ids = {e.id for e in MODEL_CATALOG}
    to_add = [e for e in new_entries if e.id not in existing_ids]
    merged = list(MODEL_CATALOG) + to_add
    _save_catalog_to_disk(merged)
    _rebuild_globals(merged)
  return len(to_add)


# ── Публичное API ─────────────────────────────────────────────────────────────

def normalize_model_id(value: str | None, fallback: str = "") -> str:
  raw = str(value or "").strip().lower()
  if not raw:
    return fallback
  raw = MODEL_ID_ALIASES.get(raw, raw)
  return raw if raw in MODEL_BY_ID else fallback


def get_model_entry(model_id: str | None) -> ModelCatalogEntry | None:
  key = normalize_model_id(model_id, "")
  return MODEL_BY_ID.get(key) if key else None


def resolve_model_id_for_tier(tier: str, requested_model_id: str | None = None) -> str:
  normalized_tier = normalize_recommended_tier(tier, "compact")
  default_id = DEFAULT_MODEL_ID_BY_TIER.get(normalized_tier, DEFAULT_MODEL_ID_BY_TIER["compact"])
  return normalize_model_id(requested_model_id, "") or default_id


def list_model_catalog_payload() -> list[dict[str, Any]]:
  return [asdict(e) for e in MODEL_CATALOG]
