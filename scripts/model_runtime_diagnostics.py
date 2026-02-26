#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from scripts.asgi_client import create_app_client


def _bool_flag(value: bool) -> str:
  return "yes" if value else "no"


def _print_section(title: str) -> None:
  print(f"\n=== {title} ===")


def _extract_selected_model_id(models_payload: dict) -> str:
  selected = str(models_payload.get("selected_model") or "").strip().lower()
  if selected:
    return selected
  models = models_payload.get("models")
  if not isinstance(models, list):
    return ""
  for item in models:
    if isinstance(item, dict) and bool(item.get("selected")):
      model_id = str(item.get("id") or "").strip().lower()
      if model_id:
        return model_id
  return ""


def _summarize_failure_payload(payload: dict) -> dict:
  if not isinstance(payload, dict):
    return {"error": "invalid payload"}
  startup = payload.get("startup") if isinstance(payload.get("startup"), dict) else {}
  runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
  runtime_profile = runtime.get("runtime_profile") if isinstance(runtime.get("runtime_profile"), dict) else {}
  probe = runtime_profile.get("mlx_runtime_probe") if isinstance(runtime_profile.get("mlx_runtime_probe"), dict) else {}
  summary = {
    "startup_status": startup.get("status"),
    "startup_stage": startup.get("stage"),
    "startup_message": startup.get("message"),
    "runtime_backend_kind": runtime.get("runtime_backend_kind"),
    "selected_model_id": runtime.get("selected_model_id"),
    "loaded_model_id": runtime.get("loaded_model_id"),
    "mlx_probe_ok": probe.get("ok"),
    "mlx_probe_reason": probe.get("reason"),
    "mlx_probe_exit_code": probe.get("exit_code"),
  }
  stderr_preview = str(probe.get("stderr_preview") or "").strip()
  if stderr_preview:
    summary["mlx_probe_stderr_preview"] = stderr_preview
  return summary


def _poll_until_ready(client, timeout_sec: float) -> tuple[bool, dict]:
  started = time.perf_counter()
  while (time.perf_counter() - started) <= max(1.0, timeout_sec):
    health = client.get("/health")
    if health.status_code != 200:
      return False, {"error": f"/health -> HTTP {health.status_code}"}
    payload = health.json() if isinstance(health.json(), dict) else {}
    startup = payload.get("startup") if isinstance(payload.get("startup"), dict) else {}
    status = str(startup.get("status") or "").strip().lower()
    if status == "ready":
      return True, payload
    if status == "error":
      return False, payload
    time.sleep(0.35)
  return False, {"error": f"timeout after {timeout_sec:.1f}s"}


def main() -> int:
  parser = argparse.ArgumentParser(description="Ancia model runtime diagnostics")
  parser.add_argument("--load", action="store_true", help="Try to load selected model")
  parser.add_argument("--chat", action="store_true", help="Run one chat request (requires --load and ready model)")
  parser.add_argument("--timeout", type=float, default=120.0, help="Timeout for --load wait (seconds)")
  args = parser.parse_args()

  temp_root = Path(tempfile.mkdtemp(prefix="ancia-model-diag-")).resolve()
  data_dir = (temp_root / "data").resolve()
  plugins_dir = (temp_root / "plugins").resolve()
  data_dir.mkdir(parents=True, exist_ok=True)
  plugins_dir.mkdir(parents=True, exist_ok=True)

  original_env = {
    "ANCIA_BACKEND_DATA_DIR": os.environ.get("ANCIA_BACKEND_DATA_DIR"),
    "ANCIA_PLUGINS_DIR": os.environ.get("ANCIA_PLUGINS_DIR"),
    "ANCIA_ENABLE_MODEL_EAGER_LOAD": os.environ.get("ANCIA_ENABLE_MODEL_EAGER_LOAD"),
  }
  if not args.load:
    original_env["ANCIA_DISABLE_MLX_RUNTIME"] = os.environ.get("ANCIA_DISABLE_MLX_RUNTIME")

  try:
    os.environ["ANCIA_BACKEND_DATA_DIR"] = str(data_dir)
    os.environ["ANCIA_PLUGINS_DIR"] = str(plugins_dir)
    os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"
    if not args.load:
      os.environ["ANCIA_DISABLE_MLX_RUNTIME"] = "1"
    elif "ANCIA_DISABLE_MLX_RUNTIME" in os.environ:
      del os.environ["ANCIA_DISABLE_MLX_RUNTIME"]

    from backend.main import make_app

    app = make_app()
    with create_app_client(app) as client:
      health = client.get("/health")
      if health.status_code != 200:
        print(f"[FAIL] GET /health -> {health.status_code}")
        return 1
      health_payload = health.json() if isinstance(health.json(), dict) else {}

      models_response = client.get("/models")
      if models_response.status_code != 200:
        print(f"[FAIL] GET /models -> {models_response.status_code}")
        return 1
      models_payload = models_response.json() if isinstance(models_response.json(), dict) else {}

      diagnostics_response = client.get("/models/runtime-diagnostics")
      if diagnostics_response.status_code != 200:
        print(f"[FAIL] GET /models/runtime-diagnostics -> {diagnostics_response.status_code}")
        return 1
      runtime_diag = diagnostics_response.json() if isinstance(diagnostics_response.json(), dict) else {}

      _print_section("Runtime")
      profile = runtime_diag.get("runtime_profile") if isinstance(runtime_diag.get("runtime_profile"), dict) else {}
      tuning = runtime_diag.get("runtime_tuning") if isinstance(runtime_diag.get("runtime_tuning"), dict) else {}
      print(f"system: {profile.get('system')} {profile.get('machine')}")
      print(f"python: {profile.get('python')}")
      print(f"supports_mlx: {_bool_flag(bool(profile.get('supports_mlx')))}")
      probe = profile.get("mlx_runtime_probe") if isinstance(profile.get("mlx_runtime_probe"), dict) else {}
      if probe:
        print(f"mlx_probe_ok: {_bool_flag(bool(probe.get('ok')))} | reason: {probe.get('reason')}")
      print(f"perf_mode: {profile.get('perf_mode')} | thread_budget: {profile.get('thread_budget')}")
      effective_env = tuning.get("effective_env") if isinstance(tuning.get("effective_env"), dict) else {}
      print(f"effective_env_keys: {sorted(effective_env.keys())}")

      _print_section("Model")
      selected_model_id = _extract_selected_model_id(models_payload)
      loaded_model = str(models_payload.get("loaded_model") or "").strip().lower()
      print(f"selected_model: {selected_model_id or '-'}")
      print(f"loaded_model: {loaded_model or '-'}")
      print(f"runtime_backend: {runtime_diag.get('runtime_backend_kind')}")
      print(f"streaming_runtime_available: {_bool_flag(bool(runtime_diag.get('streaming_runtime_available')))}")
      print(f"vision_runtime_available: {_bool_flag(bool(runtime_diag.get('vision_runtime_available')))}")
      recommended = str(runtime_diag.get("recommended_model_id_for_memory") or "").strip().lower()
      if recommended:
        print(f"recommended_model_for_memory: {recommended}")

      startup = health_payload.get("startup") if isinstance(health_payload.get("startup"), dict) else {}
      print(f"startup_status: {startup.get('status')} | stage: {startup.get('stage')}")
      if startup.get("status") == "error":
        print(f"startup_error: {startup.get('message')}")

      if not args.load:
        print("\n[OK] diagnostics complete (without model loading)")
        return 0

      _print_section("Load test")
      if not selected_model_id:
        print("[FAIL] selected model id is empty")
        return 1

      load_start = time.perf_counter()
      load_response = client.post("/models/load", json={"model_id": selected_model_id})
      print(f"/models/load -> HTTP {load_response.status_code}")
      ready, ready_payload = _poll_until_ready(client, timeout_sec=args.timeout)
      load_elapsed_ms = int((time.perf_counter() - load_start) * 1000)
      print(f"load_wait_ms: {load_elapsed_ms}")
      if not ready:
        print("[FAIL] model is not ready")
        print(json.dumps(_summarize_failure_payload(ready_payload), ensure_ascii=False, indent=2))
        return 1
      final_startup = ready_payload.get("startup") if isinstance(ready_payload.get("startup"), dict) else {}
      print(f"ready_status: {final_startup.get('status')} | stage: {final_startup.get('stage')}")

      if args.chat:
        _print_section("Chat test")
        chat_start = time.perf_counter()
        chat_response = client.post(
          "/chat",
          json={
            "message": "Короткий self-test. Ответь только 'ok'.",
            "context": {"chat_id": "diag-chat"},
          },
        )
        chat_elapsed_ms = int((time.perf_counter() - chat_start) * 1000)
        print(f"/chat -> HTTP {chat_response.status_code} | latency_ms: {chat_elapsed_ms}")
        if chat_response.status_code == 200 and isinstance(chat_response.json(), dict):
          payload = chat_response.json()
          print(f"reply_preview: {str(payload.get('reply') or '')[:120]}")
        else:
          print(f"chat_error: {chat_response.text[:400]}")

      print("\n[OK] diagnostics complete")
      return 0
  finally:
    for key, value in original_env.items():
      if value is None:
        os.environ.pop(key, None)
      else:
        os.environ[key] = value
    shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
  raise SystemExit(main())
