#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

# Для smoke-проверки ACL не грузим модель на старте.
os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from fastapi.testclient import TestClient


def _auth_headers(token: str) -> dict[str, str]:
  return {"Authorization": f"Bearer {token}"}


def _is_forbidden(response) -> bool:
  return int(response.status_code) == 403


def _is_not_forbidden(response) -> bool:
  return int(response.status_code) != 403


def _choose_uncached_model_id(models_payload: dict) -> str:
  if not isinstance(models_payload, dict):
    return ""
  models = models_payload.get("models")
  if not isinstance(models, list):
    return ""
  for item in models:
    if not isinstance(item, dict):
      continue
    model_id = str(item.get("id") or "").strip().lower()
    if not model_id:
      continue
    cache = item.get("cache") if isinstance(item.get("cache"), dict) else {}
    cached = bool(cache.get("cached"))
    loading = bool(item.get("loading"))
    loaded = bool(item.get("loaded"))
    if not cached and not loading and not loaded:
      return model_id
  return ""


def main() -> int:
  failed = False
  temp_dir = Path(tempfile.mkdtemp(prefix="ancia-acl-smoke-")).resolve()
  data_dir = (temp_dir / "data").resolve()
  plugins_dir = (temp_dir / "plugins").resolve()
  data_dir.mkdir(parents=True, exist_ok=True)
  plugins_dir.mkdir(parents=True, exist_ok=True)

  original_env = {
    "ANCIA_DEPLOYMENT_MODE": os.environ.get("ANCIA_DEPLOYMENT_MODE"),
    "ANCIA_BACKEND_DATA_DIR": os.environ.get("ANCIA_BACKEND_DATA_DIR"),
    "ANCIA_PLUGINS_DIR": os.environ.get("ANCIA_PLUGINS_DIR"),
    "ANCIA_ENABLE_MODEL_EAGER_LOAD": os.environ.get("ANCIA_ENABLE_MODEL_EAGER_LOAD"),
    "HF_HUB_OFFLINE": os.environ.get("HF_HUB_OFFLINE"),
  }

  try:
    os.environ["ANCIA_DEPLOYMENT_MODE"] = "remote_server"
    os.environ["ANCIA_BACKEND_DATA_DIR"] = str(data_dir)
    os.environ["ANCIA_PLUGINS_DIR"] = str(plugins_dir)
    os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"
    os.environ["HF_HUB_OFFLINE"] = "1"

    from backend.main import make_app

    app = make_app()
    client = TestClient(app)

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
      print("[FAIL] bootstrap token is empty")
      return 1
    admin_headers = _auth_headers(admin_token)

    create_users_payload = [
      {
        "username": "limited",
        "password": "Password123",
        "role": "user",
        "permissions": {
          "models_download": False,
          "models": False,
          "plugins_download": False,
          "plugins": False,
        },
      },
      {
        "username": "plugins_only",
        "password": "Password123",
        "role": "user",
        "permissions": {
          "models_download": False,
          "models": False,
          "plugins_download": True,
          "plugins": True,
        },
      },
      {
        "username": "models_only",
        "password": "Password123",
        "role": "user",
        "permissions": {
          "models_download": True,
          "models": True,
          "plugins_download": False,
          "plugins": False,
        },
      },
    ]

    for payload in create_users_payload:
      response = client.post("/admin/users", json=payload, headers=admin_headers)
      if response.status_code != 200:
        print(f"[FAIL] POST /admin/users ({payload['username']}) -> {response.status_code}")
        failed = True
      else:
        print(f"[OK] POST /admin/users ({payload['username']}) -> 200")

    if failed:
      return 1

    tokens: dict[str, str] = {}
    for username in ("limited", "plugins_only", "models_only"):
      login = client.post(
        "/auth/login",
        json={"username": username, "password": "Password123", "remember": True},
      )
      if login.status_code != 200:
        print(f"[FAIL] POST /auth/login ({username}) -> {login.status_code}")
        failed = True
        continue
      token = str((login.json() or {}).get("token") or "").strip()
      if not token:
        print(f"[FAIL] /auth/login ({username}) returned empty token")
        failed = True
        continue
      tokens[username] = token
      print(f"[OK] POST /auth/login ({username}) -> 200")

    if failed:
      return 1

    limited_headers = _auth_headers(tokens["limited"])
    plugins_only_headers = _auth_headers(tokens["plugins_only"])
    models_only_headers = _auth_headers(tokens["models_only"])
    uncached_model_id = ""
    models_snapshot = client.get("/models", headers=admin_headers)
    if models_snapshot.status_code == 200:
      payload = models_snapshot.json() if isinstance(models_snapshot.json(), dict) else {}
      uncached_model_id = _choose_uncached_model_id(payload)
    if uncached_model_id:
      print(f"[OK] selected uncached model for ACL checks: {uncached_model_id}")
    else:
      print("[OK] uncached model not found, model-download deny checks are skipped")

    # No permissions user must be denied for model/plugin downloading actions.
    if uncached_model_id:
      limited_select_uncached = client.post(
        "/models/select",
        json={"model_id": uncached_model_id, "load": False},
        headers=limited_headers,
      )
      if limited_select_uncached.status_code != 200:
        print(f"[FAIL] limited POST /models/select(load=false) -> {limited_select_uncached.status_code}")
        failed = True
      else:
        print("[OK] limited POST /models/select(load=false) -> 200")

      limited_models_load = client.post(
        "/models/load",
        json={"model_id": uncached_model_id},
        headers=limited_headers,
      )
      if not _is_forbidden(limited_models_load):
        print(f"[FAIL] limited POST /models/load -> {limited_models_load.status_code}")
        failed = True
      else:
        print("[OK] limited POST /models/load -> 403")

      limited_models_select_load = client.post(
        "/models/select",
        json={"model_id": uncached_model_id, "load": True},
        headers=limited_headers,
      )
      if not _is_forbidden(limited_models_select_load):
        print(f"[FAIL] limited POST /models/select(load=true) -> {limited_models_select_load.status_code}")
        failed = True
      else:
        print("[OK] limited POST /models/select(load=true) -> 403")

    limited_models_catalog = client.post("/models/catalog/refresh", json={}, headers=limited_headers)
    if not _is_forbidden(limited_models_catalog):
      print(f"[FAIL] limited POST /models/catalog/refresh -> {limited_models_catalog.status_code}")
      failed = True
    else:
      print("[OK] limited POST /models/catalog/refresh -> 403")

    limited_plugins_install = client.post("/plugins/install", json={"id": "some-plugin"}, headers=limited_headers)
    if not _is_forbidden(limited_plugins_install):
      print(f"[FAIL] limited POST /plugins/install -> {limited_plugins_install.status_code}")
      failed = True
    else:
      print("[OK] limited POST /plugins/install -> 403")

    if uncached_model_id:
      limited_chat = client.post(
        "/chat",
        json={"message": "test", "context": {"chat_id": "acl-limited-chat"}},
        headers=limited_headers,
      )
      if not _is_forbidden(limited_chat):
        print(f"[FAIL] limited POST /chat -> {limited_chat.status_code}")
        failed = True
      else:
        print("[OK] limited POST /chat -> 403")

      limited_chat_stream = client.post(
        "/chat/stream",
        json={"message": "test", "context": {"chat_id": "acl-limited-stream"}},
        headers=limited_headers,
      )
      if not _is_forbidden(limited_chat_stream):
        print(f"[FAIL] limited POST /chat/stream -> {limited_chat_stream.status_code}")
        failed = True
      else:
        print("[OK] limited POST /chat/stream -> 403")

    # Plugins-only user can download plugins, but cannot download models.
    plugins_only_install = client.post(
      "/plugins/install",
      json={"id": "some-plugin"},
      headers=plugins_only_headers,
    )
    if not _is_not_forbidden(plugins_only_install):
      print(f"[FAIL] plugins_only POST /plugins/install -> {plugins_only_install.status_code}")
      failed = True
    else:
      print(f"[OK] plugins_only POST /plugins/install -> {plugins_only_install.status_code}")

    plugins_only_update = client.post(
      "/plugins/duckduckgo/update",
      json={},
      headers=plugins_only_headers,
    )
    if not _is_not_forbidden(plugins_only_update):
      print(f"[FAIL] plugins_only POST /plugins/duckduckgo/update -> {plugins_only_update.status_code}")
      failed = True
    else:
      print(f"[OK] plugins_only POST /plugins/duckduckgo/update -> {plugins_only_update.status_code}")

    plugins_only_uninstall = client.delete(
      "/plugins/duckduckgo/uninstall",
      headers=plugins_only_headers,
    )
    if not _is_not_forbidden(plugins_only_uninstall):
      print(f"[FAIL] plugins_only DELETE /plugins/duckduckgo/uninstall -> {plugins_only_uninstall.status_code}")
      failed = True
    else:
      print(f"[OK] plugins_only DELETE /plugins/duckduckgo/uninstall -> {plugins_only_uninstall.status_code}")

    if uncached_model_id:
      plugins_only_select_uncached = client.post(
        "/models/select",
        json={"model_id": uncached_model_id, "load": False},
        headers=plugins_only_headers,
      )
      if plugins_only_select_uncached.status_code != 200:
        print(f"[FAIL] plugins_only POST /models/select(load=false) -> {plugins_only_select_uncached.status_code}")
        failed = True
      else:
        print("[OK] plugins_only POST /models/select(load=false) -> 200")

      plugins_only_models_load = client.post(
        "/models/load",
        json={"model_id": uncached_model_id},
        headers=plugins_only_headers,
      )
      if not _is_forbidden(plugins_only_models_load):
        print(f"[FAIL] plugins_only POST /models/load -> {plugins_only_models_load.status_code}")
        failed = True
      else:
        print("[OK] plugins_only POST /models/load -> 403")

    # Models-only user can download models, but cannot download plugins.
    models_only_models_load = client.post(
      "/models/load",
      json={"model_id": uncached_model_id} if uncached_model_id else {},
      headers=models_only_headers,
    )
    if not _is_not_forbidden(models_only_models_load):
      print(f"[FAIL] models_only POST /models/load -> {models_only_models_load.status_code}")
      failed = True
    else:
      print(f"[OK] models_only POST /models/load -> {models_only_models_load.status_code}")

    models_only_select_load = client.post(
      "/models/select",
      json=({"model_id": uncached_model_id} if uncached_model_id else {}) | {"load": True},
      headers=models_only_headers,
    )
    if not _is_not_forbidden(models_only_select_load):
      print(f"[FAIL] models_only POST /models/select(load=true) -> {models_only_select_load.status_code}")
      failed = True
    else:
      print(f"[OK] models_only POST /models/select(load=true) -> {models_only_select_load.status_code}")

    models_only_plugins_install = client.post(
      "/plugins/install",
      json={"id": "some-plugin"},
      headers=models_only_headers,
    )
    if not _is_forbidden(models_only_plugins_install):
      print(f"[FAIL] models_only POST /plugins/install -> {models_only_plugins_install.status_code}")
      failed = True
    else:
      print("[OK] models_only POST /plugins/install -> 403")

    # Admin is never blocked by ACL toggles.
    admin_models_load = client.post(
      "/models/load",
      json={"model_id": uncached_model_id} if uncached_model_id else {},
      headers=admin_headers,
    )
    if not _is_not_forbidden(admin_models_load):
      print(f"[FAIL] admin POST /models/load -> {admin_models_load.status_code}")
      failed = True
    else:
      print(f"[OK] admin POST /models/load -> {admin_models_load.status_code}")

    admin_plugins_install = client.post(
      "/plugins/install",
      json={"id": "some-plugin"},
      headers=admin_headers,
    )
    if not _is_not_forbidden(admin_plugins_install):
      print(f"[FAIL] admin POST /plugins/install -> {admin_plugins_install.status_code}")
      failed = True
    else:
      print(f"[OK] admin POST /plugins/install -> {admin_plugins_install.status_code}")

    # Optional verification: if model loading has already started by an allowed user,
    # limited user should no longer be blocked specifically by ACL.
    should_check_chat_acl_bypass = False
    if uncached_model_id:
      for _ in range(20):
        models_payload = client.get("/models", headers=models_only_headers)
        if models_payload.status_code != 200:
          break
        body = models_payload.json() if isinstance(models_payload.json(), dict) else {}
        loaded_model_id = str(body.get("loaded_model") or "").strip().lower()
        startup = body.get("startup") if isinstance(body.get("startup"), dict) else {}
        startup_details = startup.get("details") if isinstance(startup.get("details"), dict) else {}
        startup_model_id = str(startup_details.get("model_id") or "").strip().lower()
        if loaded_model_id == uncached_model_id or startup_model_id == uncached_model_id:
          should_check_chat_acl_bypass = True
          break

    if uncached_model_id and should_check_chat_acl_bypass:
      limited_chat_after_external_load = client.post(
        "/chat",
        # Keep selected model aligned to the same one that is loading/loaded by permitted user.
        json={
          "message": "test",
          "context": {
            "chat_id": "acl-limited-chat-after-load",
          },
        },
        headers=limited_headers,
      )
      if _is_forbidden(limited_chat_after_external_load):
        print(f"[FAIL] limited POST /chat after external model load -> {limited_chat_after_external_load.status_code}")
        failed = True
      else:
        print(f"[OK] limited POST /chat after external model load -> {limited_chat_after_external_load.status_code}")
    else:
      print("[OK] skipped limited chat ACL-bypass check (model load state not yet visible)")

    if uncached_model_id:
      # Restore selected model to uncached one for explicit chat ACL checks in later maintenance runs.
      client.post(
        "/models/select",
        json={"model_id": uncached_model_id, "load": False},
        headers=limited_headers,
      )

    if uncached_model_id and not should_check_chat_acl_bypass:
      # Keep this check explicit in logs for easier diagnostics.
      print("[OK] model ACL deny checks executed with uncached model id")

    if failed:
      print("ACL SMOKE RESULT: FAILED")
      return 1
    print("ACL SMOKE RESULT: OK")
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
