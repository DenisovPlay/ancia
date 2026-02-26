from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

DEFAULT_MAX_READ_CHARS = 8_000
MAX_READ_CHARS = 32_000
MIN_READ_CHARS = 100
DEFAULT_MAX_ENTRIES = 100
MAX_ENTRIES = 500

_BLOCKED_PATH_PREFIXES: tuple[str, ...] = (
  "/etc/shadow",
  "/etc/passwd",
  "/etc/sudoers",
  "/etc/ssl",
  "/etc/ssh",
  "/proc",
  "/sys",
  "/dev",
  "/run/secrets",
  "/var/run/secrets",
)

_BLOCKED_EXTENSIONS: frozenset[str] = frozenset({
  ".key", ".pem", ".p12", ".pfx", ".crt", ".cer",
  ".keystore", ".jks", ".gpg", ".asc",
})


def _resolve_path(raw_path: str) -> Path:
  stripped = str(raw_path or "").strip()
  if not stripped:
    return Path.home()
  expanded = os.path.expandvars(os.path.expanduser(stripped))
  resolved = Path(expanded).resolve()
  return resolved


def _check_path_allowed(resolved: Path) -> None:
  path_str = str(resolved)
  for blocked in _BLOCKED_PATH_PREFIXES:
    if path_str == blocked or path_str.startswith(blocked + os.sep):
      raise PermissionError(
        f"Доступ к пути '{path_str}' запрещён по соображениям безопасности."
      )
  suffix = resolved.suffix.lower()
  if suffix in _BLOCKED_EXTENSIONS:
    raise PermissionError(
      f"Чтение файлов с расширением '{suffix}' запрещено по соображениям безопасности."
    )


def _entry_type(entry: os.DirEntry) -> str:
  try:
    if entry.is_symlink():
      return "symlink"
    if entry.is_dir():
      return "dir"
    return "file"
  except OSError:
    return "unknown"


def _entry_size(entry: os.DirEntry) -> int | None:
  try:
    if entry.is_file(follow_symlinks=False):
      return entry.stat(follow_symlinks=False).st_size
  except OSError:
    pass
  return None


def read_file(args: dict[str, Any], runtime: Any, host: Any) -> dict[str, Any]:
  payload = args or {}
  raw_path = str(payload.get("path") or "").strip()
  if not raw_path:
    raise ValueError("path is required")

  try:
    max_chars = int(payload.get("max_chars") or DEFAULT_MAX_READ_CHARS)
  except (TypeError, ValueError):
    max_chars = DEFAULT_MAX_READ_CHARS
  safe_max_chars = max(MIN_READ_CHARS, min(MAX_READ_CHARS, max_chars))

  encoding = str(payload.get("encoding") or "utf-8").strip() or "utf-8"

  resolved = _resolve_path(raw_path)
  _check_path_allowed(resolved)

  if not resolved.exists():
    raise FileNotFoundError(f"Файл не найден: {resolved}")
  if not resolved.is_file():
    raise IsADirectoryError(f"Путь указывает на директорию, а не на файл: {resolved}")

  file_size = resolved.stat().st_size

  try:
    raw_content = resolved.read_bytes()
  except PermissionError as exc:
    raise PermissionError(f"Нет прав на чтение файла: {resolved}") from exc
  except OSError as exc:
    raise OSError(f"Ошибка чтения файла: {exc}") from exc

  try:
    content = raw_content.decode(encoding, errors="replace")
  except (LookupError, UnicodeDecodeError):
    content = raw_content.decode("utf-8", errors="replace")
    encoding = "utf-8"

  truncated = len(content) > safe_max_chars
  if truncated:
    content = content[:safe_max_chars]

  return {
    "path": str(resolved),
    "size_bytes": file_size,
    "encoding": encoding,
    "content": content,
    "truncated": truncated,
    "lines": len(content.splitlines()),
  }


def list_dir(args: dict[str, Any], runtime: Any, host: Any) -> dict[str, Any]:
  payload = args or {}
  raw_path = str(payload.get("path") or "").strip()
  show_hidden = bool(payload.get("show_hidden", False))

  try:
    max_entries = int(payload.get("max_entries") or DEFAULT_MAX_ENTRIES)
  except (TypeError, ValueError):
    max_entries = DEFAULT_MAX_ENTRIES
  safe_max_entries = max(1, min(MAX_ENTRIES, max_entries))

  resolved = _resolve_path(raw_path) if raw_path else Path.home()
  _check_path_allowed(resolved)

  if not resolved.exists():
    raise FileNotFoundError(f"Директория не найдена: {resolved}")
  if not resolved.is_dir():
    raise NotADirectoryError(f"Путь указывает на файл, а не на директорию: {resolved}")

  entries: list[dict[str, Any]] = []
  truncated = False

  try:
    all_entries = list(os.scandir(resolved))
  except PermissionError as exc:
    raise PermissionError(f"Нет прав на чтение директории: {resolved}") from exc
  except OSError as exc:
    raise OSError(f"Ошибка чтения директории: {exc}") from exc

  all_entries.sort(key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))

  for entry in all_entries:
    if not show_hidden and entry.name.startswith("."):
      continue
    entry_type = _entry_type(entry)
    item: dict[str, Any] = {
      "name": entry.name,
      "type": entry_type,
    }
    size = _entry_size(entry)
    if size is not None:
      item["size_bytes"] = size
    entries.append(item)
    if len(entries) >= safe_max_entries:
      truncated = True
      break

  return {
    "path": str(resolved),
    "entries": entries,
    "count": len(entries),
    "truncated": truncated,
    "show_hidden": show_hidden,
  }
