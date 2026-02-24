from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

try:
  from backend.plugin_host_api import PluginHostApi
  from backend.storage import AppStorage
except ModuleNotFoundError:
  from plugin_host_api import PluginHostApi  # type: ignore
  from storage import AppStorage  # type: ignore

try:
  from backend.tooling import PluginManager, ToolRegistry
except ModuleNotFoundError:
  from tooling import PluginManager, ToolRegistry  # type: ignore

try:
  from backend.plugin_tool_runtime import register_tools_from_plugins
except ModuleNotFoundError:
  from plugin_tool_runtime import register_tools_from_plugins  # type: ignore

try:
  from backend.routes import register_api_routes
except ModuleNotFoundError:
  from routes import register_api_routes  # type: ignore


try:
  from backend.engine import PythonModelEngine, build_system_prompt
except ModuleNotFoundError:
  from engine import PythonModelEngine, build_system_prompt  # type: ignore


def resolve_data_dir() -> Path:
  env_path = os.getenv("ANCIA_BACKEND_DATA_DIR", "").strip()
  if env_path:
    return Path(env_path).expanduser().resolve()
  return (Path(__file__).resolve().parent / ".runtime").resolve()


def resolve_plugins_root_dir() -> Path:
  env_path = os.getenv("ANCIA_PLUGINS_DIR", "").strip()
  if env_path:
    return Path(env_path).expanduser().resolve()
  return (Path(__file__).resolve().parent / "plugins").resolve()


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


LOGGER = logging.getLogger("ancia.backend.main")
PROD_CORS_DEFAULT_ORIGINS = [
  "tauri://localhost",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "http://127.0.0.1:1420",
  "http://localhost:1420",
]


def _parse_cors_origins(raw_value: str) -> list[str]:
  return [
    origin.strip()
    for origin in str(raw_value or "").split(",")
    if origin.strip()
  ]


def resolve_cors_origins() -> tuple[list[str], str]:
  profile = str(os.getenv("ANCIA_CORS_PROFILE", "dev") or "dev").strip().lower()
  raw_origins = str(os.getenv("ANCIA_CORS_ALLOW_ORIGINS", "") or "").strip()

  if profile == "prod":
    if raw_origins:
      parsed = _parse_cors_origins(raw_origins)
      origins = [origin for origin in parsed if origin != "*"]
      if not origins:
        origins = PROD_CORS_DEFAULT_ORIGINS.copy()
    else:
      origins = PROD_CORS_DEFAULT_ORIGINS.copy()
    return origins, "prod"

  # dev profile: wildcard by default for local iteration.
  if not raw_origins or raw_origins == "*":
    return ["*"], "dev"

  parsed = _parse_cors_origins(raw_origins)
  return parsed or ["*"], "dev"


def make_app() -> FastAPI:
  app = FastAPI(title="Ancia Local Agent Backend", version="0.1.0")
  cors_origins, cors_profile = resolve_cors_origins()
  app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
  )
  LOGGER.info("CORS profile '%s' active (%d origins)", cors_profile, len(cors_origins))

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

  plugin_host_api = PluginHostApi(
    storage=storage,
    is_autonomous_mode_fn=is_autonomous_mode,
  )

  plugins_root_dir = resolve_plugins_root_dir()
  plugins_user_dir = (plugins_root_dir / "installed").resolve()
  plugins_preinstalled_dir = (plugins_root_dir / "preinstalled").resolve()
  plugins_root_dir.mkdir(parents=True, exist_ok=True)
  plugins_user_dir.mkdir(parents=True, exist_ok=True)
  plugins_preinstalled_dir.mkdir(parents=True, exist_ok=True)
  try:
    os.chmod(plugins_root_dir, 0o700)
  except OSError:
    pass
  for directory in (plugins_user_dir, plugins_preinstalled_dir):
    try:
      os.chmod(directory, 0o700)
    except OSError:
      pass
  plugin_manager = PluginManager(
    storage=storage,
    plugin_dirs=[
      plugins_preinstalled_dir,
      plugins_user_dir,
    ],
  )

  def refresh_tool_registry() -> None:
    plugin_manager.reload()
    register_tools_from_plugins(
      tool_registry=tool_registry,
      plugin_manager=plugin_manager,
      builtin_handlers={},
      get_autonomous_mode=is_autonomous_mode,
      host_api=plugin_host_api,
    )

  refresh_tool_registry()
  register_api_routes(
    app,
    storage=storage,
    model_engine=model_engine,
    tool_registry=tool_registry,
    plugin_manager=plugin_manager,
    system_prompt=system_prompt,
    data_dir=str(data_dir),
    plugins_root_dir=str(plugins_root_dir),
    plugins_user_dir=str(plugins_user_dir),
    plugins_preinstalled_dir=str(plugins_preinstalled_dir),
    build_system_prompt_fn=build_system_prompt,
    refresh_tool_registry_fn=refresh_tool_registry,
  )

  return app


app = make_app()


if __name__ == "__main__":
  import uvicorn

  host = os.getenv("ANCIA_BACKEND_HOST", "127.0.0.1")
  port = int(os.getenv("ANCIA_BACKEND_PORT", "5055"))
  uvicorn.run("backend.main:app", host=host, port=port, reload=False)
