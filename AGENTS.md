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

## AWS / deployment notes (for code changes)
- Root `Makefile` has targets for AWS installs and packaging (dev/test/prod).
- `install/parameters.sh` derives env names; `TOUCH_MAPPER_DEV_ENV` controls the dev suffix.
- `install/run-dev-converter.sh` runs the OSM -> STL converter locally.

## Setup
- See `README.md` for full local setup steps (dependencies, AWS CLI, and web dev workflow).
- `init.sh` installs system dependencies and builds `OSM2World` (use it for full setup).

## OSM2World
- `OSM2World/` is a modified upstream dependency, rarely modified.
