#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

# Для smoke-проверки не грузим MLX, чтобы тесты работали в CI/песочнице.
os.environ.setdefault("ANCIA_DISABLE_MODEL_AUTOLOAD", "1")
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
  if plugins_payload.status_code != 200:
    print(f"[FAIL] GET /plugins -> {plugins_payload.status_code}")
    failed = True
  else:
    plugin_items = plugins_payload.json().get("plugins", [])
    plugin_ids = sorted([str(item.get("id") or "") for item in plugin_items if isinstance(item, dict)])
    expected_ids = sorted(["duckduckgo", "visit-website", "system-time", "chat-mood"])
    if plugin_ids != expected_ids:
      print(f"[FAIL] plugin ids mismatch: {plugin_ids} != {expected_ids}")
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

  if failed:
    print("SMOKE RESULT: FAILED")
    return 1
  print("SMOKE RESULT: OK")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
