#!/bin/bash
# Resolve the host-local worker environment; do not fall back to system Python.
set -e
dist_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
worker_python="${TM_WORKER_PYTHON:-$dist_dir/../worker-venv/bin/python}"
if [[ ! -x "$worker_python" ]]; then
    echo "Worker Python missing: $worker_python; run bash $dist_dir/setup-worker-python.sh" >&2
    exit 1
fi
if [[ "${1:-}" == --check || "${1:-}" == --print ]]; then
    "$worker_python" "$dist_dir/worker-runtime-check.py" >&2
    if [[ "$1" == --print ]]; then printf '%s\n' "$worker_python"; fi
else
    exec "$worker_python" "$@"
fi
