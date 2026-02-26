from __future__ import annotations

import ast
import math
import operator
from typing import Any

MAX_EXPRESSION_CHARS = 512
MAX_RESULT_REPR_CHARS = 256

_SAFE_NAMES: dict[str, Any] = {
  "pi": math.pi,
  "e": math.e,
  "inf": math.inf,
  "nan": math.nan,
  "tau": math.tau,
  "abs": abs,
  "round": round,
  "ceil": math.ceil,
  "floor": math.floor,
  "sqrt": math.sqrt,
  "exp": math.exp,
  "log": math.log,
  "log2": math.log2,
  "log10": math.log10,
  "sin": math.sin,
  "cos": math.cos,
  "tan": math.tan,
  "asin": math.asin,
  "acos": math.acos,
  "atan": math.atan,
  "atan2": math.atan2,
  "sinh": math.sinh,
  "cosh": math.cosh,
  "tanh": math.tanh,
  "degrees": math.degrees,
  "radians": math.radians,
  "factorial": math.factorial,
  "gcd": math.gcd,
  "pow": math.pow,
  "hypot": math.hypot,
  "trunc": math.trunc,
  "isfinite": math.isfinite,
  "isinf": math.isinf,
  "isnan": math.isnan,
  "fabs": math.fabs,
  "fmod": math.fmod,
}

_SAFE_OPS: dict[type, Any] = {
  ast.Add: operator.add,
  ast.Sub: operator.sub,
  ast.Mult: operator.mul,
  ast.Div: operator.truediv,
  ast.FloorDiv: operator.floordiv,
  ast.Mod: operator.mod,
  ast.Pow: operator.pow,
  ast.USub: operator.neg,
  ast.UAdd: operator.pos,
  ast.BitXor: operator.xor,
  ast.BitAnd: operator.and_,
  ast.BitOr: operator.or_,
}

_MAX_SAFE_INT = 10 ** 300
_MAX_FACTORIAL_ARG = 1000


def _safe_eval(node: ast.AST) -> float | int:
  if isinstance(node, ast.Expression):
    return _safe_eval(node.body)

  if isinstance(node, ast.Constant):
    if isinstance(node.value, (int, float, complex)):
      if isinstance(node.value, int) and abs(node.value) > _MAX_SAFE_INT:
        raise ValueError("Число слишком большое для вычисления.")
      return node.value
    raise ValueError(f"Неподдерживаемая константа: {type(node.value).__name__}")

  if isinstance(node, ast.Name):
    name = str(node.id or "").strip().lower()
    if name not in _SAFE_NAMES:
      raise ValueError(f"Неизвестное имя: '{node.id}'. Разрешены только математические константы и функции.")
    return _SAFE_NAMES[name]

  if isinstance(node, ast.BinOp):
    op_type = type(node.op)
    if op_type not in _SAFE_OPS:
      raise ValueError(f"Неподдерживаемая операция: {op_type.__name__}")
    left = _safe_eval(node.left)
    right = _safe_eval(node.right)
    if op_type is ast.Pow:
      if isinstance(right, (int, float)) and abs(right) > 1000:
        raise ValueError("Показатель степени слишком большой.")
      if isinstance(left, (int, float)) and abs(left) > _MAX_SAFE_INT:
        raise ValueError("Основание слишком большое.")
    return _SAFE_OPS[op_type](left, right)

  if isinstance(node, ast.UnaryOp):
    op_type = type(node.op)
    if op_type not in _SAFE_OPS:
      raise ValueError(f"Неподдерживаемая унарная операция: {op_type.__name__}")
    operand = _safe_eval(node.operand)
    return _SAFE_OPS[op_type](operand)

  if isinstance(node, ast.Call):
    if not isinstance(node.func, ast.Name):
      raise ValueError("Поддерживаются только именованные функции.")
    func_name = str(node.func.id or "").strip().lower()
    if func_name not in _SAFE_NAMES:
      raise ValueError(f"Функция '{node.func.id}' не поддерживается. Используйте математические функции: sqrt, sin, cos, log и др.")
    func = _SAFE_NAMES[func_name]
    if not callable(func):
      raise ValueError(f"'{func_name}' не является функцией.")
    if node.keywords:
      raise ValueError("Именованные аргументы не поддерживаются.")
    if func_name == "factorial":
      if len(node.args) != 1:
        raise ValueError("factorial() принимает ровно 1 аргумент.")
      arg_val = _safe_eval(node.args[0])
      if not isinstance(arg_val, int) or arg_val < 0 or arg_val > _MAX_FACTORIAL_ARG:
        raise ValueError(f"factorial() принимает неотрицательное целое число не больше {_MAX_FACTORIAL_ARG}.")
    args = [_safe_eval(arg) for arg in node.args]
    return func(*args)

  raise ValueError(f"Неподдерживаемый элемент выражения: {type(node).__name__}")


def _format_result(value: Any) -> str:
  if isinstance(value, float):
    if math.isnan(value):
      return "nan"
    if math.isinf(value):
      return "inf" if value > 0 else "-inf"
    if value == int(value) and abs(value) < 1e15:
      return str(int(value))
    return f"{value:.10g}"
  if isinstance(value, complex):
    return str(value)
  return str(value)


def handle(args: dict[str, Any], runtime: Any, host: Any) -> dict[str, Any]:
  payload = args or {}
  raw_expression = str(payload.get("expression") or "").strip()
  if not raw_expression:
    raise ValueError("expression is required")
  if len(raw_expression) > MAX_EXPRESSION_CHARS:
    raise ValueError(f"Выражение слишком длинное (максимум {MAX_EXPRESSION_CHARS} символов).")

  try:
    tree = ast.parse(raw_expression, mode="eval")
  except SyntaxError as exc:
    msg = str(getattr(exc, "msg", "") or "некорректный синтаксис").strip()
    raise ValueError(f"Ошибка синтаксиса: {msg}") from exc

  try:
    result = _safe_eval(tree)
  except (ValueError, TypeError, ZeroDivisionError, OverflowError, ArithmeticError) as exc:
    return {
      "ok": False,
      "expression": raw_expression,
      "result": None,
      "result_repr": "",
      "error": str(exc),
    }

  result_repr = _format_result(result)
  if len(result_repr) > MAX_RESULT_REPR_CHARS:
    result_repr = result_repr[:MAX_RESULT_REPR_CHARS]

  return {
    "ok": True,
    "expression": raw_expression,
    "result": result if isinstance(result, (int, float)) and math.isfinite(result) else None,
    "result_repr": result_repr,
    "error": "",
  }
