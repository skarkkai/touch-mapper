# Python 3.5
from __future__ import division

from typing import Any, Dict, Optional


CENTER_MIN = 0.375
CENTER_MAX = 0.625
EDGE_THICKNESS = 0.125
OFFSET_MIN = EDGE_THICKNESS
OFFSET_MAX = 1 - EDGE_THICKNESS


def _clamp(value: float, min_value: float, max_value: float) -> float:
    if value < min_value:
        return min_value
    if value > max_value:
        return max_value
    return value


def _diag_dir(x_dir: Optional[str], y_dir: Optional[str]) -> Optional[str]:
    if not x_dir and not y_dir:
        return None
    if not x_dir:
        return y_dir
    if not y_dir:
        return x_dir
    return y_dir + x_dir


def _diag_phrase(direction: Optional[str]) -> Optional[str]:
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


def _edge_phrase(direction: Optional[str]) -> Optional[str]:
    if direction == "west":
        return "near the western edge of the map"
    if direction == "east":
        return "near the eastern edge of the map"
    if direction == "north":
        return "near the northern edge of the map"
    if direction == "south":
        return "near the southern edge of the map"
    return None


def _corner_phrase(direction: Optional[str]) -> Optional[str]:
    if direction == "northwest":
        return "near the top-left corner of the map"
    if direction == "northeast":
        return "near the top-right corner of the map"
    if direction == "southwest":
        return "near the bottom-left corner of the map"
    if direction == "southeast":
        return "near the bottom-right corner of the map"
    return None


def classify_location(point: Optional[Dict[str, float]],
                      bbox: Optional[Dict[str, float]]) -> Optional[Dict[str, Any]]:
    if not point or not bbox:
        return None
    width = bbox.get("maxX") - bbox.get("minX")
    height = bbox.get("maxY") - bbox.get("minY")
    if width == 0 or height == 0:
        return None

    nx = (point["x"] - bbox.get("minX")) / width
    ny = (point["y"] - bbox.get("minY")) / height
    nx = _clamp(nx, 0, 1)
    ny = _clamp(ny, 0, 1)

    in_center = (CENTER_MIN <= nx <= CENTER_MAX) and (CENTER_MIN <= ny <= CENTER_MAX)
    if in_center:
        return {"zone": "center", "dir": None, "phrase": "near the center of the map"}

    edge_x = "west" if nx < EDGE_THICKNESS else ("east" if nx > 1 - EDGE_THICKNESS else None)
    edge_y = "south" if ny < EDGE_THICKNESS else ("north" if ny > 1 - EDGE_THICKNESS else None)
    if edge_x and edge_y:
        direction = _diag_dir(edge_x, edge_y)
        return {"zone": "corner", "dir": direction, "phrase": _corner_phrase(direction)}
    if edge_x or edge_y:
        direction = edge_x or edge_y
        return {"zone": "edge", "dir": direction, "phrase": _edge_phrase(direction)}

    offset_x = "west" if (OFFSET_MIN <= nx <= CENTER_MIN) else ("east" if (CENTER_MAX <= nx <= OFFSET_MAX) else None)
    offset_y = "south" if (OFFSET_MIN <= ny <= CENTER_MIN) else ("north" if (CENTER_MAX <= ny <= OFFSET_MAX) else None)
    if offset_x or offset_y:
        direction = _diag_dir(offset_x, offset_y)
        phrase_dir = _diag_phrase(direction)
        return {
            "zone": "offset_of_center",
            "dir": direction,
            "phrase": "a little " + phrase_dir + " of the center of the map"
        }

    part_x = "west" if nx < 0.5 else "east"
    part_y = "south" if ny < 0.5 else "north"
    part_dir = _diag_dir(part_x, part_y)
    part_phrase = _diag_phrase(part_dir)
    return {
        "zone": "part",
        "dir": part_dir,
        "phrase": "in the " + part_phrase + " part of the map"
    }


__all__ = ["classify_location"]
