# Python 3.5
from __future__ import division

import math
from typing import Any, Dict, List, Optional, Tuple

from .map_desc_loc_segments import BBox, Point, classify_location


GridCell = Tuple[int, int]
Ring = List[Tuple[float, float]]

GRID_BASE = 60
GRID_REFINED = 120

THIN_ASPECT_RATIO = 3.0
THIN_FILL_RATIO = 0.6
COMPLEX_FILL_RATIO = 0.4

ANGLE_DEGREES = (0.0, 22.5, 45.0, 67.5)
ORIENTATION_LABELS = {
    0.0: "east-west",
    90.0: "north-south",
    22.5: "east-northeast to west-southwest",
    45.0: "northeast-southwest",
    67.5: "north-northeast to south-southwest"
}

DEBUG_OSM_ID = None


def set_debug_osm_id(osm_id: Optional[int]) -> None:
    global DEBUG_OSM_ID
    DEBUG_OSM_ID = osm_id


def _coerce_point(coord: Any) -> Optional[Tuple[float, float]]:
    if not isinstance(coord, list) or len(coord) < 2:
        return None
    x = coord[0]
    y = coord[1]
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return float(x), float(y)


def _normalize_ring(coords: Any) -> Optional[Ring]:
    if not isinstance(coords, list) or len(coords) < 3:
        return None
    ring = []
    for coord in coords:
        point = _coerce_point(coord)
        if point is None:
            continue
        ring.append(point)
    if len(ring) < 3:
        return None
    if ring[0] == ring[-1]:
        ring = ring[:-1]
    return ring if len(ring) >= 3 else None


def _extract_polygon_rings(geometry: Dict[str, Any]) -> Tuple[Optional[Ring], List[Ring]]:
    outer = geometry.get("outer")
    if outer is None:
        outer = geometry.get("coordinates")
    outer_ring = _normalize_ring(outer)
    holes = []
    for hole in geometry.get("holes") or []:
        ring = _normalize_ring(hole)
        if ring:
            holes.append(ring)
    return outer_ring, holes


def _bbox_from_ring(ring: Ring) -> BBox:
    min_x = ring[0][0]
    max_x = ring[0][0]
    min_y = ring[0][1]
    max_y = ring[0][1]
    for x, y in ring[1:]:
        if x < min_x:
            min_x = x
        if x > max_x:
            max_x = x
        if y < min_y:
            min_y = y
        if y > max_y:
            max_y = y
    return {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y}


def _bbox_intersection(a: BBox, b: BBox) -> Optional[BBox]:
    min_x = max(a["minX"], b["minX"])
    min_y = max(a["minY"], b["minY"])
    max_x = min(a["maxX"], b["maxX"])
    max_y = min(a["maxY"], b["maxY"])
    if min_x > max_x or min_y > max_y:
        return None
    return {"minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y}


def _grid_index_range(clip_min: float, clip_max: float,
                      base_min: float, step: float, size: int) -> Optional[Tuple[int, int]]:
    if step <= 0:
        return None
    min_idx = int(math.ceil((clip_min - base_min) / step - 0.5))
    max_idx = int(math.floor((clip_max - base_min) / step - 0.5))
    if max_idx < 0 or min_idx > size - 1:
        return None
    if min_idx < 0:
        min_idx = 0
    if max_idx > size - 1:
        max_idx = size - 1
    if min_idx > max_idx:
        return None
    return min_idx, max_idx


def _point_in_bbox(x: float, y: float, bbox: BBox) -> bool:
    return bbox["minX"] <= x <= bbox["maxX"] and bbox["minY"] <= y <= bbox["maxY"]


def _point_in_ring(x: float, y: float, ring: Ring) -> bool:
    inside = False
    x0, y0 = ring[-1]
    for x1, y1 in ring:
        if (y1 > y) != (y0 > y):
            x_intersect = (x0 - x1) * (y - y1) / (y0 - y1) + x1
            if x < x_intersect:
                inside = not inside
        x0, y0 = x1, y1
    return inside


def _point_in_polygon(x: float, y: float,
                      outer: Ring, outer_bbox: BBox,
                      holes: List[Ring], hole_bboxes: List[BBox]) -> bool:
    # A point is inside if it is in the outer ring and not inside any hole ring.
    if not _point_in_bbox(x, y, outer_bbox):
        return False
    if not _point_in_ring(x, y, outer):
        return False
    for ring, bbox in zip(holes, hole_bboxes):
        if _point_in_bbox(x, y, bbox) and _point_in_ring(x, y, ring):
            return False
    return True


def _make_point(x: float, y: float) -> Point:
    return {"x": x, "y": y}


def _segment_key(point: Point, boundary: BBox) -> Tuple[str, Optional[str], str]:
    classification = classify_location(point, boundary)
    if not classification:
        return "unknown", None, "unknown"
    zone = classification.get("zone") or "unknown"
    direction = classification.get("dir")
    phrase = classification.get("phrase") or "unknown"
    return zone, direction, phrase


def _rasterize_polygon(outer: Ring, holes: List[Ring],
                       boundary: BBox, clip_bbox: BBox,
                       grid_size: int,
                       debug: bool = False,
                       debug_tag: str = "") -> Dict[str, Any]:
    dx = (boundary["maxX"] - boundary["minX"]) / grid_size
    dy = (boundary["maxY"] - boundary["minY"]) / grid_size
    if dx <= 0 or dy <= 0:
        return {
            "gridSize": grid_size,
            "insideCells": 0,
            "consideredCount": 0,
            "trueCells": [],
            "mask": [],
            "segments": [],
            "components": [],
            "edgesTouched": [],
            "componentCount": 0
        }

    col_range = _grid_index_range(clip_bbox["minX"], clip_bbox["maxX"],
                                  boundary["minX"], dx, grid_size)
    row_range = _grid_index_range(clip_bbox["minY"], clip_bbox["maxY"],
                                  boundary["minY"], dy, grid_size)
    if not col_range or not row_range:
        return {
            "gridSize": grid_size,
            "insideCells": 0,
            "consideredCount": 0,
            "trueCells": [],
            "mask": [],
            "segments": [],
            "components": [],
            "edgesTouched": [],
            "componentCount": 0
        }

    min_col, max_col = col_range
    min_row, max_row = row_range

    outer_bbox = _bbox_from_ring(outer)
    hole_bboxes = [_bbox_from_ring(hole) for hole in holes]
    if debug:
        print("[areas_raster] {} grid={} dx={:.3f} dy={:.3f}".format(debug_tag, grid_size, dx, dy))
        print("[areas_raster] {} clip rows {}..{} cols {}..{}".format(
            debug_tag, min_row, max_row, min_col, max_col
        ))
        print("[areas_raster] {} outer_bbox={}".format(debug_tag, outer_bbox))
        print("[areas_raster] {} holes={}".format(debug_tag, len(holes)))

    mask = [[False for _ in range(grid_size)] for _ in range(grid_size)]
    true_cells = []  # type: List[GridCell]
    segment_counts = {}  # type: Dict[Tuple[str, Optional[str], str], int]
    considered_count = 0
    inside_count = 0
    edge_hits = {
        "north": set(),
        "south": set(),
        "east": set(),
        "west": set()
    }

    for row in range(min_row, max_row + 1):
        y = boundary["minY"] + (row + 0.5) * dy
        for col in range(min_col, max_col + 1):
            x = boundary["minX"] + (col + 0.5) * dx
            considered_count += 1
            # Cell is "inside" only if the center point is inside the outer ring
            # and not inside any hole ring.
            if not _point_in_polygon(x, y, outer, outer_bbox, holes, hole_bboxes):
                continue
            mask[row][col] = True
            true_cells.append((row, col))
            inside_count += 1
            if row == 0:
                edge_hits["south"].add(col)
            if row == grid_size - 1:
                edge_hits["north"].add(col)
            if col == 0:
                edge_hits["west"].add(row)
            if col == grid_size - 1:
                edge_hits["east"].add(row)
            seg_key = _segment_key(_make_point(x, y), boundary)
            segment_counts[seg_key] = segment_counts.get(seg_key, 0) + 1

    segments = []
    if inside_count:
        for (zone, direction, phrase), count in segment_counts.items():
            segments.append({
                "zone": zone,
                "dir": direction,
                "phrase": phrase,
                "insideCount": count
            })
        segments.sort(key=lambda entry: (-entry["insideCount"], entry.get("phrase") or ""))
    if debug:
        top_segments = [
            "{}:{}={}".format(seg.get("zone"), seg.get("dir"), seg.get("insideCount"))
            for seg in segments[:5]
        ]
        print("[areas_raster] {} insideCells={} consideredCells={}".format(
            debug_tag, inside_count, considered_count
        ))
        print("[areas_raster] {} segments(top5)={}".format(debug_tag, top_segments))

    components = []
    edges_touched = set()
    if true_cells:
        visited = set()
        for cell in true_cells:
            if cell in visited:
                continue
            stack = [cell]
            visited.add(cell)
            count = 0
            sum_x = 0.0
            sum_y = 0.0
            edges = set()
            while stack:
                row, col = stack.pop()
                count += 1
                sum_x += boundary["minX"] + (col + 0.5) * dx
                sum_y += boundary["minY"] + (row + 0.5) * dy
                if row == 0:
                    edges.add("south")
                if row == grid_size - 1:
                    edges.add("north")
                if col == 0:
                    edges.add("west")
                if col == grid_size - 1:
                    edges.add("east")
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nr = row + dr
                    nc = col + dc
                    if nr < 0 or nr >= grid_size or nc < 0 or nc >= grid_size:
                        continue
                    if not mask[nr][nc]:
                        continue
                    neighbor = (nr, nc)
                    if neighbor in visited:
                        continue
                    visited.add(neighbor)
                    stack.append(neighbor)
            centroid = _make_point(sum_x / count, sum_y / count)
            location = classify_location(centroid, boundary)
            edges_touched.update(edges)
            components.append({
                "cellCount": count,
                "centroid": centroid,
                "location": location,
                "touchesEdge": bool(edges),
                "edges": sorted(edges)
            })

    if components:
        components.sort(key=lambda entry: -entry.get("cellCount", 0))
    edges_percent = []
    if grid_size > 0:
        for edge in ("north", "east", "south", "west"):
            hit_count = len(edge_hits.get(edge, []))
            if hit_count:
                percent = round(100.0 * hit_count / grid_size, 1)
                edges_percent.append({edge: percent})
    if debug:
        print("[areas_raster] {} components={} edgesTouched={}".format(
            debug_tag, len(components), sorted(edges_touched)
        ))

    return {
        "gridSize": grid_size,
        "insideCells": inside_count,
        "consideredCount": considered_count,
        "trueCells": true_cells,
        "mask": mask,
        "segments": segments,
        "components": components,
        "edgesTouched": edges_percent,
        "componentCount": len(components)
    }


def _shape_from_cells(cells: List[GridCell]) -> Optional[Dict[str, Any]]:
    if not cells:
        return None
    points = []
    min_x = None
    max_x = None
    min_y = None
    max_y = None
    for row, col in cells:
        x = col + 0.5
        y = row + 0.5
        points.append((x, y))
        if min_x is None or x < min_x:
            min_x = x
        if max_x is None or x > max_x:
            max_x = x
        if min_y is None or y < min_y:
            min_y = y
        if max_y is None or y > max_y:
            max_y = y
    area_cells = float(len(points))

    best = None
    for angle in ANGLE_DEGREES:
        rad = math.radians(angle)
        ux = math.cos(rad)
        uy = math.sin(rad)
        vx = -uy
        vy = ux
        min_u = None
        max_u = None
        min_v = None
        max_v = None
        for x, y in points:
            proj_u = x * ux + y * uy
            proj_v = x * vx + y * vy
            if min_u is None or proj_u < min_u:
                min_u = proj_u
            if max_u is None or proj_u > max_u:
                max_u = proj_u
            if min_v is None or proj_v < min_v:
                min_v = proj_v
            if max_v is None or proj_v > max_v:
                max_v = proj_v
        if min_u is None or min_v is None or max_u is None or max_v is None:
            continue
        span_u = (max_u - min_u) + 1.0
        span_v = (max_v - min_v) + 1.0
        if span_u <= 0 or span_v <= 0:
            continue
        rect_area = span_u * span_v
        fill_ratio = area_cells / rect_area
        aspect_ratio = max(span_u, span_v) / max(1e-9, min(span_u, span_v))
        entry = {
            "angle": angle,
            "fillRatio": fill_ratio,
            "aspectRatio": aspect_ratio
        }
        if best is None:
            best = entry
        else:
            if fill_ratio > best["fillRatio"] + 1e-6:
                best = entry
            elif abs(fill_ratio - best["fillRatio"]) <= 1e-6 and aspect_ratio > best["aspectRatio"]:
                best = entry

    if not best:
        return None
    fill_ratio = best["fillRatio"]
    aspect_ratio = best["aspectRatio"]
    angle = best["angle"]
    orientation_deg = angle
    orientation_label = ORIENTATION_LABELS.get(angle)
    if angle == 0.0 and min_x is not None and max_x is not None and min_y is not None and max_y is not None:
        span_x = max_x - min_x
        span_y = max_y - min_y
        if span_y > span_x and aspect_ratio > 1.05:
            orientation_deg = 90.0
            orientation_label = ORIENTATION_LABELS.get(orientation_deg)
    result = {
        "orientationDeg": orientation_deg,
        "orientationLabel": orientation_label,
        "fillRatio": round(fill_ratio, 3),
        "aspectRatio": round(aspect_ratio, 3)
    }
    if fill_ratio >= THIN_FILL_RATIO and aspect_ratio >= THIN_ASPECT_RATIO:
        result["type"] = "thin"
    elif fill_ratio <= COMPLEX_FILL_RATIO:
        result["type"] = "complex"
    else:
        result["type"] = "regular"
    return result


def _tidy_segment_phrase(phrase: Optional[str]) -> str:
    if not phrase or not isinstance(phrase, str):
        return ""
    cleaned = phrase.strip()
    for prefix in ("near the ", "in the ", "a little "):
        if cleaned.lower().startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    suffix = " of the map"
    if cleaned.lower().endswith(suffix):
        cleaned = cleaned[:-len(suffix)]
    return cleaned.strip()


def _coverage_breakdown_text(segments: List[Dict[str, Any]],
                             total_inside: int,
                             total_cells: int) -> Tuple[Optional[str], List[str]]:
    if not segments or total_inside <= 0:
        return None, []
    ordered = [seg for seg in segments if isinstance(seg, dict) and isinstance(seg.get("insideCount"), (int, float))]
    if not ordered:
        return None, []
    ordered.sort(key=lambda entry: -entry.get("insideCount", 0))
    phrases = []
    percents = []
    for segment in ordered:
        inside_count = float(segment.get("insideCount", 0))
        if inside_count <= 0:
            continue
        ratio = inside_count / float(total_inside)
        if ratio >= 0.5:
            qualifier = "much of"
        elif ratio >= 0.2:
            qualifier = "some of"
        else:
            qualifier = "a little of"
        raw_phrase = segment.get("phrase") or segment.get("dir") or segment.get("zone") or ""
        segment_text = _tidy_segment_phrase(raw_phrase) or raw_phrase
        phrases.append("{} {}".format(qualifier, segment_text))
        percent = 0.0
        if total_cells > 0:
            percent = round(100.0 * inside_count / float(total_cells), 1)
        percents.append("{}={:.1f}%".format(segment_text, percent))
    if not phrases:
        return None, []
    if len(phrases) == 1:
        summary = phrases[0]
    elif len(phrases) == 2:
        summary = phrases[0] + " and " + phrases[1]
    else:
        summary = ", ".join(phrases[:-1]) + ", and " + phrases[-1]
    return summary, percents


def analyze_area_visibility(geometry: Dict[str, Any],
                            boundary: Optional[BBox],
                            osm_id: Optional[Any] = None) -> Optional[Dict[str, Any]]:
    debug = False
    debug_tag = ""
    osm_id_num = None
    if osm_id is not None:
        try:
            osm_id_num = int(osm_id)
        except (TypeError, ValueError):
            osm_id_num = None
    if DEBUG_OSM_ID is not None and osm_id_num == DEBUG_OSM_ID:
        debug = True
        debug_tag = "osmId={}".format(osm_id_num)
    outer, holes = _extract_polygon_rings(geometry)
    if not outer or not boundary:
        return None
    if debug:
        print("[areas_raster] {} start outer_points={} holes={}".format(
            debug_tag, len(outer), len(holes)
        ))
        print("[areas_raster] {} boundary={}".format(debug_tag, boundary))

    outer_bbox = _bbox_from_ring(outer)
    clip_bbox = _bbox_intersection(outer_bbox, boundary)
    if not clip_bbox:
        return {
            "coverage": {
                "coveragePercent": 0.0,
                "insideCells": 0,
                "consideredCells": 0,
                "gridSize": GRID_BASE,
                "segments": []
            },
            "edgesTouched": [],
            "components": []
        }
    if debug:
        print("[areas_raster] {} outer_bbox={}".format(debug_tag, outer_bbox))
        print("[areas_raster] {} clip_bbox={}".format(debug_tag, clip_bbox))

    analysis_60 = _rasterize_polygon(
        outer, holes, boundary, clip_bbox, GRID_BASE,
        debug=debug, debug_tag=debug_tag + ":60"
    )
    analysis = analysis_60
    refined_from = None
    analysis_120 = None
    if analysis_60.get("componentCount", 0) > 1:
        analysis_120 = _rasterize_polygon(
            outer, holes, boundary, clip_bbox, GRID_REFINED,
            debug=debug, debug_tag=debug_tag + ":120"
        )
        if analysis_120.get("insideCells", 0) > 0:
            analysis = analysis_120
            refined_from = GRID_BASE

    inside_count = analysis.get("insideCells", 0)
    grid_size = analysis.get("gridSize", GRID_BASE)
    total_cells = grid_size * grid_size if grid_size else 0
    coverage_percent = 0.0
    if total_cells > 0:
        coverage_percent = round(100.0 * inside_count / total_cells, 1)
        if coverage_percent < 0:
            coverage_percent = 0.0
        if coverage_percent > 100:
            coverage_percent = 100.0
    if debug:
        print("[areas_raster] {} gridSize={} insideCells={} coveragePercent={}".format(
            debug_tag, grid_size, inside_count, coverage_percent
        ))
        coverage_summary, coverage_percents = _coverage_breakdown_text(
            analysis.get("segments", []), inside_count, total_cells
        )
        if coverage_summary:
            print("[areas_raster] {} coverageSegments={}".format(debug_tag, coverage_summary))
        if coverage_percents:
            print("[areas_raster] {} coverageSegmentsPercent={}".format(debug_tag, coverage_percents))
        if refined_from:
            print("[areas_raster] {} refinedFrom={}".format(debug_tag, refined_from))

    shape = _shape_from_cells(analysis_60.get("trueCells") or [])
    if debug:
        print("[areas_raster] {} shape={}".format(debug_tag, shape))

    coverage = {
        "coveragePercent": coverage_percent,
        "insideCells": inside_count,
        "consideredCells": analysis.get("consideredCount", 0),
        "gridSize": grid_size,
        "segments": analysis.get("segments", [])
    }
    result = {
        "coverage": coverage,
        "edgesTouched": analysis.get("edgesTouched", []),
        "components": analysis.get("components", [])
    }
    if refined_from:
        result["refinedFrom"] = refined_from
    if shape:
        result["shape"] = shape
        result["shapeGridSize"] = GRID_BASE

    if debug:
        from .areas_raster_debug import print_union_grid
        mask_60 = analysis_60.get("mask")
        mask_120 = None
        if analysis is analysis_120:
            mask_120 = analysis_120.get("mask") if analysis_120 else None
        print_union_grid(mask_60, mask_120, boundary)
    return result


__all__ = ["analyze_area_visibility"]
