#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

node "$repo_root/test/map-content/run-tests.js" --all --jobs 2

for category in simple average complex; do
  test_root="$repo_root/test/map-content/out/$category"
  [[ -f "$test_root/source/map-info.json" ]]
  [[ -f "$test_root/source/map.osm" ]]

  [[ -f "$test_root/pipeline/map.obj" ]]
  [[ -f "$test_root/pipeline/map-meta-raw.json" ]]
  [[ -f "$test_root/pipeline/map-meta.augmented.json" ]]
  [[ -f "$test_root/pipeline/map-meta.json" ]]
  [[ -f "$test_root/pipeline/map-content.json" ]]

  for locale in de en fi nl; do
    [[ -f "$test_root/descriptions/$locale/structured.json" ]]
    [[ -f "$test_root/descriptions/$locale/simulated.txt" ]]
  done

  [[ -f "$test_root/manifest.json" ]]
  [[ -f "$test_root/timings.json" ]]

done

echo "Map-content suite smoke test passed."
