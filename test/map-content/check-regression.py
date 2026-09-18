#!/usr/bin/env python3
"""Offline assertions on the existing map-content pipeline; no golden snapshots."""
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import zlib

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'test/map-content/out'
SVG_NS = '{http://www.w3.org/2000/svg}'
# Product expectations deliberately do not import converter height constants.
EXPECTED = {
    'mixed': {
        'classes': {'A1_local_streets': {'101'}, 'A2_footpaths_trails': {'102'},
                    'B1_other_water': {'104'}, 'C3_other_buildings': {'103'}},
        'sections': {'roads': {'101'}, 'paths': {'102'}, 'waterAreas': {'104'},
                     'buildings': {'103'}, 'railways': set()},
    },
    'no-buildings': {
        'classes': {'A1_local_streets': {'101'}, 'A2_footpaths_trails': {'102'},
                    'A3_rail_lines': {'105'}, 'B1_other_water': {'104'}},
        'sections': {'roads': {'101'}, 'paths': {'102'}, 'waterAreas': {'104'},
                     'buildings': set(), 'railways': {'105'}},
    },
    'big-roads': {
        'classes': {'A1_major_roads': {'201'}, 'A1_local_streets': {'202'},
                    'A1_secondary_roads': {'203', '204'}, 'A3_rail_lines': {'209'},
                    'A5_connectivity_nodes': {'2', '3'},
                    'B1_other_water': {'210'}},
        'sections': {'roads': {'201', '202', '203', '204'}, 'paths': set(),
                     'waterAreas': {'210'}, 'buildings': set(), 'railways': {'209'}},
    },
}


def classification_ids(content):
    return {subclass['key']: {str(item['osmId']) for group in subclass.get('groups', [])
                            for item in group.get('ways', []) + group.get('items', [])}
            for family in 'ABC' for subclass in content[family]['subclasses']
            if subclass.get('groups')}


def model_ids(model, section):
    return {item['attrs']['dataOsmId'] for item in model[section]['items']
            if 'dataOsmId' in item.get('attrs', {})}


def check_semantics(root, name):
    content = json.loads((root / 'pipeline/map-content.json').read_text())
    assert set(content) >= set('ABCDE') | {'boundary'}, name
    actual = classification_ids(content)
    assert actual == EXPECTED[name]['classes'], (name, actual)
    model_paths = sorted((root / 'descriptions').glob('*/structured.json'))
    locales = {p.parent.name for p in (REPO / 'web/locales').glob('*/tm.json')}
    assert 'en' in locales and {p.parent.name for p in model_paths} == locales, (name, model_paths)
    for model_path in model_paths:
        model = json.loads(model_path.read_text())['mapDescriptionModel']
        for section in ('roads', 'paths', 'railways', 'waterways', 'waterAreas', 'otherLinear', 'buildings'):
            assert section in model, (name, model_path, section)
            expected = EXPECTED[name]['sections'].get(section, set())
            assert model_ids(model, section) == expected, (name, model_path, section, model_ids(model, section))
    if name in ('mixed', 'no-buildings'):
        # The road/path share an OSM node: both must retain the junction event.
        for subclass in content['A']['subclasses']:
            for group in subclass.get('groups', []):
                for way in group.get('ways', []):
                    if way['osmId'] not in (101, 102):
                        continue
                    connections = [{str(c['osmId']) for c in event.get('connections', [])}
                                   for segment in way['visibleGeometry'] for event in segment['events']
                                   if event['type'] == 'junction']
                    assert {'101', '102'} in connections, (name, way['osmId'], connections)
    if name != 'mixed':
        filtered = ET.parse(str(root / 'pipeline/filtered.osm')).getroot()
        kept = {way.attrib['id'] for way in filtered.findall('way')}
        expected = {'101', '102', '104', '105'} if name == 'no-buildings' else {'201', '202', '203', '204', '209', '210'}
        assert kept == expected, (name, kept)


def inspect_stl(path):
    assert 84 < path.stat().st_size < 50_000_000, path
    data = path.read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    assert 0 < count < 1_000_000 and len(data) == 84 + count * 50, path
    triangles = []
    for index in range(count):
        values = struct.unpack_from('<12fH', data, 84 + 50 * index)
        assert all(math.isfinite(value) for value in values[:12]), path
        triangles.append(tuple(tuple(values[start:start + 3]) for start in (3, 6, 9)))
    bounds = [[func(vertex[axis] for triangle in triangles for vertex in triangle)
               for axis in range(3)] for func in (min, max)]
    return triangles, bounds


def surface_height(triangles, x, y):
    """Vertical ray against the actual STL; overlapping solids are fine."""
    heights = []
    for a, b, c in triangles:
        denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(denominator) < 1e-10:
            continue
        u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator
        v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator
        if u >= -1e-6 and v >= -1e-6 and u + v <= 1 + 1e-6:
            heights.append(u * a[2] + v * b[2] + (1 - u - v) * c[2])
    assert heights, ('Missing STL surface', x, y)
    return max(heights)


def measure_blend(pipeline, scale):
    result = subprocess.run([
        str(REPO / 'converter/blender/blender'), '-noaudio', '--factory-startup',
        '--background', str(pipeline / 'map.blend'), '--threads', '1', '--python-exit-code', '1',
        '--python', str(REPO / 'test/map-content/inspect-geometry.py'), '--', str(scale)],
        cwd=str(REPO), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        universal_newlines=True, timeout=20)
    assert result.returncode == 0, result.stdout
    lines = [line for line in result.stdout.splitlines() if line.startswith('GEOMETRY_JSON=')]
    assert len(lines) == 1, result.stdout
    return json.loads(lines[0].split('=', 1)[1])


def check_tactile(pipeline, name, request, triangles, bounds):
    meshes = measure_blend(pipeline, request['scale'])
    base = meshes['Base']
    ground = base['max'][2]
    assert abs(ground - base['min'][2] - 0.6) < 0.02, base
    for axis in (0, 1):
        expected_mm = request['size'] * 10
        assert abs(base['max'][axis] - base['min'][axis] - expected_mm) < 1, base
        assert abs(bounds[1][axis] - bounds[0][axis] - expected_mm) < 1, bounds
    assert 3 < bounds[1][2] - bounds[0][2] < 6, bounds
    profiles = {'CarRoads': 0.82, 'WaterAreas': 1.5}
    if EXPECTED[name]['sections']['paths']:
        profiles['PedestrianRoads'] = 1.5
    if EXPECTED[name]['sections']['buildings']:
        profiles['Buildings'] = 2.9
    else:
        assert 'Buildings' not in meshes, name
    if EXPECTED[name]['sections']['railways']:
        profiles['Rails'] = 0.8118
    if not EXPECTED[name]['sections']['paths']:
        assert 'PedestrianRoads' not in meshes, name
    measured_relief = {}
    for object_name, expected in profiles.items():
        mesh = meshes[object_name]
        assert mesh['vertices'] >= 4 and mesh['faces'] > 0, object_name
        relief = mesh['max'][2] - ground
        assert abs(relief - expected) < 0.08, (name, object_name, relief, expected)
        low, high = mesh['min'], mesh['max']
        if object_name == 'WaterAreas':
            # A flat slab with lots of vertices must not masquerade as waved water.
            samples = [surface_height(triangles, low[0] + (high[0] - low[0]) * x / 6,
                                      low[1] + (high[1] - low[1]) * y / 6) - ground
                       for x in range(1, 6) for y in range(1, 6)]
            assert max(samples) - min(samples) > 0.3 and max(samples) > 1.0, samples
            assert len([z for z in mesh['zLevels'] if z > ground + 0.1]) > 5, mesh
            measured_relief[object_name] = [min(samples), max(samples)]
            continue
        x, y = (low[0] + high[0]) / 2, (low[1] + high[1]) / 2
        if object_name in ('CarRoads', 'Rails'):
            x = low[0] + (high[0] - low[0]) / 4
        elif object_name == 'PedestrianRoads':
            y = low[1] + (high[1] - low[1]) / 4
        printed_relief = surface_height(triangles, x, y) - ground
        assert abs(printed_relief - expected) < 0.08, (name, object_name, printed_relief, expected)
        measured_relief[object_name] = printed_relief
    (pipeline / 'geometry-measurements.json').write_text(json.dumps({
        'baseMm': base, 'stlBoundsMm': bounds, 'reliefMm': measured_relief,
    }, indent=2) + '\n')


def check_artifacts(root, name, request):
    pipeline = root / 'pipeline'
    for filename in ('map.stl', 'map-ways.stl', 'map-rest.stl',
                     'map.svg', 'map.pdf', 'map.blend', 'map-content.json'):
        assert 100 < (pipeline / filename).stat().st_size < 50_000_000, filename
    full, bounds = inspect_stl(pipeline / 'map.stl')
    ways, _ = inspect_stl(pipeline / 'map-ways.stl')
    rest, _ = inspect_stl(pipeline / 'map-rest.stl')
    assert len(full) == len(ways) + len(rest)
    check_tactile(pipeline, name, request, full, bounds)

    svg = ET.parse(str(pipeline / 'map.svg')).getroot()
    assert svg.attrib['width'] == '17.00cm' and svg.attrib['height'] == '18.00cm'
    view_box = [float(value) for value in svg.attrib['viewBox'].split()]
    assert len(view_box) == 4 and all(math.isfinite(v) for v in view_box)
    assert view_box[2] > 0 and view_box[3] > 0
    fills = {group.get('fill') for group in svg.iter(SVG_NS + 'g') if group.findall(SVG_NS + 'polygon')}
    expected_fills = {'rgb(178, 0, 0)', 'rgb(51, 51, 255)'}  # vehicle roads and water
    if EXPECTED[name]['sections']['paths']:
        expected_fills.add('rgb(0, 0, 0)')
    if EXPECTED[name]['sections']['railways']:
        assert fills & {'rgb(0, 127, 0)', 'rgb(0, 128, 0)'}, (name, fills)
    if EXPECTED[name]['sections']['buildings']:
        expected_fills.add('rgb(204, 51, 255)')
    else:
        assert 'rgb(204, 51, 255)' not in fills
    assert expected_fills <= fills, (name, fills)
    assert any(group.findtext(SVG_NS + 'title') == 'North-east corner' and group.find(SVG_NS + 'polygon') is not None
               for group in svg.findall(SVG_NS + 'g'))
    for polygon in svg.iter(SVG_NS + 'polygon'):
        values = [float(v) for v in re.split(r'[,\s]+', polygon.attrib['points'].strip())]
        assert len(values) >= 6 and all(math.isfinite(v) for v in values)

    # CairoSVG emits a simple one-page PDF. Check page size and decode its content
    # stream without adding a PDF-library dependency for this narrow smoke check.
    pdf = (pipeline / 'map.pdf').read_bytes()
    assert pdf.startswith(b'%PDF-') and b'%%EOF' in pdf[-64:]
    boxes = re.findall(rb'/MediaBox\s*\[([^\]]+)\]', pdf)
    assert len(boxes) == 1 and re.search(rb'/Count\s+1\b', pdf)
    box = [float(v) for v in boxes[0].split()]
    assert len(box) == 4 and all(math.isfinite(v) for v in box)
    assert abs(box[2] - 17 / 2.54 * 72) < 0.1 and abs(box[3] - 18 / 2.54 * 72) < 0.1
    streams = re.findall(rb'\bstream\r?\n(.*?)\r?\nendstream', pdf, re.DOTALL)
    assert streams and len(zlib.decompress(streams[0])) > 100


def main():
    started = time.monotonic()
    subprocess.run(['node', str(REPO / 'test/map-content/run-tests.js'),
                    '--suite', 'regression-tests.json', '--all', '--offline', '--with-blender', '--jobs', '1'],
                   cwd=str(REPO), check=True, timeout=180)
    cases = json.loads((REPO / 'test/map-content/regression-tests.json').read_text())['tests']
    for case in cases:
        name = case['category'].removeprefix('regression-')
        root = OUT / case['category']
        check_semantics(root, name)
        check_artifacts(root, name, case['requestBody'])
        print('PASS semantic, tactile and printable artifacts: ' + name)
    print('Offline converter regression passed ({:.2f}s)'.format(time.monotonic() - started))


if __name__ == '__main__':
    sys.exit(main())
