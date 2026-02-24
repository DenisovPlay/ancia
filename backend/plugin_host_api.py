from __future__ import annotations

import datetime as dt
import threading
import uuid
from contextlib import contextmanager
from typing import Any, Callable
from urllib import parse as url_parse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
  from backend.common import normalize_mood
  from backend.plugin_permissions import (
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
  )
  from backend.tooling import (
    extract_html_links,
    extract_html_title,
    fetch_web_url,
    html_to_text,
    normalize_http_url,
  )
except ModuleNotFoundError:
  from common import normalize_mood  # type: ignore
  from plugin_permissions import (  # type: ignore
    normalize_domain_key,
    normalize_domain_default_policy,
    normalize_plugin_permission_policy,
  )
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
    self._runtime_local = threading.local()

  @property
  def storage(self) -> Any:
    return self._storage

  def is_autonomous_mode(self) -> bool:
    return bool(self._is_autonomous_mode_fn())

  def ensure_network_allowed(self) -> None:
    if self.is_autonomous_mode():
      raise RuntimeError("Автономный режим включен: внешние веб-запросы отключены.")

  def _get_bound_runtime(self) -> tuple[Any, str, str]:
    payload = getattr(self._runtime_local, "payload", None)
    if isinstance(payload, tuple) and len(payload) == 3:
      return payload
    return None, "", ""

  @contextmanager
  def bind_runtime(self, *, runtime: Any, plugin_id: str = "", tool_name: str = ""):
    previous = getattr(self._runtime_local, "payload", None)
    self._runtime_local.payload = (
      runtime,
      str(plugin_id or "").strip().lower(),
      str(tool_name or "").strip().lower(),
    )
    try:
      yield
    finally:
      if previous is None:
        if hasattr(self._runtime_local, "payload"):
          delattr(self._runtime_local, "payload")
      else:
        self._runtime_local.payload = previous

  @staticmethod
  def _resolve_domain_policy(domain: str, policies: dict[str, str], *, default_policy: str = "allow") -> str:
    safe_domain = normalize_domain_key(domain)
    if not safe_domain:
      return normalize_domain_default_policy(default_policy, "allow")
    safe_default_policy = normalize_domain_default_policy(default_policy, "allow")
    labels = safe_domain.split(".")
    candidates = [safe_domain]
    for index in range(1, len(labels) - 1):
      candidates.append(".".join(labels[index:]))
    candidates.append("*")
    for candidate in candidates:
      if candidate in policies:
        return normalize_plugin_permission_policy(policies.get(candidate), safe_default_policy)
    return safe_default_policy

  @staticmethod
  def _is_domain_granted(domain: str, grants: set[str]) -> bool:
    if "*" in grants:
      return True
    safe_domain = normalize_domain_key(domain)
    if not safe_domain:
      return False
    if safe_domain in grants:
      return True
    labels = safe_domain.split(".")
    for index in range(1, len(labels) - 1):
      if ".".join(labels[index:]) in grants:
        return True
    return False

  def ensure_domain_allowed(self, url: str, *, runtime: Any = None) -> str:
    safe_url = normalize_http_url(url)
    parsed = url_parse.urlparse(safe_url)
    safe_domain = normalize_domain_key(str(parsed.hostname or ""))
    if not safe_domain:
      return ""
    resolved_runtime = runtime
    if resolved_runtime is None:
      resolved_runtime, _plugin_id, _tool_name = self._get_bound_runtime()
    domain_policy_map = (
      dict(getattr(resolved_runtime, "domain_permission_policies", {}) or {})
      if resolved_runtime is not None
      else {}
    )
    default_policy = normalize_domain_default_policy(
      getattr(resolved_runtime, "domain_default_policy", "allow") if resolved_runtime is not None else "allow",
      "allow",
    )
    policy = self._resolve_domain_policy(safe_domain, domain_policy_map, default_policy=default_policy)
    if policy == "deny":
      raise RuntimeError(f"Доступ к домену '{safe_domain}' запрещён политикой разрешений.")
    if policy == "ask":
      granted_domains = {
        normalize_domain_key(item)
        for item in list(getattr(resolved_runtime, "domain_permission_grants", None) or [])
        if normalize_domain_key(item)
      } if resolved_runtime is not None else set()
      if not self._is_domain_granted(safe_domain, granted_domains):
        raise RuntimeError(
          f"Доступ к домену '{safe_domain}' требует подтверждения (policy: ask)."
        )
    return safe_domain

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

  def fetch_web_url(self, url: str, *, timeout_sec: float = 12.0, max_bytes: int = 2_500_000) -> dict[str, Any]:
    self.ensure_network_allowed()
    safe_url = normalize_http_url(url)
    self.ensure_domain_allowed(safe_url)
    return fetch_web_url(safe_url, timeout_sec=timeout_sec, max_bytes=max_bytes)

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
