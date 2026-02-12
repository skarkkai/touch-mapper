# Converter Pipeline Stages

This document describes converter data flow and stage names used by code comments and artifacts.

## OSM2World notes
- `OSM2World/` is a modified upstream dependency and rarely changed.
- To build safely, use:
  - `ant clean jar`
- OSM2World outputs:
  - `map.obj`: geometry (height is applied later in Blender).
  - `map-meta-raw.json`: semantic metadata before Touch Mapper enrichment.

## Processing pipeline
1. OSM data is fetched from OSM servers for the requested area.
2. OSM2World reads OSM data and outputs `map.obj` and `map-meta-raw.json`.
3. `converter.map_desc` enriches metadata and writes `map-meta.augmented.json`, `map-meta.json`, and `map-content.json`.
4. `converter/process-request.py` uploads artifacts to S3. Uploaded `.map-content.json` includes `metadata.requestBody` (full request params including real `requestId`).
5. Browser UI fetches `.map-content.json` from S3/CloudFront and presents map descriptions.

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

### Stage: Final map content
- Created at: `converter/map_desc/map_desc_render.py`
- Stored as: `map-content.json`
- Diff from previous: serializes structured grouped data for all classes.
