# Touch Mapper Agent Guide

Use this file as the quick operating guide for coding agents and contributors.
Keep it specific, command-first, and easy to scan.

## Start here (copy/paste commands)

```bash
# Initial setup
./init.sh

# Fast converter/map-description verification
node test/map-content/run-tests.js --category average --offline --jobs 1

# Python type checks (required for changed Python files)
pyright converter/osm-to-tactile.py

# Web app local build/serve
cd web
make build
make serve
```

## Repo map

- `web/`: static UI (templates, JS, Less, locales).
- `converter/`: OSM -> tactile map conversion pipeline (Python + Node + Blender + helper scripts).
- `test/map-content/`: map-description verification and regression tooling.
- `OSM2World/`: vendored rendering/conversion dependency.
- `install/`: AWS packaging/deployment scripts.
- `doc/`: contributor and agent guidance.

## Source-of-truth rules

- Accessibility comes first in UI and content. Touch Mapper is used by visually impaired users.
- In `converter/`, do not preserve backward compatibility by default. If producer output changes, update consumers.
- For UI-only changes, confirm whether backward compatibility is required.
- Edit template sources in `web/pre-src/*.pre`, not generated `web/src/*.ect`.
- For translations, update `web/locales/<lang>/tm.json` files together in the same change.

## Validation by change type

- Python changes:
  - Run `pyright` on changed Python files and fix issues.
- Converter map-description changes:
  - Run `node test/map-content/run-tests.js --category average --offline --jobs 1`.
  - If geometry changes are involved, run with `--with-blender` and review:
    - `test/map-content/out/<category>/pipeline/map-wireframe-flat.png`
    - `test/map-content/out/<category>/pipeline/map-wireframe.png`
- UI text or description-model wording changes:
  - Validate locale outputs (`en`, `de`, `fi`, `nl`) and check simulated map-description text quality.
- Performance claims:
  - Use single-core runs only (`taskset -c 0 ...`).

## Boundaries

Always:
- Keep edits scoped to the task.
- Update docs when behavior or workflow changes.
- Prefer changing sources over generated artifacts.

Never:
- Present multi-core benchmarks as comparable to production.
- Skip required `pyright` checks for changed Python files.

## Temporary files policy

- Always create temporary files/directories needed during task execution under `<project-root>/.tmp/`.
- Create `.tmp/` as needed (`mkdir -p .tmp`).
- Do not use `/tmp` for new task artifacts unless the user explicitly requests it.

## Sandbox networking note

- In this environment, direct shell `curl` may work while Node `spawnSync("curl", ...)` fails DNS.
- If map-content fetch fails from Node:
  - Fetch with shell `curl` into `test/map-content/cache/<category>/map.osm`.
  - Re-run tests with `--offline`.

## Docs index

- `doc/development-conventions.md`: coding conventions, web/i18n details, Python guidelines.
- `doc/development-setup.md`: local setup, AWS setup, and development workflows.
- `doc/map-content-verification.md`: category suites, locale checks, and visual artifacts.
- `doc/map-description-introspection.md`: canonical map-description inspection CLI flow.
- `doc/converter-pipeline-stages.md`: OSM2World outputs and metadata stage names.
- `doc/map-description-model-schema.md`: map-description JSON schema.
- `doc/deployed-map-inspection.md`: inspect deployed map artifacts via map ID.
- `doc/ui-visual-baseline.md`: UI visual/style baseline.
- `doc/way-area-extrusion-tiers.md`: tactile extrusion tiers.
- `doc/creating-new-server.doc`: legacy server provisioning notes.
