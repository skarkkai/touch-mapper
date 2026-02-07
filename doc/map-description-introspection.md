# Map Description Introspection (Dev Only)

This workflow generates `map-content.json` from `map.osm` and then builds
structured map description models from UI code without rendering the page.

## Overview

1. `test/scripts/generate-map-content-from-osm.py`
   - runs OSM2World on a `.osm` file
   - runs `python3 -m converter.map_desc` on the generated `map-meta-raw.json`
   - emits generated file paths as JSON
2. `test/scripts/inspect-map-description.js`
   - calls the Python generator above
   - loads `map-desc-ways.js`, `map-desc-areas.js`, and `map-description.js`
   - runs their `buildModel(...)` functions
   - writes one machine-readable JSON artifact

## End-to-end example

```bash
node test/scripts/inspect-map-description.js \
  --osm test/data/map.osm \
  --locale en \
  --out /tmp/tm-map-description-model.json
```

The command prints output JSON with:

- `outPath`: written artifact path
- `mapContentPath`: generated `map-content.json` path

The artifact includes:

- source metadata (`inputOsmPath`, locale, generator output paths)
- `waysModel` from `window.TM.mapDescWays.buildModel(...)`
- `areasModel` from `window.TM.mapDescAreas.buildModel(...)`
- `mapDescriptionModel` from `window.TM.mapDescription.buildModel(...)`

## Python generator usage

```bash
python3 test/scripts/generate-map-content-from-osm.py \
  --osm test/data/map.osm \
  --out-dir /tmp/tm-map-desc-work
```

Optional flags:

- `--scale <int>`: OSM2World `TOUCH_MAPPER_SCALE` value (default `1400`)
- `--exclude-buildings`: run OSM2World with `TOUCH_MAPPER_EXCLUDE_BUILDINGS=true`

## Notes

- This tooling is development-only; production browser/runtime behavior is not
  changed.
- Locale dictionaries are loaded from `web/locales/<lang>/tm.json` with English
  fallback from `web/locales/en/tm.json`.

## Smoke tests

```bash
bash test/scripts/test-map-description-introspection.sh
```

This script covers:

- end-to-end generation and model export
- locale difference smoke (`en` vs `de`)
- missing input file error handling
