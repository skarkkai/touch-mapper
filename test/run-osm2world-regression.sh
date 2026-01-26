#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="$repo_root/test/data"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/tm-osm2world-test.XXXXXX")"

cleanup() {
  rm -rf "$work_dir"
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
  "$work_dir/map.osm"

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
