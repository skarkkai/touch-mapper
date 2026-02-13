# Touch Mapper

This file is the quick start for contributors and coding agents. Detailed references now live under `doc/`.

## Critical rules
- Prioritize accessibility in UI and content; this tool is used by visually impaired users.
- In `converter/`, do not preserve backward compatibility by default. If producer output changes, consumer updates are expected.
- For UI-only changes, confirm whether backward compatibility is required.
- For Python changes, run `pyright` on changed Python files and fix issues.
- In web templates, edit `web/pre-src/*.pre` (source), not generated `web/src/*.ect`.
- For all benchmarking and performance comparisons, use exactly one CPU core (for example `taskset -c 0 ...`) because production runs with one core.

## Quick navigation
- Coding conventions and build/i18n guidance:
  - `doc/development-conventions.md`
- Map-content verification workflow and visual regression outputs:
  - `doc/map-content-verification.md`
  - `doc/map-description-introspection.md`
- Converter pipeline and metadata stage definitions:
  - `doc/converter-pipeline-stages.md`

## Common workflows
- Fast map-content check:
  - `node test/map-content/run-tests.js --category average --offline --jobs 1`
- Blender visual regression artifacts (when using `--with-blender`):
  - `map-wireframe-flat.png` (pre-modification)
  - `map-wireframe.png` (post-modification)
  - Output directory: `test/map-content/out/<category>/pipeline/`

## Sandbox networking note
- In this environment, direct `curl` commands run in the terminal with an approved prefix can succeed, but Node's internal `spawnSync("curl", ...)` still runs inside the restricted sandbox and may fail DNS resolution.
- If map-content fetch fails from Node with curl/DNS errors, use direct shell `curl` to fetch the OSM payload and write it to `test/map-content/cache/<category>/map.osm`, then rerun with `--offline`.

## Documentation index
- `doc/development-conventions.md`: repo layout, generated vs source files, web build conventions, i18n rules, Python conventions, deployment notes.
- `doc/map-content-verification.md`: category suite usage, locale validation expectations, visual regression artifacts.
- `doc/converter-pipeline-stages.md`: OSM2World outputs, processing flow, and canonical metadata stage names.
- `doc/map-description-introspection.md`: canonical CLI workflow for local map-description generation and inspection.
- `doc/map-description-model-schema.md`: schema reference for map-description JSON models.
- `doc/deployed-map-inspection.md`: inspecting deployed map artifacts via persistent map ID.
- `doc/ui-visual-baseline.md`: visual/style baseline for start/area/map views.
- `doc/way-area-extrusion-tiers.md`: way/area/building tactile extrusion tiers.
- `doc/creating-new-server.doc`: legacy server provisioning notes.
