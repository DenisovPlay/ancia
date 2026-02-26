from __future__ import annotations

import ipaddress
import logging
import math
import os
import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
  from backend.auth_service import AuthService
  from backend.deployment import (
    DEPLOYMENT_MODE_REMOTE_SERVER,
    allow_credentials_for_mode,
    resolve_cors_origins_for_mode,
    resolve_deployment_mode,
  )
  from backend.plugin_host_api import PluginHostApi
  from backend.storage import AppStorage
except ModuleNotFoundError:
  from auth_service import AuthService  # type: ignore
  from deployment import (  # type: ignore
    DEPLOYMENT_MODE_REMOTE_SERVER,
    allow_credentials_for_mode,
    resolve_cors_origins_for_mode,
    resolve_deployment_mode,
  )
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
    (project_root / "system_prompt.txt").resolve(),
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

_SENSITIVE_LOG_PATTERN = re.compile(
  r"(?i)(authorization\s*[:=]\s*['\"]?bearer\s+)[a-z0-9._~+/=-]+",
)


class _SensitiveLogFilter(logging.Filter):
  def filter(self, record: logging.LogRecord) -> bool:
    try:
      message = str(record.getMessage() or "")
      redacted = _SENSITIVE_LOG_PATTERN.sub(r"\1[REDACTED]", message)
      if redacted != message:
        record.msg = redacted
        record.args = ()
    except Exception:
      return True
    return True


def _install_sensitive_log_filter() -> None:
  filter_instance = _SensitiveLogFilter()
  for logger_name in ("uvicorn.access", "uvicorn.error", "fastapi", "ancia.backend.main"):
    target_logger = logging.getLogger(logger_name)
    if any(isinstance(item, _SensitiveLogFilter) for item in target_logger.filters):
      continue
    target_logger.addFilter(filter_instance)

PUBLIC_PATH_PREFIXES = (
  "/health",
  "/auth/config",
  "/auth/login",
  "/auth/bootstrap",
  "/auth/register",
  "/plugins/assets/",
)
PUBLIC_PATH_EXACT = {
  "/",
  "/docs",
  "/openapi.json",
  "/redoc",
}

RATE_LIMIT_RULES: dict[tuple[str, str], tuple[str, int]] = {
  ("POST", "/chat"): ("ANCIA_RATE_LIMIT_CHAT_PER_WINDOW", 20),
  ("POST", "/chat/stream"): ("ANCIA_RATE_LIMIT_CHAT_STREAM_PER_WINDOW", 8),
  ("POST", "/models/load"): ("ANCIA_RATE_LIMIT_MODELS_LOAD_PER_WINDOW", 4),
  ("POST", "/plugins/install"): ("ANCIA_RATE_LIMIT_PLUGINS_INSTALL_PER_WINDOW", 6),
}
REQUEST_SIZE_LIMIT_RULES: dict[tuple[str, str], tuple[str, int]] = {
  ("POST", "/chat"): ("ANCIA_MAX_BODY_CHAT_BYTES", 280_000),
  ("POST", "/chat/stream"): ("ANCIA_MAX_BODY_CHAT_STREAM_BYTES", 280_000),
  ("POST", "/chats/import"): ("ANCIA_MAX_BODY_CHATS_IMPORT_BYTES", 2_000_000),
  ("POST", "/plugins/install"): ("ANCIA_MAX_BODY_PLUGINS_INSTALL_BYTES", 200_000),
  ("POST", "/models/load"): ("ANCIA_MAX_BODY_MODELS_LOAD_BYTES", 80_000),
  ("POST", "/models/select"): ("ANCIA_MAX_BODY_MODELS_SELECT_BYTES", 80_000),
}
_RATE_LIMIT_STATE_LOCK = threading.Lock()
_RATE_LIMIT_STATE: dict[str, list[float]] = {}
_RATE_LIMIT_LAST_SWEEP_TS = 0.0
_RATE_LIMIT_SWEEP_INTERVAL_SECONDS = 90.0
_RATE_LIMIT_SWEEP_MAX_KEYS = 20000


def _resolve_rate_limit_window_seconds() -> float:
  raw = str(os.getenv("ANCIA_RATE_LIMIT_WINDOW_SECONDS", "60") or "").strip()
  try:
    value = float(raw)
  except ValueError:
    value = 60.0
  return max(5.0, min(3600.0, value))


def _resolve_rate_limit_budget(method: str, path: str) -> int:
  rule = RATE_LIMIT_RULES.get((method, path))
  if rule is None:
    return 0
  env_key, fallback = rule
  raw = str(os.getenv(env_key, str(fallback)) or "").strip()
  try:
    value = int(raw)
  except ValueError:
    value = fallback
  return max(0, min(1000, value))


def _is_rate_limited_request(method: str, path: str) -> bool:
  return (method, path) in RATE_LIMIT_RULES


def _resolve_request_size_limit_bytes(method: str, path: str) -> int:
  rule = REQUEST_SIZE_LIMIT_RULES.get((method, path))
  if rule is None:
    return 0
  env_key, fallback = rule
  raw = str(os.getenv(env_key, str(fallback)) or "").strip()
  try:
    value = int(raw)
  except ValueError:
    value = fallback
  return max(0, min(20_000_000, value))


def _is_request_size_limited(method: str, path: str) -> bool:
  return (method, path) in REQUEST_SIZE_LIMIT_RULES


def _read_content_length_bytes(request: Request) -> int | None:
  raw = str(request.headers.get("content-length") or "").strip()
  if not raw:
    return None
  try:
    value = int(raw)
  except ValueError:
    return None
  if value < 0:
    return None
  return value


def _resolve_rate_limit_subject(request: Request) -> str:
  auth_payload = getattr(request.state, "auth", None)
  user_payload = auth_payload.get("user") if isinstance(auth_payload, dict) and isinstance(auth_payload.get("user"), dict) else {}
  user_id = str(user_payload.get("id") or "").strip()
  if user_id:
    return f"user:{user_id}"
  host = str(getattr(getattr(request, "client", None), "host", "") or "").strip().lower()
  if host:
    return f"ip:{host}"
  return "ip:unknown"


def _consume_rate_limit(method: str, path: str, subject: str) -> tuple[bool, int]:
  global _RATE_LIMIT_LAST_SWEEP_TS
  budget = _resolve_rate_limit_budget(method, path)
  if budget <= 0:
    return False, 0
  window_sec = _resolve_rate_limit_window_seconds()
  now_ts = time.time()
  key = f"{method}|{path}|{subject}"
  with _RATE_LIMIT_STATE_LOCK:
    should_sweep = (
      (now_ts - _RATE_LIMIT_LAST_SWEEP_TS) >= _RATE_LIMIT_SWEEP_INTERVAL_SECONDS
      or len(_RATE_LIMIT_STATE) >= _RATE_LIMIT_SWEEP_MAX_KEYS
    )
    if should_sweep:
      stale_keys: list[str] = []
      for state_key, state_events in _RATE_LIMIT_STATE.items():
        if not state_events:
          stale_keys.append(state_key)
          continue
        last_event_ts = float(state_events[-1])
        if (now_ts - last_event_ts) > window_sec:
          stale_keys.append(state_key)
      for stale_key in stale_keys:
        _RATE_LIMIT_STATE.pop(stale_key, None)
      _RATE_LIMIT_LAST_SWEEP_TS = now_ts

    events = [float(item) for item in _RATE_LIMIT_STATE.get(key, []) if (now_ts - float(item)) <= window_sec]
    if len(events) >= budget:
      retry_after = max(1, int(math.ceil(window_sec - (now_ts - events[0]))))
      _RATE_LIMIT_STATE[key] = events
      return True, retry_after
    events.append(now_ts)
    _RATE_LIMIT_STATE[key] = events
  return False, 0


def _extract_bearer_token(request: Request) -> str:
  header = str(request.headers.get("authorization") or "").strip()
  if not header:
    return ""
  prefix = "bearer "
  if header.lower().startswith(prefix):
    return header[len(prefix):].strip()
  return ""


def _is_public_path(path: str) -> bool:
  safe_path = str(path or "").strip() or "/"
  if safe_path in PUBLIC_PATH_EXACT:
    return True
  return any(safe_path.startswith(prefix) for prefix in PUBLIC_PATH_PREFIXES)


def _is_loopback_client(request: Request | None) -> bool:
  if request is None:
    return False
  host = str(getattr(getattr(request, "client", None), "host", "") or "").strip().lower()
  if not host:
    return False
  if host in {"localhost", "127.0.0.1", "::1"}:
    return True
  try:
    return ipaddress.ip_address(host).is_loopback
  except ValueError:
    return False


def _is_local_recovery_request(request: Request | None) -> bool:
  if request is None:
    return False
  # Do not trust forwarded requests (reverse proxy / external edge).
  forwarded = str(request.headers.get("forwarded") or "").strip()
  xff = str(request.headers.get("x-forwarded-for") or "").strip()
  if forwarded or xff:
    return False
  return _is_loopback_client(request)


def make_app() -> FastAPI:
  _install_sensitive_log_filter()
  app = FastAPI(title="Ancia Agent Backend", version="0.1.0")

  data_dir = resolve_data_dir()
  data_dir.mkdir(parents=True, exist_ok=True)

  storage = AppStorage(data_dir / "app.db")
  deployment_mode = resolve_deployment_mode(storage)
  cors_origins = resolve_cors_origins_for_mode(deployment_mode)
  app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials_for_mode(deployment_mode),
    allow_methods=["*"],
    allow_headers=["*"],
  )
  LOGGER.info(
    "Deployment mode '%s' active; CORS origins: %d",
    deployment_mode,
    len(cors_origins),
  )

  # Приходит часть OPTIONS не как CORS preflight (без Origin/Access-Control-Request-Method),
  # поэтому FastAPI по умолчанию отвечает 405. Ловим все OPTIONS и отдаём 204.
  @app.options("/{full_path:path}")
  def options_passthrough(full_path: str) -> Response:
    return Response(status_code=204)

  auth_service = AuthService(storage=storage)
  app.state.auth_service = auth_service

  @app.middleware("http")
  async def security_middleware(request: Request, call_next):
    path = str(request.url.path or "/").strip() or "/"
    method = str(request.method or "").strip().upper()

    if _is_request_size_limited(method, path):
      limit_bytes = _resolve_request_size_limit_bytes(method, path)
      content_length = _read_content_length_bytes(request)
      if limit_bytes > 0 and content_length is not None and content_length > limit_bytes:
        return JSONResponse(
          status_code=413,
          content={"detail": f"Payload too large. Max {limit_bytes} bytes."},
        )

    if request.method.upper() == "OPTIONS":
      return await call_next(request)

    runtime_mode = resolve_deployment_mode(storage)
    request.state.deployment_mode = runtime_mode
    request.state.auth = None

    if runtime_mode != DEPLOYMENT_MODE_REMOTE_SERVER:
      # local / remote_client modes are non-account modes on this backend.
      return await call_next(request)

    if _is_public_path(path):
      return await call_next(request)

    # Desktop recovery path:
    # allow switching remote_server -> local from trusted loopback request.
    if (
      request.method.upper() == "PATCH"
      and path == "/settings"
      and _is_local_recovery_request(request)
    ):
      return await call_next(request)

    token = _extract_bearer_token(request)
    if not token:
      return JSONResponse(
        status_code=401,
        content={"detail": "Authentication required."},
      )

    auth_payload = auth_service.authenticate_token(token, renew=True)
    if not isinstance(auth_payload, dict):
      return JSONResponse(
        status_code=401,
        content={"detail": "Invalid or expired session."},
      )
    request.state.auth = auth_payload

    user_payload = auth_payload.get("user") if isinstance(auth_payload.get("user"), dict) else {}
    role = str(user_payload.get("role") or "user").strip().lower()
    if path.startswith("/admin/") and role != "admin":
      return JSONResponse(
        status_code=403,
        content={"detail": "Admin access required."},
      )

    if _is_rate_limited_request(method, path):
      subject = _resolve_rate_limit_subject(request)
      exceeded, retry_after = _consume_rate_limit(method, path, subject)
      if exceeded:
        return JSONResponse(
          status_code=429,
          content={"detail": "Too many requests. Please retry later."},
          headers={"Retry-After": str(retry_after)},
        )

    return await call_next(request)

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
    auth_service=auth_service,
  )

  return app


app = make_app()


if __name__ == "__main__":
  import uvicorn

  host = os.getenv("ANCIA_BACKEND_HOST", "127.0.0.1")
  port = int(os.getenv("ANCIA_BACKEND_PORT", "5055"))
  uvicorn.run("backend.main:app", host=host, port=port, reload=False)
