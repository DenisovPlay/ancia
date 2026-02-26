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


def _auth_headers(token: str) -> dict[str, str]:
  return {"Authorization": f"Bearer {token}"}


def _parse_retry_after(value: str) -> int:
  raw = str(value or "").strip()
  try:
    parsed = int(raw)
  except ValueError:
    return 0
  return max(0, parsed)


def main() -> int:
  failed = False
  temp_dir = Path(tempfile.mkdtemp(prefix="ancia-rate-limit-smoke-")).resolve()
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
    "ANCIA_RATE_LIMIT_WINDOW_SECONDS",
    "ANCIA_RATE_LIMIT_PLUGINS_INSTALL_PER_WINDOW",
  )
  original_env = {key: os.environ.get(key) for key in managed_env_keys}

  try:
    os.environ["ANCIA_DEPLOYMENT_MODE"] = "remote_server"
    os.environ["ANCIA_BACKEND_DATA_DIR"] = str(data_dir)
    os.environ["ANCIA_PLUGINS_DIR"] = str(plugins_dir)
    os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"
    os.environ["ANCIA_DISABLE_MLX_RUNTIME"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["ANCIA_RATE_LIMIT_WINDOW_SECONDS"] = "120"
    os.environ["ANCIA_RATE_LIMIT_PLUGINS_INSTALL_PER_WINDOW"] = "2"

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

      admin_token = str((bootstrap.json() or {}).get("token") or "").strip()
      if not admin_token:
        print("[FAIL] /auth/bootstrap returned empty token")
        return 1
      admin_headers = _auth_headers(admin_token)

      first_responses = []
      for attempt in range(1, 3):
        response = client.post("/plugins/install", json={}, headers=admin_headers)
        first_responses.append(response)
        print(f"[INFO] POST /plugins/install attempt={attempt} -> {response.status_code}")

      first_statuses = [int(resp.status_code) for resp in first_responses]
      if any(status == 429 for status in first_statuses) or len(first_statuses) != 2:
        print(f"[FAIL] first phase rate limit status mismatch: {first_statuses}")
        failed = True
      else:
        print(f"[OK] first phase attempts allowed by limiter: {first_statuses}")

    app_after_restart = make_app()
    with create_app_client(app_after_restart) as client:
      login = client.post(
        "/auth/login",
        json={"username": "admin", "password": "Password123", "remember": True},
      )
      if login.status_code != 200:
        print(f"[FAIL] POST /auth/login after restart -> {login.status_code}")
        failed = True
      else:
        print("[OK] POST /auth/login after restart -> 200")
      admin_token = str((login.json() or {}).get("token") or "").strip()
      if not admin_token:
        print("[FAIL] /auth/login after restart returned empty token")
        failed = True
      else:
        admin_headers = _auth_headers(admin_token)
        final_response = client.post("/plugins/install", json={}, headers=admin_headers)
        print(f"[INFO] POST /plugins/install attempt=3(after restart) -> {final_response.status_code}")
        if final_response.status_code != 429:
          print(f"[FAIL] third attempt after restart expected 429, got {final_response.status_code}")
          failed = True
        else:
          retry_after = _parse_retry_after(str(final_response.headers.get("Retry-After") or "0"))
          if retry_after <= 0:
            print("[FAIL] 429 response missing positive Retry-After header")
            failed = True
          else:
            print(f"[OK] limiter persisted across restart, Retry-After={retry_after}")

    if failed:
      print("RATE LIMIT SMOKE RESULT: FAILED")
      return 1
    print("RATE LIMIT SMOKE RESULT: OK")
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
