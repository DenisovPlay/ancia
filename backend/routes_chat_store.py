from __future__ import annotations

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
  @app.get("/chats")
  def list_chats() -> dict[str, Any]:
    return storage.list_chat_store()

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
