from __future__ import annotations

import html as html_lib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from pydantic import BaseModel, Field

try:
  from backend.tool_catalog import (
    build_preinstalled_plugin_manifests,
    build_tool_alias_map,
    build_tool_schemas,
    get_tool_input_schema,
    get_tool_spec,
  )
  from backend.tool_prompt_builder import apply_enabled_tools_prompt
except ModuleNotFoundError:
  from tool_catalog import (  # type: ignore
    build_preinstalled_plugin_manifests,
    build_tool_alias_map,
    build_tool_schemas,
    get_tool_input_schema,
    get_tool_spec,
  )
  from tool_prompt_builder import apply_enabled_tools_prompt  # type: ignore


ToolHandler = Callable[[dict[str, Any], Any], dict[str, Any]]


class ToolRegistry:
  def __init__(self) -> None:
    self._handlers: dict[str, ToolHandler] = {}
    self._meta: dict[str, dict[str, Any]] = {}

  def register(
    self,
    *,
    name: str,
    description: str,
    input_schema: dict[str, Any],
    handler: ToolHandler,
    runtime_meta: dict[str, Any] | None = None,
  ) -> None:
    normalized_name = name.strip().lower()
    self._handlers[normalized_name] = handler
    meta = {
      "name": normalized_name,
      "description": description,
      "input_schema": input_schema,
    }
    if isinstance(runtime_meta, dict):
      for key, value in runtime_meta.items():
        if key in {"name", "description", "input_schema"}:
          continue
        meta[key] = value
    self._meta[normalized_name] = meta

  def has_tool(self, name: str) -> bool:
    return name.strip().lower() in self._handlers

  def get_tool_meta(self, name: str) -> dict[str, Any]:
    normalized_name = name.strip().lower()
    payload = self._meta.get(normalized_name)
    return dict(payload) if isinstance(payload, dict) else {}

  def execute(self, name: str, args: dict[str, Any], runtime: Any) -> dict[str, Any]:
    normalized_name = name.strip().lower()
    handler = self._handlers.get(normalized_name)
    if handler is None:
      raise KeyError(f"Tool '{name}' is not registered")
    return handler(args, runtime)

  def list_tools(self) -> list[dict[str, Any]]:
    return [self._meta[name] for name in sorted(self._meta.keys())]


class PluginDescriptor(BaseModel):
  id: str
  name: str
  subtitle: str = ""
  description: str = ""
  homepage: str = ""
  enabled: bool = True
  tools: list[str] = Field(default_factory=list)
  version: str = "0.1.0"
  category: str = "system"
  keywords: list[str] = Field(default_factory=list)
  locked: bool = False
  allow_update: bool = True
  requires_network: bool = False


TOOL_SCHEMAS: dict[str, dict[str, Any]] = build_tool_schemas()
TOOL_NAME_ALIASES: dict[str, str] = build_tool_alias_map()
HARDCODED_PLUGIN_MANIFESTS: list[dict[str, Any]] = build_preinstalled_plugin_manifests()


def resolve_tool_name_alias(raw_name: str) -> str:
  safe_raw = str(raw_name or "").strip().lower()
  if not safe_raw:
    return ""
  return TOOL_NAME_ALIASES.get(safe_raw, safe_raw)


def get_tool_runtime_meta(name: str) -> dict[str, Any]:
  safe_name = str(name or "").strip().lower()
  spec = get_tool_spec(safe_name)
  if not isinstance(spec, dict):
    return {}
  return {
    "title": str(spec.get("title") or safe_name),
    "subtitle": str(spec.get("subtitle") or ""),
    "description": str(spec.get("description") or ""),
    "category": str(spec.get("category") or "system"),
    "keywords": list(spec.get("keywords") or []),
    "requires_network": bool(spec.get("requires_network", False)),
  }


def get_tool_registry_payload(name: str) -> dict[str, Any]:
  safe_name = str(name or "").strip().lower()
  spec = get_tool_spec(safe_name)
  runtime_meta = get_tool_runtime_meta(safe_name)
  description = (
    str(spec.get("description") or safe_name)
    if isinstance(spec, dict)
    else safe_name
  )
  input_schema = get_tool_input_schema(safe_name)
  return {
    "name": safe_name,
    "description": description,
    "input_schema": input_schema,
    "runtime_meta": {
      "display_name": str(runtime_meta.get("title") or safe_name),
      "subtitle": str(runtime_meta.get("subtitle") or ""),
      "category": str(runtime_meta.get("category") or "system"),
      "keywords": list(runtime_meta.get("keywords") or []),
      "requires_network": bool(runtime_meta.get("requires_network", False)),
    },
  }


class PluginManager:
  def __init__(
    self,
    storage: Any,
    plugin_dirs: list[Path],
    hardcoded_manifests: list[dict[str, Any]] | None = None,
  ) -> None:
    self._storage = storage
    self._plugin_dirs = plugin_dirs
    self._hardcoded_manifests = hardcoded_manifests or []
    self._builtin_ids: set[str] = set()
    for manifest in self._hardcoded_manifests:
      try:
        plugin = self._normalize_manifest(manifest)
      except Exception:
        continue
      if plugin.id:
        self._builtin_ids.add(plugin.id)
    self._plugins: dict[str, PluginDescriptor] = {}

  @staticmethod
  def _normalize_manifest(payload: dict[str, Any]) -> PluginDescriptor:
    raw_tools = payload.get("tools", [])
    tools: list[str] = []
    if isinstance(raw_tools, list):
      for item in raw_tools:
        if isinstance(item, str):
          tools.append(item.strip().lower())
        elif isinstance(item, dict):
          name = str(item.get("name") or "").strip().lower()
          if name:
            tools.append(name)

    raw_keywords = payload.get("keywords", [])
    keywords: list[str] = []
    if isinstance(raw_keywords, list):
      for item in raw_keywords:
        text = str(item or "").strip().lower()
        if text:
          keywords.append(text)

    return PluginDescriptor(
      id=str(payload.get("id") or "").strip().lower(),
      name=str(payload.get("name") or "").strip() or "Unnamed plugin",
      subtitle=str(payload.get("subtitle") or payload.get("summary") or "").strip(),
      description=str(payload.get("description") or "").strip(),
      homepage=str(payload.get("homepage") or payload.get("url") or "").strip(),
      enabled=bool(payload.get("enabled", True)),
      tools=tools,
      version=str(payload.get("version") or "0.1.0").strip() or "0.1.0",
      category=str(payload.get("category") or "system").strip().lower() or "system",
      keywords=keywords,
      locked=bool(payload.get("locked", False)),
      allow_update=bool(payload.get("allow_update", True)),
      requires_network=bool(payload.get("requires_network", False)),
    )

  def reload(self) -> None:
    plugin_state = self._storage.get_plugin_state()
    result: dict[str, PluginDescriptor] = {}

    for base_dir in self._plugin_dirs:
      if not base_dir.exists() or not base_dir.is_dir():
        continue

      for file_path in sorted(base_dir.glob("*.json")):
        try:
          payload = json.loads(file_path.read_text(encoding="utf-8"))
          plugin = self._normalize_manifest(payload)
          if not plugin.id:
            continue

          if plugin.id in plugin_state and not plugin.locked:
            plugin.enabled = plugin_state[plugin.id]
          if plugin.locked:
            plugin.enabled = True
          result[plugin.id] = plugin
        except (OSError, json.JSONDecodeError):
          continue

    for manifest in self._hardcoded_manifests:
      try:
        plugin = self._normalize_manifest(manifest)
      except Exception:
        continue
      if not plugin.id:
        continue
      result[plugin.id] = plugin

    for plugin in result.values():
      if plugin.id in plugin_state and not plugin.locked:
        plugin.enabled = plugin_state[plugin.id]
      if plugin.locked:
        plugin.enabled = True

    self._plugins = result

  def list_plugins(self) -> list[PluginDescriptor]:
    return [self._plugins[key] for key in sorted(self._plugins.keys())]

  def get_builtin_ids(self) -> set[str]:
    return set(self._builtin_ids)

  def set_enabled(self, plugin_id: str, enabled: bool) -> PluginDescriptor:
    key = plugin_id.strip().lower()
    plugin = self._plugins.get(key)
    if plugin is None:
      raise KeyError(key)
    if plugin.locked and not enabled:
      raise PermissionError(f"Plugin '{plugin_id}' is always enabled")
    plugin.enabled = enabled
    if not plugin.locked:
      self._storage.set_plugin_enabled(key, enabled)
    return plugin

  def mark_updated(self, plugin_id: str) -> PluginDescriptor:
    key = plugin_id.strip().lower()
    plugin = self._plugins.get(key)
    if plugin is None:
      raise KeyError(key)
    # Пока версия фиксирована в манифесте: обновление отображаем как успешную синхронизацию.
    return plugin

  def resolve_active_tools(self, *, autonomous_mode: bool = False) -> set[str]:
    active: set[str] = set()
    for plugin in self._plugins.values():
      if not plugin.enabled:
        continue
      if autonomous_mode and plugin.requires_network:
        continue
      active.update(plugin.tools)
    return active

def normalize_http_url(url_like: str) -> str:
  raw = str(url_like or "").strip()
  if not raw:
    raise ValueError("URL is required")
  if not re.match(r"^[a-zA-Z][a-zA-Z0-9+\-.]*://", raw):
    raw = f"https://{raw}"

  parsed = url_parse.urlparse(raw)
  if parsed.scheme not in {"http", "https"}:
    raise ValueError("Only http/https URLs are allowed")
  if not parsed.netloc:
    raise ValueError("URL must contain a host")
  return parsed.geturl()


def _resolve_charset(content_type: str, fallback: str = "utf-8") -> str:
  if not content_type:
    return fallback
  match = re.search(r"charset=([a-zA-Z0-9_\-]+)", content_type, flags=re.IGNORECASE)
  if match:
    return match.group(1)
  return fallback


def fetch_web_url(url: str, *, timeout_sec: float = 12.0, max_bytes: int = 2_500_000) -> dict[str, Any]:
  safe_url = normalize_http_url(url)
  safe_timeout = max(3.0, min(30.0, float(timeout_sec)))
  safe_max_bytes = max(128_000, min(8_000_000, int(max_bytes)))

  request = url_request.Request(
    safe_url,
    headers={
      "User-Agent": "AnciaLocalAgent/0.1 (+https://ancial.ru)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "Accept-Language": "ru,en;q=0.8",
    },
  )

  try:
    with url_request.urlopen(request, timeout=safe_timeout) as response:
      status_code = int(response.getcode() or 200)
      final_url = str(response.geturl() or safe_url)
      content_type = str(response.headers.get("Content-Type") or "").strip()
      payload = response.read(safe_max_bytes + 1)
      truncated = len(payload) > safe_max_bytes
      if truncated:
        payload = payload[:safe_max_bytes]

      charset = _resolve_charset(content_type)
      text = payload.decode(charset, errors="replace")
      return {
        "requested_url": safe_url,
        "url": final_url,
        "status_code": status_code,
        "content_type": content_type,
        "text": text,
        "truncated": truncated,
      }
  except url_error.HTTPError as exc:
    body = ""
    try:
      body = exc.read(1200).decode("utf-8", errors="replace")
    except Exception:
      body = ""
    raise RuntimeError(
      f"HTTP {exc.code} for {safe_url}" + (f": {body.strip()}" if body.strip() else "")
    ) from exc
  except url_error.URLError as exc:
    reason = getattr(exc, "reason", exc)
    raise RuntimeError(f"Failed to fetch {safe_url}: {reason}") from exc


def strip_html_tags(fragment: str) -> str:
  without_tags = re.sub(r"<[^>]+>", " ", str(fragment or ""), flags=re.DOTALL)
  return re.sub(r"\s+", " ", html_lib.unescape(without_tags)).strip()


class _HtmlTextExtractor(HTMLParser):
  def __init__(self) -> None:
    super().__init__()
    self._parts: list[str] = []
    self._skip_depth = 0

  def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
    if tag in {"script", "style", "noscript"}:
      self._skip_depth += 1

  def handle_endtag(self, tag: str) -> None:
    if tag in {"script", "style", "noscript"} and self._skip_depth > 0:
      self._skip_depth -= 1

  def handle_data(self, data: str) -> None:
    if self._skip_depth > 0:
      return
    value = re.sub(r"\s+", " ", data or "").strip()
    if value:
      self._parts.append(value)

  def get_text(self) -> str:
    return " ".join(self._parts).strip()


def html_to_text(html: str) -> str:
  parser = _HtmlTextExtractor()
  parser.feed(str(html or ""))
  parser.close()
  return parser.get_text()


def extract_html_title(html: str) -> str:
  match = re.search(r"<title[^>]*>(.*?)</title>", str(html or ""), flags=re.IGNORECASE | re.DOTALL)
  if not match:
    return ""
  return strip_html_tags(match.group(1))


def extract_html_links(html: str, base_url: str, *, limit: int = 20) -> list[str]:
  links: list[str] = []
  seen: set[str] = set()
  for match in re.finditer(r'href=["\']([^"\']+)["\']', str(html or ""), flags=re.IGNORECASE):
    raw_href = html_lib.unescape(match.group(1)).strip()
    if not raw_href:
      continue
    if raw_href.startswith(("#", "javascript:", "mailto:", "tel:")):
      continue
    resolved = url_parse.urljoin(base_url, raw_href)
    parsed = url_parse.urlparse(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
      continue
    normalized = parsed.geturl()
    if normalized in seen:
      continue
    seen.add(normalized)
    links.append(normalized)
    if len(links) >= max(1, limit):
      break
  return links


def decode_duckduckgo_result_url(url_like: str) -> str:
  raw = html_lib.unescape(str(url_like or "").strip())
  if not raw:
    return ""

  parsed = url_parse.urlparse(raw)
  query = url_parse.parse_qs(parsed.query)
  uddg = query.get("uddg", [])
  if uddg:
    decoded = url_parse.unquote(uddg[0])
    if decoded:
      return decoded

  if raw.startswith("//"):
    return f"https:{raw}"
  if raw.startswith("/"):
    return url_parse.urljoin("https://duckduckgo.com", raw)
  return raw


def parse_duckduckgo_results(html: str, *, limit: int = 5) -> list[dict[str, str]]:
  results: list[dict[str, str]] = []
  seen: set[str] = set()

  pattern = re.compile(
    r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    flags=re.IGNORECASE | re.DOTALL,
  )
  for match in pattern.finditer(str(html or "")):
    href = decode_duckduckgo_result_url(match.group(1))
    title = strip_html_tags(match.group(2))
    if not href or not title:
      continue
    parsed = url_parse.urlparse(href)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
      continue
    normalized = parsed.geturl()
    if normalized in seen:
      continue
    seen.add(normalized)
    results.append(
      {
        "title": title,
        "url": normalized,
      }
    )
    if len(results) >= max(1, limit):
      break

  return results
