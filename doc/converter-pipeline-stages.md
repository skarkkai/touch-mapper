# Converter Pipeline Stages

This is the authoritative source for converter stage names and metadata lifecycle definitions.

This document describes converter data flow and stage names used by code comments and artifacts.

## OSM2World notes
- `OSM2World/` is a modified upstream dependency and rarely changed.
- To build safely, use:
  - `ant clean jar`
- OSM2World outputs:
  - `map.obj`: geometry (height is applied later in Blender).
  - `map-meta-raw.json`: semantic metadata before Touch Mapper enrichment.
  - `clip-2d` then clips `map.obj` into grouped `.ply` meshes for Blender input.

## Processing pipeline
1. OSM data is fetched from OSM servers for the requested area.
2. OSM2World reads OSM data and outputs `map.obj` and `map-meta-raw.json`.
3. `clip-2d` clips OBJ triangles to map bounds and writes grouped `.ply` files plus `map-clip-report.json`.
4. Blender (`obj-to-tactile.py`) reads grouped `.ply` files and writes tactile outputs (`map.stl`, split STLs, SVG, blend, wireframes).
5. `converter.map_desc` enriches metadata and writes `map-meta.augmented.json`, `map-meta.json`, and `map-content.json`.
6. `converter/process-request.py` uploads artifacts to S3. Uploaded `.map-content.json` includes `metadata.requestBody` (full request params including real `requestId`).
7. Browser UI fetches `.map-content.json` from S3/CloudFront and presents map descriptions.

### OSM fetch mode notes
- All content modes (`normal`, `no-buildings`, `only-big-roads`, `only-named-roads`) use the same network fetch strategy:
  - randomized Overpass `xapi?map?bbox=` endpoint attempts first
  - OSM main API `api/0.6/map?bbox=` fallback last
- Mode-specific behavior is applied after fetch:
  - `normal`: no local OSM content pruning.
  - `no-buildings`: local OSM filtering removes building features.
  - `only-big-roads`: local OSM pruning keeps major-road-focused content for tactile density/continuity.
  - `only-named-roads`: local OSM filtering keeps highways with a nonblank `name`, any `name:*`, `loc_name`, or `short_name`, plus railway tracks and water areas. Named paths/service roads qualify; density is ignored. Buildings and standalone linear waterways are excluded. Water boundary members retain geometry without excluded highway/building tags. Naming is independent of UI language; see `map-description-model-schema.md`.
- Each completed map stores a private compressed copy of its post-preset OSM source at `map/data/<requestId>.osm.gz`. A result-page content-filter request reads the original map's copy, removes selected physical OSM features before OSM2World, and suppresses selected text-only POIs during metadata grouping. It then runs the same OSM2World → clip-2d → Blender → metadata → upload stages without another OSM fetch. Filtered results keep the original request ID and complete exclusion set in info JSON; the browser uses the original map-content description for the persistent checklist. Later filter requests start from the same original OSM copy, so unticking or rechecking items can remove or restore them within the original preset. `contentFilterAvailable` in info JSON enables the UI only for maps with a stored source.
- Physical OSM exclusions strip the selected object's rendering tags while retaining nodes, ways, and relation memberships needed by other selected features. `natural=coastline` is retained because generated coastal water has separate filter identities. Generated coastal polygons receive stable `coastline:<sha256>` references in OSM2World; exclusions travel through `osm-to-tactile.py --exclude-coastline-areas` to `TOUCH_MAPPER_EXCLUDED_COASTLINE_AREAS` and are applied as those polygons are created, before world modules render them. This keeps raw metadata, clipped geometry, tactile outputs, and descriptions consistent without treating synthetic relation IDs as source OSM objects.

## Metadata stage names (must stay in sync)
Any time you change these stages, keep this document and in-code stage comments synchronized.

Each referenced code file contains comments in format:
- `Code below creates stage "<stage name>" data`

### Stage: OSM2World raw meta
- Created at: `osm-to-tactile.py`
- Stored as: `map-meta-raw.json`
- Diff from previous: baseline semantic output from OSM2World; no Touch Mapper enrichment.

### Stage: Raw meta with visibility augmentation
- Created at: `converter/map_desc/__init__.py`
- Stored as: `map-meta.augmented.json`
- Diff from previous: adds `visibleGeometry` to line strings (clipped to boundary when possible).

### Stage: Raw meta with building/water area visibility raster
- Created at: `converter/map_desc/__init__.py`
- Stored as: `map-meta.augmented.json`
- Diff from previous: adds `visibleGeometry` raster summaries for building and rendered water-area polygons (coverage, segments, components, shape).

### Stage: Grouped + classified meta
- Created at: `converter/map_desc/__init__.py`
- Stored as: `map-meta.json`
- Diff from previous: reorganized into TM classes/subclasses with `_classification` and location annotations.

### Stage: Render-ready intermediate
- Created at: `converter/map_desc/map_desc_render.py`
- Stored as: in-memory (not written to disk)
- Diff from previous: items are grouped/sorted with display labels, counts, lengths/areas, and connectivity.
- Connectivity assigns shared roundabout identities to connected source ways
  tagged `junction=roundabout`. Visible contacts carry this identity through
  `connections[].roundabout`; the browser counts each component once. This is
  semantic metadata enrichment, with no change to tactile geometry or clipping.

### Stage: Final map content
- Created at: `converter/map_desc/map_desc_render.py`
- Stored as: `map-content.json`
- Diff from previous: serializes structured grouped data for all classes.

## Physical dimensions

Requests normalize at ingress to `printWidthCm` and `printHeightCm` (finite,
at least 1 cm and at most 99.9 cm) and one isotropic `scale`. Legacy `size` initializes
both axes only when neither new field exists. A partial pair is rejected even
when `size` exists. Normalization removes `size` and the unused `diameter`.
`effectiveArea` already describes an independent longitude/latitude bounding box:
width and height select geography; neither clipping nor extrusion stretches it.

Both converter CLIs accept `--print-width-cm` and `--print-height-cm`. Their old
`--size` square alias and ignored `--diameter` remain for existing local callers.
The road pruner uses physical width × height for its density target; its legacy
`--print-size-cm` alias is square-only. SVG physical dimensions are width ×
(height + 1 cm), including the existing north strip; PDF inherits these dimensions.
STL scaling remains uniform. Small projection differences from requested physical
size are unchanged (roughly 0.25% in the offline fixtures).

Deploy the converter and email Lambda before enabling the updated browser.
Queued legacy square requests remain supported. `info.json` and
`map-content.json.metadata.requestBody` persist the normalized pair. Filtered
reruns retain both dimensions. Stats use `print_width_cm` and `print_height_cm`;
the Athena `size_cm` column remains available for historical records.
