from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI

try:
  from backend.common import utc_now_iso
except ModuleNotFoundError:
  from common import utc_now_iso  # type: ignore


def register_settings_routes(
  app: FastAPI,
  *,
  storage: Any,
  model_engine: Any,
  plugin_manager: Any,
  user_plugins_dir: Path,
  get_settings_payload: Callable[[], dict[str, Any]],
  persist_settings_payload: Callable[..., dict[str, Any]],
  list_plugins_payload: Callable[[], dict[str, Any]],
  default_runtime_config: dict[str, Any],
  default_onboarding_state: dict[str, Any],
  refresh_tool_registry_fn: Callable[[], None] | None = None,
) -> None:
  @app.get("/settings")
  def get_settings() -> dict[str, Any]:
    return get_settings_payload()

  @app.patch("/settings")
  def patch_settings(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    current = get_settings_payload()
    runtime_input = body.get("runtime_config")
    if runtime_input is None and isinstance(body.get("runtimeConfig"), dict):
      runtime_input = body.get("runtimeConfig")
    runtime_config = dict(current["runtime_config"])
    if isinstance(runtime_input, dict):
      runtime_config.update(runtime_input)

    onboarding_input = body.get("onboarding_state")
    if onboarding_input is None and isinstance(body.get("onboardingState"), dict):
      onboarding_input = body.get("onboardingState")
    onboarding_state = current["onboarding_state"]
    if isinstance(onboarding_input, dict):
      onboarding_state = onboarding_input

    autonomous_mode: bool | None = None
    if "autonomous_mode" in body:
      autonomous_mode = bool(body.get("autonomous_mode"))
    elif "autonomousMode" in body:
      autonomous_mode = bool(body.get("autonomousMode"))
    elif isinstance(runtime_input, dict) and "autonomousMode" in runtime_input:
      autonomous_mode = bool(runtime_input.get("autonomousMode"))

    return persist_settings_payload(
      runtime_config=runtime_config,
      onboarding_state=onboarding_state,
      autonomous_mode=autonomous_mode,
    )

  @app.get("/app/state")
  def app_state() -> dict[str, Any]:
    startup = model_engine.get_startup_snapshot()
    startup_state = str(startup.get("status") or "").strip().lower()
    return {
      "status": "ok" if startup_state == "ready" else ("degraded" if startup_state == "error" else "starting"),
      "time": utc_now_iso(),
      "settings": get_settings_payload(),
      "startup": startup,
      "runtime": model_engine.get_runtime_snapshot() if hasattr(model_engine, "get_runtime_snapshot") else {"startup": startup},
      "plugins": list_plugins_payload(),
      "store": storage.list_chat_store(),
    }

  @app.post("/app/reset")
  def app_reset(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    reset_onboarding = bool(body.get("reset_onboarding", True))
    previous_settings = get_settings_payload()
    model_engine.request_stop_generation()
    storage.reset_all()
    removed_plugin_files = 0
    for file_path in sorted(user_plugins_dir.glob("*.json")):
      if not file_path.is_file():
        continue
      try:
        file_path.unlink()
        removed_plugin_files += 1
      except OSError:
        continue
    for dir_path in sorted(user_plugins_dir.iterdir()):
      if not dir_path.is_dir():
        continue
      try:
        shutil.rmtree(dir_path)
        removed_plugin_files += 1
      except OSError:
        continue
    defaults = persist_settings_payload(
      runtime_config=default_runtime_config,
      onboarding_state=default_onboarding_state if reset_onboarding else previous_settings["onboarding_state"],
      autonomous_mode=False,
    )
    if callable(refresh_tool_registry_fn):
      refresh_tool_registry_fn()
    else:
      plugin_manager.reload()
    return {
      "ok": True,
      "message": "Локальные данные приложения сброшены.",
      "settings": defaults,
      "store": storage.list_chat_store(),
      "plugins": list_plugins_payload(),
      "removed_plugin_files": removed_plugin_files,
    }
