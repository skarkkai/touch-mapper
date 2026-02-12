# Map-Content Verification

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

Required for POI/type-label/i18n changes:
- Run `inspect-map-description` against `test/map-content/out/complex/pipeline/map-content.json` for `en`, `de`, `fi`, and `nl`.
- Render simulation text from resulting `mapDescriptionModel` and review POI lines in each locale.
- Treat leftover English suffixes in non-English outputs as validation failures unless the borrowed word is intentionally identical in that locale.
