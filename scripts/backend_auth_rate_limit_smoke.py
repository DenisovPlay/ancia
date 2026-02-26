#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from scripts.asgi_client import create_app_client


def _retry_after(response) -> int:
  raw = str(response.headers.get("Retry-After") or "").strip()
  try:
    value = int(raw)
  except ValueError:
    return 0
  return max(0, value)


def main() -> int:
  failed = False
  temp_dir = Path(tempfile.mkdtemp(prefix="ancia-auth-rate-limit-smoke-")).resolve()
  data_dir = (temp_dir / "data").resolve()
  plugins_dir = (temp_dir / "plugins").resolve()
  data_dir.mkdir(parents=True, exist_ok=True)
  plugins_dir.mkdir(parents=True, exist_ok=True)

  managed_env_keys = (
    "ANCIA_DEPLOYMENT_MODE",
    "ANCIA_BACKEND_DATA_DIR",
    "ANCIA_PLUGINS_DIR",
    "ANCIA_ENABLE_MODEL_EAGER_LOAD",
    "ANCIA_DISABLE_MLX_RUNTIME",
    "HF_HUB_OFFLINE",
    "ANCIA_AUTH_LOGIN_WINDOW_SECONDS",
    "ANCIA_AUTH_LOGIN_MAX_ATTEMPTS",
    "ANCIA_AUTH_LOGIN_BLOCK_SECONDS",
  )
  original_env = {key: os.environ.get(key) for key in managed_env_keys}

  try:
    os.environ["ANCIA_DEPLOYMENT_MODE"] = "remote_server"
    os.environ["ANCIA_BACKEND_DATA_DIR"] = str(data_dir)
    os.environ["ANCIA_PLUGINS_DIR"] = str(plugins_dir)
    os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"
    os.environ["ANCIA_DISABLE_MLX_RUNTIME"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["ANCIA_AUTH_LOGIN_WINDOW_SECONDS"] = "120"
    os.environ["ANCIA_AUTH_LOGIN_MAX_ATTEMPTS"] = "2"
    os.environ["ANCIA_AUTH_LOGIN_BLOCK_SECONDS"] = "120"

    from backend.main import make_app

    app_before_restart = make_app()
    with create_app_client(app_before_restart) as client:
      bootstrap = client.post(
        "/auth/bootstrap",
        json={"username": "admin", "password": "Password123", "remember": True},
      )
      if bootstrap.status_code != 200:
        print(f"[FAIL] POST /auth/bootstrap -> {bootstrap.status_code}")
        return 1
      print("[OK] POST /auth/bootstrap -> 200")

      for attempt in range(1, 3):
        response = client.post(
          "/auth/login",
          json={"username": "admin", "password": "wrong-password", "remember": False},
        )
        if response.status_code != 401:
          print(f"[FAIL] POST /auth/login wrong password attempt={attempt} -> {response.status_code}")
          failed = True
        else:
          print(f"[OK] POST /auth/login wrong password attempt={attempt} -> 401")

    app_after_restart = make_app()
    with create_app_client(app_after_restart) as client:
      blocked = client.post(
        "/auth/login",
        json={"username": "admin", "password": "wrong-password", "remember": False},
      )
      if blocked.status_code != 429:
        print(f"[FAIL] POST /auth/login after restart expected 429 -> {blocked.status_code}")
        failed = True
      else:
        retry_after = _retry_after(blocked)
        if retry_after <= 0:
          print("[FAIL] /auth/login 429 missing Retry-After header")
          failed = True
        else:
          print(f"[OK] auth limiter persisted across restart, Retry-After={retry_after}")

    if failed:
      print("AUTH RATE LIMIT SMOKE RESULT: FAILED")
      return 1
    print("AUTH RATE LIMIT SMOKE RESULT: OK")
    return 0
  finally:
    for key, value in original_env.items():
      if value is None:
        os.environ.pop(key, None)
      else:
        os.environ[key] = value
    shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
  raise SystemExit(main())
