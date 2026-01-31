# Python 3.5
from __future__ import division

from typing import List, Optional


Grid = List[List[str]]
Mask = List[List[bool]]


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


def print_canvas(canvas: Grid) -> None:
    if not canvas:
        return
    width = len(canvas[0])
    top = "+" + ("-" * width) + "+"
    print("".join(ch * 2 for ch in top))
    for row in reversed(canvas):
        line = "".join(row)
        if len(line) < width:
            line = line + (" " * (width - len(line)))
        elif len(line) > width:
            line = line[:width]
        bordered = "|" + line + "|"
        print("".join(ch * 2 for ch in bordered))
    print("".join(ch * 2 for ch in top))


def print_union_grid(mask_60: Optional[Mask], mask_120: Optional[Mask]) -> None:
    canvas = make_canvas(120)
    add_mask_60(canvas, mask_60)
    add_mask_120(canvas, mask_120)
    print_canvas(canvas)


__all__ = ["make_canvas", "add_mask_60", "add_mask_120", "print_canvas", "print_union_grid"]
