# Python 3.5
from __future__ import division

from typing import List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from typing_extensions import TypedDict  # type: ignore[import-not-found]
else:  # pragma: no cover - blender python may not have typing_extensions
    try:
        from typing_extensions import TypedDict  # type: ignore[import-not-found]
    except ImportError:
        def TypedDict(name, fields, total=True):  # type: ignore[no-redef]
            return dict


BBox = TypedDict("BBox", {"minX": float, "minY": float, "maxX": float, "maxY": float})


Point = Tuple[float, float]
Coord = List[float]
Segment = List[Coord]


def _coerce_point(coord: object) -> Optional[Point]:
    if not isinstance(coord, list) or len(coord) < 2:
        return None
    x = coord[0]
    y = coord[1]
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return float(x), float(y)


def _points_close(a: Coord, b: Coord, eps: float = 1e-9) -> bool:
    return abs(a[0] - b[0]) <= eps and abs(a[1] - b[1]) <= eps


def _clip_segment(p0: Point, p1: Point, bbox: BBox) -> Optional[Tuple[Point, Point]]:
    # Clip a line segment to the bbox using Liang–Barsky; return the visible segment or None.
    min_x = bbox["minX"]
    min_y = bbox["minY"]
    max_x = bbox["maxX"]
    max_y = bbox["maxY"]

    dx = p1[0] - p0[0]
    dy = p1[1] - p0[1]

    p = (-dx, dx, -dy, dy)
    q = (p0[0] - min_x, max_x - p0[0], p0[1] - min_y, max_y - p0[1])

    u1 = 0.0
    u2 = 1.0
    for pi, qi in zip(p, q):
        if pi == 0:
            if qi < 0:
                return None
            continue
        t = qi / pi
        if pi < 0:
            if t > u2:
                return None
            if t > u1:
                u1 = t
        else:
            if t < u1:
                return None
            if t < u2:
                u2 = t

    if u1 > u2:
        return None
    c0 = (p0[0] + u1 * dx, p0[1] + u1 * dy)
    c1 = (p0[0] + u2 * dx, p0[1] + u2 * dy)
    if c0 == c1:
        return None
    return c0, c1


def clip_line_string(coords: List[Coord], bbox: BBox) -> List[Segment]:
    # Clip a polyline against the bbox and return visible segments as lists of [x, y] points.
    segments = []  # type: List[Segment]
    current = []  # type: Segment
    prev = None  # type: Optional[Point]

    for coord in coords:
        point = _coerce_point(coord)
        if point is None:
            if len(current) >= 2:
                segments.append(current)
            current = []
            prev = None
            continue

        if prev is None:
            prev = point
            continue

        clipped = _clip_segment(prev, point, bbox)
        if clipped is None:
            if len(current) >= 2:
                segments.append(current)
            current = []
        else:
            c0, c1 = clipped
            c0_list = [c0[0], c0[1]]
            c1_list = [c1[0], c1[1]]
            if not current:
                current = [c0_list, c1_list]
            else:
                if _points_close(current[-1], c0_list):
                    if not _points_close(current[-1], c1_list):
                        current.append(c1_list)
                else:
                    if len(current) >= 2:
                        segments.append(current)
                    current = [c0_list, c1_list]

        prev = point

    if len(current) >= 2:
        segments.append(current)

    return segments
