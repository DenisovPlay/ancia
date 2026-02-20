#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  echo "[build-sidecar] .venv not found. Run: bash scripts/setup_backend.sh" >&2
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

if ! python -c "import PyInstaller" >/dev/null 2>&1; then
  echo "[build-sidecar] PyInstaller is not installed. Installing..."
  python -m pip install pyinstaller
fi

mkdir -p build dist src-tauri/bin

pyinstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name ancia-backend \
  backend/main.py

TARGET_BINARY="src-tauri/bin/ancia-backend"
if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == CYGWIN* || "$(uname -s)" == MSYS* ]]; then
  TARGET_BINARY="src-tauri/bin/ancia-backend.exe"
fi

cp -f dist/ancia-backend "$TARGET_BINARY" || cp -f dist/ancia-backend.exe "$TARGET_BINARY"
chmod +x "$TARGET_BINARY" 2>/dev/null || true

echo "[build-sidecar] Sidecar ready: $TARGET_BINARY"
