# Python 3.5
from __future__ import division

import json
import os
import sys
from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import TypedDict  # type: ignore[import-not-found]
else:  # pragma: no cover - blender python may not have typing_extensions
    try:
        from typing_extensions import TypedDict  # type: ignore[import-not-found]
    except ImportError:
        def TypedDict(name, fields, total=True):  # type: ignore[no-redef]
            return dict

from . import map_desc_render
from .geometry_clip import BBox as ClipBBox
from .geometry_clip import clip_line_string
from .map_desc_loc_segments import BBox, Point, classify_location


Bounds = TypedDict(
    "Bounds",
    {"minX": float, "minY": float, "maxX": float, "maxY": float},
    total=False
)


RuleInputs = TypedDict(
    "RuleInputs",
    {
        "elementTypeField": str,
        "geometryTypeField": str,
        "primaryRepresentationField": str,
        "representationsField": str,
        "tmCategoryField": str,
        "tmRoadTypeField": str,
        "tagsField": str
    },
    total=False
)

def _get_field(item: Dict[str, Any], path: Optional[str]) -> Optional[Any]:
    if not path:
        return None
    cur = item
    for part in path.split("."):
        if cur is None:
            return None
        cur = cur.get(part)
    return cur


def _input_field(inputs: RuleInputs, name: str) -> Optional[str]:
    value = inputs.get(name)
    return value if isinstance(value, str) else None


def _match_tags_any(tags: Optional[Dict[str, Any]], conditions: Optional[List[Dict[str, Any]]]) -> bool:
    if not conditions:
        return True
    for cond in conditions:
        key = cond.get("key")
        if not isinstance(key, str):
            continue
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


def _match_tags_all(tags: Optional[Dict[str, Any]], conditions: Optional[List[Dict[str, Any]]]) -> bool:
    if not conditions:
        return True
    for cond in conditions:
        key = cond.get("key")
        if not isinstance(key, str):
            return False
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


def _match_any_field(item: Dict[str, Any], field_name: str, values: Optional[List[Any]]) -> bool:
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


def _match_rule(item: Dict[str, Any], rule: Dict[str, Any], inputs: RuleInputs) -> bool:
    if "elementTypes" in rule:
        field_name = _input_field(inputs, "elementTypeField")
        if not field_name or item.get(field_name) not in rule["elementTypes"]:
            return False
    if "geometryTypes" in rule:
        field_name = _input_field(inputs, "geometryTypeField")
        if not field_name:
            return False
        geom_type = _get_field(item, field_name)
        if geom_type not in rule["geometryTypes"]:
            return False
    if "primaryRepresentationAny" in rule:
        field_name = _input_field(inputs, "primaryRepresentationField")
        if not field_name or not _match_any_field(item, field_name, rule["primaryRepresentationAny"]):
            return False
    if "representationsAny" in rule:
        field_name = _input_field(inputs, "representationsField")
        if not field_name or not _match_any_field(item, field_name, rule["representationsAny"]):
            return False
    if "tmCategoryAny" in rule:
        field_name = _input_field(inputs, "tmCategoryField")
        if not field_name or not _match_any_field(item, field_name, rule["tmCategoryAny"]):
            return False
    if "tmRoadTypeAny" in rule:
        field_name = _input_field(inputs, "tmRoadTypeField")
        if not field_name or not _match_any_field(item, field_name, rule["tmRoadTypeAny"]):
            return False

    tags_field = _input_field(inputs, "tagsField")
    tags = item.get(tags_field) if tags_field else {}
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


def _collect_modifiers(item: Dict[str, Any], spec: Dict[str, Any], options: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    inputs = spec.get("inputs", {})  # type: RuleInputs
    modifiers = []
    for rule in spec.get("modifierRules", []):
        if not _match_rule(item, rule, inputs):
            continue
        for mod in rule.get("modifiers", []):
            entry = {"name": mod.get("name")}
            if mod.get("valueFromTag"):
                tags_field = _input_field(inputs, "tagsField")
                tags_value = item.get(tags_field) if tags_field else {}
                tags = tags_value if isinstance(tags_value, dict) else {}
                entry["value"] = tags.get(mod.get("valueFromTag"))
            modifiers.append(entry)
    return modifiers


def classify_item(item: Dict[str, Any], spec: Dict[str, Any],
                  options_override: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    inputs = spec.get("inputs", {})  # type: RuleInputs
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


def _map_bbox_from_meta(map_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    meta = map_data.get("meta")
    if not meta:
        return None
    if meta.get("boundary"):
        return meta.get("boundary")
    if meta.get("dataBoundary"):
        return meta.get("dataBoundary")
    return None


def _map_bbox_from_items(map_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
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
    return {"minX": float(min_x), "minY": float(min_y), "maxX": float(max_x), "maxY": float(max_y)}


def _get_map_bbox(map_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return _map_bbox_from_meta(map_data) or _map_bbox_from_items(map_data)


def _center_from_bounds(bounds: Optional[Bounds]) -> Optional[Point]:
    if not bounds:
        return None
    min_x = bounds.get("minX")
    min_y = bounds.get("minY")
    max_x = bounds.get("maxX")
    max_y = bounds.get("maxY")
    if not isinstance(min_x, (int, float)) or not isinstance(min_y, (int, float)):
        return None
    if not isinstance(max_x, (int, float)) or not isinstance(max_y, (int, float)):
        return None
    return {
        "x": (float(min_x) + float(max_x)) / 2,
        "y": (float(min_y) + float(max_y)) / 2
    }


def _point_from_coords(coords: Any) -> Optional[Point]:
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    x = coords[0]
    y = coords[1]
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return {"x": float(x), "y": float(y)}


def _average_point(coords: Any) -> Optional[Point]:
    if not isinstance(coords, list) or not coords:
        return None
    sum_x = 0.0
    sum_y = 0.0
    count = 0
    for p in coords:
        if not isinstance(p, list) or len(p) < 2:
            continue
        x = p[0]
        y = p[1]
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            continue
        sum_x += float(x)
        sum_y += float(y)
        count += 1
    if not count:
        return None
    return {"x": sum_x / count, "y": sum_y / count}


def _polygon_points(geometry: Optional[Dict[str, Any]]) -> Optional[List[Any]]:
    if not geometry:
        return None
    if isinstance(geometry.get("outer"), list):
        return geometry.get("outer")
    coords = geometry.get("coordinates")
    if isinstance(coords, list) and coords and isinstance(coords[0], list):
        if coords[0] and isinstance(coords[0][0], (int, float)):
            return coords
    return None


def _coerce_bbox(bbox: Optional[Dict[str, Any]]) -> Optional[BBox]:
    if not bbox:
        return None
    min_x = bbox.get("minX")
    min_y = bbox.get("minY")
    max_x = bbox.get("maxX")
    max_y = bbox.get("maxY")
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


def _attach_locations(entry: Dict[str, Any], item: Dict[str, Any], bbox: Optional[Dict[str, Any]]) -> None:
    bbox_typed = _coerce_bbox(bbox)
    if not bbox_typed or not classify_location:
        return
    geom = item.get("geometry") or {}
    point = None

    if geom.get("type") == "point":
        point = _point_from_coords(geom.get("coordinates"))
        if point:
            entry["_classification"]["location"] = classify_location(point, bbox_typed)
        return

    if geom.get("type") == "line_string":
        coords = geom.get("coordinates") or []
        if coords:
            start = _point_from_coords(coords[0])
            end = _point_from_coords(coords[-1])
            center = _average_point(coords) or _center_from_bounds(item.get("bounds"))
            if start:
                entry["_classification"]["locationStart"] = classify_location(start, bbox_typed)
            if end:
                entry["_classification"]["locationEnd"] = classify_location(end, bbox_typed)
            if center:
                entry["_classification"]["locationCenter"] = classify_location(center, bbox_typed)
        if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
            if entry["_classification"].get("locationCenter"):
                entry["_classification"]["location"] = entry["_classification"]["locationCenter"]
        return

    if geom.get("type") == "polygon":
        points = _polygon_points(geom)
        point = _average_point(points) or _center_from_bounds(item.get("bounds"))
        if point:
            entry["_classification"]["locationCenter"] = classify_location(point, bbox_typed)
        if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
            if entry["_classification"].get("locationCenter"):
                entry["_classification"]["location"] = entry["_classification"]["locationCenter"]
        return

    point = _center_from_bounds(item.get("bounds"))
    if point:
        entry["_classification"]["locationCenter"] = classify_location(point, bbox_typed)
    if entry["_classification"].get("mainClass") == "D" and not entry["_classification"].get("location"):
        if entry["_classification"].get("locationCenter"):
            entry["_classification"]["location"] = entry["_classification"]["locationCenter"]


def _coerce_clip_bbox(bbox: Optional[Dict[str, Any]]) -> Optional[ClipBBox]:
    if not bbox:
        return None
    min_x = bbox.get("minX")
    min_y = bbox.get("minY")
    max_x = bbox.get("maxX")
    max_y = bbox.get("maxY")
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


def _attach_visible_geometry(entry: Dict[str, Any], item: Dict[str, Any],
                             boundary: Optional[Dict[str, Any]]) -> None:
    geom = item.get("geometry") or {}
    if geom.get("type") != "line_string":
        return
    coords = geom.get("coordinates")
    if not isinstance(coords, list):
        return
    boundary_box = _coerce_clip_bbox(boundary)
    if not boundary_box:
        visible = [coords]
        entry["visibleGeometry"] = visible
        item["visibleGeometry"] = visible
        return
    visible = clip_line_string(coords, boundary_box)
    entry["visibleGeometry"] = visible
    item["visibleGeometry"] = visible


def group_map_data(map_data: Dict[str, Any], spec: Dict[str, Any],
                   options_override: Optional[Dict[str, Any]] = None) -> OrderedDict:
    grouped = OrderedDict()
    for main_key in spec.get("classes", OrderedDict()).keys():
        grouped[main_key] = OrderedDict()

    bbox = _get_map_bbox(map_data)
    boundary = (map_data.get("meta") or {}).get("boundary")

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
        _attach_visible_geometry(entry, item, boundary)
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


def _load_json(path: str) -> OrderedDict:
    with open(path, "r") as handle:
        return json.load(handle, object_pairs_hook=OrderedDict)


def run_standalone(args: List[str]) -> OrderedDict:
    input_path = args[0] if args else os.path.join(os.getcwd(), "map-meta-raw.json")
    if not os.path.exists(input_path):
        input_path = os.path.join(os.getcwd(), "test/data/map-meta.indented.json")
    return run_map_desc(input_path)


def run_map_desc(input_path: str, output_path: Optional[str] = None,
                 options_override: Optional[Dict[str, Any]] = None) -> OrderedDict:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    spec_path = os.path.join(base_dir, "map-description-classifications.json")
    spec = _load_json(spec_path)
    map_data = _load_json(input_path)
    grouped = group_map_data(map_data, spec, options_override)
    if output_path is None:
        output_path = os.path.join(os.path.dirname(input_path), "map-meta.json")
    with open(output_path, "w") as handle:
        json.dump(grouped, handle, indent=2)
    augmented_path = os.path.join(os.path.dirname(output_path), "map-meta.augmented.json")
    with open(augmented_path, "w") as handle:
        json.dump(map_data, handle, indent=2)
    output_path = os.path.join(os.path.dirname(input_path), "map-content.json")
    map_desc_render.write_map_content(grouped, spec, output_path, map_data, options_override)
    return grouped


__all__ = [
    "classify_item",
    "group_map_data",
    "run_map_desc",
    "run_standalone"
]


if __name__ == "__main__":
    run_standalone(sys.argv[1:])
