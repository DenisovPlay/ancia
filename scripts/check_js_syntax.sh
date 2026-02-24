#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  node --check "$file"
  count=$((count + 1))
done < <(find src -type f -name "*.js" | sort)

node --check "vite.config.js"
count=$((count + 1))

if [ "$count" -eq 0 ]; then
  echo "[check-js-syntax] no JS files found"
  exit 0
fi

echo "[check-js-syntax] OK ($count files)"
