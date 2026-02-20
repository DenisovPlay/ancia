from __future__ import annotations

import datetime as dt
import os
import re
import uuid
from pathlib import Path
from typing import Any
from urllib import parse as url_parse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

try:
  from backend.common import normalize_mood
  from backend.schemas import RuntimeChatContext
  from backend.storage import AppStorage
except ModuleNotFoundError:
  from common import normalize_mood  # type: ignore
  from schemas import RuntimeChatContext  # type: ignore
  from storage import AppStorage  # type: ignore

try:
  from backend.tooling import (
    HARDCODED_PLUGIN_MANIFESTS,
    PluginManager,
    ToolRegistry,
    extract_html_links,
    extract_html_title,
    fetch_web_url,
    html_to_text,
    normalize_http_url,
    parse_duckduckgo_results,
  )
except ModuleNotFoundError:
  from tooling import (  # type: ignore
    HARDCODED_PLUGIN_MANIFESTS,
    PluginManager,
    ToolRegistry,
    extract_html_links,
    extract_html_title,
    fetch_web_url,
    html_to_text,
    normalize_http_url,
    parse_duckduckgo_results,
  )

try:
  from backend.routes import register_api_routes
except ModuleNotFoundError:
  from routes import register_api_routes  # type: ignore


try:
  from backend.engine import PythonModelEngine, build_system_prompt, normalize_model_tier_key
except ModuleNotFoundError:
  from engine import PythonModelEngine, build_system_prompt, normalize_model_tier_key  # type: ignore


def resolve_now_for_timezone(timezone: str) -> tuple[str, str]:
  tz_name = timezone.strip() or "UTC"
  try:
    zone = ZoneInfo(tz_name)
  except ZoneInfoNotFoundError:
    zone = ZoneInfo("UTC")
    tz_name = "UTC"
  now = dt.datetime.now(zone)
  return now.isoformat(timespec="seconds"), tz_name


def resolve_data_dir() -> Path:
  env_path = os.getenv("ANCIA_BACKEND_DATA_DIR", "").strip()
  if env_path:
    return Path(env_path).expanduser().resolve()
  return (Path(__file__).resolve().parent / ".runtime").resolve()


def resolve_system_prompt_path() -> Path:
  env_path = os.getenv("ANCIA_SYSTEM_PROMPT", "").strip()
  if env_path:
    return Path(env_path).expanduser().resolve()

  backend_dir = Path(__file__).resolve().parent
  project_root = backend_dir.parent
  candidate_paths = [
    (project_root / "system_promt.txt").resolve(),
    (backend_dir / "data" / "system_prompt.txt").resolve(),
  ]
  for candidate in candidate_paths:
    if candidate.exists():
      return candidate

  return candidate_paths[-1]


def load_system_prompt() -> str:
  path = resolve_system_prompt_path()
  if path.exists():
    try:
      return path.read_text(encoding="utf-8").strip()
    except OSError:
      pass

  return "Ты локальный агент Ancia. Отвечай кратко и сохраняй контекст пользователя."


def make_app() -> FastAPI:
  app = FastAPI(title="Ancia Local Agent Backend", version="0.1.0")
  cors_origins_raw = os.getenv("ANCIA_CORS_ALLOW_ORIGINS", "*").strip()
  cors_origins = ["*"] if cors_origins_raw == "*" else [
    origin.strip()
    for origin in cors_origins_raw.split(",")
    if origin.strip()
  ]
  app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
  )

  # Приходит часть OPTIONS не как CORS preflight (без Origin/Access-Control-Request-Method),
  # поэтому FastAPI по умолчанию отвечает 405. Ловим все OPTIONS и отдаём 204.
  @app.options("/{full_path:path}")
  def options_passthrough(full_path: str) -> Response:
    return Response(status_code=204)

  data_dir = resolve_data_dir()
  data_dir.mkdir(parents=True, exist_ok=True)

  storage = AppStorage(data_dir / "app.db")
  system_prompt = load_system_prompt()
  model_engine = PythonModelEngine(storage, base_system_prompt=system_prompt)
  auto_load_enabled = os.getenv("ANCIA_ENABLE_MODEL_EAGER_LOAD", "").strip() == "1"
  if auto_load_enabled:
    model_engine.start_background_load()
  tool_registry = ToolRegistry()

  def is_autonomous_mode() -> bool:
    return storage.get_setting_flag("autonomous_mode", False)

  def tool_system_time(args: dict[str, Any], runtime: RuntimeChatContext) -> dict[str, Any]:
    local_time, tz = resolve_now_for_timezone(runtime.timezone)
    return {
      "local_time": local_time,
      "timezone": tz,
      "request_id": str(uuid.uuid4()),
    }

  def tool_set_chat_mood(args: dict[str, Any], runtime: RuntimeChatContext) -> dict[str, Any]:
    mood = normalize_mood(str(args.get("mood") or runtime.mood), runtime.mood)
    storage.update_chat_mood(runtime.chat_id, mood)
    return {
      "chat_id": runtime.chat_id,
      "mood": mood,
    }

  def tool_web_search_duckduckgo(args: dict[str, Any], runtime: RuntimeChatContext) -> dict[str, Any]:
    if is_autonomous_mode():
      raise RuntimeError("Автономный режим включен: внешние веб-запросы отключены.")
    query = str(args.get("query") or "").strip()
    if not query:
      raise ValueError("query is required")

    try:
      limit = int(args.get("limit") or 5)
    except (TypeError, ValueError):
      limit = 5
    limit = max(1, min(8, limit))

    search_url = "https://duckduckgo.com/html/?q=" + url_parse.quote_plus(query)
    payload = fetch_web_url(search_url)
    results = parse_duckduckgo_results(payload.get("text", ""), limit=limit)

    return {
      "query": query,
      "count": len(results),
      "results": results,
      "source": "duckduckgo",
      "search_url": search_url,
      "response_url": payload.get("url", search_url),
      "status_code": payload.get("status_code", 200),
    }

  def tool_visit_website(args: dict[str, Any], runtime: RuntimeChatContext) -> dict[str, Any]:
    if is_autonomous_mode():
      raise RuntimeError("Автономный режим включен: внешние веб-запросы отключены.")
    raw_url = str(args.get("url") or "").strip()
    if not raw_url:
      raise ValueError("url is required")

    try:
      max_chars = int(args.get("max_chars") or 6000)
    except (TypeError, ValueError):
      max_chars = 6000
    max_chars = max(400, min(40_000, max_chars))

    try:
      max_links = int(args.get("max_links") or 20)
    except (TypeError, ValueError):
      max_links = 20
    max_links = max(0, min(100, max_links))

    payload = fetch_web_url(raw_url)
    content_type = str(payload.get("content_type") or "").lower()
    raw_text = str(payload.get("text") or "")
    is_html = "html" in content_type

    title = extract_html_title(raw_text) if is_html else ""
    content = html_to_text(raw_text) if is_html else re.sub(r"\s+", " ", raw_text).strip()
    content = content[:max_chars].strip()
    links = extract_html_links(raw_text, str(payload.get("url") or raw_url), limit=max_links) if is_html else []

    return {
      "requested_url": normalize_http_url(raw_url),
      "url": str(payload.get("url") or raw_url),
      "status_code": int(payload.get("status_code") or 200),
      "content_type": str(payload.get("content_type") or ""),
      "title": title,
      "content": content,
      "links": links,
      "truncated": bool(payload.get("truncated")) or (len(content) >= max_chars),
    }

  tool_registry.register(
    name="system.time",
    description="Возвращает локальное время пользователя по указанному часовому поясу.",
    input_schema={"type": "object", "properties": {}, "additionalProperties": False},
    handler=tool_system_time,
  )
  tool_registry.register(
    name="chat.set_mood",
    description="Устанавливает mood для активного чата.",
    input_schema={
      "type": "object",
      "properties": {
        "mood": {"type": "string"},
      },
      "required": ["mood"],
      "additionalProperties": False,
    },
    handler=tool_set_chat_mood,
  )
  tool_registry.register(
    name="web.search.duckduckgo",
    description="Выполняет веб-поиск через DuckDuckGo и возвращает список ссылок.",
    input_schema={
      "type": "object",
      "properties": {
        "query": {"type": "string"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 8},
      },
      "required": ["query"],
      "additionalProperties": False,
    },
    handler=tool_web_search_duckduckgo,
  )
  tool_registry.register(
    name="web.visit.website",
    description="Открывает URL и извлекает текст, заголовок и ссылки страницы.",
    input_schema={
      "type": "object",
      "properties": {
        "url": {"type": "string"},
        "max_chars": {"type": "integer", "minimum": 400, "maximum": 40000},
        "max_links": {"type": "integer", "minimum": 0, "maximum": 100},
      },
      "required": ["url"],
      "additionalProperties": False,
    },
    handler=tool_visit_website,
  )

  plugin_manager = PluginManager(
    storage=storage,
    plugin_dirs=[
      (Path(__file__).resolve().parent / "plugins").resolve(),
      (data_dir / "plugins").resolve(),
    ],
    hardcoded_manifests=HARDCODED_PLUGIN_MANIFESTS,
  )
  plugin_manager.reload()
  register_api_routes(
    app,
    storage=storage,
    model_engine=model_engine,
    tool_registry=tool_registry,
    plugin_manager=plugin_manager,
    system_prompt=system_prompt,
    data_dir=str(data_dir),
    build_system_prompt_fn=build_system_prompt,
    normalize_model_tier_key_fn=normalize_model_tier_key,
  )

  return app


app = make_app()


if __name__ == "__main__":
  import uvicorn

  host = os.getenv("ANCIA_BACKEND_HOST", "127.0.0.1")
  port = int(os.getenv("ANCIA_BACKEND_PORT", "5055"))
  uvicorn.run("backend.main:app", host=host, port=port, reload=False)
