# Touch Mapper

This file captures project-specific conventions and "gotchas" that help especially an AI make safe, aligned changes.

## Repo layout (high level)
- `web/`: static web UI built with Metalsmith + ECT + Less.
- `converter/`: Python-based OSM -> tactile map conversion pipeline.
- `OSM2World/`: vendored upstream with local modifications; rarely changed.
- `install/`: AWS packaging/deploy scripts for server-side code.
- `translation/`: helper scripts for spreadsheet-based translation collection (rarely used).

## Generated vs source (web)
- `web/src/*.ect` are generated from `web/pre-src/*.pre` via `web/pre2src.py`.
  - Edit `web/pre-src/*.pre`, not `web/src/*.ect`.
- `web/build.js` runs the Metalsmith pipeline; output goes to `web/build/`.
- `web/src/styles/*.less` are the source; compiled to CSS during the build.

## Web build conventions
- Build pipeline (`web/build.js`) does:
  - Converts `{{ key }}` in ECT files to `@t('key')` for i18n.
  - Runs `metalsmith-i18next` over `web/locales/*/tm.json`. Available locales seen as folders in `web/locales`.
  - Compiles Less and concatenates JS bundles into `scripts/app-common.js` and `scripts/vendor-common.js`.
- JavaScript should be as modern as possible while still working on the latest versions of Edge, Chrome, Firefox, and Safari (no legacy browser support).
  - OK: `async/await`, `fetch`, optional chaining, nullish coalescing, `URL`, `URLSearchParams`, `AbortController`, `class`.
  - Prefer: `const` by default, `let` when reassignment is needed (avoid `var`).
  - Prefer: `===`/`!==`, template literals, and `for...of` over index loops when iterating arrays.
  - Avoid: implicit globals, `with`, or `eval`.
  - Avoid: manual `XMLHttpRequest` or legacy polyfills aimed at IE/old Edge.
- `web/src/index.html` is a small redirect page; the main page template is `web/pre-src/index.pre`.
- `web/src/scripts/environment.js.*` are environment stubs; `web/create-env-js.sh` generates a real `environment.js` (requires AWS CLI + config).

## Translations / i18n
- Translation keys live in `web/locales/<lang>/tm.json`; the English file is the source of truth and runtime fallback.
- Keys are lowercase snake_case; prefixes group by feature (examples: `location2_`, `location3_`, `map_`, `multipart_`, `meta_`, `printing_`).
- In templates, use `{{ key }}` in `web/pre-src/*.pre`; `web/build.js` converts this to `@t('key')`.
- When adding or changing strings, update all locale files in the same change; copy English text as a placeholder if a translation is unknown.
- Translation spreadsheets in `translation/` exist for human translators but are not the primary edit path.
- `window.TM.translations` is a small, template-injected set of strings for JS; it is not a full runtime locale dictionary. If JS needs strings, expose them via templates (e.g., `window.TM` or `data-*` attributes).
- There’s no client‑side locale dictionary; JS should receive text from templates (e.g., rendered HTML or data-* attributes), not look up keys at runtime.

## Python conventions
- Write modern Python; avoid Python 2 compatibility hacks.
  - Python runtime is always `blender/2.78/python/bin/python3.5m` or similar; when starting, find out its version.
  - Prefer: f-strings, `pathlib`, context managers (`with`), and `enumerate`/`zip` over index loops.
  - Prefer: explicit exceptions (no bare `except`), and small pure functions with clear inputs/outputs.
  - Logging: use `print` for CLI scripts and one-off tooling; use `logging` for long-running processes or code that may be imported.
  - Avoid: mutable default arguments, implicit `None` returns for data-producing functions, and excessive global state.
  - Use type hints broadly and TypeDicts (using the functional form) for maximal type checking.
- Type checking: conform to Pylance/Pyright "standard" level (see pyrightconfig.json).
  - After making changes, always run `pyright` for files you have changed, and fix any errors it flags.

## AWS / deployment notes (for code changes)
- Root `Makefile` has targets for AWS installs and packaging (dev/test/prod).
- `install/parameters.sh` derives env names; `TOUCH_MAPPER_DEV_ENV` controls the dev suffix.
- `install/run-dev-converter.sh` runs the OSM -> STL converter locally.

## Setup
- See `README.md` for full local setup steps (dependencies, AWS CLI, and web dev workflow).
- `init.sh` installs system dependencies and builds `OSM2World` (use it for full setup).

## OSM2World
- `OSM2World/` is a modified upstream dependency, rarely modified.
- To build, it's safest to run `ant clean jar`
- OSM2World outputs
  - an .obj file that contains all needed geometry without any height (it's extruded later in Blender)
  - map-meta.json that describes the elements on the map so they can be described textually in UI

## Processing pipeline

1. OSM data is fetched from OSM servers for the requested areas.

2. OSM data is read by OSM2World, which outputs both files `map.obj` and `map-meta.json` (metadata).

3. Browser UI fetches map-meta.json from Touch Mapper S3 bucket, and presents its content to the user in a way described above.

### Metadata processing stages in the converter

Any time you make changes to code verify this list is still up-to-date. Each code file referenced below contains a comment that says where in that file the data for the stage is created, in a format "Code below creates stage "<stage name>" data" -- update it too as needed.

#### Stage name: "OSM2World raw meta"

Created at: osm-to-tactile.py
Stored as: map-meta-raw.json
Diff from previous: baseline semantic output from OSM2World; no Touch Mapper enrichment yet.

#### Stage name: "Raw meta with visibility augmentation"

Created at: __init__.py
Stored as: map-meta.augmented.json
Diff from previous: adds visibleGeometry to line strings (clipped to boundary when possible).

#### Stage name: "Grouped + classified meta"

Created at: __init__.py
Stored as: map-meta.json
Diff from previous: reorganized into TM classes/subclasses with _classification and location annotations.

#### Stage name: "Render-ready intermediate"

Created at: map_desc_render.py
Stored as: in-memory (not written to disk)
Diff from previous: items are grouped/sorted with display labels, counts, lengths/areas, and connectivity.

#### Stage name: "Final map content"

Created at: map_desc_render.py
Stored as: map-content.json
Diff from previous: adds “cooked” human‑readable summaries/segments per subclass.
