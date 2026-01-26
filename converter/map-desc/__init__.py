# Python 3.5
from __future__ import division

import importlib.machinery
import json
import os
from collections import OrderedDict


def _load_module(module_name, path):
    loader = importlib.machinery.SourceFileLoader(module_name, path)
    return loader.load_module()


def _load_loc_segments():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    loc_path = os.path.join(base_dir, "map-desc-loc-segments.py")
    if not os.path.exists(loc_path):
        return None
    try:
        module = _load_module("map_description_loc_segments", loc_path)
        return module.classify_location
    except Exception:
        return None


classify_location = _load_loc_segments()


def _load_renderer():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    render_path = os.path.join(base_dir, "map-desc-render.py")
    if not os.path.exists(render_path):
        return None
    try:
        return _load_module("map_desc_render", render_path)
    except Exception:
        return None


def _get_field(item, path):
    if not path:
        return None
    cur = item
    for part in path.split("."):
        if cur is None:
            return None
        cur = cur.get(part)
    return cur


def _match_tags_any(tags, conditions):
    if not conditions:
        return True
    for cond in conditions:
        key = cond.get("key")
        if not tags or key not in tags:
            continue
        val = tags.get(key)
        if cond.get("anyValue"):
            if val is not None and val != "":
                return True
            continue
        values = cond.get("values", [])
        if val in values:
            return True
    return False


def _match_tags_all(tags, conditions):
    if not conditions:
        return True
    for cond in conditions:
        key = cond.get("key")
        if not tags or key not in tags:
            return False
        val = tags.get(key)
        if cond.get("anyValue"):
            if val is None or val == "":
                return False
            continue
        values = cond.get("values", [])
        if val not in values:
            return False
    return True


def _match_any_field(item, field_name, values):
    if not values:
        return False
    val = item.get(field_name)
    if not val:
        return False
    if isinstance(val, list):
        for entry in val:
            if entry in values:
                return True
        return False
    return val in values


def _match_rule(item, rule, inputs):
    if "elementTypes" in rule:
        if item.get(inputs.get("elementTypeField")) not in rule["elementTypes"]:
            return False
    if "geometryTypes" in rule:
        geom_type = _get_field(item, inputs.get("geometryTypeField"))
        if geom_type not in rule["geometryTypes"]:
            return False
    if "primaryRepresentationAny" in rule:
        if not _match_any_field(item, inputs.get("primaryRepresentationField"), rule["primaryRepresentationAny"]):
            return False
    if "representationsAny" in rule:
        if not _match_any_field(item, inputs.get("representationsField"), rule["representationsAny"]):
            return False
    if "tmCategoryAny" in rule:
        if not _match_any_field(item, inputs.get("tmCategoryField"), rule["tmCategoryAny"]):
            return False
    if "tmRoadTypeAny" in rule:
        if not _match_any_field(item, inputs.get("tmRoadTypeField"), rule["tmRoadTypeAny"]):
            return False

    tags = item.get(inputs.get("tagsField")) or {}
    if "tagsAny" in rule and not _match_tags_any(tags, rule["tagsAny"]):
        return False
    if "tagsAll" in rule and not _match_tags_all(tags, rule["tagsAll"]):
        return False

    if "anyOf" in rule:
        any_matched = False
        for sub in rule["anyOf"]:
            if _match_rule(item, sub, inputs):
                any_matched = True
                break
        if not any_matched:
            return False
    if "allOf" in rule:
        for sub in rule["allOf"]:
            if not _match_rule(item, sub, inputs):
                return False

    return True


def _collect_modifiers(item, spec, options):
    inputs = spec.get("inputs", {})
    modifiers = []
    for rule in spec.get("modifierRules", []):
        if not _match_rule(item, rule, inputs):
            continue
        for mod in rule.get("modifiers", []):
            entry = {"name": mod.get("name")}
            if mod.get("valueFromTag"):
                tags = item.get(inputs.get("tagsField")) or {}
                entry["value"] = tags.get(mod.get("valueFromTag"))
            modifiers.append(entry)
    return modifiers


def classify_item(item, spec, options_override=None):
    inputs = spec.get("inputs", {})
    options = {}
    options.update(spec.get("options", {}))
    options.update(options_override or {})

    for rule in spec.get("rules", []):
        if not _match_rule(item, rule, inputs):
            continue
        actions = rule.get("actions", {})
        ignore = bool(actions.get("ignore"))
        opt_name = actions.get("ignoreWhenOptionFalse")
        if opt_name and not options.get(opt_name):
            ignore = True
        return {
            "mainClass": rule.get("mainClass"),
            "subClass": rule.get("subClass"),
            "ruleId": rule.get("id"),
            "ignore": ignore,
            "role": actions.get("role"),
            "poiImportance": actions.get("poiImportance")
        }

    for fb in spec.get("fallbacks", []):
        if not _match_rule(item, fb, inputs):
            continue
        return {
            "mainClass": fb.get("mainClass"),
            "subClass": fb.get("subClass"),
            "ruleId": fb.get("id"),
            "ignore": False
        }
    return None


def _map_bbox_from_meta(map_data):
    meta = map_data.get("meta")
    if not meta:
        return None
    if meta.get("boundary"):
        return meta.get("boundary")
    if meta.get("dataBoundary"):
        return meta.get("dataBoundary")
    return None


def _map_bbox_from_items(map_data):
    min_x = float("inf")
    min_y = float("inf")
    max_x = float("-inf")
    max_y = float("-inf")
    found = False
    for key, value in map_data.items():
        if not isinstance(value, list):
            continue
        for item in value:
            bounds = item.get("bounds")
            if not bounds:
                continue
            try:
                bminx = bounds.get("minX")
                bminy = bounds.get("minY")
                bmaxx = bounds.get("maxX")
                bmaxy = bounds.get("maxY")
                if bminx is None or bminy is None or bmaxx is None or bmaxy is None:
                    continue
            except Exception:
                continue
            min_x = min(min_x, bminx)
            min_y = min(min_y, bminy)
            max_x = max(max_x, bmaxx)
            max_y = max(max_y, bmaxy)
            found = True
    if not found:
        return None
    return {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y}


def _get_map_bbox(map_data):
    return _map_bbox_from_meta(map_data) or _map_bbox_from_items(map_data)


def _center_from_bounds(bounds):
    if not bounds:
        return None
    return {
        "x": (bounds.get("minX") + bounds.get("maxX")) / 2,
        "y": (bounds.get("minY") + bounds.get("maxY")) / 2
    }


def _point_from_coords(coords):
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    return {"x": coords[0], "y": coords[1]}


def _average_point(coords):
    if not isinstance(coords, list) or not coords:
        return None
    sum_x = 0.0
    sum_y = 0.0
    count = 0
    for p in coords:
        if not isinstance(p, list) or len(p) < 2:
            continue
        sum_x += p[0]
        sum_y += p[1]
        count += 1
    if not count:
        return None
    return {"x": sum_x / count, "y": sum_y / count}


def _polygon_points(geometry):
    if not geometry:
        return None
    if isinstance(geometry.get("outer"), list):
        return geometry.get("outer")
    coords = geometry.get("coordinates")
    if isinstance(coords, list) and coords and isinstance(coords[0], list):
        if coords[0] and isinstance(coords[0][0], (int, float)):
            return coords
    return None


def _attach_locations(entry, item, bbox):
    if not bbox or not classify_location:
        return
    geom = item.get("geometry") or {}
    point = None

    if geom.get("type") == "point":
        point = _point_from_coords(geom.get("coordinates"))
        if point:
            entry["_classification"]["location"] = classify_location(point, bbox)
        return

    if geom.get("type") == "line_string":
        coords = geom.get("coordinates") or []
        if coords:
            start = _point_from_coords(coords[0])
            end = _point_from_coords(coords[-1])
            center = _average_point(coords) or _center_from_bounds(item.get("bounds"))
            if start:
                entry["_classification"]["locationStart"] = classify_location(start, bbox)
            if end:
                entry["_classification"]["locationEnd"] = classify_location(end, bbox)
            if center:
                entry["_classification"]["locationCenter"] = classify_location(center, bbox)
        if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
            if entry["_classification"].get("locationCenter"):
                entry["_classification"]["location"] = entry["_classification"]["locationCenter"]
        return

    if geom.get("type") == "polygon":
        points = _polygon_points(geom)
        point = _average_point(points) or _center_from_bounds(item.get("bounds"))
        if point:
            entry["_classification"]["locationCenter"] = classify_location(point, bbox)
        if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
            if entry["_classification"].get("locationCenter"):
                entry["_classification"]["location"] = entry["_classification"]["locationCenter"]
        return

    point = _center_from_bounds(item.get("bounds"))
    if point:
        entry["_classification"]["locationCenter"] = classify_location(point, bbox)
    if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
        if entry["_classification"].get("locationCenter"):
            entry["_classification"]["location"] = entry["_classification"]["locationCenter"]


def group_map_data(map_data, spec, options_override=None):
    grouped = OrderedDict()
    for main_key in spec.get("classes", OrderedDict()).keys():
        grouped[main_key] = OrderedDict()

    bbox = _get_map_bbox(map_data)

    def add_item(item):
        classification = classify_item(item, spec, options_override)
        if not classification or classification.get("ignore"):
            return
        modifiers = _collect_modifiers(item, spec, options_override)
        entry = dict(item)
        entry["_classification"] = {
            "mainClass": classification.get("mainClass"),
            "subClass": classification.get("subClass"),
            "ruleId": classification.get("ruleId"),
            "role": classification.get("role"),
            "poiImportance": classification.get("poiImportance"),
            "modifiers": modifiers
        }
        _attach_locations(entry, item, bbox)
        main_group = grouped.get(classification.get("mainClass"))
        if main_group is None:
            grouped[classification.get("mainClass")] = OrderedDict()
            main_group = grouped[classification.get("mainClass")]
        sub_key = classification.get("subClass")
        if sub_key not in main_group:
            main_group[sub_key] = []
        main_group[sub_key].append(entry)

    for key, value in map_data.items():
        if not isinstance(value, list):
            continue
        for item in value:
            if isinstance(item, dict) and item.get("elementType"):
                add_item(item)

    return grouped


def _load_json(path):
    with open(path, "r") as handle:
        return json.load(handle, object_pairs_hook=OrderedDict)


def run_standalone(args):
    input_path = args[0] if args else os.path.join(os.getcwd(), "map-meta-raw.json")
    if not os.path.exists(input_path):
        input_path = os.path.join(os.getcwd(), "test/data/map-meta.indented.json")
    return run_map_desc(input_path)


def run_map_desc(input_path, output_path=None, options_override=None):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    spec_path = os.path.normpath(os.path.join(base_dir, "..", "map-description-classifications.json"))
    spec = _load_json(spec_path)
    map_data = _load_json(input_path)
    grouped = group_map_data(map_data, spec, options_override)
    if output_path is None:
        output_path = os.path.join(os.path.dirname(input_path), "map-meta.json")
    with open(output_path, "w") as handle:
        json.dump(grouped, handle, indent=2)
    print(json.dumps(grouped, indent=2))
    renderer = _load_renderer()
    if renderer:
        output = renderer.render_grouped(grouped, spec, map_data)
        print(output)
    return grouped


if __name__ == "__main__":
    run_standalone(os.sys.argv[1:])
