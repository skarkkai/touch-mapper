# Touch Mapper Agent Guide

This file is the operational contract for coding agents and contributors.

Touch Mapper generates tactile maps for blind and visually impaired users. Every change must preserve tactile clarity, semantic encoding, and pipeline integrity.

If unsure, stop and consult files in `doc/`.

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

Vertical elevation encodes meaning:

| Feature | Elevation |
|--------|-----------|
| Car roads | ~0.8 mm |
| Pedestrian roads | ~1.5 mm |
| Buildings | ~2.9 mm |

These elevations must remain distinguishable by touch.

Road width is part of tactile encoding and must not be arbitrarily changed.

Ground elevation must remain ignored.

Non-manifold geometry and overlapping solids are acceptable if prints are tactually correct.

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

- Do not merge pipeline stages.
- Do not bypass stages.
- Do not change stage responsibilities without updating doc/converter-pipeline-stages.md

Metadata lifecycle must remain consistent:

map-meta-raw.json  
→ map-meta.augmented.json  
→ map-meta.json  
→ map-content.json  

---

## map-content.json is a UI contract

map-content.json defines what users perceive in textual map description.

Default sections include:

- roads
- paths
- railways
- waterways
- buildings
- otherLinear

Agents modifying map-content.json must:

- Update schema docs
- Update verification tests
- Validate UI description output

Backward compatibility is NOT required.

Maps are mostly ephemeral.

---

## Map content authority

Map content is controlled only by UI modes:

1. Normal
2. No buildings
3. Only big roads

Agents must not introduce additional hidden filtering modes.

---

## "Only big roads" pruning rules (strict)

Goal:

Maintain tactile readability at scale.

Primary requirement:

User must feel:

- biggest roads are present
- continuity is preserved

Never allow:

- chopped roads
- unnatural gaps
- density correct but structure broken

Density target alone is insufficient.

Continuity perception is primary.

---

# Start here (copy/paste commands)

```bash
# Initial setup
./init.sh

# Fast converter/map-description verification
node test/map-content/run-tests.js --category average --offline --jobs 1

# Python type checks
pyright converter/osm-to-tactile.py

# Web build/serve
cd web
make build
make serve
````

---

# Repo structure

* web/
  Static UI, html + JS

* converter/
  Conversion pipeline (Python, Node, Blender)

* test/map-content/
  Regression and tactile description verification

* doc/
  Authoritative design documentation

* OSM2World/
  Vendored dependency

* install/
  Deployment scripts

---

# Development rules

Always:

* Scope changes tightly
* Preserve tactile meaning
* Update docs if behavior changes
* Edit template sources in web/pre-src/, not generated files
* Update all locales when changing UI text

Never:

* Compromise tactile clarity
* Introduce hidden pipeline coupling
* Assume geometric correctness is more important than tactile clarity
* Use Python newer than 3.5
* Present multi-core performance as production performance

---

# Validation requirements by change type

## Converter changes

Run:

```bash
node test/map-content/run-tests.js --category average --offline --jobs 1
```

If geometry changed:

```bash
node test/map-content/run-tests.js --category average --with-blender --jobs 1
```

Review visually:

test/map-content/out/*/pipeline/map-wireframe.png

---

## Python changes

Run:

```bash
pyright converter/osm-to-tactile.py
```

Fix all errors.

---

## map-content.json changes

Must verify:

* UI description text correctness
* Schema validity
* Locale outputs

---

## UI changes

Edit:

web/pre-src/

Then:

make build

Check locales:

* en
* fi
* de
* nl
* sp

English is source of truth. Finnish translations are human-verified and must be considered when choosing other translations.

---

## Performance claims

Production environment:

* single core
* 1 GB RAM
* EC2 T-class instance

Always benchmark with:

```bash
taskset -c 0
```

Never claim performance from multi-core runs.

---

# Runtime architecture constraints

Production system:

Browser
→ SQS message
→ EC2 converter
→ S3 output
→ browser fetch

Execution time:

1–300 seconds

Memory budget:

1 GB RAM maximum

Agents must not introduce memory-heavy operations without strong justification.

OSM data reading over Overpass API is dominant cost.

---

# Temporary file policy

Always use:

.tmp/

Never use:

/tmp/

Use:

bin/tmpctl

---

# Web system constraints

There is no runtime locale dictionary.

JS must receive text via:

* templates
* data-* attributes

Translation files:

web/locales/<lang>/tm.json

English is authoritative fallback.

---

# Core philosophy summary

Touch Mapper is a tactile language.

Not a renderer.

Not a GIS viewer.

Not a geometry processor.

Every change must preserve tactile meaning.

If a change improves geometric correctness but harms tactile clarity, reject it.

````

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
