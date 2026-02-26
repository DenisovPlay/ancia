#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN=""
if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[check-python-syntax] Python interpreter not found" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[check-python-syntax] git is required for tracked-files lint mode" >&2
  exit 1
fi

PY_FILES=()
while IFS= read -r file_path; do
  if [ -n "$file_path" ]; then
    PY_FILES+=("$file_path")
  fi
done < <(git ls-files "*.py")
if [ "${#PY_FILES[@]}" -eq 0 ]; then
  echo "[check-python-syntax] No tracked Python files found"
  exit 0
fi

"$PYTHON_BIN" -m py_compile "${PY_FILES[@]}"
echo "[check-python-syntax] OK (${#PY_FILES[@]} files)"
