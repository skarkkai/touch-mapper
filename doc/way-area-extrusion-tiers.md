# Way/Area Extrusion Tiers (Low / High / Building)

This document records how way/area features are rendered into tactile height tiers in the Blender conversion step.

It is derived from:

- `converter/obj-to-tactile.py` (actual `bpy.ops.mesh.extrude_region_move` usage and heights)
- `OSM2World/src/org/osm2world/core/target/obj/ObjTarget.java` (how `::pedestrian` suffix is assigned)
- `OSM2World/src/org/osm2world/core/map_data/object_info/TouchMapperCategory.java` (category naming)
- `converter/map_desc/map-description-classifications.json` (user-facing way/area subtype names)

## Tier Definitions

- `low`: raised/depressed with the lower relief values
- `high`: raised with the higher non-building relief values
- `building`: dedicated building extrusion height

Current constants in `converter/obj-to-tactile.py`:

- `ROAD_HEIGHT_CAR_MM = 0.82`
- `ROAD_HEIGHT_PEDESTRIAN_MM = 1.5`
- `BUILDING_HEIGHT_MM = 2.9`
- `WATERWAY_DEPTH_MM = 0.55`
- `WATER_AREA_DEPTH_MM = 1.5` (wave pattern height target)

## Source-of-Truth Mapping by OBJ Category

These are the categories/prefixes actually handled in `process_objects(...)`.

| OBJ category/prefix | Way/Area kind | Tier | How it is extruded |
|---|---|---|---|
| `Road*` with no `::pedestrian` suffix | way/area | `low` | `raise_ob(..., ROAD_HEIGHT_CAR_MM * mm_to_units)` |
| `Road*::pedestrian` | way/area | `high` | `raise_ob(..., ROAD_HEIGHT_PEDESTRIAN_MM * mm_to_units)` |
| `Rail*` | way | `low` | `do_ways(..., ROAD_HEIGHT_CAR_MM * mm_to_units * 0.99)` |
| `Waterway*` or `River*` | way | `low` (depressed) | `raise_ob(..., WATERWAY_DEPTH_MM * mm_to_units)` |
| `Water*` or `AreaFountain*` | area | `high` | `water_wave_pattern(..., WATER_AREA_DEPTH_MM * mm_to_units, ...)` after remesh prep extrusion |
| `Building*` | area | `building` | `extrude_building(..., BUILDING_HEIGHT_MM * mm_to_units)` |

Notes:

- `BuildingEntrance*` is deleted before extrusion and is not rendered as its own tactile tier.
- Unknown/unhandled object prefixes are not sent through `raise_ob(...)` / `extrude_building(...)`; they remain un-extruded by this stage.

## Map Page Height Note Mapping

Map page section notes are shown directly below each section heading. Current
mapping is:

| Map page section | Note text rule |
|---|---|
| `roads` | `Raised __mm__ mm` (from road car extrusion height) |
| `paths` | `Raised __mm__ mm` (from pedestrian road extrusion height) |
| `railways` | `Raised __mm__ mm` (from rail extrusion height) |
| `waterways` | `Waved surface` |
| `waterAreas` | `Waved surface` |
| `otherLinear` | `Raised by varying amounts` when mixed/unknown |
| `buildings` | `Raised __mm__ mm` (from building extrusion height) |

If a section resolves to more than one non-water profile in current map data,
the fallback note is `Raised by varying amounts` instead of a single mm value.

## How "Pedestrian" vs "Car" Is Decided

The suffix `::pedestrian` is assigned in OSM2World (`ObjTarget.java`) when a way/node is path-like. Path-like detection includes, among others:

- `highway=path|footway|cycleway|service|bridleway|living_street|pedestrian|track|steps`
- `footway=*`, `foot=yes|designated`
- `tourism=attraction`, `man_made=pier|breakwater`

`obj-to-tactile.py` then uses that suffix (`road_name.endswith("::pedestrian")`) to choose the `high` tier for `Road*` and `RoadArea*`.

## Mapping to Current Map-Description Way/Area Subtypes

This section maps the user-facing subtype names to tactile tiers as currently rendered.

### Linear subclasses (`A*`)

| Subclass | Tier |
|---|---|
| `A1_road_construction` | `low` |
| `A1_major_roads` | `low` |
| `A1_secondary_roads` | `low` |
| `A1_local_streets` | `low` |
| `A1_service_roads` | `low` |
| `A1_track_roads` | `low` |
| `A1_vehicle_unspecified` | `low` |
| `A2_pedestrian_streets` | `high` |
| `A2_footpaths_trails` | `high` |
| `A2_cycleways` | `high` |
| `A2_steps_ramps` | `high` |
| `A2_pedestrian_unspecified` | `high` |
| `A3_rail_lines` | `low` |
| `A3_tram_light_rail` | `low` |
| `A3_subway_metro` | `low` |
| `A3_rail_yards_sidings` | `low` |
| `A4_rivers` | `low` |
| `A4_streams_canals` | `low` |
| `A4_ditches_drains` | `low` |
| `A4_other_waterways` | `low` |
| `A_other_ways` | usually unhandled by extrusion unless represented as one of the handled prefixes above |

`A5_connectivity_nodes` is node-only, not a way/area extrusion tier.

### Areal subclasses (`B*`)

| Subclass | Tier |
|---|---|
| `B1_lakes` | `high` (water area wave pattern) |
| `B1_ponds` | `high` (water area wave pattern) |
| `B1_reservoirs` | `high` (water area wave pattern) |
| `B1_sea_coast` | `high` (water area wave pattern when represented as `Water*`/`AreaFountain*`) |
| `B1_riverbanks` | `high` (water area wave pattern) |
| `B1_other_water` | `high` (water area wave pattern) |
| `B2_parks_recreation` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B2_forests` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B2_fields_open` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B3_residential` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B3_commercial` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B3_industrial` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |
| `B_other_areas` | not explicitly extruded in `obj-to-tactile.py` (unhandled area family) |

### Building subclasses (`C*`)

| Subclass | Tier |
|---|---|
| `C1_landmark` | `building` |
| `C2_public` | `building` |
| `C3_other_buildings` | `building` |

## Relevant Code Pointers

- Height constants: `converter/obj-to-tactile.py:19`
- Building extrusion: `converter/obj-to-tactile.py:299`
- Generic raise extrusion: `converter/obj-to-tactile.py:359`
- Water area remesh prep extrusion: `converter/obj-to-tactile.py:367`
- Feature bucketing + tier application: `converter/obj-to-tactile.py:598`
- Pedestrian suffix logic: `OSM2World/src/org/osm2world/core/target/obj/ObjTarget.java:96`
- Category naming: `OSM2World/src/org/osm2world/core/map_data/object_info/TouchMapperCategory.java:24`
