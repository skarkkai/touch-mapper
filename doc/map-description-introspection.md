# Map Description Introspection (Dev Only)

This workflow generates `map-content.json` from `map.osm` and then builds
structured map description models from UI code without rendering the page.

## Overview

1. `test/map-content/generate-map-content-from-osm.py`
   - runs OSM2World on a `.osm` file
   - runs `clip-2d` (when `--with-blender`) to produce grouped Blender `.ply` inputs
   - runs `python3 -m converter.map_desc` on the generated `map-meta-raw.json`
   - emits generated file paths as JSON
2. `test/map-content/inspect-map-description.js`
   - calls the Python generator above
   - loads `map-desc-ways.js`, `map-desc-areas.js`, and `map-description.js`
   - runs their `buildModel(...)` functions
   - writes one machine-readable JSON artifact
3. `test/map-content/run-tests.js`
   - runs category tests (`--category`) or the full suite (`--all`) in parallel
   - writes test artifacts to `test/map-content/out/<category>/`
   - prints and stores per-stage timing data
4. `test/map-content/tests.json`
   - defines test categories (`simple`, `average`, `complex`) using server-style `requestBody` payload fields
   - includes map bbox (`effectiveArea`) used for OSM fetching/caching

## End-to-end example

```bash
node test/map-content/inspect-map-description.js \
  --osm test/data/map.osm \
  --locale en \
  --out /tmp/tm-map-description-model.json
```

The command prints output JSON with:

- `outPath`: written artifact path
- `mapContentPath`: generated `map-content.json` path

The artifact includes:

- source metadata (`inputOsmPath`, locale, generator output paths)
- `waysModel` from `window.TM.mapDescWays.buildModel(...)` (all linear features)
- `areasModel` from `window.TM.mapDescAreas.buildModel(...)`
- `mapDescriptionModel` from `window.TM.mapDescription.buildModel(...)` (`roads`, `paths`, `railways`, `waterways`, `waterAreas`, `otherLinear`, `buildings`)

## Python generator usage

```bash
python3 test/map-content/generate-map-content-from-osm.py \
  --osm test/data/map.osm \
  --out-dir /tmp/tm-map-desc-work
```

Optional flags:

- `--scale <int>`: OSM2World `TOUCH_MAPPER_SCALE` value (default `1400`)
- `--exclude-buildings`: run OSM2World with `TOUCH_MAPPER_EXCLUDE_BUILDINGS=true`
- `TOUCH_MAPPER_TRIANGULATION_COLLINEAR_TOLERANCE_M=<float>` (env): floor-level triangulation simplification tolerance in meters (default `0.01`; set `0` to disable)
- `--with-blender`: also run Blender tactile export and write `map.stl`, `map-ways.stl`, `map-rest.stl`, `map.svg`, `map.blend`, pre-modification wireframe-overlay render `map-wireframe-flat.png`, and post-modification wireframe-overlay render `map-wireframe.png` into `--out-dir`
  - also writes `map-clip-report.json` from the `clip-2d` stage
- `--diameter <int>` and `--size <float>`: required when `--with-blender` is used
- `--no-borders`: pass through to Blender export when `--with-blender` is used
- `--marker1 <json>`: pass marker position JSON through to Blender export when `--with-blender` is used

## Notes

- This tooling is development-only; production browser/runtime behavior is not
  changed.
- Locale dictionaries are loaded from `web/locales/<lang>/tm.json` with English
  fallback from `web/locales/en/tm.json`.

## Smoke tests

```bash
bash test/map-content/test-map-content-suite.sh
```

This script covers:

- all three category tests (`simple`, `average`, `complex`)
- required artifact presence in `test/map-content/out/<category>/`
- per-locale structured and text-simulated outputs

## Category Test Runner

Run all tests:

```bash
node test/map-content/run-tests.js --all
```

Run one category:

```bash
node test/map-content/run-tests.js --category average
```

Optional flags:

- `--jobs <N>`: max tests to run in parallel
- `--offline`: use only cached OSM input from `test/map-content/cache/`
- `--keep-existing-out`: do not clean `test/map-content/out/<category>/` before a run
- `--with-blender`: run Blender tactile export during generation and keep the generated `map*.stl`, `.svg`, `.blend`, `map-wireframe-flat.png`, and `map-wireframe.png` files in `test/map-content/out/<category>/pipeline/`

### Makefile shortcuts

From `test/map-content/`:

- `make average` / `make complex`: regular map-content runs
- `make average-bl` / `make complex-bl`: same runs with Blender outputs in each category's `pipeline/` directory
- `make simple-bl` and `make all-bl` are also available

## Test Definition Shape

`test/map-content/tests.json` uses this structure:

```json
{
  "tests": [
    {
      "category": "simple",
      "requestBody": {
        "lat": 0,
        "lon": 0,
        "scale": 2100,
        "diameter": 357,
        "size": 17,
        "effectiveArea": {
          "lonMin": 0,
          "lonMax": 0,
          "latMin": 0,
          "latMax": 0
        }
      }
    }
  ]
}
```

## Recommended Usage For Development

- Use `simple` or `average` for routine correctness checks while iterating.
- Use `complex` primarily for performance profiling and hotspot analysis.
- Typical quick validation command:
  - `node test/map-content/run-tests.js --category average --offline --jobs 1`
