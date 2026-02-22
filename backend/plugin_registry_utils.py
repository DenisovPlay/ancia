from __future__ import annotations

import json
import re
from typing import Any, Callable
from urllib import error as url_error
from urllib import parse as url_parse
from urllib import request as url_request

SAFE_PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{1,63}$")


def sanitize_plugin_id(value: Any) -> str:
  safe_value = str(value or "").strip().lower()
  if not safe_value:
    return ""
  if not SAFE_PLUGIN_ID_PATTERN.match(safe_value):
    return ""
  return safe_value


def normalize_http_url(url_like: Any) -> str:
  raw_url = str(url_like or "").strip()
  if not raw_url:
    raise ValueError("URL is required")
  parsed = url_parse.urlparse(raw_url)
  if not parsed.scheme:
    raw_url = f"https://{raw_url}"
    parsed = url_parse.urlparse(raw_url)
  if parsed.scheme not in {"http", "https"}:
    raise ValueError("Only http/https URLs are allowed")
  if not parsed.netloc:
    raise ValueError("URL host is required")
  return parsed.geturl()


def normalize_registry_url(url_like: Any) -> str:
  safe_url = normalize_http_url(url_like)
  parsed = url_parse.urlparse(safe_url)
  netloc = parsed.netloc.strip().lower()
  path_parts = [part for part in parsed.path.split("/") if part]

  # Legacy format used by older builds:
  # https://raw.githubusercontent.com/<owner>/<repo>/index.json
  # Correct format requires branch segment:
  # https://raw.githubusercontent.com/<owner>/<repo>/main/index.json
  if netloc == "raw.githubusercontent.com" and len(path_parts) == 3:
    owner, repo, file_name = path_parts
    if file_name.lower().endswith(".json"):
      parsed = parsed._replace(path=f"/{owner}/{repo}/main/{file_name}")
      return url_parse.urlunparse(parsed)

  return safe_url


def resolve_plugin_registry_url(*, storage: Any, setting_key: str, default_url: str) -> str:
  from_settings = str(storage.get_setting(setting_key) or "").strip()
  if from_settings:
    try:
      normalized = normalize_registry_url(from_settings)
      if normalized != from_settings:
        try:
          storage.set_setting(setting_key, normalized)
        except Exception:
          pass
      return normalized
    except ValueError:
      pass
  try:
    return normalize_registry_url(default_url)
  except ValueError:
    return default_url


def fetch_remote_json(url: str, *, max_bytes: int) -> Any:
  payload = fetch_remote_bytes(url, max_bytes=max_bytes)
  try:
    text = payload.decode("utf-8")
    return json.loads(text)
  except (UnicodeDecodeError, json.JSONDecodeError) as exc:
    raise RuntimeError("Registry payload is not valid JSON") from exc


def fetch_remote_bytes(url: str, *, max_bytes: int) -> bytes:
  try:
    safe_url = normalize_registry_url(url)
  except ValueError as exc:
    raise RuntimeError(str(exc)) from exc

  request = url_request.Request(
    safe_url,
    headers={
      "User-Agent": "Ancia/0.1 (+plugin-registry)",
      "Accept": "application/json, text/plain;q=0.9, */*;q=0.5",
    },
  )

  try:
    with url_request.urlopen(request, timeout=20) as response:
      raw = response.read(max_bytes + 1)
  except url_error.HTTPError as exc:
    raise RuntimeError(f"HTTP {exc.code} while fetching registry") from exc
  except url_error.URLError as exc:
    raise RuntimeError(f"Network error while fetching registry: {exc.reason}") from exc
  except OSError as exc:
    raise RuntimeError(f"Network error while fetching registry: {exc}") from exc

  if len(raw) > max_bytes:
    raise RuntimeError("Registry payload is too large")
  return raw



def normalize_registry_item(payload: Any) -> dict[str, Any] | None:
  if not isinstance(payload, dict):
    return None

  plugin_id = sanitize_plugin_id(
    payload.get("id")
    or payload.get("plugin_id")
    or payload.get("slug"),
  )
  if not plugin_id:
    return None

  manifest_url = ""
  manifest_candidate = str(payload.get("manifest_url") or payload.get("manifestUrl") or "").strip()
  if manifest_candidate:
    try:
      manifest_url = normalize_http_url(manifest_candidate)
    except ValueError:
      manifest_url = ""

  homepage = str(payload.get("homepage") or payload.get("url") or "").strip()
  if homepage:
    try:
      homepage = normalize_http_url(homepage)
    except ValueError:
      homepage = ""

  repo_url = str(payload.get("repo_url") or payload.get("repoUrl") or "").strip()
  if repo_url:
    try:
      repo_url = normalize_http_url(repo_url)
    except ValueError:
      repo_url = ""

  package_url = str(payload.get("package_url") or payload.get("packageUrl") or "").strip()
  if package_url:
    try:
      package_url = normalize_http_url(package_url)
    except ValueError:
      package_url = ""

  raw_keywords = payload.get("keywords")
  keywords: list[str] = []
  if isinstance(raw_keywords, list):
    for keyword in raw_keywords:
      safe_keyword = str(keyword or "").strip().lower()
      if safe_keyword:
        keywords.append(safe_keyword)
  unique_keywords = sorted(set(keywords))

  raw_tools = payload.get("tools")
  tools: list[str] = []
  if isinstance(raw_tools, list):
    for item in raw_tools:
      if isinstance(item, str):
        safe_tool = item.strip().lower()
        if safe_tool:
          tools.append(safe_tool)
      elif isinstance(item, dict):
        safe_tool = str(item.get("name") or "").strip().lower()
        if safe_tool:
          tools.append(safe_tool)

  return {
    "id": plugin_id,
    "name": str(payload.get("name") or payload.get("title") or plugin_id).strip(),
    "subtitle": str(payload.get("subtitle") or payload.get("summary") or "").strip(),
    "description": str(payload.get("description") or "").strip(),
    "category": str(payload.get("category") or "system").strip().lower() or "system",
    "version": str(payload.get("version") or "0.1.0").strip() or "0.1.0",
    "homepage": homepage,
    "repo_url": repo_url,
    "manifest_url": manifest_url,
    "package_url": package_url,
    "source": str(payload.get("source") or "registry").strip().lower() or "registry",
    "preinstalled": bool(payload.get("preinstalled", False)),
    "keywords": unique_keywords,
    "tools": tools,
    "requires_network": bool(payload.get("requires_network", False)),
  }


def parse_registry_payload(payload: Any) -> list[dict[str, Any]]:
  items: list[Any] = []
  if isinstance(payload, list):
    items = payload
  elif isinstance(payload, dict):
    for key in ("plugins", "items", "entries"):
      candidate = payload.get(key)
      if isinstance(candidate, list):
        items = candidate
        break

  normalized_items: list[dict[str, Any]] = []
  seen_ids: set[str] = set()
  for item in items:
    normalized = normalize_registry_item(item)
    if not normalized:
      continue
    plugin_id = str(normalized.get("id") or "").strip().lower()
    if not plugin_id or plugin_id in seen_ids:
      continue
    seen_ids.add(plugin_id)
    normalized_items.append(normalized)
  return normalized_items


def load_registry_items(
  *,
  storage: Any,
  setting_key: str,
  default_url: str,
  autonomous_mode: bool,
  max_registry_download_bytes: int,
) -> dict[str, Any]:
  registry_url = resolve_plugin_registry_url(
    storage=storage,
    setting_key=setting_key,
    default_url=default_url,
  )

  if autonomous_mode:
    return {
      "registry_url": registry_url,
      "plugins": [],
      "error": "Автономный режим включен: внешний реестр плагинов недоступен.",
      "fetched": False,
    }
  if not registry_url:
    return {
      "registry_url": "",
      "plugins": [],
      "error": "URL реестра плагинов не настроен.",
      "fetched": False,
    }

  try:
    payload = fetch_remote_json(
      registry_url,
      max_bytes=max_registry_download_bytes,
    )
    return {
      "registry_url": registry_url,
      "plugins": parse_registry_payload(payload),
      "error": "",
      "fetched": True,
    }
  except RuntimeError as exc:
    return {
      "registry_url": registry_url,
      "plugins": [],
      "error": str(exc),
      "fetched": False,
    }
