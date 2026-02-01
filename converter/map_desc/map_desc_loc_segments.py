# Python 3.5
from __future__ import division

import math

from typing import Any, Dict, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import TypedDict  # type: ignore[import-not-found]
else:  # pragma: no cover - blender python may not have typing_extensions
    try:
        from typing_extensions import TypedDict  # type: ignore[import-not-found]
    except ImportError:
        def TypedDict(name, fields, total=True):  # type: ignore[no-redef]
            return dict


Point = TypedDict("Point", {"x": float, "y": float})
BBox = TypedDict("BBox", {"minX": float, "minY": float, "maxX": float, "maxY": float})
LocationLoc = TypedDict("LocationLoc", {"kind": str, "dir": Optional[str]})


CENTER_BAND = 0.25
NEAR_CENTER_BAND = 0.5
PART_BAND = 0.75


def _clamp(value: float, min_value: float, max_value: float) -> float:
    if value < min_value:
        return min_value
    if value > max_value:
        return max_value
    return value


def _angle_dir(dx: float, dy: float) -> Optional[str]:
    if dx == 0 and dy == 0:
        return None
    angle = math.degrees(math.atan2(dy, dx))
    if -25.0 <= angle < 25.0:
        return "east"
    if 25.0 <= angle < 65.0:
        return "northeast"
    if 65.0 <= angle < 115.0:
        return "north"
    if 115.0 <= angle < 155.0:
        return "northwest"
    if angle >= 155.0 or angle < -155.0:
        return "west"
    if -155.0 <= angle < -115.0:
        return "southwest"
    if -115.0 <= angle < -65.0:
        return "south"
    if -65.0 <= angle < -25.0:
        return "southeast"
    return None


def _location_loc(kind: str, direction: Optional[str]) -> LocationLoc:
    return {"kind": kind, "dir": direction}


def classify_location(point: Optional[Point],
                      bbox: Optional[BBox]) -> Optional[Dict[str, Any]]:
    if not point or not bbox:
        return None
    min_x = bbox.get("minX")
    max_x = bbox.get("maxX")
    min_y = bbox.get("minY")
    max_y = bbox.get("maxY")
    point_x = point.get("x")
    point_y = point.get("y")
    if min_x is None or max_x is None or min_y is None or max_y is None:
        return None
    if point_x is None or point_y is None:
        return None
    width = max_x - min_x
    height = max_y - min_y
    if width == 0 or height == 0:
        return None

    nx = (point_x - min_x) / width
    ny = (point_y - min_y) / height
    nx = _clamp(nx, 0, 1)
    ny = _clamp(ny, 0, 1)

    dx = (nx - 0.5) * 2.0
    dy = (ny - 0.5) * 2.0
    r = max(abs(dx), abs(dy))

    if r <= CENTER_BAND:
        return {"loc": _location_loc("center", None)}

    direction = _angle_dir(dx, dy)
    if r <= NEAR_CENTER_BAND:
        return {"loc": _location_loc("offset_center", direction)}

    if r <= PART_BAND:
        return {"loc": _location_loc("part", direction)}

    if direction in ("northwest", "northeast", "southwest", "southeast"):
        return {"loc": _location_loc("corner", direction)}
    return {"loc": _location_loc("edge", direction)}


__all__ = ["classify_location"]
