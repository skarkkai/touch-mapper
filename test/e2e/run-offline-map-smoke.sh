#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_dir="$repo_root/.tmp/e2e-playwright-runtime"
if [[ ! -d "$runtime_dir/node_modules/playwright" ]]; then
  echo "Playwright is missing. Install playwright@1.58.2 into $runtime_dir before running the offline suite." >&2
  exit 1
fi

if ! curl -fsS --max-time 2 http://127.0.0.1:9000/en/ >/dev/null 2>&1; then
  "$repo_root/bin/tmpctl" mkdir .tmp/e2e
  nohup python3 "$repo_root/bin/serve-local" >"$repo_root/.tmp/e2e/local-preview.log" 2>&1 </dev/null &
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 2 http://127.0.0.1:9000/en/ >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
fi
if ! curl -fsS --max-time 2 http://127.0.0.1:9000/en/ >/dev/null; then
  echo "Local preview failed to start; see $repo_root/.tmp/e2e/local-preview.log" >&2
  exit 1
fi
NODE_PATH="$runtime_dir/node_modules" node "$repo_root/test/e2e/offline-map-smoke.js"
