from __future__ import annotations

import json
import re
from typing import Any, Callable

from fastapi import FastAPI, HTTPException

try:
  from backend.schemas import (
    ChatCreateRequest,
    ChatDuplicateRequest,
    ChatUpdateRequest,
    MessageUpdateRequest,
  )
except ModuleNotFoundError:
  from schemas import (  # type: ignore
    ChatCreateRequest,
    ChatDuplicateRequest,
    ChatUpdateRequest,
    MessageUpdateRequest,
  )


def register_chat_store_routes(
  app: FastAPI,
  *,
  storage: Any,
  normalize_mood_fn: Callable[[str, str], str],
) -> None:
  def extract_json_from_markdown(content: str) -> dict[str, Any]:
    safe_content = str(content or "")
    block_match = re.search(r"```ancia-json\s+([\s\S]*?)\s+```", safe_content, flags=re.IGNORECASE)
    if block_match:
      payload_text = block_match.group(1).strip()
      return json.loads(payload_text)
    return json.loads(safe_content)

  @app.get("/chats")
  def list_chats() -> dict[str, Any]:
    return storage.list_chat_store()

  @app.get("/chats/search")
  def search_chats(query: str = "", limit: int = 120, chat_id: str = "") -> dict[str, Any]:
    safe_query = str(query or "").strip()
    if not safe_query:
      return {
        "query": "",
        "results": [],
        "count": 0,
      }
    results = storage.search_messages(
      safe_query,
      limit=limit,
      chat_id=chat_id,
    )
    return {
      "query": safe_query,
      "results": results,
      "count": len(results),
    }

  @app.get("/chats/export")
  def export_chats(format: str = "json", chat_id: str = "") -> dict[str, Any]:
    safe_format = str(format or "json").strip().lower()
    if safe_format not in {"json", "md", "markdown"}:
      raise HTTPException(status_code=400, detail="format must be json or md")
    safe_chat_id = str(chat_id or "").strip()
    try:
      if safe_format == "json":
        return {
          "format": "json",
          "chat_id": safe_chat_id,
          "store": storage.export_chat_store_payload(safe_chat_id),
        }
      return {
        "format": "md",
        "chat_id": safe_chat_id,
        "content": storage.export_chat_store_markdown(safe_chat_id),
      }
    except ValueError as exc:
      raise HTTPException(status_code=404, detail=str(exc)) from exc

  @app.post("/chats/import")
  def import_chats(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = payload or {}
    mode = str(body.get("mode") or "replace").strip().lower()
    if mode not in {"replace", "merge"}:
      raise HTTPException(status_code=400, detail="mode must be replace or merge")
    raw_format = str(body.get("format") or "").strip().lower()
    source_payload: dict[str, Any] | None = None
    if raw_format in {"md", "markdown"}:
      markdown_content = str(body.get("content") or "").strip()
      if not markdown_content:
        raise HTTPException(status_code=400, detail="content is required for markdown import")
      try:
        source_payload = extract_json_from_markdown(markdown_content)
      except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid markdown payload: {exc}") from exc
    else:
      store_payload = body.get("store")
      if isinstance(store_payload, dict):
        source_payload = store_payload
      elif isinstance(body.get("sessions"), list):
        source_payload = {
          "activeSessionId": str(body.get("activeSessionId") or ""),
          "sessions": body.get("sessions"),
        }
      else:
        raise HTTPException(status_code=400, detail="store payload is required")

    try:
      imported = storage.import_chat_store_payload(source_payload, mode=mode)
    except ValueError as exc:
      raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
      "ok": True,
      "mode": str(imported.get("mode") or mode),
      "imported": {
        "sessions": int(imported.get("sessions") or 0),
        "messages": int(imported.get("messages") or 0),
      },
      "store": imported.get("store") or storage.list_chat_store(),
    }

  @app.post("/chats")
  def create_chat(payload: ChatCreateRequest) -> dict[str, Any]:
    requested_chat_id = str(payload.id or "").strip()
    requested_title = str(payload.title or "").strip() or "Новая сессия"
    raw_mood = str(payload.mood or "").strip()
    requested_mood = normalize_mood_fn(raw_mood, "") if raw_mood else ""

    session = storage.create_chat(
      chat_id=requested_chat_id,
      title=requested_title,
      mood=requested_mood,
    )
    if session is None:
      raise HTTPException(status_code=409, detail=f"Chat '{requested_chat_id}' already exists")

    return {
      "chat": session,
      "store": storage.list_chat_store(),
    }

  @app.patch("/chats/{chat_id}")
  def update_chat(chat_id: str, payload: ChatUpdateRequest) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")

    next_mood = payload.mood if payload.mood is None else normalize_mood_fn(payload.mood, "")
    session = storage.update_chat(
      safe_chat_id,
      title=payload.title,
      mood=next_mood,
    )
    if session is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    return {
      "chat": session,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}")
  def delete_chat(chat_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")

    chats = storage.list_chats()
    if not any(str(chat.get("id")) == safe_chat_id for chat in chats):
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    storage.delete_chat(safe_chat_id)
    if len(chats) <= 1:
      storage.create_chat(title="Новая сессия")
    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }

  @app.post("/chats/{chat_id}/duplicate")
  def duplicate_chat(chat_id: str, payload: ChatDuplicateRequest | None = None) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    body = payload or ChatDuplicateRequest()
    requested_target_id = str(body.id or "").strip()
    if requested_target_id and storage.get_chat(requested_target_id) is not None:
      raise HTTPException(status_code=409, detail=f"Chat '{requested_target_id}' already exists")

    duplicated = storage.duplicate_chat(
      safe_chat_id,
      target_chat_id=requested_target_id,
      title=body.title,
    )
    if duplicated is None:
      raise HTTPException(status_code=500, detail="Failed to duplicate chat")

    return {
      "chat": duplicated,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}/messages")
  def clear_chat_messages(chat_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    deleted = storage.clear_chat_messages(safe_chat_id)
    return {
      "deleted": deleted,
      "store": storage.list_chat_store(),
    }

  @app.patch("/chats/{chat_id}/messages/{message_id}")
  def update_chat_message(chat_id: str, message_id: str, payload: MessageUpdateRequest) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    next_text = str(payload.text or "").strip()
    if not next_text:
      raise HTTPException(status_code=400, detail="text is required")

    updated = storage.edit_message(safe_chat_id, message_id, next_text)
    if not updated:
      raise HTTPException(status_code=404, detail=f"Message '{message_id}' not found")

    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }

  @app.delete("/chats/{chat_id}/messages/{message_id}")
  def delete_chat_message(chat_id: str, message_id: str) -> dict[str, Any]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise HTTPException(status_code=400, detail="chat_id is required")
    if storage.get_chat(safe_chat_id) is None:
      raise HTTPException(status_code=404, detail=f"Chat '{safe_chat_id}' not found")

    deleted = storage.delete_message(safe_chat_id, message_id)
    if not deleted:
      raise HTTPException(status_code=404, detail=f"Message '{message_id}' not found")

    return {
      "ok": True,
      "store": storage.list_chat_store(),
    }
