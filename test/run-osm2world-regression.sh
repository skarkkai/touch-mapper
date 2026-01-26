#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="$repo_root/test/data"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tm-osm2world-test.XXXXXX")"
log_path="$work_dir/osm-to-tactile.stdout.log"
test_ok=0

cleanup() {
  if [[ "$test_ok" -eq 1 ]]; then
    rm -rf "$work_dir"
  else
    echo "Test failed; keeping temp dir: $work_dir" >&2
    echo "osm-to-tactile stdout: $log_path" >&2
  fi
}
trap cleanup EXIT

if ! command -v json_pp >/dev/null 2>&1; then
  echo "json_pp is required for this test (used to pretty-print JSON output)." >&2
  exit 1
fi

osm2world_jar="$repo_root/converter/OSM2World/build/OSM2World.jar"
if [[ ! -f "$osm2world_jar" ]]; then
  echo "Missing OSM2World jar: $osm2world_jar" >&2
  exit 1
fi

cp "$data_dir/map.osm" "$work_dir/map.osm"

python3 "$repo_root/converter/osm-to-tactile.py" \
  --scale 1400 \
  --diameter 238 \
  --size 17 \
  "$work_dir/map.osm" >"$log_path"

json_pp < "$work_dir/map-meta.json" > "$work_dir/map-meta.indented.json"

if ! diff -u "$data_dir/map.obj" "$work_dir/map.obj"; then
  echo "map.obj differs from expected output." >&2
  exit 1
fi

if ! diff -u "$data_dir/map-meta.indented.json" "$work_dir/map-meta.indented.json"; then
  echo "map-meta.json differs from expected output." >&2
  exit 1
fi

echo "OSM2World regression test passed."
test_ok=1
