# Python 3.5
from __future__ import division

import importlib.machinery
import json
import os
from collections import OrderedDict


def _load_module(module_name, path):
    loader = importlib.machinery.SourceFileLoader(module_name, path)
    return loader.load_module()


def _load_classifier():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    classifier_path = os.path.join(base_dir, "map-description-classifier.py")
    module = _load_module("map_description_classifier", classifier_path)
    return module


classifier = _load_classifier()


MAX_ITEMS_PER_SUBCLASS = 10


def _js_round(value):
    if value >= 0:
        return int((value + 0.5) // 1)
    return int((value - 0.5) // 1)


def _to_fixed(value, digits):
    scale = 10 ** digits
    rounded = _js_round(value * scale) / float(scale)
    if digits == 0:
        return str(int(_js_round(value)))
    fmt = "{0:." + str(digits) + "f}"
    return fmt.format(rounded)


def _get_name(tags):
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


def _location_phrase(location):
    if not location or not location.get("phrase"):
        return None
    return location.get("phrase")


def _normalize_label(value):
    if not value:
        return None
    return str(value).replace("_", " ")


def _format_meters(length_meters):
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


def _format_area(area_sq_m):
    if area_sq_m is None:
        return None
    area = max(0, area_sq_m)
    if area >= 10000:
        ha = area / 10000.0
        digits = 0 if ha >= 10 else 1
        return "~" + _to_fixed(ha, digits) + " ha"
    return "~" + str(int(_js_round(area))) + " m^2"


def _coord_key(coord):
    return _to_fixed(float(coord[0]), 3) + "," + _to_fixed(float(coord[1]), 3)


def _build_road_names_by_coord(map_data):
    road_map = {}
    ways = map_data.get("ways") or []
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


def _compute_line_length(geometry):
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


def _ring_area(coords):
    if not coords or len(coords) < 3:
        return 0
    total = 0.0
    for i in range(len(coords)):
        p1 = coords[i]
        p2 = coords[(i + 1) % len(coords)]
        total += p1[0] * p2[1] - p2[0] * p1[1]
    return abs(total) / 2.0


def _compute_area(geometry, bounds):
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


def _modifiers_suffix(modifiers):
    if not modifiers:
        return ""
    labels = []
    for mod in modifiers:
        if "value" in mod and mod.get("value") is not None:
            labels.append(mod.get("name") + "=" + str(mod.get("value")))
        else:
            labels.append(mod.get("name"))
    return " [" + ", ".join(labels) + "]"


def _summarize_linear_base(item):
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


def _connected_road_names(item, road_names_by_coord):
    coords = item.get("geometry", {}).get("coordinates")
    if not isinstance(coords, list):
        return []
    key = _coord_key(coords)
    return list(road_names_by_coord.get(key, []))


def _summarize_connectivity_base(item, road_names_by_coord):
    role = item.get("_classification", {}).get("role") or "node"
    names = _connected_road_names(item, road_names_by_coord)
    if names:
        label = role + ": " + " x ".join(names)
    else:
        label = role + ": (unnamed)"
    return {"label": label, "hasName": len(names) > 0}


def _summarize_building_base(item):
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


def _summarize_poi_base(item):
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


def _area_type_label(sub_class):
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


def _summarize_area_base(item):
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


def _summarize_boundary_base(item):
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


def _sort_groups(groups, kind):
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


def _build_groups(items, kind, road_names_by_coord):
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


def _render_group_line(group, kind):
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


def render_grouped(grouped, spec, map_data):
    lines = []
    road_names_by_coord = _build_road_names_by_coord(map_data)
    classes = spec.get("classes") or OrderedDict()
    main_keys = sorted(classes.keys())

    for main_key in main_keys:
        main_name = classes.get(main_key, {}).get("name", main_key)
        lines.append(main_key + " — " + main_name)

        sub_groups = grouped.get(main_key) or OrderedDict()
        sub_order = []
        subclasses = classes.get(main_key, {}).get("subclasses")
        if subclasses:
            sub_order = list(subclasses.keys())
        sub_keys = [k for k in sub_order if sub_groups.get(k)]
        for key in sub_groups.keys():
            if key not in sub_keys and sub_groups.get(key):
                sub_keys.append(key)

        if not sub_keys:
            lines.append("  (no items)")
            lines.append("")
            continue

        for sub_key in sub_keys:
            items = sub_groups.get(sub_key) or []
            if not items:
                continue
            sub_name = classes.get(main_key, {}).get("subclasses", {}).get(sub_key, sub_key)
            lines.append("  " + sub_key + " — " + sub_name + " (" + str(len(items)) + ")")

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
            display = sorted_groups[:MAX_ITEMS_PER_SUBCLASS]
            for group in display:
                lines.append("    - " + _render_group_line(group, sort_kind))
            if len(sorted_groups) > MAX_ITEMS_PER_SUBCLASS:
                lines.append("    - ... (+" + str(len(sorted_groups) - MAX_ITEMS_PER_SUBCLASS) + " more)")

        lines.append("")

    return "\n".join(lines).strip()


def _load_json(path):
    with open(path, "r") as handle:
        return json.load(handle, object_pairs_hook=OrderedDict)


def run_standalone(args):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    spec_path = os.path.join(base_dir, "map-description-classifications.json")
    spec = _load_json(spec_path)
    input_path = args[0] if args else os.path.join(os.getcwd(), "map-meta.json")
    if not os.path.exists(input_path):
        input_path = os.path.join(os.getcwd(), "test/data/map-meta.indented.json")
    map_data = _load_json(input_path)
    grouped = classifier.group_map_data(map_data, spec, None)
    output = render_grouped(grouped, spec, map_data)
    print(output)
    return output


if __name__ == "__main__":
    run_standalone(os.sys.argv[1:])
