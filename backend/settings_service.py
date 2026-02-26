from __future__ import annotations

from typing import Any

try:
  from backend.deployment import DEPLOYMENT_MODE_LOCAL, normalize_deployment_mode
except ModuleNotFoundError:
  from deployment import DEPLOYMENT_MODE_LOCAL, normalize_deployment_mode  # type: ignore

RUNTIME_CONFIG_SETTING_KEY = "runtime_config"
ONBOARDING_STATE_SETTING_KEY = "onboarding_state"
AUTONOMOUS_MODE_SETTING_KEY = "autonomous_mode"

DEFAULT_RUNTIME_CONFIG: dict[str, Any] = {
  "mode": "backend",
  "deploymentMode": DEPLOYMENT_MODE_LOCAL,
  "backendUrl": "http://127.0.0.1:5055",
  "apiKey": "",
  "serverAllowRegistration": False,
  "timeoutMs": 12000,
  "modelId": "qwen2.5-0.5b-instruct-mlx-4bit",
  "devicePreset": "auto",
  "modelContextWindow": None,
  "modelMaxTokens": None,
  "modelTemperature": None,
  "modelTopP": None,
  "modelTopK": None,
  "autoReconnect": True,
  "bootMood": "neutral",
  "defaultTransitionMs": 1200,
  "userName": "",
  "userContext": "",
  "userLanguage": "ru",
  "userTimezone": "UTC",
  "uiDensity": "comfortable",
  "uiAnimations": True,
  "uiFontScale": 100,
  "uiFontPreset": "system",
  "uiFontFamily": "",
  "uiShowInspector": True,
  "autonomousMode": False,
  "contextGuardPluginEnabled": True,
  "contextGuardAutoCompress": True,
  "contextGuardShowChatEvents": True,
  "modelAutoFallbackEnabled": True,
  "modelAutoFallbackProfile": "balanced",
}

DEFAULT_ONBOARDING_STATE: dict[str, Any] = {
  "version": 4,
  "completed": False,
  "skipped": False,
  "completedAt": "",
  "data": {},
}


class SettingsService:
  def __init__(self, *, storage: Any, model_engine: Any) -> None:
    self._storage = storage
    self._model_engine = model_engine

  def sanitize_runtime_config(self, payload: Any) -> dict[str, Any]:
    result = dict(DEFAULT_RUNTIME_CONFIG)
    if isinstance(payload, dict):
      for key in DEFAULT_RUNTIME_CONFIG.keys():
        if key in payload:
          result[key] = payload[key]
    result["mode"] = "backend" if str(result.get("mode") or "").strip().lower() == "backend" else "mock"
    result["deploymentMode"] = normalize_deployment_mode(
      result.get("deploymentMode"),
      DEPLOYMENT_MODE_LOCAL,
    )
    result["autonomousMode"] = bool(result.get("autonomousMode", False))
    result["serverAllowRegistration"] = bool(result.get("serverAllowRegistration", False))
    result["contextGuardPluginEnabled"] = bool(result.get("contextGuardPluginEnabled", True))
    result["contextGuardAutoCompress"] = bool(result.get("contextGuardAutoCompress", True))
    result["contextGuardShowChatEvents"] = bool(result.get("contextGuardShowChatEvents", True))
    result["modelAutoFallbackEnabled"] = bool(result.get("modelAutoFallbackEnabled", True))
    profile = str(result.get("modelAutoFallbackProfile") or "balanced").strip().lower()
    if profile not in {"conservative", "balanced", "aggressive"}:
      profile = "balanced"
    result["modelAutoFallbackProfile"] = profile
    return result

  def sanitize_onboarding_state(self, payload: Any) -> dict[str, Any]:
    result = dict(DEFAULT_ONBOARDING_STATE)
    if isinstance(payload, dict):
      if "version" in payload:
        try:
          result["version"] = max(1, int(payload.get("version") or DEFAULT_ONBOARDING_STATE["version"]))
        except (TypeError, ValueError):
          result["version"] = DEFAULT_ONBOARDING_STATE["version"]
      if "completed" in payload:
        result["completed"] = bool(payload.get("completed"))
      if "skipped" in payload:
        result["skipped"] = bool(payload.get("skipped"))
      if "completedAt" in payload:
        result["completedAt"] = str(payload.get("completedAt") or "")
      if "data" in payload and isinstance(payload.get("data"), dict):
        result["data"] = payload.get("data") or {}
    return result

  def get_autonomous_mode(self) -> bool:
    runtime_config = self.sanitize_runtime_config(self._storage.get_setting_json(RUNTIME_CONFIG_SETTING_KEY, {}))
    autonomous_from_runtime = bool(runtime_config.get("autonomousMode", False))
    autonomous_from_flag = self._storage.get_setting_flag(AUTONOMOUS_MODE_SETTING_KEY, autonomous_from_runtime)
    return bool(autonomous_from_flag)

  def get_settings_payload(self) -> dict[str, Any]:
    runtime_config = self.sanitize_runtime_config(self._storage.get_setting_json(RUNTIME_CONFIG_SETTING_KEY, {}))
    onboarding_state = self.sanitize_onboarding_state(self._storage.get_setting_json(ONBOARDING_STATE_SETTING_KEY, {}))
    autonomous_mode = self.get_autonomous_mode()
    runtime_config["autonomousMode"] = autonomous_mode

    engine_model_id = self._model_engine.get_selected_model_id()
    if engine_model_id:
      runtime_config["modelId"] = engine_model_id

    return {
      "runtime_config": runtime_config,
      "onboarding_state": onboarding_state,
      "autonomous_mode": autonomous_mode,
    }

  def persist_settings_payload(
    self,
    *,
    runtime_config: dict[str, Any] | None = None,
    onboarding_state: dict[str, Any] | None = None,
    autonomous_mode: bool | None = None,
  ) -> dict[str, Any]:
    current = self.get_settings_payload()
    next_runtime = self.sanitize_runtime_config(runtime_config if runtime_config is not None else current["runtime_config"])
    next_onboarding = self.sanitize_onboarding_state(onboarding_state if onboarding_state is not None else current["onboarding_state"])
    next_autonomous = bool(next_runtime.get("autonomousMode", False) if autonomous_mode is None else autonomous_mode)
    next_runtime["autonomousMode"] = next_autonomous

    engine_model_id = self._model_engine.get_selected_model_id()
    if engine_model_id:
      next_runtime["modelId"] = engine_model_id

    self._storage.set_setting_json(RUNTIME_CONFIG_SETTING_KEY, next_runtime)
    self._storage.set_setting_json(ONBOARDING_STATE_SETTING_KEY, next_onboarding)
    self._storage.set_setting_flag(AUTONOMOUS_MODE_SETTING_KEY, next_autonomous)

    return {
      "runtime_config": next_runtime,
      "onboarding_state": next_onboarding,
      "autonomous_mode": next_autonomous,
    }
