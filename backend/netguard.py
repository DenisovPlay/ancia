from __future__ import annotations

import ipaddress
import os
import re
import socket
from typing import Any
from urllib import parse as url_parse

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
