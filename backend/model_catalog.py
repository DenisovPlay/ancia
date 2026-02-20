from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


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


MODEL_CATALOG: list[ModelCatalogEntry] = [
  ModelCatalogEntry(
    id="qwen2.5-0.5b-instruct-mlx-4bit",
    label="Qwen2.5 0.5B Instruct",
    repo="lmstudio-community/Qwen2.5-0.5B-Instruct-MLX-4bit",
    source="huggingface",
    homepage="https://huggingface.co/lmstudio-community/Qwen2.5-0.5B-Instruct-MLX-4bit",
    family="Qwen2.5",
    size="0.5B",
    quantization="MLX 4bit",
    description="Быстрая lightweight-модель для простых чатов и tool-calling.",
    supports_tools=True,
    supports_vision=False,
    supports_documents=True,
    recommended_tier="lite",
    max_context=3072,
    estimated_unified_memory_bytes=2_000_000_000,
  ),
  ModelCatalogEntry(
    id="qwen2.5-1.5b-instruct-mlx-4bit",
    label="Qwen2.5 1.5B Instruct",
    repo="lmstudio-community/Qwen2.5-1.5B-Instruct-MLX-4bit",
    source="huggingface",
    homepage="https://huggingface.co/lmstudio-community/Qwen2.5-1.5B-Instruct-MLX-4bit",
    family="Qwen2.5",
    size="1.5B",
    quantization="MLX 4bit",
    description="Сбалансированная модель с лучшим качеством reasoning и инструментов.",
    supports_tools=True,
    supports_vision=False,
    supports_documents=True,
    recommended_tier="lite",
    max_context=4096,
    estimated_unified_memory_bytes=3_200_000_000,
  ),
  ModelCatalogEntry(
    id="qwen2.5-3b-instruct-mlx-4bit",
    label="Qwen2.5 3B Instruct",
    repo="lmstudio-community/Qwen2.5-3B-Instruct-MLX-4bit",
    source="huggingface",
    homepage="https://huggingface.co/lmstudio-community/Qwen2.5-3B-Instruct-MLX-4bit",
    family="Qwen2.5",
    size="3B",
    quantization="MLX 4bit",
    description="Улучшенное качество ответов и tool-calling для повседневной работы.",
    supports_tools=True,
    supports_vision=False,
    supports_documents=True,
    recommended_tier="standart",
    max_context=4096,
    estimated_unified_memory_bytes=5_200_000_000,
  ),
  ModelCatalogEntry(
    id="qwen2.5-7b-instruct-mlx-4bit",
    label="Qwen2.5 7B Instruct",
    repo="lmstudio-community/Qwen2.5-7B-Instruct-MLX-4bit",
    source="huggingface",
    homepage="https://huggingface.co/lmstudio-community/Qwen2.5-7B-Instruct-MLX-4bit",
    family="Qwen2.5",
    size="7B",
    quantization="MLX 4bit",
    description="Более сильная text-модель для сложных задач и агентных сценариев.",
    supports_tools=True,
    supports_vision=False,
    supports_documents=True,
    recommended_tier="plus",
    max_context=8192,
    estimated_unified_memory_bytes=9_500_000_000,
  ),
  ModelCatalogEntry(
    id="qwen3-vl-4b-instruct-mlx-4bit",
    label="Qwen3-VL 4B Instruct",
    repo="lmstudio-community/Qwen3-VL-4B-Instruct-MLX-4bit",
    source="lmstudio",
    homepage="https://lmstudio.ai/models/qwen/qwen3-vl-4b",
    family="Qwen3-VL",
    size="4B",
    quantization="MLX 4bit",
    description="Vision+Language модель с поддержкой tool-calling (предустановлена).",
    supports_tools=True,
    supports_vision=True,
    supports_documents=True,
    recommended_tier="standart",
    max_context=8192,
    estimated_unified_memory_bytes=6_500_000_000,
  ),
]

MODEL_BY_ID: dict[str, ModelCatalogEntry] = {entry.id: entry for entry in MODEL_CATALOG}
MODEL_ID_ALIASES: dict[str, str] = {
  "qwen2.5-0.5b": "qwen2.5-0.5b-instruct-mlx-4bit",
  "qwen2.5-1.5b": "qwen2.5-1.5b-instruct-mlx-4bit",
  "qwen2.5-3b": "qwen2.5-3b-instruct-mlx-4bit",
  "qwen2.5-7b": "qwen2.5-7b-instruct-mlx-4bit",
  "qwen3-vl-4b": "qwen3-vl-4b-instruct-mlx-4bit",
}
DEFAULT_MODEL_ID_BY_TIER: dict[str, str] = {
  "lite": "qwen2.5-0.5b-instruct-mlx-4bit",
  "standart": "qwen3-vl-4b-instruct-mlx-4bit",
  "plus": "qwen3-vl-4b-instruct-mlx-4bit",
}


def normalize_model_id(value: str | None, fallback: str = "") -> str:
  raw = str(value or "").strip().lower()
  if not raw:
    return fallback
  raw = MODEL_ID_ALIASES.get(raw, raw)
  if raw in MODEL_BY_ID:
    return raw
  return fallback


def get_model_entry(model_id: str | None) -> ModelCatalogEntry | None:
  key = normalize_model_id(model_id, "")
  if not key:
    return None
  return MODEL_BY_ID.get(key)


def resolve_model_id_for_tier(tier: str, requested_model_id: str | None = None) -> str:
  default_model_id = DEFAULT_MODEL_ID_BY_TIER.get(str(tier or "").strip().lower(), DEFAULT_MODEL_ID_BY_TIER["lite"])
  normalized_requested = normalize_model_id(requested_model_id, "")
  return normalized_requested or default_model_id


def list_model_catalog_payload() -> list[dict[str, Any]]:
  return [asdict(entry) for entry in MODEL_CATALOG]
