#!/bin/bash
# Run on each host, before starting workers. Venvs are not deployment artifacts.
set -e
umask 077
dist_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
worker_venv="${TM_WORKER_VENV:-$dist_dir/../worker-venv}"
base_python="${TM_WORKER_BASE_PYTHON:-python3.12}"
"$base_python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else "Worker requires Python 3.12+")'
if [[ ! -d "$worker_venv" ]]; then
    "$base_python" -m venv "$worker_venv"
fi
"$worker_venv/bin/python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else "Existing worker venv requires Python 3.12+; recreate it with workers stopped")'
"$worker_venv/bin/python" -m pip install --upgrade -r "$dist_dir/worker-requirements.txt"
"$worker_venv/bin/python" -m pip check
TM_WORKER_PYTHON="$worker_venv/bin/python" bash "$dist_dir/worker-python.sh" --check
