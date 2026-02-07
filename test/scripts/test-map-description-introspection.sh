#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/tm-map-desc-test.XXXXXX")"

en_out="$tmp_dir/en-model.json"
de_out="$tmp_dir/de-model.json"

node "$repo_root/test/scripts/inspect-map-description.js" \
  --osm "$repo_root/test/data/map.osm" \
  --locale en \
  --out "$en_out" \
  --work-dir "$tmp_dir/en-work" >/dev/null

python3 - "$en_out" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    artifact = json.load(handle)

assert isinstance(artifact.get("waysModel"), list), "waysModel must be a list"
assert isinstance(artifact.get("areasModel"), list), "areasModel must be a list"
assert len(artifact["waysModel"]) > 0, "waysModel should be non-empty"
assert len(artifact["areasModel"]) > 0, "areasModel should be non-empty"

model = artifact.get("mapDescriptionModel") or {}
ways = model.get("ways") or {}
buildings = model.get("buildings") or {}
assert ways.get("count", 0) > 0, "mapDescriptionModel.ways.count should be > 0"
assert buildings.get("count", 0) > 0, "mapDescriptionModel.buildings.count should be > 0"
PY

node "$repo_root/test/scripts/inspect-map-description.js" \
  --osm "$repo_root/test/data/map.osm" \
  --locale de \
  --out "$de_out" \
  --work-dir "$tmp_dir/de-work" >/dev/null

python3 - "$en_out" "$de_out" <<'PY'
import json
import sys

en_path, de_path = sys.argv[1], sys.argv[2]
with open(en_path, "r", encoding="utf-8") as handle:
    en_artifact = json.load(handle)
with open(de_path, "r", encoding="utf-8") as handle:
    de_artifact = json.load(handle)

en_model = json.dumps(en_artifact.get("mapDescriptionModel"), sort_keys=True)
de_model = json.dumps(de_artifact.get("mapDescriptionModel"), sort_keys=True)
assert en_model != de_model, "Expected EN and DE mapDescriptionModel outputs to differ"
PY

set +e
invalid_output="$(
  node "$repo_root/test/scripts/inspect-map-description.js" \
    --osm "$tmp_dir/missing.osm" \
    --locale en \
    --out "$tmp_dir/invalid.json" \
    2>&1
)"
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  echo "Invalid input test should fail" >&2
  exit 1
fi
if ! printf '%s' "$invalid_output" | grep -qi "not found"; then
  echo "Invalid input error should mention missing file" >&2
  exit 1
fi

echo "Map description introspection tests passed."
