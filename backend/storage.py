from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

try:
  from backend.common import normalize_mood, utc_now_iso
except ModuleNotFoundError:
  from common import normalize_mood, utc_now_iso  # type: ignore


class AppStorage:
  def __init__(self, db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    self._db_path = db_path
    try:
      os.chmod(db_path.parent, 0o700)
    except OSError:
      pass
    self._lock = threading.Lock()
    self._conn = sqlite3.connect(db_path, check_same_thread=False)
    self._conn.row_factory = sqlite3.Row
    with self._conn:
      self._conn.execute("PRAGMA journal_mode=WAL")
      self._conn.execute("PRAGMA synchronous=NORMAL")
      self._conn.execute("PRAGMA foreign_keys=ON")
      self._conn.execute("PRAGMA secure_delete=ON")
      self._conn.execute("PRAGMA temp_store=MEMORY")
    if db_path.exists():
      try:
        os.chmod(db_path, 0o600)
      except OSError:
        pass
    self._bootstrap()

  def _bootstrap(self) -> None:
    with self._lock, self._conn:
      self._conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          mood TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
      )
      self._conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id TEXT NOT NULL,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          meta_json TEXT NOT NULL DEFAULT '{}',
          timestamp TEXT NOT NULL
        )
        """
      )
      self._conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp)"
      )
      self._conn.execute(
        """
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
      )
      self._conn.execute(
        """
        CREATE TABLE IF NOT EXISTS plugin_state (
          plugin_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
      )

  @staticmethod
  def _decode_meta(meta_json: str | None) -> dict[str, Any]:
    try:
      payload = json.loads(meta_json or "{}")
      return payload if isinstance(payload, dict) else {}
    except json.JSONDecodeError:
      return {}

  @staticmethod
  def _normalize_message_pk(message_id: str | int) -> int:
    raw = str(message_id or "").strip().lower()
    if raw.startswith("msg-"):
      raw = raw[4:]
    value = int(raw)
    if value <= 0:
      raise ValueError("message id must be positive")
    return value

  @classmethod
  def _serialize_message_row(cls, row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    meta = cls._decode_meta(payload.get("meta_json"))
    meta_suffix = str(meta.get("meta_suffix") or meta.get("metaSuffix") or "").strip()
    return {
      "id": f"msg-{payload['id']}",
      "role": str(payload.get("role") or "assistant"),
      "text": str(payload.get("text") or ""),
      "metaSuffix": meta_suffix,
      "meta": meta,
      "timestamp": str(payload.get("timestamp") or utc_now_iso()),
    }

  @staticmethod
  def _serialize_chat_row(
    row: sqlite3.Row | dict[str, Any],
    messages: list[dict[str, Any]],
  ) -> dict[str, Any]:
    payload = dict(row)
    return {
      "id": str(payload.get("id") or ""),
      "title": str(payload.get("title") or "Новая сессия"),
      "createdAt": str(payload.get("created_at") or utc_now_iso()),
      "updatedAt": str(payload.get("updated_at") or utc_now_iso()),
      "mood": str(payload.get("mood") or ""),
      "messages": messages,
    }

  def _generate_chat_id_locked(self) -> str:
    while True:
      candidate = f"chat-{uuid.uuid4().hex[:12]}"
      exists = self._conn.execute("SELECT 1 FROM chats WHERE id=?", (candidate,)).fetchone()
      if not exists:
        return candidate

  def get_chat(self, chat_id: str) -> dict[str, Any] | None:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return None

    with self._lock:
      row = self._conn.execute(
        "SELECT id, title, mood, created_at, updated_at FROM chats WHERE id=?",
        (safe_chat_id,),
      ).fetchone()
    return dict(row) if row else None

  def list_chats(self) -> list[dict[str, Any]]:
    with self._lock:
      rows = self._conn.execute(
        """
        SELECT id, title, mood, created_at, updated_at
        FROM chats
        ORDER BY updated_at DESC, id DESC
        """
      ).fetchall()
    return [dict(row) for row in rows]

  def ensure_chat(self, chat_id: str, title: str, mood: str = "") -> None:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      raise ValueError("chat id is required")

    safe_title = str(title or "").strip() or f"Чат {safe_chat_id}"
    safe_mood = normalize_mood(mood, "") if mood else ""
    now = utc_now_iso()

    with self._lock, self._conn:
      existing = self._conn.execute(
        "SELECT title, mood FROM chats WHERE id=?",
        (safe_chat_id,),
      ).fetchone()

      if existing is None:
        self._conn.execute(
          """
          INSERT INTO chats(id, title, mood, created_at, updated_at)
          VALUES(?, ?, ?, ?, ?)
          """,
          (safe_chat_id, safe_title, safe_mood, now, now),
        )
        return

      next_mood = safe_mood or str(existing["mood"] or "")
      self._conn.execute(
        "UPDATE chats SET mood=?, updated_at=? WHERE id=?",
        (next_mood, now, safe_chat_id),
      )

  def create_chat(self, chat_id: str = "", title: str = "", mood: str = "") -> dict[str, Any] | None:
    safe_chat_id = str(chat_id or "").strip()
    safe_title = str(title or "").strip() or "Новая сессия"
    safe_mood = normalize_mood(mood, "") if mood else ""
    now = utc_now_iso()

    with self._lock, self._conn:
      if safe_chat_id:
        exists = self._conn.execute("SELECT 1 FROM chats WHERE id=?", (safe_chat_id,)).fetchone()
        if exists:
          return None
      else:
        safe_chat_id = self._generate_chat_id_locked()

      self._conn.execute(
        """
        INSERT INTO chats(id, title, mood, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?)
        """,
        (safe_chat_id, safe_title, safe_mood, now, now),
      )

    return self.get_chat_session(safe_chat_id)

  def update_chat(
    self,
    chat_id: str,
    *,
    title: str | None = None,
    mood: str | None = None,
  ) -> dict[str, Any] | None:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return None

    updates: list[str] = []
    params: list[Any] = []

    if title is not None:
      safe_title = str(title or "").strip() or "Новая сессия"
      updates.append("title=?")
      params.append(safe_title)

    if mood is not None:
      safe_mood = normalize_mood(mood, "")
      updates.append("mood=?")
      params.append(safe_mood)

    if not updates:
      return self.get_chat_session(safe_chat_id)

    updates.append("updated_at=?")
    params.append(utc_now_iso())
    params.append(safe_chat_id)

    with self._lock, self._conn:
      cursor = self._conn.execute(
        f"UPDATE chats SET {', '.join(updates)} WHERE id=?",
        tuple(params),
      )
      if cursor.rowcount <= 0:
        return None

    return self.get_chat_session(safe_chat_id)

  def delete_chat(self, chat_id: str) -> bool:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return False

    with self._lock, self._conn:
      self._conn.execute("DELETE FROM messages WHERE chat_id=?", (safe_chat_id,))
      cursor = self._conn.execute("DELETE FROM chats WHERE id=?", (safe_chat_id,))
      return cursor.rowcount > 0

  def duplicate_chat(
    self,
    source_chat_id: str,
    *,
    target_chat_id: str = "",
    title: str | None = None,
  ) -> dict[str, Any] | None:
    source_id = str(source_chat_id or "").strip()
    next_chat_id = str(target_chat_id or "").strip()
    if not source_id:
      return None

    now = utc_now_iso()
    with self._lock, self._conn:
      source = self._conn.execute(
        "SELECT id, title, mood FROM chats WHERE id=?",
        (source_id,),
      ).fetchone()
      if source is None:
        return None

      if next_chat_id:
        exists = self._conn.execute("SELECT 1 FROM chats WHERE id=?", (next_chat_id,)).fetchone()
        if exists:
          return None
      else:
        next_chat_id = self._generate_chat_id_locked()

      next_title = str(title or "").strip() or f"{source['title']} (копия)"
      self._conn.execute(
        """
        INSERT INTO chats(id, title, mood, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?)
        """,
        (next_chat_id, next_title, str(source["mood"] or ""), now, now),
      )

      source_messages = self._conn.execute(
        """
        SELECT role, text, meta_json, timestamp
        FROM messages
        WHERE chat_id=?
        ORDER BY id ASC
        """,
        (source_id,),
      ).fetchall()

      for row in source_messages:
        self._conn.execute(
          """
          INSERT INTO messages(chat_id, role, text, meta_json, timestamp)
          VALUES(?, ?, ?, ?, ?)
          """,
          (
            next_chat_id,
            str(row["role"] or "assistant"),
            str(row["text"] or ""),
            str(row["meta_json"] or "{}"),
            str(row["timestamp"] or now),
          ),
        )

      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (now, next_chat_id),
      )

    return self.get_chat_session(next_chat_id)

  def get_chat_messages(self, chat_id: str, limit: int | None = None) -> list[dict[str, Any]]:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return []

    with self._lock:
      if limit is not None:
        safe_limit = max(1, int(limit))
        rows = self._conn.execute(
          """
          SELECT id, role, text, meta_json, timestamp
          FROM messages
          WHERE chat_id=?
          ORDER BY id DESC
          LIMIT ?
          """,
          (safe_chat_id, safe_limit),
        ).fetchall()
        rows = list(reversed(rows))
      else:
        rows = self._conn.execute(
          """
          SELECT id, role, text, meta_json, timestamp
          FROM messages
          WHERE chat_id=?
          ORDER BY id ASC
          """,
          (safe_chat_id,),
        ).fetchall()

    return [self._serialize_message_row(row) for row in rows]

  def get_chat_session(self, chat_id: str) -> dict[str, Any] | None:
    row = self.get_chat(chat_id)
    if row is None:
      return None
    messages = self.get_chat_messages(chat_id)
    return self._serialize_chat_row(row, messages)

  def list_chat_store(self) -> dict[str, Any]:
    rows = self.list_chats()
    sessions = [
      self._serialize_chat_row(row, self.get_chat_messages(str(row["id"])))
      for row in rows
    ]
    return {
      "version": 1,
      "activeSessionId": sessions[0]["id"] if sessions else "",
      "sessions": sessions,
    }

  def update_chat_mood(self, chat_id: str, mood: str) -> None:
    self.update_chat(chat_id, mood=mood)

  def append_message(
    self,
    *,
    chat_id: str,
    role: str,
    text: str,
    meta: dict[str, Any] | None = None,
    timestamp: str | None = None,
  ) -> str:
    ts = timestamp or utc_now_iso()
    payload = json.dumps(meta or {}, ensure_ascii=False)

    with self._lock, self._conn:
      cursor = self._conn.execute(
        """
        INSERT INTO messages(chat_id, role, text, meta_json, timestamp)
        VALUES(?, ?, ?, ?, ?)
        """,
        (chat_id, role, text, payload, ts),
      )
      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (ts, chat_id),
      )
      return f"msg-{cursor.lastrowid}"

  def edit_message(self, chat_id: str, message_id: str, next_text: str) -> bool:
    safe_chat_id = str(chat_id or "").strip()
    safe_text = str(next_text or "").strip()
    if not safe_chat_id or not safe_text:
      return False

    try:
      message_pk = self._normalize_message_pk(message_id)
    except (TypeError, ValueError):
      return False

    now = utc_now_iso()
    with self._lock, self._conn:
      cursor = self._conn.execute(
        """
        UPDATE messages
        SET text=?, timestamp=?
        WHERE id=? AND chat_id=?
        """,
        (safe_text, now, message_pk, safe_chat_id),
      )
      if cursor.rowcount <= 0:
        return False
      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (now, safe_chat_id),
      )
    return True

  def update_message(
    self,
    chat_id: str,
    message_id: str,
    *,
    text: str | None = None,
    meta: dict[str, Any] | None = None,
    timestamp: str | None = None,
  ) -> bool:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return False

    try:
      message_pk = self._normalize_message_pk(message_id)
    except (TypeError, ValueError):
      return False

    updates: list[str] = []
    params: list[Any] = []
    if text is not None:
      updates.append("text=?")
      params.append(str(text))
    if meta is not None:
      updates.append("meta_json=?")
      params.append(json.dumps(meta, ensure_ascii=False))

    if not updates:
      return False

    now = str(timestamp or utc_now_iso())
    updates.append("timestamp=?")
    params.append(now)
    params.extend([message_pk, safe_chat_id])

    with self._lock, self._conn:
      cursor = self._conn.execute(
        f"UPDATE messages SET {', '.join(updates)} WHERE id=? AND chat_id=?",
        tuple(params),
      )
      if cursor.rowcount <= 0:
        return False
      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (now, safe_chat_id),
      )
    return True

  def delete_message(self, chat_id: str, message_id: str) -> bool:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return False

    try:
      message_pk = self._normalize_message_pk(message_id)
    except (TypeError, ValueError):
      return False

    now = utc_now_iso()
    with self._lock, self._conn:
      cursor = self._conn.execute(
        "DELETE FROM messages WHERE id=? AND chat_id=?",
        (message_pk, safe_chat_id),
      )
      if cursor.rowcount <= 0:
        return False
      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (now, safe_chat_id),
      )
    return True

  def clear_chat_messages(self, chat_id: str) -> int:
    safe_chat_id = str(chat_id or "").strip()
    if not safe_chat_id:
      return 0

    with self._lock, self._conn:
      cursor = self._conn.execute(
        "DELETE FROM messages WHERE chat_id=?",
        (safe_chat_id,),
      )
      self._conn.execute(
        "UPDATE chats SET updated_at=? WHERE id=?",
        (utc_now_iso(), safe_chat_id),
      )
      return max(0, int(cursor.rowcount))

  def get_recent_messages(self, chat_id: str, limit: int = 30) -> list[dict[str, Any]]:
    with self._lock:
      rows = self._conn.execute(
        """
        SELECT role, text, timestamp
        FROM messages
        WHERE chat_id=?
        ORDER BY id DESC
        LIMIT ?
        """,
        (chat_id, limit),
      ).fetchall()

    result = [dict(row) for row in reversed(rows)]
    return result

  def get_setting(self, key: str) -> str | None:
    with self._lock:
      row = self._conn.execute(
        "SELECT value FROM settings WHERE key=?",
        (key,),
      ).fetchone()
    if not row:
      return None
    return str(row["value"])

  def set_setting(self, key: str, value: str) -> None:
    now = utc_now_iso()
    with self._lock, self._conn:
      self._conn.execute(
        """
        INSERT INTO settings(key, value, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(key)
        DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """,
        (key, value, now),
      )

  def get_setting_json(self, key: str, fallback: Any = None) -> Any:
    raw = self.get_setting(key)
    if raw is None:
      return fallback
    try:
      return json.loads(raw)
    except json.JSONDecodeError:
      return fallback

  def set_setting_json(self, key: str, value: Any) -> None:
    self.set_setting(key, json.dumps(value, ensure_ascii=False))

  def get_setting_flag(self, key: str, fallback: bool = False) -> bool:
    raw = self.get_setting(key)
    if raw is None:
      return bool(fallback)
    normalized = str(raw).strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
      return True
    if normalized in {"0", "false", "no", "off"}:
      return False
    return bool(fallback)

  def set_setting_flag(self, key: str, value: bool) -> None:
    self.set_setting(key, "1" if bool(value) else "0")

  def reset_all(self) -> None:
    with self._lock, self._conn:
      self._conn.execute("DELETE FROM messages")
      self._conn.execute("DELETE FROM chats")
      self._conn.execute("DELETE FROM settings")
      self._conn.execute("DELETE FROM plugin_state")
    with self._lock:
      self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")

  def get_plugin_state(self) -> dict[str, bool]:
    with self._lock:
      rows = self._conn.execute("SELECT plugin_id, enabled FROM plugin_state").fetchall()
    return {str(row["plugin_id"]): bool(row["enabled"]) for row in rows}

  def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> None:
    with self._lock, self._conn:
      self._conn.execute(
        """
        INSERT INTO plugin_state(plugin_id, enabled, updated_at)
        VALUES(?, ?, ?)
        ON CONFLICT(plugin_id)
        DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at
        """,
        (plugin_id, int(enabled), utc_now_iso()),
      )

  def remove_plugin_state(self, plugin_id: str) -> None:
    safe_plugin_id = str(plugin_id or "").strip().lower()
    if not safe_plugin_id:
      return
    with self._lock, self._conn:
      self._conn.execute(
        "DELETE FROM plugin_state WHERE plugin_id=?",
        (safe_plugin_id,),
      )
