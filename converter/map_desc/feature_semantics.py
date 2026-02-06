# Python 3.5
from __future__ import division

from collections import OrderedDict
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

UNKNOWN = object()

PAVED_SURFACES = {
    "asphalt",
    "concrete",
    "concrete:lanes",
    "concrete:plates",
    "paved",
    "paving_stones",
    "sett",
    "bricks",
    "cobblestone"
}

UNPAVED_SURFACES = {
    "unpaved",
    "gravel",
    "fine_gravel",
    "pebblestone",
    "dirt",
    "earth",
    "ground",
    "mud",
    "sand",
    "grass",
    "grass_paver",
    "woodchips",
    "snow",
    "ice"
}

SMOOTHNESS_VALUES = {
    "excellent",
    "good",
    "intermediate",
    "bad",
    "very_bad",
    "horrible",
    "very_horrible",
    "impassable"
}

SIDEWALK_VALUES = {"both", "left", "right", "no", "separate"}
ONEWAY_VALUES = {"yes", "no", "reversible"}
CYCLEWAY_VALUES = {"lane", "track", "shared_lane", "shared", "no"}
WHEELCHAIR_VALUES = {"yes", "no", "limited"}
ACCESS_VALUES = {"yes", "no", "permissive", "private", "destination", "customers"}
CROSSING_TYPES = {"uncontrolled", "traffic_signals", "marked", "island"}
KERB_VALUES = {"flush", "lowered", "raised"}


def _normalize_tag_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    return text.lower()


def _record_raw(raw: OrderedDict, key: str, value: Any) -> None:
    if value is None:
        return
    text = str(value)
    existing = raw.get(key)
    if existing is None:
        raw[key] = [text]
        return
    if text not in existing:
        existing.append(text)


def _get_tag_value(tags: Dict[str, Any], key: str, raw: OrderedDict) -> Optional[str]:
    if key not in tags:
        return None
    value = tags.get(key)
    _record_raw(raw, key, value)
    if value is None:
        return None
    return str(value).strip()


def _parse_yes_no(value: Optional[str]) -> Any:
    if value is None:
        return None
    lowered = value.lower()
    if lowered in ("yes", "true", "1"):
        return "yes"
    if lowered in ("no", "false", "0"):
        return "no"
    return UNKNOWN


def _parse_enum(value: Optional[str], allowed: Iterable[str]) -> Any:
    if value is None:
        return None
    lowered = value.lower()
    if lowered in allowed:
        return lowered
    return UNKNOWN


def _parse_int_strict(value: Optional[str]) -> Any:
    if value is None:
        return None
    text = value.strip()
    if text == "" or ";" in text or "|" in text:
        return UNKNOWN
    try:
        num = int(text)
    except ValueError:
        return UNKNOWN
    if num < 0:
        return UNKNOWN
    return num


def _parse_float_meters(value: Optional[str]) -> Any:
    if value is None:
        return None
    text = value.strip().lower()
    if text == "" or ";" in text or "|" in text:
        return UNKNOWN
    for suffix in (" meters", " meter", " m"):
        if text.endswith(suffix):
            text = text[:-len(suffix)].strip()
            break
    try:
        num = float(text)
    except ValueError:
        return UNKNOWN
    if num < 0:
        return UNKNOWN
    return num


def _parse_speed_kmh(value: Optional[str]) -> Any:
    if value is None:
        return None
    text = value.strip().lower()
    if text == "" or ";" in text or "|" in text:
        return UNKNOWN
    try:
        num = float(text)
    except ValueError:
        return UNKNOWN
    if num < 0:
        return UNKNOWN
    if num.is_integer():
        return int(num)
    return num


def _surface_class(value: Optional[str]) -> Any:
    if value is None:
        return None
    lowered = value.lower()
    if lowered in PAVED_SURFACES:
        return "paved"
    if lowered in UNPAVED_SURFACES:
        return "unpaved"
    return UNKNOWN


def _merge_uniform_or_mixed(values: List[Any], touched: bool) -> Optional[str]:
    if not touched:
        return None
    known = [value for value in values if value not in (None, UNKNOWN)]
    if not known:
        return "unknown"
    first = known[0]
    for value in known[1:]:
        if value != first:
            return "mixed"
    return first


def _merge_numeric_with_source(entries: Sequence[Tuple[Any, Optional[str]]],
                               touched: bool) -> Optional[OrderedDict]:
    if not touched:
        return None
    known = [entry for entry in entries if entry[0] is not None]
    if not known:
        return OrderedDict([("value", None), ("source", "unknown")])
    value = known[0][0]
    for entry in known[1:]:
        if entry[0] != value:
            return OrderedDict([("value", None), ("source", "unknown")])
    source = known[0][1]
    for entry in known[1:]:
        if entry[1] != source:
            source = "unknown"
            break
    return OrderedDict([("value", value), ("source", source or "unknown")])


def _merge_lanes(entries: List[Dict[str, Any]], touched: bool) -> Optional[OrderedDict]:
    if not touched:
        return None
    known = [entry for entry in entries if entry.get("total") is not None]
    if not known:
        return OrderedDict([
            ("total", None),
            ("forward", None),
            ("backward", None),
            ("source", "unknown")
        ])
    total = known[0].get("total")
    for entry in known[1:]:
        if entry.get("total") != total:
            return OrderedDict([
                ("total", None),
                ("forward", None),
                ("backward", None),
                ("source", "unknown")
            ])
    forward_values = [entry.get("forward") for entry in entries if entry.get("forward") is not None]
    backward_values = [entry.get("backward") for entry in entries if entry.get("backward") is not None]
    forward = None
    backward = None
    if forward_values and all(value == forward_values[0] for value in forward_values):
        forward = forward_values[0]
    if backward_values and all(value == backward_values[0] for value in backward_values):
        backward = backward_values[0]
    sources = [entry.get("source") for entry in entries if entry.get("source")]
    source = sources[0] if sources and all(val == sources[0] for val in sources) else "unknown"
    return OrderedDict([
        ("total", total),
        ("forward", forward),
        ("backward", backward),
        ("source", source)
    ])


def _merge_incline(entries: List[Dict[str, Any]], touched: bool) -> Optional[OrderedDict]:
    if not touched:
        return None
    values = [entry.get("value") for entry in entries]
    percents = [entry.get("percent") for entry in entries]
    value = _merge_uniform_or_mixed(values, True)
    percent_entries = [(percent, "incline") for percent in percents]
    percent_out = _merge_numeric_with_source(percent_entries, True)
    percent_value = percent_out.get("value") if percent_out else None
    return OrderedDict([("value", value), ("percent", percent_value)])


def _finalize_raw(raw: OrderedDict) -> Optional[OrderedDict]:
    if not raw:
        return None
    out = OrderedDict()
    for key, values in raw.items():
        if len(values) == 1:
            out[key] = values[0]
        else:
            out[key] = list(values)
    return out


def _sorted_tag_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    type_rank = {"relation": 0, "way": 1, "node": 2}
    def sort_key(entry):
        return (type_rank.get(entry.get("osmType"), 3), entry.get("osmId") or 0)
    return sorted(sources, key=sort_key)


def _tag_sources(item: Dict[str, Any]) -> List[Dict[str, Any]]:
    sources = item.get("tagSources")
    if isinstance(sources, list):
        cleaned = []
        for source in sources:
            if not isinstance(source, dict):
                continue
            tags = source.get("tags")
            if not isinstance(tags, dict):
                continue
            cleaned.append({
                "osmType": source.get("osmType"),
                "osmId": source.get("osmId"),
                "tags": tags
            })
        if cleaned:
            return _sorted_tag_sources(cleaned)
    tags = item.get("tags")
    if isinstance(tags, dict):
        return [{
            "osmType": item.get("osmType"),
            "osmId": item.get("osmId"),
            "tags": tags
        }]
    return []


def _parse_surface(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, Any, bool]:
    if "surface" in tags:
        value = _normalize_tag_value(_get_tag_value(tags, "surface", raw))
        return (value if value is not None else UNKNOWN,
                _surface_class(value) if value is not None else UNKNOWN,
                True)
    if "tracktype" in tags:
        highway = _normalize_tag_value(_get_tag_value(tags, "highway", raw))
        track_val = _normalize_tag_value(_get_tag_value(tags, "tracktype", raw))
        if highway == "track":
            if track_val is None:
                return (UNKNOWN, UNKNOWN, True)
            return (track_val, _surface_class(track_val), True)
    if "material" in tags:
        material = _normalize_tag_value(_get_tag_value(tags, "material", raw))
        if material is None:
            return (UNKNOWN, UNKNOWN, True)
        return (material, _surface_class(material), True)
    return (None, None, False)


def _parse_smoothness(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "smoothness" not in tags:
        return (None, False)
    value = _parse_enum(_get_tag_value(tags, "smoothness", raw), SMOOTHNESS_VALUES)
    return (value, True)


def _parse_lit(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "lit" not in tags:
        return (None, False)
    return (_parse_yes_no(_get_tag_value(tags, "lit", raw)), True)


def _parse_oneway(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "oneway" not in tags:
        return (None, False)
    value = _normalize_tag_value(_get_tag_value(tags, "oneway", raw))
    if value in ("yes", "true", "1"):
        return ("yes", True)
    if value in ("no", "false", "0"):
        return ("no", True)
    if value == "reversible":
        return ("reversible", True)
    return (UNKNOWN, True)


def _parse_lanes(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Dict[str, Any], bool]:
    lanes = {"total": None, "forward": None, "backward": None, "source": None}  # type: Dict[str, Any]
    forward_raw = _get_tag_value(tags, "lanes:forward", raw)
    backward_raw = _get_tag_value(tags, "lanes:backward", raw)
    total_raw = _get_tag_value(tags, "lanes", raw)
    touched = forward_raw is not None or backward_raw is not None or total_raw is not None
    if not touched:
        return (lanes, False)
    forward = _parse_int_strict(forward_raw)
    backward = _parse_int_strict(backward_raw)
    if isinstance(forward, int) and isinstance(backward, int):
        lanes["forward"] = forward
        lanes["backward"] = backward
        lanes["total"] = forward + backward
        lanes["source"] = "lanes:forward/backward"
        return (lanes, True)
    total = _parse_int_strict(total_raw)
    if isinstance(total, int):
        lanes["total"] = total
        lanes["source"] = "lanes"
        return (lanes, True)
    lanes["source"] = "unknown"
    return (lanes, True)


def _parse_width(tags: Dict[str, Any], raw: OrderedDict, lanes_hint: Any) -> Tuple[Tuple[Any, Optional[str]], bool]:
    width_raw = _get_tag_value(tags, "width", raw)
    if width_raw is not None:
        value = _parse_float_meters(width_raw)
        return ((value if value is not UNKNOWN else None, "width"), True)
    est_raw = _get_tag_value(tags, "est_width", raw)
    if est_raw is not None:
        value = _parse_float_meters(est_raw)
        return ((value if value is not UNKNOWN else None, "est_width"), True)
    lane_raw = _get_tag_value(tags, "lane_width", raw)
    if lane_raw is not None:
        lane_width = _parse_float_meters(lane_raw)
        if lane_width is UNKNOWN:
            return ((None, "lane_width*lanes"), True)
        if isinstance(lanes_hint, int):
            return ((lane_width * lanes_hint, "lane_width*lanes"), True)
        return ((None, "lane_width*lanes"), True)
    return ((None, None), False)


def _parse_maxspeed(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Tuple[Any, Optional[str]], bool]:
    fwd_raw = _get_tag_value(tags, "maxspeed:forward", raw)
    back_raw = _get_tag_value(tags, "maxspeed:backward", raw)
    touched = fwd_raw is not None or back_raw is not None
    if touched:
        fwd = _parse_speed_kmh(fwd_raw)
        back = _parse_speed_kmh(back_raw)
        if fwd is not UNKNOWN and back is not UNKNOWN and fwd is not None and back is not None and fwd == back:
            return ((fwd, "maxspeed:forward/backward"), True)
    max_raw = _get_tag_value(tags, "maxspeed", raw)
    if max_raw is not None:
        value = _parse_speed_kmh(max_raw)
        return ((value if value is not UNKNOWN else None, "maxspeed"), True)
    if touched:
        return ((None, "unknown"), True)
    return ((None, None), False)


def _parse_sidewalk(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "sidewalk" not in tags:
        return (None, False)
    return (_parse_enum(_get_tag_value(tags, "sidewalk", raw), SIDEWALK_VALUES), True)


def _parse_cycleway(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "cycleway" in tags:
        return (_parse_enum(_get_tag_value(tags, "cycleway", raw), CYCLEWAY_VALUES), True)
    left_raw = _get_tag_value(tags, "cycleway:left", raw)
    right_raw = _get_tag_value(tags, "cycleway:right", raw)
    if left_raw is None and right_raw is None:
        return (None, False)
    left = _parse_enum(left_raw, CYCLEWAY_VALUES)
    right = _parse_enum(right_raw, CYCLEWAY_VALUES)
    if left is UNKNOWN or right is UNKNOWN:
        if left is None and right is None:
            return (None, False)
        return (UNKNOWN, True)
    if left is not None and right is not None and left != right:
        return ("mixed", True)
    return (left if left is not None else right, True)


def _parse_segregated(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "segregated" not in tags:
        return (None, False)
    return (_parse_yes_no(_get_tag_value(tags, "segregated", raw)), True)


def _parse_crossing(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Dict[str, Any], bool]:
    touched = False
    crossing_raw = None
    if "highway" in tags:
        highway = _normalize_tag_value(_get_tag_value(tags, "highway", raw))
        if highway == "crossing":
            touched = True
    if "crossing" in tags:
        crossing_raw = _get_tag_value(tags, "crossing", raw)
        touched = True
    if "crossing:markings" in tags or "tactile_paving" in tags:
        touched = True
    if not touched:
        return ({}, False)
    crossing_type = _parse_enum(crossing_raw, CROSSING_TYPES)
    if crossing_raw is None and touched:
        crossing_type = UNKNOWN
    markings = _parse_yes_no(_get_tag_value(tags, "crossing:markings", raw))
    tactile = _parse_yes_no(_get_tag_value(tags, "tactile_paving", raw))
    return (OrderedDict([
        ("type", crossing_type if crossing_type is not None else UNKNOWN),
        ("markings", markings if markings is not None else UNKNOWN),
        ("tactile_paving", tactile if tactile is not None else UNKNOWN)
    ]), True)


def _parse_kerb(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "kerb" not in tags:
        return (None, False)
    return (_parse_enum(_get_tag_value(tags, "kerb", raw), KERB_VALUES), True)


def _parse_incline(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Dict[str, Any], bool]:
    if "incline" not in tags:
        return ({}, False)
    value = _get_tag_value(tags, "incline", raw)
    if value is None:
        return (OrderedDict([("value", "unknown"), ("percent", None)]), True)
    text = value.strip().lower()
    if text in ("up", "down"):
        return (OrderedDict([("value", text), ("percent", None)]), True)
    if text.endswith("%"):
        num_text = text[:-1].strip()
        try:
            num = float(num_text)
        except ValueError:
            return (OrderedDict([("value", "unknown"), ("percent", None)]), True)
        direction = "level" if num == 0 else ("down" if num < 0 else "up")
        return (OrderedDict([("value", direction), ("percent", abs(num))]), True)
    if ":" in text:
        parts = text.split(":", 1)
        try:
            num = float(parts[0])
            denom = float(parts[1])
        except ValueError:
            return (OrderedDict([("value", "unknown"), ("percent", None)]), True)
        if denom == 0:
            return (OrderedDict([("value", "unknown"), ("percent", None)]), True)
        percent = 100.0 * abs(num) / denom
        direction = "level" if num == 0 else ("down" if num < 0 else "up")
        return (OrderedDict([("value", direction), ("percent", percent)]), True)
    return (OrderedDict([("value", "unknown"), ("percent", None)]), True)


def _parse_steps(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Dict[str, Any], bool]:
    touched = False
    if "highway" in tags:
        highway = _normalize_tag_value(_get_tag_value(tags, "highway", raw))
        if highway == "steps":
            touched = True
    step_raw = _get_tag_value(tags, "step_count", raw)
    if step_raw is not None:
        touched = True
    if not touched:
        return ({}, False)
    step_count = _parse_int_strict(step_raw)
    if step_count is UNKNOWN:
        step_count = None
    return (OrderedDict([("step_count", step_count)]), True)


def _parse_wheelchair(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "wheelchair" not in tags:
        return (None, False)
    return (_parse_enum(_get_tag_value(tags, "wheelchair", raw), WHEELCHAIR_VALUES), True)


def _parse_access(tags: Dict[str, Any], raw: OrderedDict) -> Tuple[Any, bool]:
    if "access" not in tags:
        return (None, False)
    return (_parse_enum(_get_tag_value(tags, "access", raw), ACCESS_VALUES), True)


def build_feature_semantics(item: Dict[str, Any]) -> Optional[OrderedDict]:
    sources = _tag_sources(item)
    if not sources:
        return None

    raw_values = OrderedDict()

    surface_values = []
    surface_classes = []
    surface_touched = False

    smoothness_values = []
    smoothness_touched = False

    lit_values = []
    lit_touched = False

    width_entries = []
    width_touched = False

    lanes_entries = []
    lanes_touched = False

    oneway_values = []
    oneway_touched = False

    maxspeed_entries = []
    maxspeed_touched = False

    sidewalk_values = []
    sidewalk_touched = False

    cycleway_values = []
    cycleway_touched = False

    segregated_values = []
    segregated_touched = False

    crossing_entries = []
    crossing_touched = False

    kerb_values = []
    kerb_touched = False

    incline_entries = []
    incline_touched = False

    steps_entries = []
    steps_touched = False

    wheelchair_values = []
    wheelchair_touched = False

    access_values = []
    access_touched = False

    for source in sources:
        tags = source.get("tags") or {}
        if not isinstance(tags, dict):
            continue

        surface_value, surface_class, touched = _parse_surface(tags, raw_values)
        surface_values.append(surface_value)
        surface_classes.append(surface_class)
        surface_touched = surface_touched or touched

        smoothness_value, touched = _parse_smoothness(tags, raw_values)
        smoothness_values.append(smoothness_value)
        smoothness_touched = smoothness_touched or touched

        lit_value, touched = _parse_lit(tags, raw_values)
        lit_values.append(lit_value)
        lit_touched = lit_touched or touched

        lanes_entry, touched = _parse_lanes(tags, raw_values)
        lanes_entries.append(lanes_entry)
        lanes_touched = lanes_touched or touched

        width_entry, touched = _parse_width(tags, raw_values, lanes_entry.get("total"))
        width_entries.append(width_entry)
        width_touched = width_touched or touched

        oneway_value, touched = _parse_oneway(tags, raw_values)
        oneway_values.append(oneway_value)
        oneway_touched = oneway_touched or touched

        maxspeed_entry, touched = _parse_maxspeed(tags, raw_values)
        maxspeed_entries.append(maxspeed_entry)
        maxspeed_touched = maxspeed_touched or touched

        sidewalk_value, touched = _parse_sidewalk(tags, raw_values)
        sidewalk_values.append(sidewalk_value)
        sidewalk_touched = sidewalk_touched or touched

        cycleway_value, touched = _parse_cycleway(tags, raw_values)
        cycleway_values.append(cycleway_value)
        cycleway_touched = cycleway_touched or touched

        segregated_value, touched = _parse_segregated(tags, raw_values)
        segregated_values.append(segregated_value)
        segregated_touched = segregated_touched or touched

        crossing_entry, touched = _parse_crossing(tags, raw_values)
        crossing_entries.append(crossing_entry)
        crossing_touched = crossing_touched or touched

        kerb_value, touched = _parse_kerb(tags, raw_values)
        kerb_values.append(kerb_value)
        kerb_touched = kerb_touched or touched

        incline_entry, touched = _parse_incline(tags, raw_values)
        incline_entries.append(incline_entry)
        incline_touched = incline_touched or touched

        steps_entry, touched = _parse_steps(tags, raw_values)
        steps_entries.append(steps_entry)
        steps_touched = steps_touched or touched

        wheelchair_value, touched = _parse_wheelchair(tags, raw_values)
        wheelchair_values.append(wheelchair_value)
        wheelchair_touched = wheelchair_touched or touched

        access_value, touched = _parse_access(tags, raw_values)
        access_values.append(access_value)
        access_touched = access_touched or touched

    output = OrderedDict()
    raw_out = _finalize_raw(raw_values)
    if raw_out:
        output["raw"] = raw_out

    surface_value = _merge_uniform_or_mixed(surface_values, surface_touched)
    surface_class = _merge_uniform_or_mixed(surface_classes, surface_touched)
    if surface_value is not None or surface_class is not None:
        output["surface"] = OrderedDict([("class", surface_class), ("value", surface_value)])

    smoothness = _merge_uniform_or_mixed(smoothness_values, smoothness_touched)
    if smoothness is not None:
        output["smoothness"] = OrderedDict([("value", smoothness)])

    lit = _merge_uniform_or_mixed(lit_values, lit_touched)
    if lit is not None:
        output["lit"] = OrderedDict([("value", lit)])

    width = _merge_numeric_with_source(width_entries, width_touched)
    if width is not None:
        output["width_m"] = width

    lanes = _merge_lanes(lanes_entries, lanes_touched)
    if lanes is not None:
        output["lanes"] = lanes

    oneway = _merge_uniform_or_mixed(oneway_values, oneway_touched)
    if oneway is not None:
        output["oneway"] = OrderedDict([("value", oneway)])

    maxspeed = _merge_numeric_with_source(maxspeed_entries, maxspeed_touched)
    if maxspeed is not None:
        output["maxspeed_kmh"] = maxspeed

    sidewalk = _merge_uniform_or_mixed(sidewalk_values, sidewalk_touched)
    if sidewalk is not None:
        output["sidewalk"] = OrderedDict([("value", sidewalk)])

    cycleway = _merge_uniform_or_mixed(cycleway_values, cycleway_touched)
    if cycleway is not None:
        output["cycleway"] = OrderedDict([("value", cycleway)])

    segregated = _merge_uniform_or_mixed(segregated_values, segregated_touched)
    if segregated is not None:
        output["segregated"] = OrderedDict([("value", segregated)])

    if crossing_touched:
        types = [entry.get("type") for entry in crossing_entries]
        markings = [entry.get("markings") for entry in crossing_entries]
        tactile = [entry.get("tactile_paving") for entry in crossing_entries]
        crossing = OrderedDict([
            ("type", _merge_uniform_or_mixed(types, True)),
            ("markings", _merge_uniform_or_mixed(markings, True)),
            ("tactile_paving", _merge_uniform_or_mixed(tactile, True))
        ])
        output["crossing"] = crossing

    kerb = _merge_uniform_or_mixed(kerb_values, kerb_touched)
    if kerb is not None:
        output["kerb"] = OrderedDict([("value", kerb)])

    incline = _merge_incline(incline_entries, incline_touched)
    if incline is not None:
        output["incline"] = incline

    if steps_touched:
        step_counts = [entry.get("step_count") for entry in steps_entries]
        step_value = _merge_uniform_or_mixed(step_counts, True)
        if step_value == "mixed":
            step_value = None
        output["steps"] = OrderedDict([("step_count", step_value if step_value != "unknown" else None)])

    wheelchair = _merge_uniform_or_mixed(wheelchair_values, wheelchair_touched)
    if wheelchair is not None:
        output["wheelchair"] = OrderedDict([("value", wheelchair)])

    access = _merge_uniform_or_mixed(access_values, access_touched)
    if access is not None:
        output["access"] = OrderedDict([("value", access)])

    return output if output else None
