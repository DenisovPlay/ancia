from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any, Callable


class EngineModelStorage:
  def __init__(
    self,
    *,
    storage: Any,
    model_params_setting_key: str,
    model_tiers: dict[str, Any],
    normalize_model_id_fn: Callable[[str | None, str], str],
    get_model_entry_fn: Callable[[str], Any | None],
    list_model_catalog_payload_fn: Callable[[], list[dict[str, Any]]],
    format_bytes_fn: Callable[[int | None], str],
    get_loaded_model_id_fn: Callable[[], str],
  ) -> None:
    self._storage = storage
    self._model_params_setting_key = model_params_setting_key
    self._model_tiers = model_tiers
    self._normalize_model_id_fn = normalize_model_id_fn
    self._get_model_entry_fn = get_model_entry_fn
    self._list_model_catalog_payload_fn = list_model_catalog_payload_fn
    self._format_bytes_fn = format_bytes_fn
    self._get_loaded_model_id_fn = get_loaded_model_id_fn

  def default_model_params(self, tier_key: str) -> dict[str, Any]:
    tier = self._model_tiers.get(tier_key) or self._model_tiers["compact"]
    return {
      "context_window": int(tier.max_context),
      "max_tokens": 320 if tier.key == "performance" else 256,
      "temperature": float(tier.temperature),
      "top_p": 0.9,
      "top_k": 40,
    }

  def load_model_params_map(self) -> dict[str, Any]:
    payload = self._storage.get_setting_json(self._model_params_setting_key, {})
    if not isinstance(payload, dict):
      return {}
    return payload

  def normalize_model_params_payload(self, params: dict[str, Any], tier_key: str) -> dict[str, Any]:
    defaults = self.default_model_params(tier_key)
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

  def get_model_params(self, model_id: str, *, tier_key: str = "compact") -> dict[str, Any]:
    safe_model_id = self._normalize_model_id_fn(model_id, "")
    if not safe_model_id:
      return self.default_model_params(tier_key)
    params_map = self.load_model_params_map()
    raw_model_params = params_map.get(safe_model_id, {})
    return self.normalize_model_params_payload(raw_model_params, tier_key)

  def set_model_params(self, model_id: str, params: dict[str, Any], *, tier_key: str = "compact") -> dict[str, Any]:
    safe_model_id = self._normalize_model_id_fn(model_id, "")
    if not safe_model_id:
      raise ValueError("Unsupported model id")
    params_map = self.load_model_params_map()
    normalized = self.normalize_model_params_payload(params, tier_key)
    params_map[safe_model_id] = normalized
    self._storage.set_setting_json(self._model_params_setting_key, params_map)
    return normalized

  def resolve_hf_hub_cache_root(self) -> Path:
    hf_home = str(os.getenv("HF_HOME") or "").strip()
    if hf_home:
      return (Path(hf_home).expanduser().resolve() / "hub")
    xdg_home = str(os.getenv("XDG_CACHE_HOME") or "").strip()
    if xdg_home:
      return (Path(xdg_home).expanduser().resolve() / "huggingface" / "hub")
    return (Path.home() / ".cache" / "huggingface" / "hub").resolve()

  @staticmethod
  def repo_to_hf_cache_prefix(repo: str) -> str:
    owner, _, name = str(repo or "").partition("/")
    owner = owner.strip()
    name = name.strip()
    if not owner or not name:
      return ""
    safe_owner = owner.replace("/", "--")
    safe_name = name.replace("/", "--")
    return f"models--{safe_owner}--{safe_name}"

  def resolve_repo_cache_dir(self, repo: str) -> Path | None:
    prefix = self.repo_to_hf_cache_prefix(repo)
    if not prefix:
      return None
    return (self.resolve_hf_hub_cache_root() / prefix).resolve()

  @staticmethod
  def directory_size_bytes(path: Path) -> int:
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
    for model_entry in self._list_model_catalog_payload_fn():
      repo = str(model_entry.get("repo") or "").strip()
      model_id = str(model_entry.get("id") or "").strip()
      cache_dir = self.resolve_repo_cache_dir(repo)
      if not repo or not model_id or cache_dir is None or not cache_dir.exists():
        continue
      snapshots_dir = cache_dir / "snapshots"
      refs_dir = cache_dir / "refs"
      has_snapshots = snapshots_dir.exists() and any(snapshots_dir.iterdir())
      if not has_snapshots:
        continue
      size_bytes = self.directory_size_bytes(cache_dir)
      cache_map[model_id] = {
        "cached": True,
        "repo": repo,
        "cache_dir": str(cache_dir),
        "snapshots_dir": str(snapshots_dir),
        "refs_dir": str(refs_dir),
        "size_bytes": size_bytes,
        "size_human": self._format_bytes_fn(size_bytes),
      }
    return cache_map

  def delete_local_model_cache(self, model_id: str) -> bool:
    safe_model_id = self._normalize_model_id_fn(model_id, "")
    if not safe_model_id:
      raise ValueError("Unsupported model id")
    if safe_model_id == self._get_loaded_model_id_fn():
      raise RuntimeError("Нельзя удалить кэш загруженной модели. Сначала выгрузите модель.")

    entry = self._get_model_entry_fn(safe_model_id)
    if entry is None:
      raise ValueError("Unsupported model id")
    cache_dir = self.resolve_repo_cache_dir(entry.repo)
    if cache_dir is None:
      return False
    hub_root = self.resolve_hf_hub_cache_root()
    if not str(cache_dir).startswith(str(hub_root)):
      raise RuntimeError("Некорректный путь к локальному кэшу модели.")
    if not cache_dir.exists():
      return False
    shutil.rmtree(cache_dir, ignore_errors=False)
    return True
