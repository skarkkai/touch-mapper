"""Export asymmetric Blender meshes and check geographic SVG orientation."""
import argparse
from pathlib import Path
import runpy
import sys
import xml.etree.ElementTree as ET

import bpy  # pyright: ignore[reportMissingImports]

REPO = Path(__file__).resolve().parents[2]
WORK = Path(sys.argv[sys.argv.index('--') + 1]) / 'svg-orientation'
WORK.mkdir(exist_ok=True)
SVG_NS = '{http://www.w3.org/2000/svg}'
EXPORT = runpy.run_path(str(REPO / 'converter/obj-to-tactile.py'))['export_svg']


# Exercise real world transforms as well as every visible layer and its overlays.
def check_export(name, min_y, max_y, width, height):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    kinds = ['Road', 'Rail', 'Waterway', 'Water', 'Building']
    for index, kind in enumerate(kinds):
        mesh = bpy.data.meshes.new(kind)
        mesh.from_pydata([(0, 0, 0), (4, 0, 0), (0, -4, 0)], [], [(0, 1, 2)])
        ob = bpy.data.objects.new(kind, mesh)
        bpy.context.scene.objects.link(ob)
        ob.location = (12 + index * 8, max_y - 5, 0)
        ob.scale = (1.5, 2, 1)
    bpy.context.scene.update()
    path = WORK / name
    EXPORT(str(path), argparse.Namespace(min_x=10, max_x=70,
           min_y=min_y, max_y=max_y, print_width_cm=width, print_height_cm=height))
    root = ET.parse(str(path.with_suffix('.svg'))).getroot()
    assert root.get('width') == '%.2fcm' % width
    assert root.get('height') == '%.2fcm' % (height + 1)
    main = root.find(SVG_NS + 'g')
    assert main is not None
    # All five triangles lie near the north edge; their east-west order is preserved.
    expected = ['{0},{1} {2},{1} {0},{3}'.format(
        '%.1f' % (12 + i * 8), '%.1f' % (min_y + 5),
        '%.1f' % (18 + i * 8), '%.1f' % (min_y + 13)) for i in range(5)]
    layers = main.findall(SVG_NS + 'g')
    actual = []
    for layer in layers:
        polygon = layer.find(SVG_NS + 'polygon')
        assert polygon is not None
        actual.append(polygon.attrib['points'])
    # SVG layer order is railway, river, water, road, building, then line overlays.
    assert actual[:5] == [expected[i] for i in [1, 2, 3, 0, 4]], actual
    assert sorted(actual[5:]) == sorted(expected[:3]), actual
    clip = root.find('.//' + SVG_NS + 'clipPath/' + SVG_NS + 'rect')
    assert clip is not None and float(clip.attrib['y']) == min_y
    assert float(clip.attrib['height']) == max_y - min_y
    marker = root.findall(SVG_NS + 'g')[-1].find(SVG_NS + 'polygon')
    assert marker is not None
    marker_points = [tuple(map(float, pair.split(','))) for pair in marker.attrib['points'].split()]
    assert all(y < min_y for x, y in marker_points), marker_points
    assert max(x for x, y in marker_points) == 70
    # Export must not modify the source geometry used by STL extrusion.
    assert bpy.data.objects['Building'].location.y == max_y - 5


check_export('square', -30, 30, 17, 17)
check_export('offset-rectangle', 20, 100, 12, 16)
print('SVG layers and overlays preserve north-up orientation and the north-east marker')
