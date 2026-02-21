from __future__ import annotations

from typing import Any

try:
  from backend.tool_catalog import build_preinstalled_plugin_manifests
except ModuleNotFoundError:
  from tool_catalog import build_preinstalled_plugin_manifests  # type: ignore


PREINSTALLED_PLUGIN_MANIFESTS: list[dict[str, Any]] = build_preinstalled_plugin_manifests()

