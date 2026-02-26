from __future__ import annotations

import importlib.util
import inspect
import json
from contextlib import nullcontext
from pathlib import Path
from types import ModuleType
from typing import Any, Callable
from urllib import error as url_error
from urllib import request as url_request

try:
  from backend.netguard import ensure_safe_outbound_url
  from backend.plugin_permissions import normalize_plugin_permission_policy
except ModuleNotFoundError:
  from netguard import ensure_safe_outbound_url  # type: ignore
  from plugin_permissions import normalize_plugin_permission_policy  # type: ignore


ToolHandler = Callable[[dict[str, Any], Any], dict[str, Any]]


def _normalize_http_url(url_like: str) -> str:
  return ensure_safe_outbound_url(
    url_like,
    allow_http=True,
    allow_loopback=False,
    allow_private=False,
  )


class PluginPythonCallableCache:
  def __init__(self) -> None:
    self._modules: dict[str, ModuleType] = {}

  def load_callable(self, module_path: Path, callable_name: str) -> Callable[..., Any]:
    safe_module_path = module_path.resolve()
    cache_key = f"{safe_module_path}::{callable_name}"
    module = self._modules.get(cache_key)
    if module is None:
      spec = importlib.util.spec_from_file_location(
        f"ancia_plugin_{safe_module_path.stem}_{abs(hash(cache_key))}",
        safe_module_path,
      )
      if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить модуль плагина: {safe_module_path}")
      module = importlib.util.module_from_spec(spec)
      spec.loader.exec_module(module)
      self._modules[cache_key] = module
    fn = getattr(module, callable_name, None)
    if not callable(fn):
      raise RuntimeError(f"В модуле {safe_module_path.name} нет callable '{callable_name}'.")
    return fn


def _tool_policy_key(plugin_id: str, tool_name: str) -> str:
  safe_plugin_id = str(plugin_id or "").strip().lower()
  safe_tool_name = str(tool_name or "").strip().lower()
  if not safe_plugin_id or not safe_tool_name:
    return ""
  return f"{safe_plugin_id}::{safe_tool_name}"


def _enforce_runtime_tool_policy(runtime: Any, plugin_id: str, tool_name: str) -> None:
  tool_key = _tool_policy_key(plugin_id, tool_name)
  if not tool_key or runtime is None:
    return
  policy_map = (
    dict(getattr(runtime, "tool_permission_policies", {}) or {})
    if hasattr(runtime, "tool_permission_policies")
    else {}
  )
  policy = normalize_plugin_permission_policy(policy_map.get(tool_key, "allow"), "allow")
  if policy == "deny":
    raise RuntimeError(f"Инструмент '{tool_name}' запрещён политикой разрешений.")
  if policy == "ask":
    granted = {
      str(item or "").strip().lower()
      for item in list(getattr(runtime, "tool_permission_grants", None) or [])
      if str(item or "").strip()
    }
    if tool_key not in granted:
      raise RuntimeError(f"Инструмент '{tool_name}' требует подтверждения (policy: ask).")


def _call_python_tool(
  fn: Callable[..., Any],
  *,
  args: dict[str, Any],
  runtime: Any,
  host_api: Any,
  plugin_id: str,
  tool_name: str,
  handler_spec: dict[str, Any],
) -> dict[str, Any]:
  _enforce_runtime_tool_policy(runtime, plugin_id, tool_name)
  signature = inspect.signature(fn)
  runtime_scope = (
    host_api.bind_runtime(runtime=runtime, plugin_id=plugin_id, tool_name=tool_name)
    if host_api is not None and hasattr(host_api, "bind_runtime")
    else nullcontext()
  )
  with runtime_scope:
    if len(signature.parameters) >= 3:
      result = fn(args, runtime, host_api)
    elif len(signature.parameters) >= 2:
      result = fn(args, runtime)
    elif len(signature.parameters) == 1:
      result = fn(args)
    else:
      result = fn()

  if isinstance(result, dict):
    return result
  return {
    "result": result,
    "plugin_id": plugin_id,
    "tool_name": tool_name,
    "handler_type": str(handler_spec.get("type") or ""),
  }


def _make_http_json_handler(
  *,
  tool_name: str,
  plugin_id: str,
  handler_spec: dict[str, Any],
  requires_network: bool,
  get_autonomous_mode: Callable[[], bool],
  host_api: Any = None,
) -> ToolHandler:
  endpoint = _normalize_http_url(str(handler_spec.get("url") or handler_spec.get("endpoint") or "").strip())
  method = str(handler_spec.get("method") or "POST").strip().upper()
  timeout_sec = max(2.0, min(60.0, float(handler_spec.get("timeout_sec") or 18.0)))
  max_bytes = max(8_000, min(8_000_000, int(handler_spec.get("max_bytes") or 1_500_000)))
  static_headers = handler_spec.get("headers") if isinstance(handler_spec.get("headers"), dict) else {}

  def handler(args: dict[str, Any], runtime: Any) -> dict[str, Any]:
    _enforce_runtime_tool_policy(runtime, plugin_id, tool_name)
    if requires_network and get_autonomous_mode():
      raise RuntimeError("Автономный режим включен: внешний HTTP-инструмент отключен.")
    if host_api is not None and hasattr(host_api, "ensure_network_allowed"):
      host_api.ensure_network_allowed()
    if host_api is not None and hasattr(host_api, "ensure_domain_allowed"):
      host_api.ensure_domain_allowed(endpoint, runtime=runtime)

    payload = {
      "tool": tool_name,
      "plugin_id": plugin_id,
      "arguments": args or {},
      "runtime": {
        "chat_id": str(getattr(runtime, "chat_id", "") or ""),
        "mood": str(getattr(runtime, "mood", "") or ""),
        "user_name": str(getattr(runtime, "user_name", "") or ""),
        "timezone": str(getattr(runtime, "timezone", "") or ""),
      },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = url_request.Request(
      endpoint,
      method=method,
      data=body,
      headers={
        "Content-Type": "application/json; charset=utf-8",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
        "User-Agent": "AnciaPluginRuntime/0.1",
        **{str(k): str(v) for k, v in static_headers.items()},
      },
    )
    try:
      with url_request.urlopen(request, timeout=timeout_sec) as response:
        raw = response.read(max_bytes + 1)
        if len(raw) > max_bytes:
          raise RuntimeError("Ответ HTTP-инструмента слишком большой.")
        text = raw.decode("utf-8", errors="replace")
        try:
          parsed = json.loads(text)
        except json.JSONDecodeError:
          return {
            "status_code": int(response.getcode() or 200),
            "text": text,
          }
        if isinstance(parsed, dict):
          return parsed
        return {
          "status_code": int(response.getcode() or 200),
          "result": parsed,
        }
    except url_error.HTTPError as exc:
      raise RuntimeError(f"HTTP-инструмент '{tool_name}' вернул HTTP {exc.code}.") from exc
    except url_error.URLError as exc:
      raise RuntimeError(f"HTTP-инструмент '{tool_name}' недоступен: {exc.reason}") from exc
    except OSError as exc:
      raise RuntimeError(f"HTTP-инструмент '{tool_name}' недоступен: {exc}") from exc

  return handler


def register_tools_from_plugins(
  *,
  tool_registry: Any,
  plugin_manager: Any,
  builtin_handlers: dict[str, ToolHandler],
  get_autonomous_mode: Callable[[], bool],
  host_api: Any = None,
) -> None:
  python_cache = PluginPythonCallableCache()
  if hasattr(tool_registry, "clear"):
    tool_registry.clear()

  for plugin, spec in plugin_manager.iter_tool_specs(include_disabled=True):
    tool_name = str(spec.get("name") or "").strip().lower()
    if not tool_name:
      continue

    description = str(spec.get("description") or tool_name).strip() or tool_name
    input_schema = spec.get("input_schema") if isinstance(spec.get("input_schema"), dict) else {
      "type": "object",
      "properties": {},
      "required": [],
      "additionalProperties": False,
    }
    runtime_meta = spec.get("runtime_meta") if isinstance(spec.get("runtime_meta"), dict) else {}
    handler_spec = spec.get("handler") if isinstance(spec.get("handler"), dict) else {}
    handler_type = str(handler_spec.get("type") or "builtin").strip().lower() or "builtin"
    requires_network = bool(
      runtime_meta.get("requires_network", False)
      or getattr(plugin, "requires_network", False)
      or handler_spec.get("requires_network", False)
    )

    handler: ToolHandler
    if handler_type == "builtin":
      builtin_name = str(handler_spec.get("name") or tool_name).strip().lower() or tool_name
      builtin_handler = builtin_handlers.get(builtin_name)
      if not callable(builtin_handler):
        def unsupported_builtin(args: dict[str, Any], runtime: Any, *, expected: str = builtin_name) -> dict[str, Any]:
          raise RuntimeError(f"Builtin-handler '{expected}' не зарегистрирован в backend.")

        handler = unsupported_builtin
      else:
        handler = builtin_handler
    elif handler_type == "http_json":
      try:
        handler = _make_http_json_handler(
          tool_name=tool_name,
          plugin_id=str(getattr(plugin, "id", "") or ""),
          handler_spec=handler_spec,
          requires_network=requires_network,
          get_autonomous_mode=get_autonomous_mode,
          host_api=host_api,
        )
      except ValueError:
        def invalid_http_handler(args: dict[str, Any], runtime: Any) -> dict[str, Any]:
          raise RuntimeError(f"Некорректная конфигурация HTTP-инструмента '{tool_name}'.")

        handler = invalid_http_handler
    elif handler_type == "python":
      plugin_dir = Path(str(getattr(plugin, "plugin_dir", "") or "")).resolve()
      module_file = str(handler_spec.get("module_file") or handler_spec.get("path") or "plugin.py").strip()
      callable_name = str(handler_spec.get("callable") or "handle").strip()
      module_path = (plugin_dir / module_file).resolve()
      if plugin_dir == module_path or plugin_dir not in module_path.parents or not module_path.exists():
        def invalid_python_handler(args: dict[str, Any], runtime: Any) -> dict[str, Any]:
          raise RuntimeError(f"Некорректный путь python-handler для инструмента '{tool_name}'.")

        handler = invalid_python_handler
      else:
        def python_handler(
          args: dict[str, Any],
          runtime: Any,
          *,
          _module_path: Path = module_path,
          _callable_name: str = callable_name,
          _plugin_id: str = str(getattr(plugin, "id", "") or ""),
          _tool_name: str = tool_name,
          _handler_spec: dict[str, Any] = dict(handler_spec),
        ) -> dict[str, Any]:
          fn = python_cache.load_callable(_module_path, _callable_name)
          return _call_python_tool(
            fn,
            args=args,
            runtime=runtime,
            host_api=host_api,
            plugin_id=_plugin_id,
            tool_name=_tool_name,
            handler_spec=_handler_spec,
          )

        handler = python_handler
    else:
      def unsupported_handler(args: dict[str, Any], runtime: Any, *, kind: str = handler_type) -> dict[str, Any]:
        raise RuntimeError(f"Неподдерживаемый handler type '{kind}' для инструмента '{tool_name}'.")

      handler = unsupported_handler

    display_name = str(runtime_meta.get("display_name") or runtime_meta.get("title") or tool_name).strip() or tool_name
    runtime_meta_known_keys = {
      "display_name",
      "title",
      "subtitle",
      "category",
      "keywords",
      "requires_network",
      "aliases",
      "prompt",
      "plugin_id",
    }
    runtime_meta_extras = {
      str(key): value
      for key, value in runtime_meta.items()
      if str(key) not in runtime_meta_known_keys
    }
    llm_schema_raw = spec.get("llm_schema") if isinstance(spec.get("llm_schema"), dict) else {}
    if llm_schema_raw and str(llm_schema_raw.get("type") or "").strip().lower() == "function":
      llm_schema = dict(llm_schema_raw)
      function_payload = llm_schema.get("function")
      if isinstance(function_payload, dict):
        function_payload = dict(function_payload)
      else:
        function_payload = {}
      function_payload["name"] = tool_name
      if not str(function_payload.get("description") or "").strip():
        function_payload["description"] = description
      if not isinstance(function_payload.get("parameters"), dict):
        function_payload["parameters"] = input_schema
      llm_schema["function"] = function_payload
    else:
      llm_schema = {
        "type": "function",
        "function": {
          "name": tool_name,
          "description": description,
          "parameters": input_schema,
        },
      }
    tool_registry.register(
      name=tool_name,
      description=description,
      input_schema=input_schema,
      handler=handler,
      runtime_meta={
        "display_name": display_name,
        "subtitle": str(runtime_meta.get("subtitle") or ""),
        "category": str(runtime_meta.get("category") or getattr(plugin, "category", "system") or "system"),
        "keywords": list(runtime_meta.get("keywords") or getattr(plugin, "keywords", []) or []),
        "requires_network": requires_network,
        "plugin_id": str(getattr(plugin, "id", "") or ""),
        "aliases": list(runtime_meta.get("aliases") or []),
        "prompt": str(runtime_meta.get("prompt") or ""),
        **runtime_meta_extras,
      },
      llm_schema=llm_schema,
    )
