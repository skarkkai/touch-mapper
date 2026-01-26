# Python 3.5
from __future__ import division

import json
import os
from collections import OrderedDict
from typing import Any, Dict, Iterable, Iterator, List, Optional

MAX_ITEMS_PER_SUBCLASS = 10


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


def _location_phrase(location: Optional[Dict[str, Any]]) -> Optional[str]:
    # Extract the pre-built location phrase if available.
    if not location or not location.get("phrase"):
        return None
    return location.get("phrase")


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
        coords = way.get("geometry", {}).get("coordinates")
        if not isinstance(coords, list):
            continue
        name = _get_name(way.get("tags"))
        if not name:
            continue
        for coord in coords:
            key = _coord_key(coord)
            entry = road_map.get(key)
            if not entry:
                road_map[key] = [name]
            else:
                if name not in entry:
                    entry.append(name)
    return road_map


def _compute_line_length(geometry: Optional[Dict[str, Any]]) -> Optional[float]:
    # Polyline length in local map units.
    if not geometry or geometry.get("type") != "line_string":
        return None
    coords = geometry.get("coordinates")
    if not isinstance(coords, list):
        return None
    length = 0.0
    for i in range(1, len(coords)):
        a = coords[i - 1]
        b = coords[i]
        dx = b[0] - a[0]
        dy = b[1] - a[1]
        length += (dx * dx + dy * dy) ** 0.5
    return length


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


def _compute_area(geometry: Optional[Dict[str, Any]], bounds: Optional[Dict[str, Any]]) -> Optional[float]:
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
        width = abs(bounds.get("maxX") - bounds.get("minX"))
        height = abs(bounds.get("maxY") - bounds.get("minY"))
        if width is not None and height is not None:
            return width * height
    return None


def _modifiers_suffix(modifiers: Optional[List[Dict[str, Any]]]) -> str:
    # Render bracketed modifiers like [bridge, layer=1].
    if not modifiers:
        return ""
    labels = []
    for mod in modifiers:
        if "value" in mod and mod.get("value") is not None:
            labels.append(mod.get("name") + "=" + str(mod.get("value")))
        else:
            labels.append(mod.get("name"))
    return " [" + ", ".join(labels) + "]"


def _summarize_linear_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for linear features: name, modifiers, and location phrase.
    name = _get_name(item.get("tags")) or "(unnamed)"
    mod_suffix = _modifiers_suffix(item.get("_classification", {}).get("modifiers"))
    cls = item.get("_classification", {})
    start_phrase = _location_phrase(cls.get("locationStart"))
    end_phrase = _location_phrase(cls.get("locationEnd"))
    center_phrase = _location_phrase(cls.get("locationCenter"))
    location_text = None
    if start_phrase or end_phrase or center_phrase:
        if start_phrase and end_phrase and start_phrase == end_phrase:
            location_text = start_phrase
            if center_phrase:
                location_text += " (center: " + center_phrase + ")"
        else:
            if start_phrase and end_phrase:
                location_text = start_phrase + " -> " + end_phrase
            else:
                location_text = start_phrase or end_phrase
            if center_phrase:
                location_text += " (center: " + center_phrase + ")"
    return {
        "label": name + mod_suffix,
        "locationText": location_text,
        "length": _compute_line_length(item.get("geometry")),
        "hasName": name != "(unnamed)"
    }


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
    return {"label": label, "hasName": len(names) > 0}


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
    return {
        "label": ", ".join(parts),
        "locationText": _location_phrase(item.get("_classification", {}).get("locationCenter")),
        "hasName": bool(name)
    }


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
        return {
            "label": label + ": " + name,
            "locationText": _location_phrase(item.get("_classification", {}).get("location")),
            "hasName": True
        }
    return {
        "label": label,
        "locationText": _location_phrase(item.get("_classification", {}).get("location")),
        "hasName": False
    }


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
    return mapping.get(sub_class, "area")


def _summarize_area_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for area features with type/name/size and location.
    subtype = item.get("_classification", {}).get("subClass")
    label = _area_type_label(subtype)
    name = _get_name(item.get("tags"))
    base = label + ": " + name if name else label + " (unnamed)"
    return {
        "label": base,
        "locationText": _location_phrase(item.get("_classification", {}).get("locationCenter")),
        "area": _compute_area(item.get("geometry"), item.get("bounds")),
        "hasName": bool(name)
    }


def _summarize_boundary_base(item: Dict[str, Any]) -> Dict[str, Any]:
    # Summary for boundary/edge features with length and location.
    subtype = item.get("_classification", {}).get("subClass")
    label = _area_type_label(subtype)
    name = _get_name(item.get("tags"))
    summary = label + ": " + name if name else label
    return {
        "label": summary,
        "locationText": _location_phrase(item.get("_classification", {}).get("locationCenter")),
        "length": _compute_line_length(item.get("geometry")),
        "hasName": bool(name)
    }


def _sort_groups(groups: List[Dict[str, Any]], kind: str) -> List[Dict[str, Any]]:
    # Sort grouped summaries by salience: named first, then size/length.
    def sort_key(entry):
        if kind in ("linear", "boundary"):
            metric = entry.get("totalLength", 0)
        elif kind == "area":
            metric = entry.get("totalArea", 0)
        elif kind == "connectivity":
            metric = entry.get("count", 0)
        else:
            metric = 0
        return (not entry.get("hasName"), -metric, entry.get("label"))
    return sorted(groups, key=sort_key)


def _build_groups(items: List[Dict[str, Any]], kind: str,
                  road_names_by_coord: Dict[str, List[str]]) -> List[Dict[str, Any]]:
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
            base = _summarize_boundary_base(item)
        else:
            base = _summarize_linear_base(item)

        key = base.get("label") + "||" + (base.get("locationText") or "")
        group = groups.get(key)
        if not group:
            groups[key] = {
                "label": base.get("label"),
                "locationText": base.get("locationText"),
                "count": 0,
                "hasName": base.get("hasName"),
                "totalLength": 0.0,
                "totalArea": 0.0
            }
            group = groups[key]
        group["count"] += 1
        group["hasName"] = group["hasName"] or base.get("hasName")
        if base.get("length"):
            group["totalLength"] += base.get("length")
        if base.get("area"):
            group["totalArea"] += base.get("area")

    return list(groups.values())


def _render_group_line(group: Dict[str, Any], kind: str) -> str:
    # Render a single summary line, with totals for grouped items.
    if group.get("count") == 1:
        if kind == "linear":
            length = _format_meters(group.get("totalLength"))
            if length and group.get("locationText"):
                return group.get("label") + " — " + length + " — " + group.get("locationText")
            if length:
                return group.get("label") + " — " + length
            return group.get("label") + " — " + group.get("locationText") if group.get("locationText") else group.get("label")
        if kind == "boundary":
            b_len = _format_meters(group.get("totalLength"))
            if b_len and group.get("locationText"):
                return group.get("label") + " — " + b_len + " — " + group.get("locationText")
            if b_len:
                return group.get("label") + " — " + b_len
            return group.get("label") + " — " + group.get("locationText") if group.get("locationText") else group.get("label")
        if kind == "area":
            area = _format_area(group.get("totalArea"))
            if area and group.get("locationText"):
                return group.get("label") + ", " + area + " — " + group.get("locationText")
            if area:
                return group.get("label") + ", " + area
            return group.get("label") + " — " + group.get("locationText") if group.get("locationText") else group.get("label")
        return group.get("label") + " — " + group.get("locationText") if group.get("locationText") else group.get("label")

    prefix = str(group.get("count")) + " x " + group.get("label")
    if kind in ("linear", "boundary"):
        total_len = _format_meters(group.get("totalLength"))
        if total_len and group.get("locationText"):
            return prefix + " — total " + total_len + " — " + group.get("locationText")
        if total_len:
            return prefix + " — total " + total_len
        return prefix + " — " + group.get("locationText") if group.get("locationText") else prefix
    if kind == "area":
        total_area = _format_area(group.get("totalArea"))
        if total_area and group.get("locationText"):
            return prefix + " — total " + total_area + " — " + group.get("locationText")
        if total_area:
            return prefix + " — total " + total_area
        return prefix + " — " + group.get("locationText") if group.get("locationText") else prefix
    return prefix + " — " + group.get("locationText") if group.get("locationText") else prefix


def build_intermediate(grouped: Dict[str, Any], spec: Dict[str, Any],
                       map_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # Build a structured intermediate representation for later rendering.
    road_names_by_coord = _build_road_names_by_coord(map_data or grouped)
    classes = spec.get("classes") or OrderedDict()
    main_keys = sorted(classes.keys())
    raw: List[Dict[str, Any]] = []

    for main_key in main_keys:
        main_name = classes.get(main_key, {}).get("name", main_key)
        sub_groups = grouped.get(main_key) or OrderedDict()
        subclasses = classes.get(main_key, {}).get("subclasses") or {}
        sub_order = list(subclasses.keys())
        sub_keys = [k for k in sub_order if sub_groups.get(k)]
        for key in sub_groups.keys():
            if key not in sub_keys and sub_groups.get(key):
                sub_keys.append(key)

        main_entry: Dict[str, Any] = {
            "key": main_key,
            "name": main_name,
            "subclasses": []
        }

        if not sub_keys:
            main_entry["subclasses"].append({
                "key": None,
                "name": None,
                "count": 0,
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

            grouped_items = _build_groups(items, kind, road_names_by_coord)
            sort_kind = "boundary" if (kind == "linear" and main_key == "E") else kind
            sorted_groups = _sort_groups(grouped_items, sort_kind)

            main_entry["subclasses"].append({
                "key": sub_key,
                "name": sub_name,
                "count": len(items),
                "kind": sort_kind,
                "groups": sorted_groups
            })

        raw.append(main_entry)

    return {"raw": raw}


def render_from_intermediate(intermediate: Dict[str, Any]) -> str:
    # Render human-readable output from the intermediate representation.
    lines: List[str] = []
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
            count = sub_entry.get("count", 0)
            lines.append("  " + str(sub_key) + " — " + str(sub_name) + " (" + str(count) + ")")

            groups = sub_entry.get("groups") or []
            display = groups[:MAX_ITEMS_PER_SUBCLASS]
            for group in display:
                lines.append("    - " + _render_group_line(group, sub_entry.get("kind", "")))
            if len(groups) > MAX_ITEMS_PER_SUBCLASS:
                lines.append("    - ... (+" + str(len(groups) - MAX_ITEMS_PER_SUBCLASS) + " more)")

        lines.append("")

    return "\n".join(lines).strip()


def write_map_content(grouped: Dict[str, Any], spec: Dict[str, Any],
                      output_path: str, map_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # Persist intermediate data with cooked summaries embedded per subclass.
    intermediate = build_intermediate(grouped, spec, map_data)
    content: "OrderedDict[str, Any]" = OrderedDict()
    for main_entry in intermediate.get("raw", []):
        subclasses = main_entry.get("subclasses") or []
        for sub_entry in subclasses:
            if sub_entry.get("empty"):
                sub_entry["cooked"] = []
                continue
            groups = sub_entry.get("groups") or []
            display = groups[:MAX_ITEMS_PER_SUBCLASS]
            cooked_lines = []
            for group in display:
                cooked_lines.append("- " + _render_group_line(group, sub_entry.get("kind", "")))
            if len(groups) > MAX_ITEMS_PER_SUBCLASS:
                cooked_lines.append("- ... (+" + str(len(groups) - MAX_ITEMS_PER_SUBCLASS) + " more)")
            sub_entry["cooked"] = cooked_lines
        key = main_entry.get("key") or "unknown"
        content[key] = main_entry
    with open(output_path, "w") as handle:
        json.dump(content, handle, indent=2)
    return content


def _load_json(path: str) -> OrderedDict:
    # Read JSON with stable key ordering for deterministic output.
    with open(path, "r") as handle:
        return json.load(handle, object_pairs_hook=OrderedDict)


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
    run_standalone(os.sys.argv[1:])
