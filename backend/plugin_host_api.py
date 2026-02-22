from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
  from backend.common import normalize_mood
  from backend.tooling import (
    extract_html_links,
    extract_html_title,
    fetch_web_url,
    html_to_text,
    normalize_http_url,
  )
except ModuleNotFoundError:
  from common import normalize_mood  # type: ignore
  from tooling import (  # type: ignore
    extract_html_links,
    extract_html_title,
    fetch_web_url,
    html_to_text,
    normalize_http_url,
  )


class PluginHostApi:
  def __init__(self, *, storage: Any, is_autonomous_mode_fn: Callable[[], bool]) -> None:
    self._storage = storage
    self._is_autonomous_mode_fn = is_autonomous_mode_fn

  @property
  def storage(self) -> Any:
    return self._storage

  def is_autonomous_mode(self) -> bool:
    return bool(self._is_autonomous_mode_fn())

  def ensure_network_allowed(self) -> None:
    if self.is_autonomous_mode():
      raise RuntimeError("Автономный режим включен: внешние веб-запросы отключены.")

  @staticmethod
  def normalize_mood(value: str, fallback: str = "neutral") -> str:
    return normalize_mood(value, fallback)

  @staticmethod
  def now_for_timezone(timezone: str) -> tuple[str, str]:
    tz_name = str(timezone or "").strip() or "UTC"
    try:
      zone = ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
      zone = ZoneInfo("UTC")
      tz_name = "UTC"
    now = dt.datetime.now(zone)
    return now.isoformat(timespec="seconds"), tz_name

  @staticmethod
  def create_request_id() -> str:
    return str(uuid.uuid4())

  @staticmethod
  def normalize_http_url(raw_url: str) -> str:
    return normalize_http_url(raw_url)

  @staticmethod
  def fetch_web_url(url: str, *, timeout_sec: float = 12.0, max_bytes: int = 2_500_000) -> dict[str, Any]:
    return fetch_web_url(url, timeout_sec=timeout_sec, max_bytes=max_bytes)

  @staticmethod
  def extract_html_title(raw_html: str) -> str:
    return extract_html_title(raw_html)

  @staticmethod
  def html_to_text(raw_html: str) -> str:
    return html_to_text(raw_html)

  @staticmethod
  def extract_html_links(raw_html: str, base_url: str, *, limit: int = 20) -> list[str]:
    return extract_html_links(raw_html, base_url, limit=limit)

  def update_chat_mood(self, *, chat_id: str, mood: str) -> None:
    safe_chat_id = str(chat_id or "").strip() or "default"
    self._storage.update_chat_mood(safe_chat_id, mood)
