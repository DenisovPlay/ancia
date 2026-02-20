#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

is_supported_python() {
  local bin="$1"
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 1
  fi
  "$bin" -c 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] < (3, 13) else 1)' >/dev/null 2>&1
}

resolve_python_bin() {
  if [ -n "${PYTHON_BIN:-}" ]; then
    if ! is_supported_python "$PYTHON_BIN"; then
      echo "[setup-backend] PYTHON_BIN=$PYTHON_BIN не подходит. Нужен Python 3.10-3.12." >&2
      exit 1
    fi
    printf '%s' "$PYTHON_BIN"
    return 0
  fi

  local candidates=(python3.12 python3.11 python3.10 python3)
  local candidate
  for candidate in "${candidates[@]}"; do
    if is_supported_python "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  echo "[setup-backend] Не найден подходящий Python. Установите Python 3.10-3.12." >&2
  exit 1
}

PYTHON_BIN="$(resolve_python_bin)"
echo "[setup-backend] Using python: $PYTHON_BIN ($("$PYTHON_BIN" -V 2>&1))"

if [ -x ".venv/bin/python" ]; then
  if ! is_supported_python ".venv/bin/python"; then
    echo "[setup-backend] Existing .venv uses unsupported Python. Recreating .venv..."
    rm -rf .venv
  fi
fi

if [ ! -d ".venv" ]; then
  echo "[setup-backend] Creating virtualenv (.venv)"
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

if ! is_supported_python "python"; then
  echo "[setup-backend] Активный .venv не соответствует Python 3.10-3.12." >&2
  exit 1
fi

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "[setup-backend] Done. Activate with: source .venv/bin/activate"
