#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_dir="$repo_root/.tmp/e2e-playwright-runtime"
script_path="$repo_root/test/e2e/touch-mapper-settings-regression.js"

mkdir -p "$runtime_dir"

if [[ ! -f "$runtime_dir/package.json" ]]; then
  cat > "$runtime_dir/package.json" <<'JSON'
{
  "name": "touch-mapper-e2e-runtime",
  "private": true,
  "version": "1.0.0"
}
JSON
fi

if [[ ! -d "$runtime_dir/node_modules/playwright" ]]; then
  echo "Installing Playwright into .tmp runtime..."
  (cd "$runtime_dir" && npm install --no-audit --no-fund playwright@1.58.2)
fi

if [[ ! -d "$HOME/.cache/ms-playwright/chromium-1208" ]]; then
  echo "Installing Playwright Chromium browser..."
  (cd "$runtime_dir" && ./node_modules/.bin/playwright install chromium)
fi

NODE_PATH="$runtime_dir/node_modules" node "$script_path" "$@"
