# Python 3.5
from __future__ import division

import json
import os
import sys
import time
from collections import OrderedDict
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import TypedDict  # type: ignore[import-not-found]
else:  # pragma: no cover - blender python may not have typing_extensions
    try:
        from typing_extensions import TypedDict  # type: ignore[import-not-found]
    except ImportError:
        def TypedDict(name, fields, total=True):  # type: ignore[no-redef]
            return dict

from .map_desc_loc_segments import classify_location

MAX_ITEMS_PER_SUBCLASS = 10
SAMPLE_TS = (0.0, 0.25, 0.5, 0.75, 1.0)
EDGE_EPS = 1e-6


Bounds = TypedDict(
    "Bounds",
    {"minX": float, "minY": float, "maxX": float, "maxY": float},
    total=False
)
Boundary = TypedDict(
    "Boundary",
    {"minX": float, "minY": float, "maxX": float, "maxY": float}
)


def _coerce_boundary(boundary: Optional[Dict[str, Any]]) -> Optional[Boundary]:
    if not boundary:
        return None
    min_x = boundary.get("minX")
    min_y = boundary.get("minY")
    max_x = boundary.get("maxX")
    max_y = boundary.get("maxY")
    if not isinstance(min_x, (int, float)) or not isinstance(min_y, (int, float)):
        return None
    if not isinstance(max_x, (int, float)) or not isinstance(max_y, (int, float)):
        return None
    return {
        "minX": float(min_x),
        "minY": float(min_y),
        "maxX": float(max_x),
        "maxY": float(max_y)
    }


def _js_round(value: float) -> int:
    # Match JS Math.round behavior for consistent output.
    if value >= 0:
        return int((value + 0.5) // 1)
    return int((value - 0.5) // 1)


def _to_fixed(value: float, digits: int) -> str:
    # JS-like toFixed using JS rounding rules.
    scale = 10 ** digits
    rounded = _js_round(value * scale) / float(scale)
    if digits == 0:
        return str(int(_js_round(value)))
    fmt = "{0:." + str(digits) + "f}"
    return fmt.format(rounded)


def _get_name(tags: Optional[Dict[str, Any]]) -> Optional[str]:
    # Prefer the most human-friendly name available in tags.
    if not tags:
        return None
    return (
        tags.get("name") or
        tags.get("name:en") or
        tags.get("name:fi") or
        tags.get("name:sv") or
        tags.get("loc_name") or
        tags.get("short_name") or
        None
    )


def _loc_from_classification(location: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not location or not isinstance(location, dict):
        return None
    loc = location.get("loc")
    if not isinstance(loc, dict):
        return None
    kind = loc.get("kind")
    direction = loc.get("dir")
    if kind == "center":
        return {"kind": "center", "dir": None}
    if kind == "part":
        return {"kind": "part", "dir": direction}
    if kind == "near_edge":
        return {"kind": "near_edge", "dir": direction}
    return None


def _extract_loc(value: Optional[Any]) -> Optional[Dict[str, Any]]:
    if not value or not isinstance(value, dict):
        return None
    loc = value.get("loc")
    if isinstance(loc, dict):
        return loc
    if "kind" in value or "dir" in value:
        return value
    return None


def _loc_key(loc: Optional[Dict[str, Any]]) -> str:
    if not loc or not isinstance(loc, dict):
        return ""
    kind = loc.get("kind") or ""
    direction = loc.get("dir") or ""
    if direction:
        return str(kind) + ":" + str(direction)
    return str(kind)


def _location_struct_from_loc(loc: Optional[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    if not loc:
        return None
    return {key: {"loc": loc}}


def _location_key(location: Optional[Dict[str, Any]]) -> str:
    # Stable string key for grouping by location locs.
    if not location:
        return ""
    parts = []
    for key in ("start", "end", "center", "point"):
        value = location.get(key)
        if isinstance(value, dict):
            loc = _extract_loc(value)
            if loc:
                parts.append(key + "=" + _loc_key(loc))
    return "|".join(parts)


def _attach_semantics(entry: Dict[str, Any], item: Dict[str, Any]) -> None:
    semantics = item.get("semantics")
    if semantics is not None:
        entry["semantics"] = semantics


def _dir_label(direction: Optional[str]) -> Optional[str]:
    if not direction:
        return None
    if direction == "northwest":
        return "north-west"
    if direction == "northeast":
        return "north-east"
    if direction == "southwest":
        return "south-west"
    if direction == "southeast":
        return "south-east"
    return direction


def _corner_label(direction: Optional[str]) -> Optional[str]:
    if direction == "northwest":
        return "north-west corner"
    if direction == "northeast":
        return "north-east corner"
    if direction == "southwest":
        return "south-west corner"
    if direction == "southeast":
        return "south-east corner"
    return None


def _loc_phrase(loc: Optional[Dict[str, Any]]) -> Optional[str]:
    """Render location clauses

    Location classes:
    1) center
    2) part + direction
    3) near_edge + direction (diagonal near_edge means corner)

    Clause form:
    - "in the center"
    - "in the <dir> part"
    - "near the <dir> edge"
    - "in the <dir> corner"

    Rules:
    - corner phrases use "in the ... corner"
    """
    if not loc or not isinstance(loc, dict):
        return None
    kind = loc.get("kind")
    direction = loc.get("dir")
    dir_label = _dir_label(direction)
    if kind == "center":
        return "in the center"
    if kind == "part":
        if dir_label:
            return "in the " + dir_label + " part"
        return "in the center"
    if kind == "near_edge":
        if direction in ("northwest", "northeast", "southwest", "southeast"):
            corner = _corner_label(direction)
            if corner:
                return "in the " + corner
            return "in the corner"
        if dir_label:
            return "near the " + dir_label + " edge"
        return "near the edge"
    return None


def _location_value_phrase(value: Optional[Any]) -> Optional[str]:
    if isinstance(value, dict):
        loc = _extract_loc(value)
        phrase = _loc_phrase(loc)
        if phrase:
            return phrase
    return None


def _render_location_text(location: Optional[Dict[str, Any]], kind: str) -> Optional[str]:
    # Render a human-readable location string from structured locs.
    if not location:
        return None
    start_phrase = _location_value_phrase(location.get("start"))
    end_phrase = _location_value_phrase(location.get("end"))
    center_phrase = _location_value_phrase(location.get("center")) or _location_value_phrase(location.get("point"))
    if kind in ("linear", "boundary"):
        if not start_phrase and not end_phrase and not center_phrase:
            return None
        if start_phrase and end_phrase and start_phrase == end_phrase:
            text = start_phrase
        elif start_phrase and end_phrase:
            text = start_phrase + " -> " + end_phrase
        else:
            text = start_phrase or end_phrase or ""
        if center_phrase:
            if text:
                text += " (center: " + center_phrase + ")"
            else:
                text = center_phrase
        return text if text else None
    return center_phrase or start_phrase or end_phrase


def _normalize_label(value: Optional[Any]) -> Optional[str]:
    # Normalize tag values for display.
    if not value:
        return None
    return str(value).replace("_", " ")


def _format_meters(length_meters: Optional[float]) -> Optional[str]:
    # Format lengths in meters with coarse rounding like the JS renderer.
    if length_meters is None:
        return None
    length = max(0, length_meters)
    if length >= 1000:
        rounded = _js_round(length / 10.0) * 10
    elif length >= 100:
        rounded = _js_round(length / 5.0) * 5
    else:
        rounded = _js_round(length)
    return str(int(rounded)) + " m"


def _format_area(area_sq_m: Optional[float]) -> Optional[str]:
    # Format areas using ha for large areas and m^2 otherwise.
    if area_sq_m is None:
        return None
    area = max(0, area_sq_m)
    if area >= 10000:
        ha = area / 10000.0
        digits = 0 if ha >= 10 else 1
        return "~" + _to_fixed(ha, digits) + " ha"
    return "~" + str(int(_js_round(area))) + " m^2"


def _coord_key(coord: List[float]) -> str:
    # Stable key for coordinate matching across ways/nodes.
    return _to_fixed(float(coord[0]), 3) + "," + _to_fixed(float(coord[1]), 3)


def _polyline_length(coords: List[List[float]]) -> float:
    length = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        length += (dx * dx + dy * dy) ** 0.5
    return length


def _sample_point(coords: List[List[float]], t: float) -> Tuple[float, float]:
    total = _polyline_length(coords)
    if total <= 0 or len(coords) == 1:
        return coords[0][0], coords[0][1]
    target = max(0.0, min(1.0, t)) * total
    walked = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        seg_len = (dx * dx + dy * dy) ** 0.5
        if seg_len == 0:
            continue
        if walked + seg_len >= target:
            ratio = (target - walked) / seg_len
            return a[0] + ratio * dx, a[1] + ratio * dy
        walked += seg_len
    return coords[-1][0], coords[-1][1]


def _location_zone_for_point(point: Tuple[float, float],
                             boundary: Optional[Boundary]) -> Optional[Dict[str, Any]]:
    if not boundary:
        return None
    classification = classify_location({"x": point[0], "y": point[1]}, boundary)
    if not classification:
        return None
    loc = classification.get("loc") if isinstance(classification, dict) else None
    if isinstance(loc, dict):
        return loc
    return _loc_from_classification(classification)


def _sample_location_samples(coords: List[List[float]],
                             boundary: Optional[Boundary]) -> List[Dict[str, Any]]:
    samples = []
    for t in SAMPLE_TS:
        pt = _sample_point(coords, t)
        zone = _location_zone_for_point(pt, boundary) or "unknown"
        samples.append({"t": t, "zone": zone})
    return samples


def _edge_contact(point: Tuple[float, float], boundary: Boundary, eps: float) -> Optional[Dict[str, Any]]:
    x, y = point
    edges = []
    if abs(x - boundary["minX"]) <= eps:
        edges.append("west")
    if abs(x - boundary["maxX"]) <= eps:
        edges.append("east")
    if abs(y - boundary["minY"]) <= eps:
        edges.append("south")
    if abs(y - boundary["maxY"]) <= eps:
        edges.append("north")
    if not edges:
        return None
    if len(edges) >= 2:
        corner = None
        if "north" in edges and "west" in edges:
            corner = "northwest"
        elif "north" in edges and "east" in edges:
            corner = "northeast"
        elif "south" in edges and "west" in edges:
            corner = "southwest"
        elif "south" in edges and "east" in edges:
            corner = "southeast"
        return {"edge": "corner", "cornerName": corner, "edges": edges}
    return {"edge": edges[0]}


def _event_sort_key(event: Dict[str, Any]) -> Tuple[float, int]:
    order = {
        "map_edge_crossing": 0,
        "junction": 1,
        "continues_as": 2,
        "terminates": 3
    }
    evt_type = event.get("type") or ""
    return event.get("t", 0.0), order.get(evt_type, 99)


def _build_connectors_by_coord_key(connectors: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    index = {}  # type: Dict[str, List[Dict[str, Any]]]
    for connector in connectors:
        point = connector.get("point")
        if not point:
            continue
        key = _coord_key([point[0], point[1]])
        bucket = index.get(key)
        if bucket is None:
            index[key] = [connector]
            continue
        bucket.append(connector)
    return index


def _segment_vertex_first_occurrence_t(
    coords: List[List[float]]
) -> "OrderedDict[str, Dict[str, Any]]":
    # Map each unique segment coordinate key to the first path position t in [0, 1].
    index = OrderedDict()  # type: OrderedDict
    if not coords:
        return index

    first = coords[0]
    first_key = _coord_key(first)
    index[first_key] = {"t": 0.0, "point": (first[0], first[1])}

    total = _polyline_length(coords)
    if total <= 0 or len(coords) == 1:
        return index

    walked = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        seg_len = (dx * dx + dy * dy) ** 0.5
        walked += seg_len
        key = _coord_key(b)
        if key in index:
            continue
        index[key] = {"t": walked / total, "point": (b[0], b[1])}
    return index


def _segment_events(coords: List[List[float]],
                    boundary: Optional[Boundary],
                    connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                    connections_index: Dict[str, List[Dict[str, Any]]],
                    emit_connectivity: bool) -> List[Dict[str, Any]]:
    events = []
    if not coords:
        return events
    start = (coords[0][0], coords[0][1])
    end = (coords[-1][0], coords[-1][1])

    if boundary:
        for t_val, point in ((0.0, start), (1.0, end)):
            edge_info = _edge_contact(point, boundary, EDGE_EPS)
            if edge_info:
                zone = _location_zone_for_point(point, boundary) or "unknown"
                event = {"t": t_val, "type": "map_edge_crossing", "zone": zone}
                event.update(edge_info)
                events.append(event)

    junction_events = []
    if emit_connectivity:
        if connectors_by_coord_key:
            segment_coord_index = _segment_vertex_first_occurrence_t(coords)
            for coord_key, hit in segment_coord_index.items():
                matches = connectors_by_coord_key.get(coord_key)
                if not matches:
                    continue
                t_val = hit.get("t", 0.0)
                closest = hit.get("point", start)
                zone = _location_zone_for_point(closest, boundary) or "unknown"
                connections = connections_index.get(coord_key)
                for connector in matches:
                    event = {
                        "t": t_val,
                        "type": "junction",
                        "zone": zone,
                        "connectorType": connector["connectorType"]
                    }
                    if connections:
                        event["connections"] = connections
                    events.append(event)
                    junction_events.append(event)

    for t_val, point in ((0.0, start), (1.0, end)):
        if boundary and _edge_contact(point, boundary, EDGE_EPS):
            continue
        if any(abs(evt.get("t", 0.0) - t_val) <= 1e-6 for evt in junction_events):
            continue
        zone = _location_zone_for_point(point, boundary) or "unknown"
        events.append({"t": t_val, "type": "terminates", "zone": zone})

    return sorted(events, key=_event_sort_key)


def _build_visible_segments(item: Dict[str, Any],
                            boundary: Optional[Boundary],
                            connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                            connections_index: Dict[str, List[Dict[str, Any]]],
                            emit_connectivity: bool,
                            profile: Optional[Dict[str, float]] = None) -> List[Dict[str, Any]]:
    start_total = time.perf_counter()

    def add_timing(name: str, elapsed: float) -> None:
        if profile is None:
            return
        profile[name] = profile.get(name, 0.0) + elapsed

    segments = []
    segment_list = _iter_line_segments(item)
    if not segment_list:
        add_timing("build-visible-segments.total", time.perf_counter() - start_total)
        return segments

    # Order segments by descending length, then stable index.
    indexed = []
    for idx, coords in enumerate(segment_list):
        if not isinstance(coords, list) or not coords:
            continue
        indexed.append((idx, coords, _polyline_length(coords)))
    sorted_indexed = sorted(indexed, key=lambda entry: (-entry[2], entry[0]))
    for _, coords, length in sorted_indexed:
        location_samples = _sample_location_samples(coords, boundary)
        events = _segment_events(
            coords,
            boundary,
            connectors_by_coord_key,
            connections_index,
            emit_connectivity
        )
        segments.append({
            "length": length,
            "locationSamples": location_samples,
            "events": events
        })
    add_timing("build-visible-segments.total", time.perf_counter() - start_total)
    return segments

def _iter_grouped_items(grouped: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
    # Iterate items from already-classified grouped data.
    if not isinstance(grouped, dict):
        return
    for main_group in grouped.values():
        if not isinstance(main_group, dict):
            continue
        for items in main_group.values():
            if not isinstance(items, list):
                continue
            for item in items:
                yield item


def _connector_type_for_item(item: Dict[str, Any]) -> Optional[str]:
    cls = item.get("_classification", {})
    role = cls.get("role")
    if role == "junction":
        return "RoadJunction"
    if role == "connector":
        return "RoadConnector"
    if role == "crossing":
        return "RoadCrossingAtConnector"
    pr = item.get("primaryRepresentation")
    if pr in ("RoadJunction", "RoadConnector", "RoadCrossingAtConnector"):
        return pr
    return None


def _collect_connectors(grouped: Dict[str, Any]) -> List[Dict[str, Any]]:
    connectors = []
    for item in _iter_grouped_items(grouped):
        if item.get("elementType") != "node":
            continue
        geom = item.get("geometry") or {}
        if geom.get("type") != "point":
            continue
        coords = geom.get("coordinates")
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        connector_type = _connector_type_for_item(item)
        if not connector_type:
            continue
        connectors.append({
            "point": (coords[0], coords[1]),
            "connectorType": connector_type,
            "osmType": item.get("osmType"),
            "osmId": item.get("osmId")
        })
    return connectors


def _collect_inferred_named_connectors(
    connections_index: Dict[str, List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    # Recover named road junctions from shared line coordinates when explicit node
    # connector features are missing from grouped metadata.
    inferred = []
    for key, features in connections_index.items():
        if not isinstance(features, list) or len(features) < 2:
            continue
        names = []
        seen_names = set()
        for feature in features:
            if feature.get("osmType") != "way":
                continue
            name = feature.get("name")
            if not isinstance(name, str):
                continue
            norm = name.strip().lower()
            if not norm or norm in seen_names:
                continue
            seen_names.add(norm)
            names.append(name)
        if len(names) < 2:
            continue
        try:
            x_str, y_str = key.split(",")
            point = (float(x_str), float(y_str))
        except (ValueError, AttributeError):
            continue
        inferred.append({
            "point": point,
            "connectorType": "RoadJunction",
            "osmType": None,
            "osmId": None
        })
    return inferred


def _merge_connectors(
    primary: List[Dict[str, Any]], secondary: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    merged = list(primary)
    seen = set()
    for connector in merged:
        point = connector.get("point")
        if not point:
            continue
        seen.add(_coord_key([point[0], point[1]]))
    for connector in secondary:
        point = connector.get("point")
        if not point:
            continue
        key = _coord_key([point[0], point[1]])
        if key in seen:
            continue
        seen.add(key)
        merged.append(connector)
    return merged


def _feature_info(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    osm_id = item.get("osmId")
    osm_type = item.get("osmType")
    if osm_id is None or osm_type is None:
        return None
    name = _get_name(item.get("tags"))
    sub_class = item.get("_classification", {}).get("subClass")
    return {
        "osmType": osm_type,
        "osmId": osm_id,
        "name": name,
        "subClass": sub_class
    }


def _build_connections_index(grouped: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    index = {}
    for item in _iter_grouped_items(grouped):
        geom = item.get("geometry") or {}
        if geom.get("type") != "line_string":
            continue
        info = _feature_info(item)
        if not info:
            continue
        for coords in _iter_line_segments(item):
            for coord in coords:
                key = _coord_key(coord)
                entry = index.get(key)
                if not entry:
                    index[key] = [info]
                else:
                    if not any(info.get("osmId") == existing.get("osmId") and
                               info.get("osmType") == existing.get("osmType")
                               for existing in entry):
                        entry.append(info)
    return index


def _iter_line_segments(item: Dict[str, Any]) -> List[List[List[float]]]:
    visible = item.get("visibleGeometry")
    if isinstance(visible, list):
        return [seg for seg in visible if isinstance(seg, list)]
    coords = item.get("geometry", {}).get("coordinates")
    if isinstance(coords, list):
        return [coords]
    return []


def _build_road_names_by_coord(map_data: Dict[str, Any]) -> Dict[str, List[str]]:
    # Build a coordinate->road-names map for connectivity summaries.
    road_map = {}
    ways = []
    if isinstance(map_data, dict) and isinstance(map_data.get("ways"), list):
        ways = map_data.get("ways") or []
    else:
        for item in _iter_grouped_items(map_data):
            if item.get("elementType") == "way":
                ways.append(item)
    for way in ways:
        name = _get_name(way.get("tags"))
        if not name:
            continue
        for coords in _iter_line_segments(way):
            for coord in coords:
                key = _coord_key(coord)
                entry = road_map.get(key)
                if not entry:
                    road_map[key] = [name]
                else:
                    if name not in entry:
                        entry.append(name)
    return road_map


def _segment_length(coords: List[List[float]]) -> float:
    length = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        length += (dx * dx + dy * dy) ** 0.5
    return length


def _compute_line_length(item: Dict[str, Any]) -> Optional[float]:
    # Polyline length in local map units.
    geom = item.get("geometry") or {}
    if geom.get("type") != "line_string":
        return None
    segments = _iter_line_segments(item)
    if not segments:
        return None
    total = 0.0
    for coords in segments:
        if len(coords) < 2:
            continue
        total += _segment_length(coords)
    return total


def _ring_area(coords: List[List[float]]) -> float:
    # Polygon ring area using the shoelace formula.
    if not coords or len(coords) < 3:
        return 0
    total = 0.0
    for i in range(len(coords)):
        p1 = coords[i]
        p2 = coords[(i + 1) % len(coords)]
        total += p1[0] * p2[1] - p2[0] * p1[1]
    return abs(total) / 2.0


def _compute_area(geometry: Optional[Dict[str, Any]], bounds: Optional[Bounds]) -> Optional[float]:
    # Polygon area (with holes) or bbox fallback.
    if geometry and geometry.get("type") == "polygon":
        area = 0.0
        outer = geometry.get("outer")
        if isinstance(outer, list):
            area += _ring_area(outer)
        else:
            coords = geometry.get("coordinates")
            if isinstance(coords, list) and coords and isinstance(coords[0], list):
                area += _ring_area(coords)
        holes = geometry.get("holes")
        if isinstance(holes, list):
            for hole in holes:
                area -= _ring_area(hole)
        return abs(area)
    if bounds:
        min_x = bounds.get("minX")
        min_y = bounds.get("minY")
        max_x = bounds.get("maxX")
        max_y = bounds.get("maxY")
        if min_x is None or min_y is None or max_x is None or max_y is None:
            return None
        width = abs(max_x - min_x)
        height = abs(max_y - min_y)
        return width * height
    return None


def _modifiers_suffix(modifiers: Optional[List[Dict[str, Any]]]) -> str:
    # Render bracketed modifiers like [bridge, layer=1].
    if not modifiers:
        return ""
    labels = []
    for mod in modifiers:
        name = mod.get("name")
        if not name:
            continue
        if "value" in mod and mod.get("value") is not None:
            labels.append(name + "=" + str(mod.get("value")))
        else:
            labels.append(name)
    if not labels:
        return ""
    return " [" + ", ".join(labels) + "]"


def _summarize_linear_base(item: Dict[str, Any],
                           boundary: Optional[Boundary],
                           connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                           connections_index: Dict[str, List[Dict[str, Any]]],
                           emit_connectivity: bool,
                           profile: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    # Summary for linear features: name, modifiers, and visible segment metadata.
    start_total = time.perf_counter()

    def add_timing(name: str, elapsed: float) -> None:
        if profile is None:
            return
        profile[name] = profile.get(name, 0.0) + elapsed

    name = _get_name(item.get("tags"))
    mod_suffix = _modifiers_suffix(item.get("_classification", {}).get("modifiers"))
    build_visible_segments_start = time.perf_counter()
    visible_segments = _build_visible_segments(
        item, boundary, connectors_by_coord_key, connections_index, emit_connectivity, profile
    )
    add_timing("summarize-linear-base.build-visible-segments", time.perf_counter() - build_visible_segments_start)

    length = _compute_line_length(item)

    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": name if name else None,
        "displayLabel": (name if name else "(unnamed)") + mod_suffix,
        "visibleGeometry": visible_segments,
        "length": length
    }
    _attach_semantics(summary, item)
    add_timing("summarize-linear-base.total", time.perf_counter() - start_total)
    return summary


def _connected_road_names(item: Dict[str, Any], road_names_by_coord: Dict[str, List[str]]) -> List[str]:
    # Resolve road names touching a node by coordinate.
    coords = item.get("geometry", {}).get("coordinates")
    if not isinstance(coords, list):
        return []
    key = _coord_key(coords)
    return list(road_names_by_coord.get(key, []))


def _summarize_connectivity_base(item: Dict[str, Any],
                                 road_names_by_coord: Dict[str, List[str]]) -> Dict[str, Any]:
    # Summary for junction/connector/crossing nodes.
    role = item.get("_classification", {}).get("role") or "node"
    names = _connected_road_names(item, road_names_by_coord)
    if names:
        label = role + ": " + " x ".join(names)
    else:
        label = role + ": (unnamed)"
    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": label
    }
    _attach_semantics(summary, item)
    return summary


def _summarize_building_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for buildings with type/name/address and location.
    tags = item.get("tags") or {}
    amenity = _normalize_label(tags.get("amenity"))
    building_use = _normalize_label(tags.get("building:use"))
    building = _normalize_label(tags.get("building"))
    subtype = item.get("_classification", {}).get("subClass")
    if amenity:
        type_label = amenity
    elif building_use:
        type_label = building_use
    elif building and building != "yes":
        type_label = building + " building"
    elif subtype == "C1_landmark":
        type_label = "landmark building"
    elif subtype == "C2_public":
        type_label = "public building"
    else:
        type_label = "building"

    name = _get_name(tags)
    street = tags.get("addr:street")
    number = tags.get("addr:housenumber")
    address = street + " " + number if (street and number) else None

    parts = [type_label]
    if name:
        parts.append(name)
    if address:
        parts.append(address)
    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": name if name else None,
        "displayLabel": ", ".join(parts),
        "location": _location_struct_from_loc(
            _loc_from_classification(item.get("_classification", {}).get("locationCenter")),
            "center"
        )
    }
    if "visibleGeometry" in item:
        summary["visibleGeometry"] = item.get("visibleGeometry")
    _attach_semantics(summary, item)
    return summary


def _summarize_poi_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for POIs with category/qualifier and location.
    tags = item.get("tags") or {}
    subtype = item.get("_classification", {}).get("subClass")
    category = "poi"
    if subtype == "D1_transport":
        category = "transport"
    elif subtype == "D2_civic":
        category = "civic"
    elif subtype == "D3_commercial":
        category = "commercial"
    elif subtype == "D4_leisure_cultural":
        category = "leisure"

    qualifier = (
        _normalize_label(tags.get("public_transport")) or
        _normalize_label(tags.get("railway")) or
        _normalize_label(tags.get("amenity")) or
        _normalize_label(tags.get("shop")) or
        _normalize_label(tags.get("tourism")) or
        _normalize_label(tags.get("leisure"))
    )
    name = _get_name(tags)
    label = qualifier or category
    if name:
        summary = {
            "osmId": item.get("osmId"),
            "osmType": item.get("osmType"),
            "label": name,
            "displayLabel": label + ": " + name,
            "location": _location_struct_from_loc(
                _loc_from_classification(item.get("_classification", {}).get("location")),
                "point"
            )
        }
        _attach_semantics(summary, item)
        return summary
    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": None,
        "displayLabel": label,
        "location": _location_struct_from_loc(
            _loc_from_classification(item.get("_classification", {}).get("location")),
            "point"
        )
    }
    _attach_semantics(summary, item)
    return summary


def _area_type_label(sub_class: Optional[str]) -> str:
    # Human-facing labels for area subclasses.
    mapping = {
        "B1_lakes": "lake",
        "B1_ponds": "pond",
        "B1_reservoirs": "reservoir",
        "B1_sea_coast": "sea",
        "B1_riverbanks": "riverbank",
        "B1_other_water": "water",
        "B2_parks_recreation": "park",
        "B2_forests": "forest",
        "B2_fields_open": "open land",
        "B3_residential": "residential area",
        "B3_commercial": "commercial area",
        "B3_industrial": "industrial area",
        "B_other_areas": "area",
        "E1_admin_boundaries": "admin boundary",
        "E2_coastlines": "coastline",
        "E3_fences_walls": "fence/wall"
    }
    if sub_class is None:
        return "area"
    return mapping.get(sub_class, "area")


def _summarize_area_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for area features with type/name/size and location.
    subtype = item.get("_classification", {}).get("subClass")
    label = _area_type_label(subtype)
    name = _get_name(item.get("tags"))
    base = label + ": " + name if name else label + " (unnamed)"
    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": name if name else None,
        "displayLabel": base,
        "location": _location_struct_from_loc(
            _loc_from_classification(item.get("_classification", {}).get("locationCenter")),
            "center"
        ),
        "area": _compute_area(item.get("geometry"), item.get("bounds")),
    }
    if "visibleGeometry" in item:
        summary["visibleGeometry"] = item.get("visibleGeometry")
    _attach_semantics(summary, item)
    return summary


def _summarize_boundary_base(item: Dict[str, Any],
                             boundary: Optional[Boundary],
                             connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                             connections_index: Dict[str, List[Dict[str, Any]]],
                             emit_connectivity: bool) -> Dict[str, Any]:
    # Summary for boundary/edge features with length and visible segment metadata.
    subtype = item.get("_classification", {}).get("subClass")
    label = _area_type_label(subtype)
    name = _get_name(item.get("tags"))
    summary = label + ": " + name if name else label
    summary = {
        "osmId": item.get("osmId"),
        "osmType": item.get("osmType"),
        "label": name if name else None,
        "displayLabel": summary,
        "visibleSegments": _build_visible_segments(
            item, boundary, connectors_by_coord_key, connections_index, emit_connectivity
        ),
        "length": _compute_line_length(item)
    }
    _attach_semantics(summary, item)
    return summary


def _sort_groups(groups: List[Dict[str, Any]], kind: str) -> List[Dict[str, Any]]:
    # Sort grouped summaries by salience: named first, then size/length.
    def sort_key(entry):
        if kind in ("linear", "boundary"):
            metric = entry.get("totalLength", 0)
        elif kind == "area":
            metric = entry.get("totalArea", 0)
        elif kind == "connectivity":
            metric = _group_count(entry)
        else:
            metric = 0
        return (entry.get("label") is None, -metric, entry.get("displayLabel") or "")
    return sorted(groups, key=sort_key)


def _group_count(group: Dict[str, Any]) -> int:
    count = group.get("count")
    if isinstance(count, int):
        return count
    ways = group.get("ways")
    if isinstance(ways, list):
        return len(ways)
    items = group.get("items")
    if isinstance(items, list):
        return len(items)
    return 0


def _build_way_groups(items: List[Dict[str, Any]],
                      boundary: Optional[Boundary],
                      connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                      connections_index: Dict[str, List[Dict[str, Any]]],
                      emit_connectivity: bool,
                      profile: Optional[Dict[str, float]] = None) -> List[Dict[str, Any]]:
    # Ways are grouped by displayLabel to keep one top-level entry per logical way.
    start_total = time.perf_counter()

    def add_timing(name: str, elapsed: float) -> None:
        if profile is None:
            return
        profile[name] = profile.get(name, 0.0) + elapsed

    groups = OrderedDict()
    for item in items:
        summarize_start = time.perf_counter()
        base = _summarize_linear_base(
            item, boundary, connectors_by_coord_key, connections_index, emit_connectivity, profile
        )
        add_timing("build-way-groups.summarize-linear-base", time.perf_counter() - summarize_start)

        display_label = base.get("displayLabel") or ""
        is_unnamed = (base.get("label") is None) or display_label.startswith("(unnamed)")
        if is_unnamed:
            key = display_label + "||" + str(base.get("osmType") or "") + ":" + str(base.get("osmId"))
        else:
            key = display_label
        group = groups.get(key)
        if not group:
            groups[key] = {
                "label": base.get("label"),
                "displayLabel": display_label,
                "totalLength": 0.0,
                "totalArea": 0.0,
                "ways": [],
                "visibleGeometry": []
            }
            group = groups[key]
        if base.get("length"):
            group["totalLength"] += base.get("length")
        group["ways"].append(base)

    for group in groups.values():
        ways = group.get("ways") or []
        sorted_ways = sorted(
            ways,
            key=lambda entry: (
                -(entry.get("length") or 0.0),
                entry.get("osmId") is None,
                entry.get("osmId") or 0
            )
        )
        group["ways"] = sorted_ways
        buckets = []
        for way in sorted_ways:
            visible = way.get("visibleGeometry")
            buckets.append({
                "osmId": way.get("osmId"),
                "segments": visible if isinstance(visible, list) else []
            })
        group["visibleGeometry"] = buckets

    add_timing("build-way-groups.total", time.perf_counter() - start_total)

    return list(groups.values())


def _build_groups(items: List[Dict[str, Any]], kind: str,
                  road_names_by_coord: Dict[str, List[str]],
                  boundary: Optional[Boundary],
                  connectors_by_coord_key: Optional[Dict[str, List[Dict[str, Any]]]],
                  connections_index: Dict[str, List[Dict[str, Any]]],
                  emit_connectivity: bool) -> List[Dict[str, Any]]:
    # Collapse repeated items into grouped summaries for compact output.
    groups = OrderedDict()
    for item in items:
        if kind == "connectivity":
            base = _summarize_connectivity_base(item, road_names_by_coord)
        elif kind == "building":
            base = _summarize_building_base(item)
        elif kind == "poi":
            base = _summarize_poi_base(item)
        elif kind == "area":
            base = _summarize_area_base(item)
        elif kind == "boundary":
            base = _summarize_boundary_base(
                item, boundary, connectors_by_coord_key, connections_index, emit_connectivity
            )
        else:
            base = _summarize_linear_base(
                item, boundary, connectors_by_coord_key, connections_index, emit_connectivity
            )

        key = (base.get("displayLabel") or "") + "||" + _location_key(base.get("location"))
        group = groups.get(key)
        if not group:
            groups[key] = {
                "label": base.get("label"),
                "displayLabel": base.get("displayLabel"),
                "location": base.get("location"),
                "totalLength": 0.0,
                "totalArea": 0.0,
                "items": []
            }
            group = groups[key]
        if base.get("length"):
            group["totalLength"] += base.get("length")
        if base.get("area"):
            group["totalArea"] += base.get("area")
        group["items"].append(base)

    return list(groups.values())


def _render_group_line(group: Dict[str, Any], kind: str) -> str:
    # Render a single summary line, with totals for grouped items.
    display_label = group.get("displayLabel") or "(unnamed)"
    if _group_count(group) == 1:
        if kind == "linear":
            length = _format_meters(group.get("totalLength"))
            location_text = _render_location_text(group.get("location"), kind)
            if length and location_text:
                return display_label + " — " + length + " — " + location_text
            if length:
                return display_label + " — " + length
            return display_label + " — " + location_text if location_text else display_label
        if kind == "boundary":
            b_len = _format_meters(group.get("totalLength"))
            location_text = _render_location_text(group.get("location"), kind)
            if b_len and location_text:
                return display_label + " — " + b_len + " — " + location_text
            if b_len:
                return display_label + " — " + b_len
            return display_label + " — " + location_text if location_text else display_label
        if kind == "area":
            area = _format_area(group.get("totalArea"))
            location_text = _render_location_text(group.get("location"), kind)
            if area and location_text:
                return display_label + ", " + area + " — " + location_text
            if area:
                return display_label + ", " + area
            return display_label + " — " + location_text if location_text else display_label
        location_text = _render_location_text(group.get("location"), kind)
        return display_label + " — " + location_text if location_text else display_label

    prefix = str(_group_count(group)) + " x " + display_label
    if kind in ("linear", "boundary"):
        total_len = _format_meters(group.get("totalLength"))
        location_text = _render_location_text(group.get("location"), kind)
        if total_len and location_text:
            return prefix + " — total " + total_len + " — " + location_text
        if total_len:
            return prefix + " — total " + total_len
        return prefix + " — " + location_text if location_text else prefix
    if kind == "area":
        total_area = _format_area(group.get("totalArea"))
        location_text = _render_location_text(group.get("location"), kind)
        if total_area and location_text:
            return prefix + " — total " + total_area + " — " + location_text
        if total_area:
            return prefix + " — total " + total_area
        return prefix + " — " + location_text if location_text else prefix
    location_text = _render_location_text(group.get("location"), kind)
    return prefix + " — " + location_text if location_text else prefix


def _resolve_options(spec: Dict[str, Any], options_override: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    options = {}
    options.update(spec.get("options", {}))
    options.update(options_override or {})
    return options


def build_intermediate(grouped: Dict[str, Any], spec: Dict[str, Any],
                       map_data: Optional[Dict[str, Any]] = None,
                       options_override: Optional[Dict[str, Any]] = None,
                       profile: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    # Code below creates stage "Render-ready intermediate" data.
    # Build a structured intermediate representation for later rendering.
    start_total = time.perf_counter()

    def add_timing(name: str, elapsed: float) -> None:
        if profile is None:
            return
        profile[name] = profile.get(name, 0.0) + elapsed

    road_names_by_coord = _build_road_names_by_coord(map_data or grouped)

    options = _resolve_options(spec, options_override)
    emit_connectivity = bool(options.get("emitConnectivityNodes", True))
    boundary = _coerce_boundary((map_data or {}).get("meta", {}).get("boundary"))

    connections_index = _build_connections_index(grouped) if emit_connectivity else {}

    connectors = _collect_connectors(grouped) if emit_connectivity else []

    if emit_connectivity:
        connectors = _merge_connectors(
            connectors,
            _collect_inferred_named_connectors(connections_index)
        )

    connectors_by_coord_key = _build_connectors_by_coord_key(connectors) if emit_connectivity else {}

    classes = spec.get("classes") or OrderedDict()
    main_keys = sorted(classes.keys())
    raw = []  # type: List[Dict[str, Any]]

    for main_key in main_keys:
        main_name = classes.get(main_key, {}).get("name", main_key)
        sub_groups = grouped.get(main_key) or OrderedDict()
        subclasses = classes.get(main_key, {}).get("subclasses") or {}
        sub_order = list(subclasses.keys())
        sub_keys = [k for k in sub_order if sub_groups.get(k)]
        for key in sub_groups.keys():
            if key not in sub_keys and sub_groups.get(key):
                sub_keys.append(key)

        main_entry = {  # type: Dict[str, Any]
            "key": main_key,
            "name": main_name,
            "subclasses": []
        }

        if not sub_keys:
            main_entry["subclasses"].append({
                "key": None,
                "name": None,
                "kind": None,
                "groups": [],
                "empty": True
            })
            raw.append(main_entry)
            continue

        for sub_key in sub_keys:
            items = sub_groups.get(sub_key) or []
            if not items:
                continue
            sub_name = subclasses.get(sub_key, sub_key)

            kind = "linear"
            if main_key == "A" and sub_key == "A5_connectivity_nodes":
                kind = "connectivity"
            elif main_key == "C":
                kind = "building"
            elif main_key == "D":
                kind = "poi"
            elif main_key == "B":
                kind = "area"
            elif main_key == "E":
                geom_type = items[0].get("geometry", {}).get("type")
                kind = "area" if geom_type == "polygon" else "linear"

            if main_key == "A" and kind == "linear":
                build_way_groups_start = time.perf_counter()
                grouped_items = _build_way_groups(
                    items,
                    boundary,
                    connectors_by_coord_key,
                    connections_index,
                    emit_connectivity,
                    profile
                )
                add_timing("build-intermediate.subclass-build-way-groups", time.perf_counter() - build_way_groups_start)
            else:
                grouped_items = _build_groups(
                    items,
                    kind,
                    road_names_by_coord,
                    boundary,
                    connectors_by_coord_key,
                    connections_index,
                    emit_connectivity
                )

            sort_kind = "boundary" if (kind == "linear" and main_key == "E") else kind
            sorted_groups = _sort_groups(grouped_items, sort_kind)

            main_entry["subclasses"].append({
                "key": sub_key,
                "name": sub_name,
                "kind": sort_kind,
                "groups": sorted_groups
            })

        raw.append(main_entry)

    add_timing("build-intermediate.total", time.perf_counter() - start_total)
    return {"raw": raw}


def render_from_intermediate(intermediate: Dict[str, Any]) -> str:
    # Render human-readable output from the intermediate representation.
    lines = []  # type: List[str]
    for main_entry in intermediate.get("raw", []):
        main_key = main_entry.get("key")
        main_name = main_entry.get("name") or main_key
        lines.append(str(main_key) + " — " + str(main_name))

        subclasses = main_entry.get("subclasses") or []
        if subclasses and subclasses[0].get("empty"):
            lines.append("  (no items)")
            lines.append("")
            continue

        for sub_entry in subclasses:
            sub_key = sub_entry.get("key")
            sub_name = sub_entry.get("name") or sub_key
            groups = sub_entry.get("groups") or []
            count = sum(_group_count(group) for group in groups)
            lines.append("  " + str(sub_key) + " — " + str(sub_name) + " (" + str(count) + ")")

            display = groups[:MAX_ITEMS_PER_SUBCLASS]
            for group in display:
                lines.append("    - " + _render_group_line(group, sub_entry.get("kind", "")))
            if len(groups) > MAX_ITEMS_PER_SUBCLASS:
                lines.append("    - ... (+" + str(len(groups) - MAX_ITEMS_PER_SUBCLASS) + " more)")

        lines.append("")

    return "\n".join(lines).strip()


def write_map_content(grouped: Dict[str, Any], spec: Dict[str, Any],
                      output_path: str, map_data: Optional[Dict[str, Any]] = None,
                      options_override: Optional[Dict[str, Any]] = None,
                      profile: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
    # Code below creates stage "Final map content" data.
    # Persist structured grouped output for map content consumers.
    start_total = time.perf_counter()

    def add_timing(name: str, elapsed: float) -> None:
        if profile is None:
            return
        profile[name] = profile.get(name, 0.0) + elapsed

    build_intermediate_start = time.perf_counter()
    intermediate = build_intermediate(grouped, spec, map_data, options_override, profile)
    add_timing("write-map-content.build-intermediate", time.perf_counter() - build_intermediate_start)

    content = OrderedDict()  # type: OrderedDict
    for main_entry in intermediate.get("raw", []):
        key = main_entry.get("key") or "unknown"
        content[key] = main_entry
    if map_data:
        meta = map_data.get("meta") or {}
        boundary = meta.get("boundary")
        if boundary:
            content["boundary"] = boundary

    json_dump_start = time.perf_counter()
    _write_json_fast(output_path, content)
    add_timing("write-map-content.json-dump", time.perf_counter() - json_dump_start)
    add_timing("write-map-content.total", time.perf_counter() - start_total)
    return content


def _load_json(path: str) -> OrderedDict:
    # Read JSON with stable key ordering for deterministic output.
    with open(path, "r") as handle:
        return json.load(handle, object_pairs_hook=OrderedDict)


def _write_json_fast(path: str, value: Any) -> None:
    with open(path, "w") as handle:
        json.dump(
            value,
            handle,
            separators=(",", ":"),
            ensure_ascii=False,
            check_circular=False
        )


def run_standalone(args: List[str]) -> str:
    # CLI entry: load grouped JSON and write map-content.json.
    base_dir = os.path.dirname(os.path.abspath(__file__))
    spec_path = os.path.join(base_dir, "map-description-classifications.json")
    spec = _load_json(spec_path)
    input_path = args[0] if args else os.path.join(os.getcwd(), "map-meta.json")
    grouped = _load_json(input_path)
    output_path = os.path.join(os.path.dirname(input_path), "map-content.json")
    write_map_content(grouped, spec, output_path, grouped)
    return output_path


__all__ = ["build_intermediate", "render_from_intermediate", "write_map_content", "run_standalone"]


if __name__ == "__main__":
    run_standalone(sys.argv[1:])
