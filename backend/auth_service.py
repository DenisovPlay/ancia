from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import os
import re
import secrets
import threading
from typing import Any

try:
  from backend.common import utc_now_iso
  from backend.access_control import (
    PERMISSION_MODELS_DOWNLOAD,
    PERMISSION_PLUGINS_DOWNLOAD,
  )
except ModuleNotFoundError:
  from common import utc_now_iso  # type: ignore
  from access_control import (  # type: ignore
    PERMISSION_MODELS_DOWNLOAD,
    PERMISSION_PLUGINS_DOWNLOAD,
  )


VALID_USER_ROLES = {"admin", "user"}
VALID_USER_STATUSES = {"active", "blocked"}
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._-]{3,64}$")
PASSWORD_MIN_LENGTH = 8
DEFAULT_SESSION_TTL_HOURS = 24
DEFAULT_SESSION_TTL_HOURS_LONG = 24 * 14
PASSWORD_HASH_ALGORITHM = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 240_000
DEFAULT_LOGIN_RATE_WINDOW_SECONDS = 5 * 60
DEFAULT_LOGIN_RATE_MAX_ATTEMPTS = 8
DEFAULT_LOGIN_RATE_BLOCK_SECONDS = 10 * 60


class AuthError(RuntimeError):
  pass


class AuthRateLimitError(AuthError):
  def __init__(self, retry_after_seconds: int) -> None:
    self.retry_after_seconds = max(1, int(retry_after_seconds or 1))
    super().__init__(
      f"Слишком много попыток входа. Повторите через {self.retry_after_seconds} сек."
    )


class AuthService:
  def __init__(
    self,
    *,
    storage: Any,
    session_ttl_hours: int = DEFAULT_SESSION_TTL_HOURS,
  ) -> None:
    self._storage = storage
    self._session_ttl_hours = max(1, int(session_ttl_hours or DEFAULT_SESSION_TTL_HOURS))
    self._login_rate_window_seconds = max(
      1,
      int(
        os.getenv(
          "ANCIA_AUTH_LOGIN_WINDOW_SECONDS",
          str(DEFAULT_LOGIN_RATE_WINDOW_SECONDS),
        ) or DEFAULT_LOGIN_RATE_WINDOW_SECONDS
      ),
    )
    self._login_rate_max_attempts = max(
      1,
      int(
        os.getenv(
          "ANCIA_AUTH_LOGIN_MAX_ATTEMPTS",
          str(DEFAULT_LOGIN_RATE_MAX_ATTEMPTS),
        ) or DEFAULT_LOGIN_RATE_MAX_ATTEMPTS
      ),
    )
    self._login_rate_block_seconds = max(
      1,
      int(
        os.getenv(
          "ANCIA_AUTH_LOGIN_BLOCK_SECONDS",
          str(DEFAULT_LOGIN_RATE_BLOCK_SECONDS),
        ) or DEFAULT_LOGIN_RATE_BLOCK_SECONDS
      ),
    )
    self._login_rate_enabled = bool(self._login_rate_max_attempts > 0)
    self._login_rate_lock = threading.Lock()
    self._login_rate_state: dict[str, dict[str, Any]] = {}

  @staticmethod
  def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)

  @classmethod
  def _parse_iso_utc(cls, value: str) -> dt.datetime | None:
    safe_value = str(value or "").strip()
    if not safe_value:
      return None
    try:
      parsed = dt.datetime.fromisoformat(safe_value.replace("Z", "+00:00"))
    except ValueError:
      return None
    if parsed.tzinfo is None:
      parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)

  @staticmethod
  def sanitize_username(value: Any) -> str:
    safe = str(value or "").strip().lower()
    if not safe:
      return ""
    if not USERNAME_PATTERN.match(safe):
      return ""
    return safe

  @staticmethod
  def validate_password(value: Any) -> str:
    password = str(value or "")
    if len(password) < PASSWORD_MIN_LENGTH:
      raise AuthError(f"Пароль должен содержать минимум {PASSWORD_MIN_LENGTH} символов.")
    if len(password) > 256:
      raise AuthError("Пароль слишком длинный.")
    return password

  @staticmethod
  def _hash_password(password: str, *, salt: bytes | None = None, iterations: int = PASSWORD_HASH_ITERATIONS) -> str:
    password_bytes = str(password or "").encode("utf-8")
    if salt is None:
      salt = os.urandom(16)
    derived = hashlib.pbkdf2_hmac("sha256", password_bytes, salt, int(iterations))
    return "$".join(
      [
        PASSWORD_HASH_ALGORITHM,
        str(int(iterations)),
        salt.hex(),
        derived.hex(),
      ]
    )

  @staticmethod
  def _verify_password(password: str, password_hash: str) -> bool:
    safe_hash = str(password_hash or "").strip()
    if not safe_hash:
      return False
    parts = safe_hash.split("$")
    if len(parts) != 4:
      return False
    algorithm, iterations_raw, salt_hex, digest_hex = parts
    if algorithm != PASSWORD_HASH_ALGORITHM:
      return False
    try:
      iterations = max(100_000, int(iterations_raw))
      salt = bytes.fromhex(salt_hex)
      expected = bytes.fromhex(digest_hex)
    except (TypeError, ValueError):
      return False

    actual = hashlib.pbkdf2_hmac("sha256", str(password or "").encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)

  @staticmethod
  def _hash_session_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()

  def _build_session_expiry_iso(self, *, remember: bool = False) -> str:
    ttl_hours = DEFAULT_SESSION_TTL_HOURS_LONG if remember else self._session_ttl_hours
    expires_at = self._utc_now() + dt.timedelta(hours=ttl_hours)
    return expires_at.replace(microsecond=0).isoformat()

  @staticmethod
  def _normalize_remote_addr(value: Any) -> str:
    return str(value or "").strip().lower()

  def _build_login_rate_scopes(self, username: str, remote_addr: str) -> list[str]:
    safe_username = str(username or "").strip().lower()
    safe_remote = self._normalize_remote_addr(remote_addr) or "_"
    scopes = [f"ip:{safe_remote}"]
    if safe_username:
      scopes.append(f"user:{safe_username}|ip:{safe_remote}")
    return scopes

  def _prune_login_rate_state_locked(self, now_ts: float) -> None:
    if not self._login_rate_state:
      return
    retention_seconds = max(
      self._login_rate_window_seconds * 2,
      self._login_rate_block_seconds,
    )
    keys_to_delete: list[str] = []
    for key, state in self._login_rate_state.items():
      attempts = [float(item) for item in list(state.get("attempts") or []) if (now_ts - float(item)) <= self._login_rate_window_seconds]
      blocked_until = float(state.get("blocked_until") or 0.0)
      if blocked_until <= now_ts:
        blocked_until = 0.0
      updated_at = float(state.get("updated_at") or 0.0)
      if not attempts and blocked_until <= 0 and (now_ts - updated_at) > retention_seconds:
        keys_to_delete.append(key)
        continue
      self._login_rate_state[key] = {
        "attempts": attempts,
        "blocked_until": blocked_until,
        "updated_at": max(updated_at, now_ts if attempts or blocked_until > 0 else updated_at),
      }
    for key in keys_to_delete:
      self._login_rate_state.pop(key, None)

  def _check_login_rate_limit(self, scopes: list[str], now: dt.datetime) -> None:
    if not self._login_rate_enabled:
      return
    now_ts = now.timestamp()
    retry_after = 0
    with self._login_rate_lock:
      self._prune_login_rate_state_locked(now_ts)
      for scope in scopes:
        state = self._login_rate_state.get(scope)
        if not isinstance(state, dict):
          continue
        blocked_until = float(state.get("blocked_until") or 0.0)
        if blocked_until > now_ts:
          retry_after = max(retry_after, int(blocked_until - now_ts + 0.999))
          continue
        attempts = [float(item) for item in list(state.get("attempts") or []) if (now_ts - float(item)) <= self._login_rate_window_seconds]
        state["attempts"] = attempts
        state["updated_at"] = now_ts
        if len(attempts) >= self._login_rate_max_attempts:
          state["attempts"] = []
          state["blocked_until"] = now_ts + self._login_rate_block_seconds
          retry_after = max(retry_after, self._login_rate_block_seconds)
        self._login_rate_state[scope] = state
    if retry_after > 0:
      raise AuthRateLimitError(retry_after)

  def _register_failed_login(self, scopes: list[str], now: dt.datetime) -> None:
    if not self._login_rate_enabled:
      return
    now_ts = now.timestamp()
    with self._login_rate_lock:
      self._prune_login_rate_state_locked(now_ts)
      for scope in scopes:
        state = self._login_rate_state.get(scope) or {
          "attempts": [],
          "blocked_until": 0.0,
          "updated_at": now_ts,
        }
        blocked_until = float(state.get("blocked_until") or 0.0)
        if blocked_until > now_ts:
          state["updated_at"] = now_ts
          self._login_rate_state[scope] = state
          continue
        attempts = [float(item) for item in list(state.get("attempts") or []) if (now_ts - float(item)) <= self._login_rate_window_seconds]
        attempts.append(now_ts)
        if len(attempts) >= self._login_rate_max_attempts:
          state["attempts"] = []
          state["blocked_until"] = now_ts + self._login_rate_block_seconds
        else:
          state["attempts"] = attempts
          state["blocked_until"] = 0.0
        state["updated_at"] = now_ts
        self._login_rate_state[scope] = state

  def _reset_login_rate_limit(self, scopes: list[str]) -> None:
    if not self._login_rate_enabled:
      return
    with self._login_rate_lock:
      for scope in scopes:
        self._login_rate_state.pop(scope, None)

  @staticmethod
  def _user_public_payload(user_row: dict[str, Any]) -> dict[str, Any]:
    return {
      "id": str(user_row.get("id") or ""),
      "username": str(user_row.get("username") or ""),
      "role": str(user_row.get("role") or "user"),
      "status": str(user_row.get("status") or "active"),
      "permissions": user_row.get("permissions") if isinstance(user_row.get("permissions"), dict) else {},
      "created_at": str(user_row.get("created_at") or ""),
      "updated_at": str(user_row.get("updated_at") or ""),
      "last_login_at": str(user_row.get("last_login_at") or ""),
    }

  def count_users(self) -> int:
    return int(self._storage.count_users())

  def has_any_users(self) -> bool:
    return self.count_users() > 0

  def has_admin_users(self) -> bool:
    for user in self._storage.list_users():
      if str(user.get("role") or "").strip().lower() == "admin":
        return True
    return False

  def bootstrap_admin(self, *, username: str, password: str) -> dict[str, Any]:
    if self.has_any_users():
      raise AuthError("Bootstrap уже выполнен: пользователи уже существуют.")
    safe_username = self.sanitize_username(username)
    if not safe_username:
      raise AuthError("Логин должен содержать 3-64 символа: буквы, цифры, . _ -")
    safe_password = self.validate_password(password)
    created = self._storage.create_user(
      username=safe_username,
      password_hash=self._hash_password(safe_password),
      role="admin",
      status="active",
      permissions={
        "chat": True,
        "plugins": True,
        "models": True,
        "settings": True,
        "admin": True,
        PERMISSION_MODELS_DOWNLOAD: True,
        PERMISSION_PLUGINS_DOWNLOAD: True,
      },
    )
    return self._user_public_payload(created)

  def create_user(
    self,
    *,
    username: str,
    password: str,
    role: str = "user",
    status: str = "active",
    permissions: dict[str, Any] | None = None,
  ) -> dict[str, Any]:
    safe_username = self.sanitize_username(username)
    if not safe_username:
      raise AuthError("Логин должен содержать 3-64 символа: буквы, цифры, . _ -")
    safe_password = self.validate_password(password)

    safe_role = str(role or "user").strip().lower()
    if safe_role not in VALID_USER_ROLES:
      safe_role = "user"
    safe_status = str(status or "active").strip().lower()
    if safe_status not in VALID_USER_STATUSES:
      safe_status = "active"

    try:
      user = self._storage.create_user(
        username=safe_username,
        password_hash=self._hash_password(safe_password),
        role=safe_role,
        status=safe_status,
        permissions=permissions if isinstance(permissions, dict) else {},
      )
    except ValueError as exc:
      raise AuthError(str(exc)) from exc
    return self._user_public_payload(user)

  def update_user(
    self,
    user_id: str,
    *,
    role: str | None = None,
    status: str | None = None,
    permissions: dict[str, Any] | None = None,
    password: str | None = None,
    revoke_sessions: bool = False,
  ) -> dict[str, Any]:
    safe_user_id = str(user_id or "").strip()
    if not safe_user_id:
      raise AuthError("Некорректный user id.")

    next_role: str | None = None
    if role is not None:
      role_candidate = str(role or "").strip().lower()
      if role_candidate not in VALID_USER_ROLES:
        raise AuthError("Некорректная роль пользователя.")
      next_role = role_candidate

    next_status: str | None = None
    if status is not None:
      status_candidate = str(status or "").strip().lower()
      if status_candidate not in VALID_USER_STATUSES:
        raise AuthError("Некорректный статус пользователя.")
      next_status = status_candidate

    next_password_hash: str | None = None
    if password is not None:
      safe_password = self.validate_password(password)
      next_password_hash = self._hash_password(safe_password)
      revoke_sessions = True

    updated = self._storage.update_user(
      safe_user_id,
      role=next_role,
      status=next_status,
      permissions=permissions if permissions is not None else None,
      password_hash=next_password_hash,
    )
    if updated is None:
      raise AuthError("Пользователь не найден.")

    if revoke_sessions or next_status == "blocked":
      self._storage.revoke_auth_sessions_for_user(safe_user_id)

    return self._user_public_payload(updated)

  def list_users(self) -> list[dict[str, Any]]:
    return [self._user_public_payload(item) for item in self._storage.list_users()]

  def login(
    self,
    *,
    username: str,
    password: str,
    remember: bool = False,
    remote_addr: str = "",
  ) -> dict[str, Any]:
    now = self._utc_now()
    safe_username = self.sanitize_username(username)
    login_scopes = self._build_login_rate_scopes(safe_username, remote_addr)
    self._check_login_rate_limit(login_scopes, now)
    if not safe_username:
      self._register_failed_login(login_scopes, now)
      raise AuthError("Неверный логин или пароль.")

    user = self._storage.get_user_by_username(safe_username)
    if user is None:
      self._register_failed_login(login_scopes, now)
      raise AuthError("Неверный логин или пароль.")

    if str(user.get("status") or "").strip().lower() == "blocked":
      self._register_failed_login(login_scopes, now)
      raise AuthError("Аккаунт заблокирован.")

    if not self._verify_password(str(password or ""), str(user.get("password_hash") or "")):
      self._register_failed_login(login_scopes, now)
      raise AuthError("Неверный логин или пароль.")

    self._reset_login_rate_limit(login_scopes)

    now_iso = utc_now_iso()
    self._storage.update_user(
      str(user.get("id") or ""),
      last_login_at=now_iso,
    )

    token = secrets.token_urlsafe(36)
    token_hash = self._hash_session_token(token)
    expires_at = self._build_session_expiry_iso(remember=remember)

    self._storage.prune_auth_sessions(now_iso=now_iso)
    session = self._storage.create_auth_session(
      user_id=str(user.get("id") or ""),
      token_hash=token_hash,
      expires_at=expires_at,
    )

    return {
      "token": token,
      "token_type": "bearer",
      "expires_at": str(session.get("expires_at") or expires_at),
      "user": self._user_public_payload(user),
    }

  def authenticate_token(self, token: str, *, renew: bool = True) -> dict[str, Any] | None:
    safe_token = str(token or "").strip()
    if not safe_token:
      return None

    now = self._utc_now()
    now_iso = now.replace(microsecond=0).isoformat()
    self._storage.prune_auth_sessions(now_iso=now_iso)

    token_hash = self._hash_session_token(safe_token)
    session = self._storage.get_auth_session_by_token_hash(token_hash)
    if not session:
      return None

    revoked_at = str(session.get("revoked_at") or "").strip()
    if revoked_at:
      return None

    expires_at = self._parse_iso_utc(str(session.get("expires_at") or ""))
    if expires_at is None or expires_at <= now:
      return None

    user = self._storage.get_user_by_id(str(session.get("user_id") or ""))
    if user is None:
      return None
    if str(user.get("status") or "").strip().lower() != "active":
      return None

    next_expires_at = session.get("expires_at") if isinstance(session.get("expires_at"), str) else ""
    if renew:
      next_expires_at = self._build_session_expiry_iso(remember=False)
      self._storage.touch_auth_session(
        str(session.get("id") or ""),
        last_seen_at=now_iso,
        expires_at=next_expires_at,
      )
    else:
      self._storage.touch_auth_session(
        str(session.get("id") or ""),
        last_seen_at=now_iso,
        expires_at=None,
      )

    return {
      "session": {
        "id": str(session.get("id") or ""),
        "expires_at": str(next_expires_at or session.get("expires_at") or ""),
      },
      "user": self._user_public_payload(user),
    }

  def logout(self, token: str) -> bool:
    safe_token = str(token or "").strip()
    if not safe_token:
      return False
    token_hash = self._hash_session_token(safe_token)
    session = self._storage.get_auth_session_by_token_hash(token_hash)
    if not session:
      return False
    return self._storage.revoke_auth_session(str(session.get("id") or ""))

  def get_user_public(self, user_id: str) -> dict[str, Any] | None:
    user = self._storage.get_user_by_id(user_id)
    if user is None:
      return None
    return self._user_public_payload(user)
