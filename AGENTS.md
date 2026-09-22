# Touch Mapper Agent Guide

This file is the operational contract for coding agents and contributors.

Touch Mapper generates tactile maps for blind and visually impaired users. Every change must preserve tactile clarity, semantic encoding, and pipeline integrity.

If unsure, stop and consult files in `doc/`.

## Scope and authority

`AGENTS.md` is authoritative for non-negotiable policy and guardrails.
`doc/*.md` is authoritative for procedures, commands, and implementation details.
If guidance conflicts, follow `doc/*.md` for operational behavior.

---

# Critical invariants (never violate)

These are architectural truths of Touch Mapper.

## Accessibility and tactile semantics

Touch Mapper is a symbolic tactile encoding system, not a realistic renderer.

Priority order:

1. Tactile clarity
2. Semantic contrast
3. Printability
4. Performance
5. Geometric correctness

Never reverse this order.

Vertical elevation encodes meaning and must remain tactually distinguishable.
Road width is part of tactile encoding and must not be arbitrarily changed.
Ground elevation must remain ignored.
Non-manifold geometry and overlapping solids are acceptable if prints are tactually correct.

Authoritative tier constants and mappings: `doc/way-area-extrusion-tiers.md`.

---

## Pipeline stage integrity (strict)

The converter pipeline is:

OSM
→ OSM2World
→ clip-2d
→ Blender tactile extrusion
→ metadata enrichment
→ render-ready model
→ map-content.json
→ S3 upload
→ UI rendering

Rules:

- Always merge bugs upstream (as early in the pipeline as possible), instead of being defensive downstream.
- Do not merge pipeline stages.
- Do not bypass stages.
- Do not change stage responsibilities without updating `doc/converter-pipeline-stages.md`.

Metadata lifecycle must remain consistent:

`map-meta-raw.json` → `map-meta.augmented.json` → `map-meta.json` → `map-content.json`

Authoritative stage definitions: `doc/converter-pipeline-stages.md`.

---

## map-content.json is a UI contract

`map-content.json` defines what users perceive in textual map description.

Default sections include:

- roads
- paths
- railways
- waterways
- buildings
- otherLinear

Agents modifying `map-content.json` must:

- Update schema docs.
- Update verification tests.
- Validate UI description output.

Backward compatibility is not required. Maps are mostly ephemeral.

Authoritative schema and verification workflows:

- `doc/map-description-model-schema.md`
- `doc/map-content-verification.md`
- `doc/map-description-introspection.md`

---

## Map content authority

Map content is controlled only by UI modes:

1. Normal
2. No buildings
3. Only big roads (includes water areas and railways)
4. Only named roads (includes named paths, water areas and railways)

---

# Development guardrails

Always:

- Scope changes tightly.
- Preserve tactile meaning.
- Update docs if behavior changes.
- When changes require an AWS infrastructure deployment (for example Athena/Glue schema or configuration, CloudFormation resources, IAM policies, or Lambda code), explicitly advise the user to run `make test-aws-install` from the repository root. Deploying EC2 `dist/` alone does not apply these changes. For production, explain that `make prod-aws-install` updates Lambda and prints the separate required `install/cloudformation-update.sh prod` command; do not imply that the make target updates the production stack automatically.
- After changes affecting UI appearance, inspect screenshots of the affected views in the local preview. Check layout, spacing, wrapping, clipping, and visible focus; automated DOM assertions alone are insufficient. Follow `doc/map-content-verification.md`.
- Add a small behavioral regression test for every bug fix or feature addition, and register it in the quick regression suite.
- Run `make test-regression` before deploying to test or production; keep this suite offline and under 30 seconds.

Never:

- Compromise tactile clarity.
- Work around map content problems downstream because earlier pipeline stages have created poor output.
- Introduce hidden pipeline coupling.
- Assume geometric correctness is more important than tactile clarity.
- Use Python newer than 3.5 where Blender/runtime constraints apply.
- Present multi-core performance as production performance.

Performance baseline constraints:

- Production assumptions are single core, 1 GB RAM, EC2 T-class instance.
- Benchmark production performance on Linux with `taskset -c 0`. macOS/Rosetta
  test timings are local developer timings and must not be presented as
  single-core production measurements.

Runtime architecture constraints:

Browser → SQS message → EC2 converter → S3 output → browser fetch

Execution time: 1-300 seconds.
Memory budget: 1 GB RAM maximum.
OSM data reading over Overpass API is dominant cost.

Temporary file policy:

- Use `.tmp/` and `bin/tmpctl`. Automated callers must invoke it with explicit Python (`sys.executable` from Python, `python3` from shell/Node) so copied checkouts work even when executable bits are lost.
- Do not use `/tmp/` for project temp files.

Web i18n guardrail:

- There is no full runtime locale dictionary.
- JS must receive text through templates or `data-*` attributes.
- Locale files live in `web/locales/<lang>/tm.json`.

Authoritative coding conventions: `doc/development-conventions.md`.

---

## Local preview preference

Keep `http://127.0.0.1:9000/en/` running after every work session. After web edits,
rebuild the local UI and verify the preview responds. Do not stop the preview
server during cleanup. End completion reports with a clickable link to
`http://127.0.0.1:9000/en/` when changes have been made available there. Follow `doc/development-setup.md` for local preview commands.

The full offline regression (`make test-regression-full`) and standalone browser
smoke (`bash test/e2e/run-offline-map-smoke.sh`) use a local HTTP preview on
`127.0.0.1:9000`. In a socket-restricted agent sandbox, invoke either command
with `exec_command`'s `sandbox_permissions: "require_escalated"` **on the first
attempt**. The same applies when starting or checking the preview directly.
The quick `make test-regression` suite does not need socket access.

On macOS the quick suite nevertheless needs
`sandbox_permissions: "require_escalated"` in a restricted agent sandbox: native `/usr/bin/time -l`
reads `sysctl kern.clockrate`. Linux uses GNU `time -v`; both platforms report
peak RSS in KiB and preserve the converter's UTF-8 locale.

## macOS development

Follow the macOS sections of `doc/development-setup.md`; `init.sh` and the old
web `make watch` recipe are Linux-specific. When a pinned runtime is missing,
check the documented official download and local installation flow before
reporting setup as blocked. Use Blender 2.78c with its bundled Python 3.5, not a
current Blender app. On Apple Silicon use Rosetta and the documented launcher
that resolves the real macOS app path. Keep downloaded archives in `.tmp/` and
installed runtimes in the ignored project-local Blender paths.

Use `make -C web build-offline` and `python3 bin/serve-local` for the portable
local preview. Native macOS fonts may differ from the Linux screenshot baselines;
do not replace accepted baselines just to make platform differences pass.

## Nightly dashboard layout preference

The nightly dashboard is used on a large screen. Prioritize desktop chart comparisons and information density; retain the existing narrow-screen fallback without further mobile-specific polish unless requested.

## Docs index

- `doc/development-conventions.md`: coding conventions, web/i18n details, Python guidelines.
- `doc/development-setup.md`: authoritative local setup and developer workflows.
- `doc/map-content-verification.md`: authoritative verification commands and locale/visual checks.
- `doc/map-description-introspection.md`: canonical map-description inspection CLI flow.
- `doc/converter-pipeline-stages.md`: authoritative OSM2World outputs, pipeline stage names, and metadata lifecycle.
- `doc/map-description-model-schema.md`: map-description JSON schema.
- `doc/deployed-map-inspection.md`: inspect deployed map artifacts via map ID.
- `doc/ui-visual-baseline.md`: UI visual/style baseline.
- `doc/way-area-extrusion-tiers.md`: authoritative tactile extrusion tiers.
- `doc/creating-new-server.doc`: legacy server provisioning notes.
