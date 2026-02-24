#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Для smoke-проверки не грузим модель на старте, чтобы тесты работали в CI/песочнице.
os.environ["ANCIA_ENABLE_MODEL_EAGER_LOAD"] = "0"
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
  sys.path.insert(0, str(ROOT_DIR))

from fastapi.testclient import TestClient

from backend.main import PythonModelEngine, app


OPTIONS_PATHS = [
  "/chat",
  "/chat/stream",
  "/chats",
  "/chats/chat-1",
  "/chats/chat-1/duplicate",
  "/chats/chat-1/history",
  "/chats/chat-1/messages",
  "/chats/chat-1/messages/msg-1",
  "/health",
  "/models",
  "/models/select",
  "/plugins",
  "/plugins/core-tools/disable",
  "/plugins/core-tools/enable",
  "/tools",
]


def main() -> int:
  client = TestClient(app)
  failed = False

  health = client.get("/health")
  if health.status_code != 200:
    print(f"[FAIL] GET /health -> {health.status_code}")
    failed = True
  else:
    print("[OK] GET /health -> 200")

  for path in OPTIONS_PATHS:
    response = client.options(path)
    if response.status_code == 405:
      print(f"[FAIL] OPTIONS {path} -> 405")
      failed = True
      continue
    print(f"[OK] OPTIONS {path} -> {response.status_code}")

  plugins_payload = client.get("/plugins")
  required_ids = {"duckduckgo", "visit-website", "system-time", "chat-mood", "python-run"}
  retry_count = 0
  while plugins_payload.status_code == 200 and retry_count < 2:
    plugin_items = plugins_payload.json().get("plugins", [])
    plugin_ids = sorted([str(item.get("id") or "") for item in plugin_items if isinstance(item, dict)])
    missing_required = sorted(required_ids.difference(set(plugin_ids)))
    if not missing_required:
      break
    retry_count += 1
    time.sleep(0.2)
    plugins_payload = client.get("/plugins")

  if plugins_payload.status_code != 200:
    print(f"[FAIL] GET /plugins -> {plugins_payload.status_code}")
    failed = True
  else:
    plugin_items = plugins_payload.json().get("plugins", [])
    plugin_ids = sorted([str(item.get("id") or "") for item in plugin_items if isinstance(item, dict)])
    missing_required = sorted(required_ids.difference(set(plugin_ids)))
    if missing_required:
      print(f"[FAIL] required plugins missing: {missing_required}; got={plugin_ids}")
      failed = True
    else:
      print(f"[OK] plugin ids -> {plugin_ids}")
    if not all(bool(item.get("enabled", False)) for item in plugin_items if isinstance(item, dict)):
      print("[FAIL] some managed plugins are disabled")
      failed = True
    for item in plugin_items:
      if not isinstance(item, dict):
        continue
      subtitle = str(item.get("subtitle") or "").strip()
      description = str(item.get("description") or "").strip()
      if not subtitle or not description:
        print(f"[FAIL] plugin '{item.get('id')}' missing subtitle/description")
        failed = True
      elif subtitle == description:
        print(f"[FAIL] plugin '{item.get('id')}' subtitle duplicates description")
        failed = True

  registry_payload = client.get("/plugins/registry")
  if registry_payload.status_code != 200:
    print(f"[FAIL] GET /plugins/registry -> {registry_payload.status_code}")
    failed = True
  else:
    print("[OK] GET /plugins/registry -> 200")

  install_without_payload = client.post("/plugins/install", json={})
  if install_without_payload.status_code not in {400, 409}:
    print(f"[FAIL] POST /plugins/install (empty) -> {install_without_payload.status_code}")
    failed = True
  else:
    print(f"[OK] POST /plugins/install (empty) -> {install_without_payload.status_code}")

  uninstall_builtin = client.delete("/plugins/duckduckgo/uninstall")
  if uninstall_builtin.status_code != 409:
    print(f"[FAIL] DELETE /plugins/duckduckgo/uninstall -> {uninstall_builtin.status_code}")
    failed = True
  else:
    print("[OK] DELETE /plugins/duckduckgo/uninstall -> 409")

  sample = '{"name":"web.visit.website","arguments":{"url":"https://ancial.ru/legal/contacts"}}'
  cleaned, calls = PythonModelEngine._extract_tool_calls_from_reply(sample)
  if not calls or calls[0][0] != "web.visit.website":
    print(f"[FAIL] tool-call parser: {calls}")
    failed = True
  else:
    print(f"[OK] tool-call parser -> {calls[0]}")
  if cleaned.strip():
    print(f"[WARN] cleaned text is not empty: {cleaned!r}")

  bulleted_sample = (
    "- Посмотри что такое ancial.ru/legal/contacts\n"
    "- {\"name\": \"web.visit.website\", \"arguments\": {\"url\": \"https://ancial.ru/legal/contacts\"}}"
  )
  bulleted_cleaned, bulleted_calls = PythonModelEngine._extract_tool_calls_from_reply(bulleted_sample)
  if not bulleted_calls or bulleted_calls[0][0] != "web.visit.website":
    print(f"[FAIL] bulleted tool-call parser: {bulleted_calls}")
    failed = True
  else:
    print(f"[OK] bulleted tool-call parser -> {bulleted_calls[0]}")
  if "web.visit.website" in PythonModelEngine._sanitize_stream_preview(bulleted_sample, final=True):
    print("[FAIL] stream sanitizer leaked tool-call JSON")
    failed = True
  if "Посмотри что такое" not in bulleted_cleaned:
    print(f"[FAIL] bulleted parser removed user-visible line: {bulleted_cleaned!r}")
    failed = True

  inline_sample = (
    "Посмотри что такое ancial.ru/legal/contacts "
    "{\"name\": \"web.visit.website\", \"arguments\": {\"url\": \"https://ancial.ru/legal/contacts\"}}"
  )
  inline_cleaned, inline_calls = PythonModelEngine._extract_tool_calls_from_reply(inline_sample)
  if not inline_calls or inline_calls[0][0] != "web.visit.website":
    print(f"[FAIL] inline tool-call parser: {inline_calls}")
    failed = True
  else:
    print(f"[OK] inline tool-call parser -> {inline_calls[0]}")
  if "web.visit.website" in PythonModelEngine._sanitize_stream_preview(inline_sample, final=True):
    print("[FAIL] stream sanitizer leaked inline tool-call JSON")
    failed = True
  if inline_cleaned.strip():
    print(f"[WARN] inline cleaned text is not empty: {inline_cleaned!r}")

  python_args_string_sample = (
    '{"name":"python.run","arguments":"```python\\nprint(1 + 1)\\n```"}'
  )
  python_cleaned, python_calls = PythonModelEngine._extract_tool_calls_from_reply(python_args_string_sample)
  if not python_calls or python_calls[0][0] != "python.run":
    print(f"[FAIL] python string-args parser: {python_calls}")
    failed = True
  else:
    python_args = python_calls[0][1] if isinstance(python_calls[0][1], dict) else {}
    if "code" not in python_args:
      print(f"[FAIL] python string-args parser missed code field: {python_calls[0]}")
      failed = True
    else:
      print(f"[OK] python string-args parser -> {python_calls[0]}")
  if python_cleaned.strip():
    print(f"[WARN] python cleaned text is not empty: {python_cleaned!r}")

  if failed:
    print("SMOKE RESULT: FAILED")
    return 1
  print("SMOKE RESULT: OK")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
