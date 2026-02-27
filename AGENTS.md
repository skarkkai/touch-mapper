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

---

# Development guardrails

Always:

- Scope changes tightly.
- Preserve tactile meaning.
- Update docs if behavior changes.

Never:

- Compromise tactile clarity.
- Work around map content problems downstream because earlier pipeline stages have created poor output.
- Introduce hidden pipeline coupling.
- Assume geometric correctness is more important than tactile clarity.
- Use Python newer than 3.5 where Blender/runtime constraints apply.
- Present multi-core performance as production performance.

Performance baseline constraints:

- Production assumptions are single core, 1 GB RAM, EC2 T-class instance.
- Benchmark with `taskset -c 0` when making performance claims.

Runtime architecture constraints:

Browser → SQS message → EC2 converter → S3 output → browser fetch

Execution time: 1-300 seconds.
Memory budget: 1 GB RAM maximum.
OSM data reading over Overpass API is dominant cost.

Temporary file policy:

- Use `.tmp/` and `bin/tmpctl`.
- Do not use `/tmp/` for project temp files.

Web i18n guardrail:

- There is no full runtime locale dictionary.
- JS must receive text through templates or `data-*` attributes.
- Locale files live in `web/locales/<lang>/tm.json`.

Authoritative coding conventions: `doc/development-conventions.md`.

---

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
