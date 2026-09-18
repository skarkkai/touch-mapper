"""Measure evaluated, transformed scene geometry in printed mm (Blender 2.78)."""
import json
import math
import sys

import bpy  # pyright: ignore[reportMissingImports]


def measure_scene(scale):
    units_to_mm = 1000.0 / scale
    results = {}
    bpy.context.scene.update()
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.to_mesh(bpy.context.scene, True, 'PREVIEW')
        try:
            vertices = [tuple(value * units_to_mm for value in obj.matrix_world * vertex.co)
                        for vertex in mesh.vertices]
            if not vertices:
                continue
            if not all(math.isfinite(value) for vertex in vertices for value in vertex):
                raise ValueError('Nonfinite geometry in ' + obj.name)
            results[obj.name] = {
                'min': [min(v[axis] for v in vertices) for axis in range(3)],
                'max': [max(v[axis] for v in vertices) for axis in range(3)],
                'zLevels': sorted(set(round(v[2], 3) for v in vertices)),
                'vertices': len(vertices), 'faces': len(mesh.polygons),
            }
        finally:
            bpy.data.meshes.remove(mesh)
    return results


if __name__ == '__main__':
    scale = float(sys.argv[sys.argv.index('--') + 1])
    print('GEOMETRY_JSON=' + json.dumps(measure_scene(scale), sort_keys=True))
