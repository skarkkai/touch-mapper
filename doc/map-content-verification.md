# Map-Content Verification

This is the authoritative source for verification commands and content/locale review workflow.

Use this workflow when changing converter map-description logic or related UI description-model code.

## Core suite
- Use tests under `test/map-content/`.
- Canonical workflow and CLI details live in `doc/map-description-introspection.md`.
- Fast default command:
  - `node test/map-content/run-tests.js --category average --offline --jobs 1`
- Prefer `simple`/`average` for routine checks.
- Use `complex` mainly for performance profiling.

## Blender visual regression artifacts
Run with `--with-blender` to generate geometry regression snapshots in `test/map-content/out/<category>/pipeline/`:
- `map-wireframe-flat.png`: before geometry modifications (flat source geometry).
- `map-wireframe.png`: after geometry modifications.

## Content and language checks
- Current UI grouping for linear features is roads + non-road linear groups (`paths`, `railways`, `waterways`, `otherLinear`) plus buildings.
- If map content UI strings changed, inspect `simulated.txt` in each locale output for natural language quality.
- For railway-related changes, verify rail-rich fixtures produce railway entries in both `normal` and `only-big-roads` modes.
- For railway connectivity changes, verify railway junction/intersection narration is absent in simulated text output.
- For an explicit mode check on one rail-rich OSM source, run:
  - `node test/map-content/check-railway-modes.js --osm test/map-content/out/complex/source/map.osm --locale en`

Required for POI/type-label/i18n changes:
- Run `inspect-map-description` against `test/map-content/out/complex/pipeline/map-content.json` for `en`, `de`, `fi`, and `nl`.
- Render simulation text from resulting `mapDescriptionModel` and review POI lines in each locale.
- Treat leftover English suffixes in non-English outputs as validation failures unless the borrowed word is intentionally identical in that locale.

## Browser level testing

After changes affecting UI appearance, capture and visually inspect screenshots of the affected views in the local preview at `http://127.0.0.1:9000/en/`. Check layout, spacing, text wrapping, clipping, and visible keyboard focus against `doc/ui-visual-baseline.md`. Automated DOM assertions alone are insufficient. Store screenshots under `.tmp/` using `bin/tmpctl` to create artifact directories.

Playwright UI validation can be run with `bash test/e2e/run-touch-mapper-settings-regression.sh`.
The settings regression also verifies big-roads density visibility (shown only for `only-big-roads`) and value persistence across area -> map -> area navigation.


Named-road checks are registered in `make test-regression`: shared Python/JS
name fixtures, actual OSM filtering, request dispatch, and browser description
semantics. Names in any input language must qualify, regardless of UI locale.
Run `NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node test/e2e/named-roads-settings.js http://127.0.0.1:9000` (using the existing Playwright runtime) against a local web build for settings,
keyboard focus, absence of the removed explanation, retention persistence, request payload, and all-locale checks.
Full conversion validation can use `generate-map-content-from-osm.py` with
`--content-mode only-named-roads --with-blender --size 17 --diameter 238 --scale 1400`.
Keep full conversions and browser tests outside the quick regression suite.
