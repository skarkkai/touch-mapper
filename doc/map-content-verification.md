# Map-Content Verification

This is the authoritative source for verification commands and content/locale review workflow.

Use this workflow when changing converter map-description logic or related UI description-model code.

## Core suite
- Use tests under `test/map-content/`.
- Canonical workflow and CLI details live in `doc/map-description-introspection.md`.
- Run `make test-regression` for the under-30-second offline deployment gate.
- Run `make test-regression-full` for the OSM2World output snapshot, fixture
  pipeline, tactile STL/SVG/PDF checks, and one local Chromium browser flow.
  The full command is offline after the one-time Playwright installation
  described below. In a socket-restricted agent sandbox, run this command with
  `exec_command`'s `sandbox_permissions: "require_escalated"` from the first
  invocation: its browser flow starts and connects to the local preview on
  `127.0.0.1:9000`. Use the same permission for the standalone browser smoke
  and local preview checks. The quick suite needs no socket access.
- Cached geographic inspection command (requires previously downloaded OSM):
  - `node test/map-content/run-tests.js --category average --offline --jobs 1`
- Prefer `simple`/`average` for routine checks.
- Use `complex` mainly for performance profiling.

## Blender visual regression artifacts
Run with `--with-blender` to generate geometry regression snapshots in `test/map-content/out/<category>/pipeline/`:
- `map-wireframe-flat.png`: before geometry modifications (flat source geometry).
- `map-wireframe.png`: after geometry modifications.

## Content and language checks
- Current UI grouping for linear features is roads + non-road linear groups (`paths`, `railways`, `waterways`, `otherLinear`) plus buildings.
- For result-page filtering, check that section tri-state controls include collapsed entries, aggregate entries carry all contributing OSM references, and a filtered rerun updates tactile output and descriptions from the same post-preset OSM source without another fetch. The editor should remain open after regeneration with removed entries still visible and unticked; checking one and applying again should restore it. The quick regression suite covers stored-source reuse and upstream exclusion; the offline browser smoke covers selection, request submission, and regenerated-result navigation.
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

## Full offline regression setup

The full suite uses the existing OSM2World jar, Blender 2.78, CairoSVG, Python 3.10+
for development scripts, and installed web build dependencies. Rebuild the jar
with `make osm2world` after Java changes; the harness does not rebuild it implicitly.
If the snapshot differs after a Java change, rebuild the jar before changing the
expected output.
Blender inspection remains compatible with its bundled Python 3.5.
Install Playwright and Chromium once:

```bash
bin/tmpctl mkdir .tmp/e2e-playwright-runtime
npm install --prefix .tmp/e2e-playwright-runtime --no-audit --no-fund playwright@1.58.2
.tmp/e2e-playwright-runtime/node_modules/.bin/playwright install chromium
```

Subsequent `make test-regression-full` runs make no external requests and install
no dependencies. It runs the quick gate, the OSM2World output snapshot, the
fixture pipeline and assertions, `make -C web build-offline`, and the Chromium
smoke. Run the snapshot alone with `bash test/run-osm2world-regression.sh`; on
failure it keeps the generated files under `.tmp/osm2world-regression/` for
comparison. The browser stubs search,
queue submission, IP lookup, conversion polling, and generated map assets;
all other external requests are blocked. It uses real keyboard Tab/Enter/Space
events for search, settings, Create, and description expansion. The application's
own polling navigates to the result page, which must load the generated STL and
show the expected description. The preview stays running at
http://127.0.0.1:9000/en/.

The full suite also runs `python3 test/map-content/check-content-filter.py`.
It uses the production stored-source and conversion entry points to check road
removal/restoration, retained lake geometry when a shared road is excluded, and
independent exclusion/restoration of generated coastal water areas. Assertions
cover description identities, actual STL surface heights, SVG polygons, and
PDF generation. Artifacts remain in `.tmp/filter-regression/`; the browser smoke
serves its original and regenerated road artifacts, and checks that selection
controls stay disabled during regeneration and become available again on failure.
Run this converter check before running the browser smoke alone.

The three synthetic OSM inputs live in `test/map-content/fixtures/`:

| Case | Main assertions |
| --- | --- |
| `mixed` | Car road, pedestrian path, building, pond, and road/path junction; matching categories and browser sections in every locale. |
| `no-buildings` | Production OSM filtering removes the building while retaining roads, path, pond and railway; no building in metadata, SVG or Blender geometry. |
| `big-roads` | Local/service roads are pruned, a residential middle segment of a major named route survives, and water/rail remain while buildings disappear. The quick test proves that the middle segment is pruned when given an unrelated name. |

All three cases run OSM2World → clip-2d → Blender → metadata enrichment through
the existing `test/map-content` harness. Local filtering and PDF generation reuse
`process-request.py` helpers with AWS clients disabled. Requests use consistent
17 cm / 1:1400 / 238 m settings. The fourth UI mode, `only-named-roads`, retains
its existing quick regression coverage.

Geometry checks inspect evaluated world coordinates in millimetres and sample
the actual exported STL above the base surface. Expected road/path/building
reliefs are independent values of 0.82/1.5/2.9 mm (0.08 mm tolerance includes
intentional mesh fattening/base overlap). Base thickness is 0.6 mm; printed
width/height must be within 1 mm of 170 mm, allowing projection differences.
Water must have a varying surface, not just a nonempty mesh. Main and split
STLs must parse with finite coordinates; SVG must have the expected feature
layers, physical size and orientation marker. The PDF check is deliberately
limited to CairoSVG's one-page output: page size, header/trailer, and a decodable
nonempty content stream. No manifoldness or whole-file snapshots are required.

Run just the converter assertions with `python3 test/map-content/check-regression.py`.
For regeneration without assertions, use
`node test/map-content/run-tests.js --suite regression-tests.json --all --offline --with-blender --jobs 1`.
Outputs remain under ignored `test/map-content/out/regression-*`; each pipeline
includes `geometry-measurements.json` for diagnostics. Browser failures save a
screenshot under `.tmp/e2e/offline-smoke/`. Tests do not retry failed assertions.

Characterization on 2026-09-18: three consecutive runs gave identical semantic
JSON and selected geometry/SVG measurements. The mixed fixture measured relief
of approximately 0.831 mm, 1.511 mm and 2.911 mm, with a 169.57 × 169.86 mm base.
A failure probe that removed car-road relief from the STL was rejected. The
full developer command took about 9.8 seconds here; the quick gate took about
2.3 seconds. These are local test-suite timings.
