from __future__ import annotations

import ipaddress
import os
import re
import socket
from typing import Any
from urllib import parse as url_parse
from urllib import error as url_error
from urllib import request as url_request

HTTP_URL_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9+\-.]*://")


def _is_true(value: Any) -> bool:
  return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def normalize_http_url(url_like: Any, *, allow_http: bool = True) -> str:
  raw = str(url_like or "").strip()
  if not raw:
    raise ValueError("URL is required")
  if not HTTP_URL_PATTERN.match(raw):
    raw = f"https://{raw}"
  parsed = url_parse.urlparse(raw)
  scheme = str(parsed.scheme or "").strip().lower()
  if scheme not in {"http", "https"}:
    raise ValueError("Only http/https URLs are allowed")
  if scheme == "http" and not allow_http:
    raise ValueError("Only https URLs are allowed")
  if not parsed.netloc:
    raise ValueError("URL host is required")
  hostname = str(parsed.hostname or "").strip()
  if not hostname:
    raise ValueError("URL host is required")
  return parsed.geturl()


def _resolve_ip_addresses(hostname: str) -> set[ipaddress._BaseAddress]:
  resolved: set[ipaddress._BaseAddress] = set()
  try:
    addrinfo = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
  except socket.gaierror:
    return resolved
  for entry in addrinfo:
    sockaddr = entry[4]
    if not isinstance(sockaddr, tuple) or not sockaddr:
      continue
    raw_ip = str(sockaddr[0] or "").strip()
    if not raw_ip:
      continue
    try:
      resolved.add(ipaddress.ip_address(raw_ip))
    except ValueError:
      continue
  return resolved


def _is_blocked_ip(address: ipaddress._BaseAddress, *, allow_loopback: bool, allow_private: bool) -> bool:
  if address.is_unspecified or address.is_multicast or address.is_reserved:
    return True
  if address.is_loopback:
    return not allow_loopback
  if address.is_link_local:
    return True
  if address.is_private:
    return not allow_private
  return False


def _extract_response_peer_ip(response: Any) -> ipaddress._BaseAddress | None:
  # urllib response internals differ between Python versions/platforms.
  # Walk a small object graph and probe getpeername() where available.
  queue: list[Any] = [response]
  visited: set[int] = set()
  while queue and len(visited) < 64:
    current = queue.pop(0)
    if current is None:
      continue
    identity = id(current)
    if identity in visited:
      continue
    visited.add(identity)

    getpeer = getattr(current, "getpeername", None)
    if callable(getpeer):
      try:
        peer = getpeer()
      except Exception:
        peer = None
      if isinstance(peer, tuple) and peer:
        try:
          return ipaddress.ip_address(str(peer[0] or "").strip())
        except ValueError:
          pass

    for attr_name in (
      "fp",
      "_fp",
      "raw",
      "_raw",
      "connection",
      "_connection",
      "sock",
      "_sock",
      "socket",
    ):
      try:
        child = getattr(current, attr_name, None)
      except Exception:
        child = None
      if child is not None:
        queue.append(child)

  return None


def is_private_hostname(hostname: str) -> bool:
  safe = str(hostname or "").strip().lower()
  if not safe:
    return True
  if safe in {"localhost", "localhost.localdomain"}:
    return True
  if safe.endswith(".local"):
    return True
  try:
    ip = ipaddress.ip_address(safe)
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified)
  except ValueError:
    return False


def ensure_safe_outbound_url(
  url_like: Any,
  *,
  allow_http: bool = True,
  allow_loopback: bool | None = None,
  allow_private: bool | None = None,
) -> str:
  safe_url = normalize_http_url(url_like, allow_http=allow_http)
  parsed = url_parse.urlparse(safe_url)
  hostname = str(parsed.hostname or "").strip()
  if not hostname:
    raise ValueError("URL host is required")

  env_allow_loopback = _is_true(os.getenv("ANCIA_ALLOW_LOOPBACK_EGRESS", ""))
  env_allow_private = _is_true(os.getenv("ANCIA_ALLOW_PRIVATE_EGRESS", ""))
  safe_allow_loopback = env_allow_loopback if allow_loopback is None else bool(allow_loopback)
  safe_allow_private = env_allow_private if allow_private is None else bool(allow_private)

  if is_private_hostname(hostname):
    if hostname in {"localhost", "localhost.localdomain"} and safe_allow_loopback:
      return safe_url
    try:
      host_ip = ipaddress.ip_address(hostname)
      if host_ip.is_loopback and safe_allow_loopback:
        return safe_url
      if host_ip.is_private and safe_allow_private:
        return safe_url
    except ValueError:
      pass
    raise ValueError("Blocked private/loopback hostname")

  resolved = _resolve_ip_addresses(hostname)
  if resolved:
    for address in resolved:
      if _is_blocked_ip(address, allow_loopback=safe_allow_loopback, allow_private=safe_allow_private):
        raise ValueError("Blocked private/loopback target")

  return safe_url


def build_safe_url_opener(
  *,
  allow_http: bool = True,
  allow_loopback: bool | None = None,
  allow_private: bool | None = None,
) -> Any:
  class _SafeRedirectHandler(url_request.HTTPRedirectHandler):
    def redirect_request(
      self,
      req,
      fp,
      code,
      msg,
      headers,
      newurl,
    ):
      try:
        safe_redirect_url = ensure_safe_outbound_url(
          newurl,
          allow_http=allow_http,
          allow_loopback=allow_loopback,
          allow_private=allow_private,
        )
      except ValueError as exc:
        raise url_error.URLError(str(exc)) from exc
      return super().redirect_request(req, fp, code, msg, headers, safe_redirect_url)

  return url_request.build_opener(_SafeRedirectHandler())


def open_safe_http_request(
  request: Any,
  *,
  timeout: float,
  allow_http: bool = True,
  allow_loopback: bool | None = None,
  allow_private: bool | None = None,
) -> Any:
  opener = build_safe_url_opener(
    allow_http=allow_http,
    allow_loopback=allow_loopback,
    allow_private=allow_private,
  )
  response = opener.open(request, timeout=timeout)
  try:
    final_url = str(response.geturl() or request.full_url)
    ensure_safe_outbound_url(
      final_url,
      allow_http=allow_http,
      allow_loopback=allow_loopback,
      allow_private=allow_private,
    )
    peer_ip = _extract_response_peer_ip(response)
    if peer_ip is not None:
      env_allow_loopback = _is_true(os.getenv("ANCIA_ALLOW_LOOPBACK_EGRESS", ""))
      env_allow_private = _is_true(os.getenv("ANCIA_ALLOW_PRIVATE_EGRESS", ""))
      safe_allow_loopback = env_allow_loopback if allow_loopback is None else bool(allow_loopback)
      safe_allow_private = env_allow_private if allow_private is None else bool(allow_private)
      if _is_blocked_ip(peer_ip, allow_loopback=safe_allow_loopback, allow_private=safe_allow_private):
        raise ValueError("Blocked private/loopback peer address")
  except Exception:
    response.close()
    raise
  return response
