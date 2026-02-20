from __future__ import annotations

import datetime as dt


def utc_now_iso() -> str:
  return dt.datetime.now(dt.timezone.utc).isoformat()


def normalize_mood(candidate: str | None, fallback: str = "neutral") -> str:
  value = str(candidate or "").strip().lower()
  if not value:
    return fallback

  aliases = {
    "ok": "success",
    "green": "success",
    "friendly": "friendly",
    "wait": "waiting",
    "think": "thinking",
    "error": "error",
    "warn": "warning",
    "danger": "aggression",
  }
  return aliases.get(value, value)
