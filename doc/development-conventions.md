# Development Conventions

This document collects day-to-day coding conventions for Touch Mapper.

## Repo layout (high level)
- `web/`: static web UI built with Metalsmith + ECT + Less.
- `converter/`: Python-based OSM -> tactile map conversion pipeline.
- `OSM2World/`: vendored upstream with local modifications; rarely changed.
- `install/`: AWS packaging/deploy scripts for server-side code.
- `translation/`: helper scripts for spreadsheet-based translation collection (rarely used).

## Web source vs generated files
- `web/src/*.ect` are generated from `web/pre-src/*.pre` via `web/pre2src.py`.
  - Edit `web/pre-src/*.pre`, not `web/src/*.ect`.
- `web/build.js` runs the Metalsmith pipeline; output goes to `web/build/`.
- `web/src/styles/*.less` are the source; compiled to CSS during the build.

## Web build conventions
- Build pipeline (`web/build.js`) does:
  - Converts `{{ key }}` in ECT files to `@t('key')` for i18n.
  - Runs `metalsmith-i18next` over `web/locales/*/tm.json`. Available locales are locale folders under `web/locales`.
  - Compiles Less and concatenates JS bundles into `scripts/app-common.js` and `scripts/vendor-common.js`.
- JavaScript should be as modern as possible while still working on latest Edge, Chrome, Firefox, and Safari (no legacy browser support).
  - OK: `async/await`, `fetch`, optional chaining, nullish coalescing, `URL`, `URLSearchParams`, `AbortController`, `class`.
  - Prefer: `const` by default, `let` when reassignment is needed (avoid `var`).
  - Prefer: `===`/`!==`, template literals, and `for...of` over index loops when iterating arrays.
  - Avoid: implicit globals, `with`, or `eval`.
  - Avoid: manual `XMLHttpRequest` or legacy polyfills aimed at IE/old Edge.
- `web/src/index.html` is a small redirect page; main page template is `web/pre-src/index.pre`.
- `web/src/scripts/environment.js.*` are environment stubs; `web/create-env-js.sh` generates a real `environment.js` (requires AWS CLI + config).

## Translations and i18n
- Translation keys live in `web/locales/<lang>/tm.json`; English is source of truth and runtime fallback.
- Keys are lowercase snake_case; prefixes group by feature (examples: `location2_`, `location3_`, `map_`, `multipart_`, `meta_`, `printing_`).
- In templates, use `{{ key }}` in `web/pre-src/*.pre`; `web/build.js` converts this to `@t('key')`.
- When adding/changing strings, update all locale files in the same change and translate non-English strings directly; if unknown, use English as placeholder.
- Translation spreadsheets in `translation/` exist for human translators but are not the primary edit path.
- `window.TM.translations` is a small, template-injected subset of strings for JS and not a full locale dictionary.
- There is no full client-side locale dictionary; JS should receive text from templates (rendered HTML / `data-*` attributes), not runtime key lookup.

## Coding guidelines
- In `converter/`, do not preserve backward compatibility by default. If data production changes, matching consumer changes are expected.
- For UI-only changes, confirm whether backward compatibility is required.
- Prioritize accessibility in UI and content; Touch Mapper is used by visually impaired users.

## Python conventions
- Write modern Python; avoid Python 2 compatibility patterns.
- Blender runtime for some scripts is old (`blender/2.78/python/bin/python3.5m` or similar); verify runtime version at start.
- Prefer: f-strings, `pathlib`, context managers (`with`), and `enumerate`/`zip` over manual index loops.
- Prefer: explicit exceptions (no bare `except`) and small pure functions.
- Logging: `print` for CLI/one-off tooling; `logging` for long-running/importable code.
- Avoid: mutable default args, implicit `None` returns for data-producing functions, and excessive global state.
- Use type hints broadly and use functional `TypedDict` form for maximal type checking.
- Type checking target: Pylance/Pyright "standard" (see `pyrightconfig.json`).
  - Run `pyright` for changed Python files and fix reported issues.

## AWS and deployment notes
- Root `Makefile` has targets for AWS install and packaging (dev/test/prod).
- `install/parameters.sh` derives environment names; `TOUCH_MAPPER_DEV_ENV` controls dev suffix.
- `install/run-dev-converter.sh` runs OSM -> STL converter locally.

## Setup references
- See `README.md` for full local setup and web workflow.
- `init.sh` installs system dependencies and builds `OSM2World`.
