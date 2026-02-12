# Python 3.5
from __future__ import division

from typing import List, Optional, Tuple

from .map_desc_loc_segments import BBox, classify_location


Grid = List[List[str]]
Mask = List[List[bool]]
BorderMap = List[List[bool]]

# fmt: off
""" Here a building is marked by * characters. This cell matrix is used for determining where the building is, its size, and rough orientation.
 +------------------------------------------------------------------------------------------------------------------------
 |                                .                                                     ..                               |
 |                                 .                                                   ..                                |
 |      north-west edge             .                                                 ..                                 |
 |                                   .                                               ..
 |                                   .                                               .
 |                                    .                                             .
 |                                     .                                           .
 |              ...........................................................................................
 |              .                        .                                       .                       ******
 |              .                         .                                     .                      **********
 |              .   north-west part        .                                   .                         **********
 |              .                           .                                 .                          ************
 |              .                            .                               ..                           .************
 |              .                             .                             ..                            .  **********
 |              .              ............................................................................  ************
 |              .              .                .                         ..               .              .    **********
 | ..           .              .                 .                       ..                .              .    **********
 |     ..       .              .                  .                     ..     north-east  .              .    **********
 |          ..  .              .                   .                   ..      near center .              .  ..**********
 |              ..             .                   .                   .                   .             ...   **********
 |              .   ..         .                    .                 .                    .         ...  .    **********
 |              .       ...    .                     .               .                     .    ....      .    **********
 |              .            ...              ...............................              ....           .
 |              .              . ..           .                             .           ....              .
 |              .              .     ..       .                             .       ...    .              .
 |              .              .          ..  .                             .  ...         .              .
 |              .              .              .                             ..             .              .
 |              .              .              .                             .              .              .
 |              .              .              .                             .              .              .
 |              .              .              .                             .              .              .
 |              .              .              .         center              .              .              .
 |              .              .              .                             .              .              .
 |              .              .              .                             .              .              .
 |              .              .             ..                             ..             .              .
 |              .              .         ...  .                             .   ..         .              .
 |              .              .    ...       .                             .        ..    .              .
 |              .              ....           .                             .            ...              .
 |              .           ....               ..............................              . ..           .
 |              .      ....    .                     .               .                     .     ...      .
 |              .  ...         .                    .                 .                    .          ..  .
 |             ...             .                   .                   .                   .              ..
 |         ...  .              .                  ..                    .                  .              .   ..
 |    ...       .              .                 ..                      .                 .              .        ..
 |...           .              .                ..                        .                .              .            ..
 |              .              .               ..                          .               .              .
 |              .              .............................................................              .
 |              .                            ..                              .                            .
 |              .                           ..                                .                           .
 |              .                           .                                 .                           .
 |              .                          .                                   .                          .
 |              .                         .                                     .                         .
 |              .                        .                                       .                        .
 |               ..........................................................................................
 |                                     .                                           .
 |                                    .                                             .
 |                                   .                                               .
 |                                  ..                                                .
 |                                 ..                                                  .
 |                                ..                                                    .                                  |
 |                               ..                                                      .                                 |
 +------------------------------------------------------------------------------------------------------------------------
"""

def make_canvas(size: int = 120) -> Grid:
    return [[" " for _ in range(size)] for _ in range(size)]


def add_mask_60(canvas: Grid, mask: Optional[Mask]) -> None:
    if not mask:
        return
    size = len(mask)
    if size != 60:
        return
    for row in range(size):
        row_data = mask[row]
        if not row_data:
            continue
        for col in range(size):
            if not row_data[col]:
                continue
            for dr in (0, 1):
                for dc in (0, 1):
                    rr = row * 2 + dr
                    cc = col * 2 + dc
                    if rr >= 120 or cc >= 120:
                        continue
                    if canvas[rr][cc] == "X":
                        continue
                    canvas[rr][cc] = "*"


def add_mask_120(canvas: Grid, mask: Optional[Mask]) -> None:
    if not mask:
        return
    size = len(mask)
    if size != 120:
        return
    for row in range(size):
        row_data = mask[row]
        if not row_data:
            continue
        for col in range(size):
            if row_data[col]:
                canvas[row][col] = "X"


def _segment_key(boundary: BBox, row: int, col: int, size: int) -> Tuple[Optional[str], Optional[str]]:
    if not boundary:
        return None, None
    dx = (boundary["maxX"] - boundary["minX"]) / size
    dy = (boundary["maxY"] - boundary["minY"]) / size
    x = boundary["minX"] + (col + 0.5) * dx
    y = boundary["minY"] + (row + 0.5) * dy
    classification = classify_location({"x": x, "y": y}, boundary)
    if not classification:
        return None, None
    loc = classification.get("loc") if isinstance(classification, dict) else None
    if not isinstance(loc, dict):
        return None, None
    return loc.get("kind"), loc.get("dir")


def _segment_borders(boundary: BBox, size: int = 120) -> BorderMap:
    borders = [[False for _ in range(size)] for _ in range(size)]
    if not boundary:
        return borders
    for row in range(size):
        for col in range(size):
            key = _segment_key(boundary, row, col, size)
            for dr, dc in ((1, 0), (0, 1)):  # north/east only for thin borders
                nr = row + dr
                nc = col + dc
                if nr < 0 or nr >= size or nc < 0 or nc >= size:
                    continue
                if _segment_key(boundary, nr, nc, size) != key:
                    borders[row][col] = True
                    break
    return borders


def _slot(mark: str, border: bool) -> str:
    first = mark if mark in ("X", "*") else " "
    second = "." if border else " "
    return first + second


def print_canvas(canvas: Grid, borders: Optional[BorderMap] = None) -> None:
    if not canvas:
        return
    width = len(canvas[0])
    top = "+" + ("-" * (width * 2)) + "+"
    print(top)
    border_rows = borders if borders is not None else [[False for _ in range(width)] for _ in range(width)]
    for row_idx in range(len(canvas) - 1, -1, -1):
        row = canvas[row_idx]
        border_row = border_rows[row_idx] if row_idx < len(border_rows) else None
        slots = []
        if len(row) < width:
            row = row + ([" "] * (width - len(row)))
        for col in range(width):
            border = False
            if border_row and col < len(border_row):
                border = border_row[col]
            slots.append(_slot(row[col], border))
        print("|" + "".join(slots) + "|")
    print(top)


def _union_mask(mask_60: Optional[Mask], mask_120: Optional[Mask]) -> Mask:
    size = 120
    filled = [[False for _ in range(size)] for _ in range(size)]
    if mask_60:
        if len(mask_60) == 60:
            for row in range(60):
                for col in range(60):
                    if not mask_60[row][col]:
                        continue
                    for dr in (0, 1):
                        for dc in (0, 1):
                            rr = row * 2 + dr
                            cc = col * 2 + dc
                            if rr < size and cc < size:
                                filled[rr][cc] = True
    if mask_120 and len(mask_120) == 120:
        for row in range(120):
            for col in range(120):
                if mask_120[row][col]:
                    filled[row][col] = True
    return filled


def print_union_grid(mask_60: Optional[Mask], mask_120: Optional[Mask], boundary: Optional[BBox]) -> None:
    canvas = make_canvas(120)
    add_mask_60(canvas, mask_60)
    add_mask_120(canvas, mask_120)
    borders = _segment_borders(boundary, 120) if boundary else None
    print_canvas(canvas, borders)


__all__ = ["make_canvas", "add_mask_60", "add_mask_120", "print_canvas", "print_union_grid"]
