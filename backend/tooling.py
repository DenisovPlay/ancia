from __future__ import annotations

import html as html_lib
import json
import os
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

from pydantic import BaseModel, Field


ToolHandler = Callable[[dict[str, Any], Any], dict[str, Any]]
SAFE_TOOL_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,127}$")
SAFE_PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,63}$")


class ToolRegistry:
  def __init__(self) -> None:
    self._handlers: dict[str, ToolHandler] = {}
    self._meta: dict[str, dict[str, Any]] = {}
    self._aliases: dict[str, str] = {}

  def clear(self) -> None:
    self._handlers = {}
    self._meta = {}
    self._aliases = {}

  def register(
    self,
    *,
    name: str,
    description: str,
    input_schema: dict[str, Any],
    handler: ToolHandler,
    runtime_meta: dict[str, Any] | None = None,
    llm_schema: dict[str, Any] | None = None,
  ) -> None:
    normalized_name = name.strip().lower()
    if not SAFE_TOOL_NAME_PATTERN.match(normalized_name):
      raise ValueError(f"Unsupported tool name: {name}")
    self._handlers[normalized_name] = handler
    safe_description = str(description or normalized_name).strip() or normalized_name
    safe_input_schema = input_schema if isinstance(input_schema, dict) else {}
    tool_schema = llm_schema if isinstance(llm_schema, dict) else {
      "type": "function",
      "function": {
        "name": normalized_name,
        "description": safe_description,
        "parameters": safe_input_schema,
      },
    }
    meta = {
      "name": normalized_name,
      "description": safe_description,
      "input_schema": safe_input_schema,
      "llm_schema": tool_schema,
    }
    if isinstance(runtime_meta, dict):
      for key, value in runtime_meta.items():
        if key in {"name", "description", "input_schema", "llm_schema"}:
          continue
        meta[key] = value
    self._meta[normalized_name] = meta
    self._aliases[normalized_name] = normalized_name
    raw_aliases = runtime_meta.get("aliases") if isinstance(runtime_meta, dict) else []
    if isinstance(raw_aliases, list):
      for alias in raw_aliases:
        safe_alias = str(alias or "").strip().lower()
        if safe_alias and SAFE_TOOL_NAME_PATTERN.match(safe_alias):
          self._aliases[safe_alias] = normalized_name

  def resolve_tool_name(self, name: str) -> str:
    normalized_name = str(name or "").strip().lower()
    if not normalized_name:
      return ""
    return self._aliases.get(normalized_name, normalized_name)

  def has_tool(self, name: str) -> bool:
    return self.resolve_tool_name(name) in self._handlers

  def get_tool_meta(self, name: str) -> dict[str, Any]:
    normalized_name = self.resolve_tool_name(name)
    payload = self._meta.get(normalized_name)
    return dict(payload) if isinstance(payload, dict) else {}

  def execute(self, name: str, args: dict[str, Any], runtime: Any) -> dict[str, Any]:
    normalized_name = self.resolve_tool_name(name)
    handler = self._handlers.get(normalized_name)
    if handler is None:
      raise KeyError(f"Tool '{name}' is not registered")
    return handler(args, runtime)

  def list_tools(self) -> list[dict[str, Any]]:
    return [self._meta[name] for name in sorted(self._meta.keys())]

  def build_llm_schema_map(self, names: set[str] | None = None) -> dict[str, dict[str, Any]]:
    if names is None:
      target_names = set(self._meta.keys())
    else:
      target_names = {str(name or "").strip().lower() for name in names if str(name or "").strip()}
    out: dict[str, dict[str, Any]] = {}
    for name in sorted(target_names):
      payload = self._meta.get(name)
      if not isinstance(payload, dict):
        continue
      schema = payload.get("llm_schema")
      if isinstance(schema, dict):
        out[name] = dict(schema)
    return out

  def build_tool_definition_map(self, names: set[str] | None = None) -> dict[str, dict[str, Any]]:
    if names is None:
      target_names = set(self._meta.keys())
    else:
      target_names = {str(name or "").strip().lower() for name in names if str(name or "").strip()}
    out: dict[str, dict[str, Any]] = {}
    for name in sorted(target_names):
      payload = self._meta.get(name)
      if not isinstance(payload, dict):
        continue
      out[name] = {
        "name": name,
        "description": str(payload.get("description") or ""),
        "input_schema": payload.get("input_schema") if isinstance(payload.get("input_schema"), dict) else {
          "type": "object",
          "properties": {},
          "required": [],
          "additionalProperties": False,
        },
        "runtime_meta": {
          "display_name": str(payload.get("display_name") or payload.get("name") or name),
          "subtitle": str(payload.get("subtitle") or ""),
          "category": str(payload.get("category") or "system"),
          "keywords": list(payload.get("keywords") or []),
          "requires_network": bool(payload.get("requires_network", False)),
          "aliases": list(payload.get("aliases") or []),
          "prompt": str(payload.get("prompt") or ""),
        },
      }
    return out


class PluginDescriptor(BaseModel):
  id: str
  name: str
  subtitle: str = ""
  description: str = ""
  homepage: str = ""
  manifest_url: str = ""
  repo_url: str = ""
  package_url: str = ""
  manifest_path: str = ""
  plugin_dir: str = ""
  source: str = "user"
  preinstalled: bool = False
  enabled: bool = True
  tools: list[str] = Field(default_factory=list)
  tool_specs: list[dict[str, Any]] = Field(default_factory=list)
  ui_extensions: list[dict[str, Any]] = Field(default_factory=list)
  version: str = "0.1.0"
  category: str = "system"
  keywords: list[str] = Field(default_factory=list)
  locked: bool = False
  allow_update: bool = True
  requires_network: bool = False


TOOL_NAME_ALIASES: dict[str, str] = {}


def resolve_tool_name_alias(raw_name: str) -> str:
  safe_raw = str(raw_name or "").strip().lower()
  if not safe_raw:
    return ""
  return TOOL_NAME_ALIASES.get(safe_raw, safe_raw)


class PluginManager:
  def __init__(
    self,
    storage: Any,
    plugin_dirs: list[Path],
  ) -> None:
    self._storage = storage
    self._plugin_dirs = [Path(item).resolve() for item in plugin_dirs]
    self._plugins: dict[str, PluginDescriptor] = {}

  @staticmethod
  def _normalize_tool_name(name: Any) -> str:
    safe_name = resolve_tool_name_alias(str(name or "").strip().lower())
    if not SAFE_TOOL_NAME_PATTERN.match(safe_name):
      return ""
    return safe_name

  @staticmethod
  def _normalize_input_schema(schema: Any) -> dict[str, Any]:
    if isinstance(schema, dict):
      out = dict(schema)
    else:
      out = {}
    out.setdefault("type", "object")
    out.setdefault("properties", {})
    out.setdefault("required", [])
    out.setdefault("additionalProperties", False)
    if not isinstance(out.get("properties"), dict):
      out["properties"] = {}
    if not isinstance(out.get("required"), list):
      out["required"] = []
    return out

  @classmethod
  def _normalize_tool_spec(cls, payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, str):
      safe_name = cls._normalize_tool_name(payload)
      if not safe_name:
        return None
      return {
        "name": safe_name,
        "description": safe_name,
        "input_schema": cls._normalize_input_schema({}),
        "runtime_meta": {},
        "handler": {
          "type": "builtin",
          "name": safe_name,
        },
      }
    if not isinstance(payload, dict):
      return None
    function_payload = payload.get("function") if isinstance(payload.get("function"), dict) else {}
    schema_payload = payload.get("schema") if isinstance(payload.get("schema"), dict) else {}
    schema_function_payload = (
      schema_payload.get("function")
      if isinstance(schema_payload.get("function"), dict)
      else {}
    )

    safe_name = cls._normalize_tool_name(
      payload.get("name")
      or payload.get("tool")
      or payload.get("tool_name")
      or function_payload.get("name")
      or schema_function_payload.get("name"),
    )
    if not safe_name:
      return None
    description = str(
      payload.get("description")
      or function_payload.get("description")
      or schema_function_payload.get("description")
      or safe_name
    ).strip() or safe_name
    input_schema = cls._normalize_input_schema(
      payload.get("input_schema")
      if isinstance(payload.get("input_schema"), dict)
      else (
        payload.get("parameters")
        if isinstance(payload.get("parameters"), dict)
        else (
          function_payload.get("parameters")
          if isinstance(function_payload.get("parameters"), dict)
          else schema_function_payload.get("parameters")
        )
      ),
    )
    runtime_meta_raw = payload.get("runtime_meta")
    runtime_meta = dict(runtime_meta_raw) if isinstance(runtime_meta_raw, dict) else {}
    if not runtime_meta.get("display_name"):
      runtime_meta["display_name"] = str(payload.get("title") or safe_name)
    if "subtitle" not in runtime_meta:
      runtime_meta["subtitle"] = str(payload.get("subtitle") or "")
    if "category" not in runtime_meta:
      runtime_meta["category"] = str(payload.get("category") or "system")
    if "keywords" not in runtime_meta:
      runtime_meta["keywords"] = list(payload.get("keywords") or [])
    if "requires_network" not in runtime_meta:
      runtime_meta["requires_network"] = bool(payload.get("requires_network", False))
    if "aliases" not in runtime_meta:
      raw_aliases = payload.get("aliases")
      aliases: list[str] = []
      if isinstance(raw_aliases, list):
        for item in raw_aliases:
          safe_alias = str(item or "").strip().lower()
          if safe_alias and SAFE_TOOL_NAME_PATTERN.match(safe_alias):
            aliases.append(safe_alias)
      runtime_meta["aliases"] = aliases
    if "prompt" not in runtime_meta:
      runtime_meta["prompt"] = str(payload.get("prompt") or payload.get("prompt_hint") or "").strip()
    handler_raw = payload.get("handler")
    if isinstance(handler_raw, dict):
      handler = dict(handler_raw)
    else:
      handler = {
        "type": "builtin",
        "name": safe_name,
      }
    return {
      "name": safe_name,
      "description": description,
      "input_schema": input_schema,
      "runtime_meta": runtime_meta,
      "handler": handler,
      "llm_schema": (
        dict(schema_payload)
        if isinstance(schema_payload, dict) and str(schema_payload.get("type") or "").strip().lower() == "function"
        else (
          dict(payload.get("llm_schema"))
          if isinstance(payload.get("llm_schema"), dict)
          else {}
        )
      ),
    }

  @staticmethod
  def _normalize_ui_extensions(payload: dict[str, Any]) -> list[dict[str, Any]]:
    extensions: list[dict[str, Any]] = []
    raw_extensions = payload.get("ui_extensions")
    if isinstance(raw_extensions, list):
      for item in raw_extensions:
        if not isinstance(item, dict):
          continue
        ext_type = str(item.get("type") or "").strip().lower()
        if ext_type not in {"script", "style"}:
          continue
        path_value = str(item.get("path") or "").strip()
        url_value = str(item.get("url") or "").strip()
        if path_value and (Path(path_value).is_absolute() or ".." in Path(path_value).parts):
          continue
        if not path_value and not url_value:
          continue
        extensions.append(
          {
            "type": ext_type,
            "path": path_value,
            "url": url_value,
            "load": str(item.get("load") or ("module" if ext_type == "script" else "style")).strip().lower(),
          }
        )

    ui_payload = payload.get("ui")
    if isinstance(ui_payload, dict):
      for style_item in ui_payload.get("styles") or []:
        if isinstance(style_item, str):
          style_path = style_item.strip()
          if style_path and not Path(style_path).is_absolute() and ".." not in Path(style_path).parts:
            extensions.append({"type": "style", "path": style_path, "url": "", "load": "style"})
        elif isinstance(style_item, dict):
          style_path = str(style_item.get("path") or "").strip()
          style_url = str(style_item.get("url") or "").strip()
          if style_path and (Path(style_path).is_absolute() or ".." in Path(style_path).parts):
            continue
          if style_path or style_url:
            extensions.append({"type": "style", "path": style_path, "url": style_url, "load": "style"})
      for script_item in ui_payload.get("scripts") or []:
        if isinstance(script_item, str):
          script_path = script_item.strip()
          if script_path and not Path(script_path).is_absolute() and ".." not in Path(script_path).parts:
            extensions.append({"type": "script", "path": script_path, "url": "", "load": "module"})
        elif isinstance(script_item, dict):
          script_path = str(script_item.get("path") or "").strip()
          script_url = str(script_item.get("url") or "").strip()
          load_mode = str(script_item.get("load") or "module").strip().lower()
          if script_path and (Path(script_path).is_absolute() or ".." in Path(script_path).parts):
            continue
          if script_path or script_url:
            extensions.append({"type": "script", "path": script_path, "url": script_url, "load": load_mode})

    # Дедупликация сохранением порядка.
    seen: set[tuple[str, str, str]] = set()
    out: list[dict[str, Any]] = []
    for item in extensions:
      key = (str(item.get("type") or ""), str(item.get("path") or ""), str(item.get("url") or ""))
      if key in seen:
        continue
      seen.add(key)
      out.append(item)
    return out

  @staticmethod
  def _normalize_plugin_id(value: Any) -> str:
    safe_value = str(value or "").strip().lower()
    if not SAFE_PLUGIN_ID_PATTERN.match(safe_value):
      return ""
    return safe_value

  @classmethod
  def _normalize_manifest(
    cls,
    payload: dict[str, Any],
    *,
    manifest_path: Path | None = None,
    source: str = "",
  ) -> PluginDescriptor:
    plugin_id = cls._normalize_plugin_id(payload.get("id"))
    if not plugin_id:
      raise ValueError("plugin id is required")

    raw_tools = payload.get("tools", [])
    if not isinstance(raw_tools, list):
      raw_tools = payload.get("tool_specs", [])
    tool_specs: list[dict[str, Any]] = []
    tools: list[str] = []
    if isinstance(raw_tools, list):
      for item in raw_tools:
        normalized_tool = cls._normalize_tool_spec(item)
        if not normalized_tool:
          continue
        tool_specs.append(normalized_tool)
        tools.append(str(normalized_tool.get("name") or "").strip().lower())

    raw_keywords = payload.get("keywords", [])
    keywords: list[str] = []
    if isinstance(raw_keywords, list):
      for item in raw_keywords:
        text = str(item or "").strip().lower()
        if text:
          keywords.append(text)

    safe_manifest_path = manifest_path.resolve() if isinstance(manifest_path, Path) else None
    safe_plugin_dir = safe_manifest_path.parent if safe_manifest_path else None
    detected_source = str(payload.get("source") or source or "user").strip().lower() or "user"
    requires_network = bool(payload.get("requires_network", False))
    if not requires_network:
      requires_network = any(bool(spec.get("runtime_meta", {}).get("requires_network", False)) for spec in tool_specs)

    return PluginDescriptor(
      id=plugin_id,
      name=str(payload.get("name") or "").strip() or "Unnamed plugin",
      subtitle=str(payload.get("subtitle") or payload.get("summary") or "").strip(),
      description=str(payload.get("description") or "").strip(),
      homepage=str(payload.get("homepage") or payload.get("url") or "").strip(),
      manifest_url=str(payload.get("manifest_url") or payload.get("manifestUrl") or "").strip(),
      repo_url=str(payload.get("repo_url") or payload.get("repoUrl") or "").strip(),
      package_url=str(payload.get("package_url") or payload.get("packageUrl") or "").strip(),
      manifest_path=str(safe_manifest_path or ""),
      plugin_dir=str(safe_plugin_dir or ""),
      source=detected_source,
      preinstalled=bool(payload.get("preinstalled", False)),
      enabled=bool(payload.get("enabled", True)),
      tools=tools,
      tool_specs=tool_specs,
      ui_extensions=cls._normalize_ui_extensions(payload),
      version=str(payload.get("version") or "0.1.0").strip() or "0.1.0",
      category=str(payload.get("category") or "system").strip().lower() or "system",
      keywords=keywords,
      locked=bool(payload.get("locked", False)),
      allow_update=bool(payload.get("allow_update", True)),
      requires_network=requires_network,
    )

  @staticmethod
  def _iter_manifest_paths(base_dir: Path) -> list[Path]:
    files: list[Path] = []
    if not base_dir.exists() or not base_dir.is_dir():
      return files
    for entry in sorted(base_dir.iterdir()):
      if entry.is_dir():
        for candidate_name in ("manifest.json", "plugin.json"):
          candidate = (entry / candidate_name).resolve()
          if candidate.exists() and candidate.is_file():
            files.append(candidate)
            break
      elif entry.is_file() and entry.suffix.lower() == ".json":
        files.append(entry.resolve())
    return files

  def reload(self) -> None:
    plugin_state = self._storage.get_plugin_state()
    result: dict[str, PluginDescriptor] = {}

    for base_dir in self._plugin_dirs:
      for file_path in self._iter_manifest_paths(base_dir):
        try:
          payload = json.loads(file_path.read_text(encoding="utf-8"))
          plugin = self._normalize_manifest(
            payload,
            manifest_path=file_path,
            source=str(payload.get("source") or "user"),
          )
          if not plugin.id:
            continue

          if plugin.id in plugin_state and not plugin.locked:
            plugin.enabled = plugin_state[plugin.id]
          if plugin.locked:
            plugin.enabled = True
          result[plugin.id] = plugin
        except (OSError, json.JSONDecodeError, ValueError):
          continue

    for plugin in result.values():
      if plugin.id in plugin_state and not plugin.locked:
        plugin.enabled = plugin_state[plugin.id]
      if plugin.locked:
        plugin.enabled = True

    self._plugins = result

  def list_plugins(self) -> list[PluginDescriptor]:
    return [self._plugins[key] for key in sorted(self._plugins.keys())]

  def get_plugin(self, plugin_id: str) -> PluginDescriptor | None:
    key = str(plugin_id or "").strip().lower()
    if not key:
      return None
    return self._plugins.get(key)

  def get_builtin_ids(self) -> set[str]:
    return {
      plugin.id
      for plugin in self._plugins.values()
      if plugin.preinstalled or plugin.source == "builtin"
    }

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

  def iter_tool_specs(self, *, include_disabled: bool = True) -> list[tuple[PluginDescriptor, dict[str, Any]]]:
    entries: list[tuple[PluginDescriptor, dict[str, Any]]] = []
    for plugin in self.list_plugins():
      if not include_disabled and not plugin.enabled:
        continue
      for spec in plugin.tool_specs:
        if not isinstance(spec, dict):
          continue
        name = str(spec.get("name") or "").strip().lower()
        if not name:
          continue
        entries.append((plugin, dict(spec)))
    return entries

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
