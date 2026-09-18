"""Exercise the production STL exporters with Blender 2.78 (Python 3.5)."""
import collections
import importlib.util
import os
import struct
import sys

import bpy  # pyright: ignore[reportMissingImports]


# Decode actual exported geometry independently of Blender's STL reader.
def triangles(path):
    with open(path, 'rb') as source:
        data = source.read()
    count = struct.unpack_from('<I', data, 80)[0]
    assert len(data) == 84 + count * 50
    result = collections.Counter()
    for index in range(count):
        values = struct.unpack_from('<12fH', data, 84 + index * 50)
        result[tuple(sorted(tuple(values[i:i + 3]) for i in (3, 6, 9)))] += 1
    return result


# Give each semantic object a unique triangle so membership is unambiguous.
def check_scene(exporter, work, names):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    expected_ways = collections.Counter()
    expected_rest = collections.Counter()
    for index, name in enumerate(names):
        x = float(index * 10)
        vertices = [(x, 0.0, 0.0), (x + 1.0, 0.0, 0.0), (x, 1.0, 0.0)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], [(0, 1, 2)])
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.objects.link(obj)
        target = expected_ways if name in ('TestRoads', 'TestRoadAreas', 'TestRails') else expected_rest
        target[tuple(sorted(vertices))] += 1
    bpy.context.scene.update()
    base = os.path.join(work, 'scene')
    exporter.export_stl(base, 1000)
    exporter.export_stl_separate(base, 1000)
    full = triangles(base + '.stl')
    ways = triangles(base + '-ways.stl')
    rest = triangles(base + '-rest.stl')
    assert ways == expected_ways, 'Ways export has wrong geometry: {}'.format(names)
    assert rest == expected_rest, 'Rest export has wrong geometry: {}'.format(names)
    assert full == expected_ways + expected_rest == ways + rest


# Flush traceback diagnostics before Blender's immediate error exit.
def main():
    repo, work = sys.argv[sys.argv.index('--') + 1:]
    spec = importlib.util.spec_from_file_location('tactile_exporter', os.path.join(repo, 'converter', 'obj-to-tactile.py'))
    assert spec is not None and spec.loader is not None
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    for names in [('TestRoads', 'TestRoadAreas', 'TestRails', 'Building', 'Base'),
                  ('Building', 'Base'), ('TestRoads', 'TestRoadAreas', 'TestRails')]:
        check_scene(exporter, work, names)
    print('STL partition and empty-selection checks passed')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.stderr.flush()
        sys.stdout.flush()
        raise
