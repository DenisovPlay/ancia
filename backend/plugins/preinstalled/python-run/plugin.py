from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import time
from typing import Any

DEFAULT_TIMEOUT_SEC = 8
DEFAULT_MAX_OUTPUT_CHARS = 6000
DEFAULT_MAX_MEMORY_MB = 256
MAX_TIMEOUT_SEC = 30
MAX_OUTPUT_CHARS = 24_000
MIN_MAX_MEMORY_MB = 64
MAX_MAX_MEMORY_MB = 2048
MAX_CODE_CHARS = 32_000
MAX_CODE_RETURN_CHARS = 16_000
MAX_CODE_PREVIEW_LINES = 18
DEPLOYMENT_MODE_REMOTE_SERVER = "remote_server"

CODE_BLOCK_PATTERN = re.compile(
  r"```(?:\s*(?P<lang>[a-zA-Z0-9_+\-]+))?\s*\n?(?P<code>[\s\S]*?)```",
  flags=re.IGNORECASE,
)

ALLOWED_IMPORTS = {
  "array",
  "base64",
  "bisect",
  "collections",
  "cmath",
  "datetime",
  "decimal",
  "fractions",
  "functools",
  "hashlib",
  "heapq",
  "itertools",
  "json",
  "math",
  "operator",
  "random",
  "re",
  "statistics",
  "string",
  "textwrap",
  "time",
  "typing",
  "uuid",
}

SAFE_BUILTINS = [
  "__build_class__",
  "abs",
  "all",
  "any",
  "ascii",
  "bin",
  "bool",
  "bytearray",
  "bytes",
  "callable",
  "chr",
  "complex",
  "dict",
  "divmod",
  "enumerate",
  "Exception",
  "filter",
  "float",
  "format",
  "frozenset",
  "hash",
  "hex",
  "IndexError",
  "int",
  "isinstance",
  "issubclass",
  "iter",
  "KeyError",
  "len",
  "list",
  "map",
  "max",
  "min",
  "NameError",
  "next",
  "object",
  "oct",
  "ord",
  "pow",
  "print",
  "range",
  "repr",
  "reversed",
  "round",
  "RuntimeError",
  "set",
  "slice",
  "sorted",
  "str",
  "sum",
  "tuple",
  "TypeError",
  "ValueError",
  "zip",
  "ZeroDivisionError",
]

DISALLOWED_CALL_NAMES = {
  "input",
  "open",
  "exec",
  "eval",
  "compile",
  "breakpoint",
  "help",
  "quit",
  "exit",
  "__import__",
}

DISALLOWED_ATTR_CALLS = {
  "unlink",
  "rmdir",
  "removedirs",
  "mkdir",
  "makedirs",
  "chmod",
  "chown",
  "touch",
  "write_text",
  "write_bytes",
  "symlink_to",
  "hardlink_to",
  "rmtree",
  "truncate",
}

DISALLOWED_MODULE_ROOTS = {
  "os",
  "sys",
  "subprocess",
  "pathlib",
  "shutil",
  "socket",
  "ssl",
  "http",
  "urllib",
  "ftplib",
  "requests",
  "aiohttp",
  "ctypes",
  "multiprocessing",
  "threading",
  "signal",
  "resource",
}

DISALLOWED_ATTR_NAMES = {
  "__bases__",
  "__base__",
  "__builtins__",
  "__class__",
  "__closure__",
  "__code__",
  "__dict__",
  "__getattribute__",
  "__globals__",
  "__import__",
  "__mro__",
  "__subclasses__",
  "cr_frame",
  "f_globals",
  "f_locals",
  "gi_frame",
  "tb_frame",
}

PYTHON_RUN_WRAPPER_TEMPLATE = """
import ast
import builtins
import contextlib
import io
import json
import sys
import traceback

ALLOWED_MODULES = set(__ALLOWED_MODULES__)
SAFE_BUILTINS = list(__SAFE_BUILTINS__)


class LimitedBuffer(io.StringIO):
  def __init__(self, max_chars):
    super().__init__()
    self.max_chars = max(200, int(max_chars or 200))
    self.truncated = False

  def write(self, value):
    text = str(value)
    current_len = self.tell()
    remaining = self.max_chars - current_len
    if remaining <= 0:
      self.truncated = True
      return len(text)
    if len(text) > remaining:
      super().write(text[:remaining])
      self.truncated = True
      return len(text)
    return super().write(text)


def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
  root = str(name or "").split(".", 1)[0]
  if root not in ALLOWED_MODULES:
    raise ImportError(f"Import '{name}' is not allowed by python.run")
  return __import__(name, globals, locals, fromlist, level)


def build_safe_builtins():
  out = {}
  for key in SAFE_BUILTINS:
    if hasattr(builtins, key):
      out[key] = getattr(builtins, key)
  out["__import__"] = safe_import
  return out


def compile_code(raw_code):
  tree = ast.parse(raw_code, mode="exec")
  if tree.body and isinstance(tree.body[-1], ast.Expr):
    tree.body[-1] = ast.Assign(
      targets=[ast.Name(id="_ancia_last_value", ctx=ast.Store())],
      value=tree.body[-1].value,
    )
    ast.fix_missing_locations(tree)
  return compile(tree, "<python.run>", "exec")


def main():
  incoming = json.loads(sys.stdin.read() or "{}")
  raw_code = str(incoming.get("code") or "")
  max_output_chars = int(incoming.get("max_output_chars") or 6000)

  stdout_buffer = LimitedBuffer(max_output_chars)
  stderr_buffer = LimitedBuffer(max_output_chars)

  namespace = {
    "__name__": "__main__",
    "__builtins__": build_safe_builtins(),
  }

  try:
    compiled = compile_code(raw_code)
    with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
      exec(compiled, namespace, namespace)

    last_value = namespace.get("_ancia_last_value")
    result = {
      "ok": True,
      "error": "",
      "traceback": "",
      "stdout": stdout_buffer.getvalue(),
      "stderr": stderr_buffer.getvalue(),
      "result_repr": "" if last_value is None else repr(last_value),
      "truncated": bool(stdout_buffer.truncated or stderr_buffer.truncated),
    }
  except Exception as exc:
    result = {
      "ok": False,
      "error": f"{type(exc).__name__}: {exc}",
      "traceback": traceback.format_exc(limit=10),
      "stdout": stdout_buffer.getvalue(),
      "stderr": stderr_buffer.getvalue(),
      "result_repr": "",
      "truncated": bool(stdout_buffer.truncated or stderr_buffer.truncated),
    }

  json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
  main()
"""


def _normalize_int(value: Any, *, fallback: int, min_value: int, max_value: int) -> int:
  try:
    parsed = int(value)
  except (TypeError, ValueError):
    parsed = fallback
  return max(min_value, min(max_value, parsed))


def _is_true(value: Any) -> bool:
  return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_deployment_mode(runtime: Any, host: Any) -> str:
  env_mode = str(os.getenv("ANCIA_DEPLOYMENT_MODE", "") or "").strip().lower()
  if env_mode:
    return env_mode

  runtime_mode = str(getattr(runtime, "deployment_mode", "") or "").strip().lower()
  if runtime_mode:
    return runtime_mode

  storage = getattr(host, "storage", None)
  if storage is None or not hasattr(storage, "get_setting_json"):
    return ""
  try:
    payload = storage.get_setting_json("runtime_config", {}) or {}
  except Exception:
    payload = {}
  if isinstance(payload, dict):
    return str(payload.get("deploymentMode") or "").strip().lower()
  return ""


def _normalize_text(value: Any, *, max_len: int = 0) -> str:
  text = str(value or "")
  if max_len > 0 and len(text) > max_len:
    text = text[:max_len]
  return text


def _strip_code_fences(text: str) -> str:
  safe_text = str(text or "").strip()
  if not safe_text:
    return ""

  # Модели нередко отправляют code как escaped-строку (с буквальными \n/\t/\r).
  # Нормализуем это до реальных переводов строки/табов перед парсингом fenced-блока.
  if "\\r\\n" in safe_text and "\r\n" not in safe_text:
    safe_text = safe_text.replace("\\r\\n", "\n")
  if "\\n" in safe_text and "\n" not in safe_text:
    safe_text = safe_text.replace("\\n", "\n")
  if "\\r" in safe_text and "\r" not in safe_text:
    safe_text = safe_text.replace("\\r", "\n")
  if "\\t" in safe_text and "\t" not in safe_text:
    safe_text = safe_text.replace("\\t", "\t")

  matches = list(CODE_BLOCK_PATTERN.finditer(safe_text))
  if matches:
    python_blocks: list[str] = []
    generic_blocks: list[str] = []
    for match in matches:
      lang = str(match.group("lang") or "").strip().lower()
      block_code = str(match.group("code") or "").strip("\n")
      if not block_code:
        continue
      if lang in {"python", "py"}:
        python_blocks.append(block_code)
      else:
        generic_blocks.append(block_code)
    selected = python_blocks or generic_blocks
    if selected:
      return "\n\n".join(selected).strip()

  if safe_text.startswith("`") and safe_text.endswith("`") and len(safe_text) >= 2:
    safe_text = safe_text.strip("`").strip()
  return safe_text


def _extract_code(payload: dict[str, Any]) -> str:
  for key in ("code", "python", "script", "source"):
    candidate = payload.get(key)
    if isinstance(candidate, str) and candidate.strip():
      return _strip_code_fences(candidate)
    if isinstance(candidate, list) and candidate and all(isinstance(item, str) for item in candidate):
      return _strip_code_fences("\n".join(str(item) for item in candidate))

  fallback = payload.get("input")
  if isinstance(fallback, str) and fallback.strip():
    return _strip_code_fences(fallback)

  return ""


def _syntax_error_message(exc: SyntaxError) -> str:
  msg = str(getattr(exc, "msg", "") or "invalid syntax").strip()
  line_no = int(getattr(exc, "lineno", 0) or 0)
  offset = int(getattr(exc, "offset", 0) or 0)
  source_line = str(getattr(exc, "text", "") or "").rstrip("\n")
  parts = [f"SyntaxError: {msg}"]
  if line_no > 0:
    parts.append(f"line={line_no}")
  if source_line:
    parts.append(source_line)
    if offset > 0:
      parts.append(f"{' ' * max(0, offset - 1)}^")
  return "\n".join(parts)


def _resolve_attribute_chain(node: ast.AST) -> list[str]:
  parts: list[str] = []
  current: ast.AST | None = node
  while isinstance(current, ast.Attribute):
    parts.append(str(current.attr or "").strip())
    current = current.value
  if isinstance(current, ast.Name):
    parts.append(str(current.id or "").strip())
  return list(reversed([part for part in parts if part]))


def _validate_code(code: str) -> ast.Module:
  try:
    tree = ast.parse(code, mode="exec")
  except SyntaxError as exc:
    raise ValueError(_syntax_error_message(exc)) from exc

  for node in ast.walk(tree):
    if isinstance(node, ast.Name):
      identifier = str(node.id or "").strip()
      if identifier.startswith("__"):
        raise ValueError("Служебные dunder-идентификаторы запрещены в python.run.")
      continue

    if isinstance(node, ast.Attribute):
      attr_name = str(getattr(node, "attr", "") or "").strip().lower()
      if (
        attr_name.startswith("__")
        or attr_name in DISALLOWED_ATTR_NAMES
      ):
        raise ValueError(
          f"Доступ к атрибуту '{attr_name}' запрещён в python.run."
        )

    if isinstance(node, ast.Import):
      for alias in node.names:
        root = str(alias.name or "").split(".", 1)[0].strip().lower()
        if root and root not in ALLOWED_IMPORTS:
          raise ValueError(
            f"Import '{alias.name}' запрещён. Разрешённые модули: {', '.join(sorted(ALLOWED_IMPORTS))}"
          )
    elif isinstance(node, ast.ImportFrom):
      if int(getattr(node, "level", 0) or 0) > 0:
        raise ValueError("Относительные импорты запрещены в python.run.")
      module_name = str(getattr(node, "module", "") or "")
      root = module_name.split(".", 1)[0].strip().lower()
      if root and root not in ALLOWED_IMPORTS:
          raise ValueError(
            f"Import '{module_name}' запрещён. Разрешённые модули: {', '.join(sorted(ALLOWED_IMPORTS))}"
          )
    elif isinstance(node, ast.Call):
      if isinstance(node.func, ast.Name):
        fn_name = str(node.func.id or "").strip().lower()
        if fn_name in DISALLOWED_CALL_NAMES:
          raise ValueError(
            f"Вызов '{fn_name}()' запрещён в python.run. Используй выражения/вычисления без ввода и системных действий."
          )
      elif isinstance(node.func, ast.Attribute):
        chain = _resolve_attribute_chain(node.func)
        if not chain:
          continue
        root = str(chain[0] or "").strip().lower()
        attr = str(chain[-1] or "").strip().lower()
        if root in DISALLOWED_MODULE_ROOTS:
          raise ValueError(
            f"Доступ к '{'.'.join(chain)}' запрещён в python.run (только безопасные расчёты без доступа к системе/файлам/сети)."
          )
        if attr in DISALLOWED_ATTR_CALLS:
          raise ValueError(
            f"Вызов '{attr}()' запрещён в python.run (операции с файлами/процессами отключены)."
          )

  return tree


def _build_wrapper_script() -> str:
  return textwrap.dedent(PYTHON_RUN_WRAPPER_TEMPLATE).replace(
    "__ALLOWED_MODULES__",
    json.dumps(sorted(ALLOWED_IMPORTS), ensure_ascii=True),
  ).replace(
    "__SAFE_BUILTINS__",
    json.dumps(SAFE_BUILTINS, ensure_ascii=True),
  )


def _build_subprocess_env() -> dict[str, str]:
  env = {
    "PYTHONIOENCODING": "utf-8",
    "PYTHONUTF8": "1",
    "PYTHONDONTWRITEBYTECODE": "1",
  }
  tz = str(os.environ.get("TZ") or "").strip()
  if tz:
    env["TZ"] = tz
  return env


def _resolve_max_memory_mb() -> int:
  raw_value = os.getenv("ANCIA_PYTHON_RUN_MAX_MEMORY_MB", str(DEFAULT_MAX_MEMORY_MB))
  return _normalize_int(
    raw_value,
    fallback=DEFAULT_MAX_MEMORY_MB,
    min_value=MIN_MAX_MEMORY_MB,
    max_value=MAX_MAX_MEMORY_MB,
  )


def _build_subprocess_preexec_fn(timeout_sec: int, max_memory_mb: int):
  if os.name != "posix":
    return None
  try:
    import resource  # type: ignore
  except Exception:
    return None

  cpu_soft = max(1, int(timeout_sec) + 1)
  cpu_hard = max(cpu_soft, int(timeout_sec) + 2)
  memory_limit_bytes = max(64 * 1024 * 1024, int(max_memory_mb) * 1024 * 1024)

  def _apply_limits() -> None:
    try:
      resource.setrlimit(resource.RLIMIT_CPU, (cpu_soft, cpu_hard))
    except Exception:
      pass
    for limit_name in ("RLIMIT_AS", "RLIMIT_DATA"):
      limit_key = getattr(resource, limit_name, None)
      if limit_key is None:
        continue
      try:
        resource.setrlimit(limit_key, (memory_limit_bytes, memory_limit_bytes))
      except Exception:
        pass
    limit_key = getattr(resource, "RLIMIT_FSIZE", None)
    if limit_key is not None:
      try:
        resource.setrlimit(limit_key, (1_048_576, 1_048_576))
      except Exception:
        pass

  return _apply_limits


def _truncate(value: Any, *, max_len: int) -> tuple[str, bool]:
  safe = str(value or "")
  if len(safe) <= max_len:
    return safe, False
  return safe[:max_len], True


def _build_code_preview(code: str) -> str:
  lines = str(code or "").splitlines()
  if not lines:
    return ""
  clipped_lines = lines[:MAX_CODE_PREVIEW_LINES]
  preview = "\n".join(clipped_lines).strip()
  if len(lines) > MAX_CODE_PREVIEW_LINES:
    preview = f"{preview}\n..."
  return preview


def _error_payload(
  *,
  error: str,
  code: str,
  max_output_chars: int,
  duration_ms: int,
  timed_out: bool = False,
  exit_code: int = 1,
  stdout: str = "",
  stderr: str = "",
  traceback_text: str = "",
) -> dict[str, Any]:
  safe_error, _ = _truncate(error, max_len=max_output_chars)
  safe_code, code_truncated = _truncate(code, max_len=MAX_CODE_RETURN_CHARS)
  safe_stdout, stdout_truncated = _truncate(stdout, max_len=max_output_chars)
  safe_stderr, stderr_truncated = _truncate(stderr, max_len=max_output_chars)
  safe_traceback, traceback_truncated = _truncate(traceback_text, max_len=max_output_chars)
  return {
    "ok": False,
    "timed_out": bool(timed_out),
    "duration_ms": int(max(0, duration_ms)),
    "exit_code": int(exit_code),
    "error": safe_error,
    "stdout": safe_stdout,
    "stderr": safe_stderr,
    "traceback": safe_traceback,
    "result_repr": "",
    "code": safe_code,
    "code_truncated": bool(code_truncated),
    "truncated": bool(stdout_truncated or stderr_truncated or traceback_truncated),
    "code_preview": _build_code_preview(code),
    "code_lines": max(1, str(code or "").count("\n") + 1),
  }


def handle(args: dict[str, Any], runtime: Any, host: Any) -> dict[str, Any]:
  payload = args if isinstance(args, dict) else {}
  deployment_mode = _resolve_deployment_mode(runtime, host)
  if (
    deployment_mode == DEPLOYMENT_MODE_REMOTE_SERVER
    and not _is_true(os.getenv("ANCIA_ALLOW_PYTHON_RUN_REMOTE_SERVER", ""))
  ):
    raise RuntimeError(
      "python.run отключён в remote_server режиме по соображениям безопасности. "
      "Для явного включения установите ANCIA_ALLOW_PYTHON_RUN_REMOTE_SERVER=1."
    )

  stdin_value = payload.get("stdin")
  if stdin_value is not None and str(stdin_value or "").strip():
    raise ValueError("python.run не поддерживает stdin/input(): ввод в этот инструмент недоступен.")

  code = _extract_code(payload)
  if not code:
    raise ValueError("code is required")
  code = _normalize_text(code, max_len=MAX_CODE_CHARS + 1).strip()
  if not code:
    raise ValueError("code is required")
  if len(code) > MAX_CODE_CHARS:
    raise ValueError(f"code is too long (max {MAX_CODE_CHARS} chars)")

  _validate_code(code)

  timeout_sec = _normalize_int(
    payload.get("timeout_sec"),
    fallback=DEFAULT_TIMEOUT_SEC,
    min_value=1,
    max_value=MAX_TIMEOUT_SEC,
  )
  max_output_chars = _normalize_int(
    payload.get("max_output_chars"),
    fallback=DEFAULT_MAX_OUTPUT_CHARS,
    min_value=500,
    max_value=MAX_OUTPUT_CHARS,
  )
  max_memory_mb = _resolve_max_memory_mb()
  preexec_fn = _build_subprocess_preexec_fn(timeout_sec, max_memory_mb)

  wrapper_script = _build_wrapper_script()
  input_payload = json.dumps(
    {
      "code": code,
      "max_output_chars": max_output_chars,
    },
    ensure_ascii=False,
  )

  started_at = time.perf_counter()
  try:
    run_kwargs: dict[str, Any] = {
      "input": input_payload,
      "text": True,
      "capture_output": True,
      "timeout": float(timeout_sec) + 0.25,
      "check": False,
      "env": _build_subprocess_env(),
    }
    if preexec_fn is not None:
      run_kwargs["preexec_fn"] = preexec_fn
    with tempfile.TemporaryDirectory(prefix="ancia-python-run-") as sandbox_cwd:
      run_kwargs["cwd"] = sandbox_cwd
      completed = subprocess.run(
        [sys.executable, "-I", "-c", wrapper_script],
        **run_kwargs,
      )
  except subprocess.TimeoutExpired:
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    return _error_payload(
      error=f"TimeoutError: выполнение превысило {timeout_sec} сек.",
      code=code,
      max_output_chars=max_output_chars,
      duration_ms=duration_ms,
      timed_out=True,
      exit_code=124,
    )
  except OSError as exc:
    duration_ms = int((time.perf_counter() - started_at) * 1000)
    return _error_payload(
      error=f"OSError: не удалось запустить Python ({exc})",
      code=code,
      max_output_chars=max_output_chars,
      duration_ms=duration_ms,
      exit_code=1,
    )

  duration_ms = int((time.perf_counter() - started_at) * 1000)
  process_stdout = str(completed.stdout or "")
  process_stderr = str(completed.stderr or "")

  if completed.returncode != 0 and not process_stdout.strip():
    return _error_payload(
      error=f"Python runtime exited with code {completed.returncode}.",
      code=code,
      max_output_chars=max_output_chars,
      duration_ms=duration_ms,
      exit_code=int(completed.returncode),
      stderr=process_stderr,
    )

  try:
    parsed_output = json.loads(process_stdout or "{}")
  except json.JSONDecodeError:
    return _error_payload(
      error="RuntimeError: некорректный ответ Python runtime.",
      code=code,
      max_output_chars=max_output_chars,
      duration_ms=duration_ms,
      exit_code=int(completed.returncode),
      stdout=process_stdout,
      stderr=process_stderr,
    )

  if not isinstance(parsed_output, dict):
    return _error_payload(
      error="RuntimeError: Python runtime вернул неожиданный формат.",
      code=code,
      max_output_chars=max_output_chars,
      duration_ms=duration_ms,
      exit_code=int(completed.returncode),
      stdout=process_stdout,
      stderr=process_stderr,
    )

  stdout_value, stdout_truncated = _truncate(parsed_output.get("stdout"), max_len=max_output_chars)
  stderr_value, stderr_truncated = _truncate(parsed_output.get("stderr"), max_len=max_output_chars)
  traceback_value, traceback_truncated = _truncate(parsed_output.get("traceback"), max_len=max_output_chars)
  result_repr_value, result_repr_truncated = _truncate(parsed_output.get("result_repr"), max_len=max_output_chars)
  error_value, error_truncated = _truncate(parsed_output.get("error"), max_len=max_output_chars)
  code_value, code_truncated = _truncate(code, max_len=MAX_CODE_RETURN_CHARS)

  return {
    "ok": bool(parsed_output.get("ok", False)) and not error_value,
    "timed_out": False,
    "duration_ms": int(max(0, duration_ms)),
    "exit_code": int(completed.returncode),
    "error": error_value,
    "stdout": stdout_value,
    "stderr": stderr_value,
    "traceback": traceback_value,
    "result_repr": result_repr_value,
    "code": code_value,
    "code_truncated": bool(code_truncated),
    "truncated": bool(
      parsed_output.get("truncated", False)
      or stdout_truncated
      or stderr_truncated
      or traceback_truncated
      or result_repr_truncated
      or error_truncated
    ),
    "code_preview": _build_code_preview(code),
    "code_lines": max(1, code.count("\n") + 1),
  }
