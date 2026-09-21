#!/usr/bin/env python3
"""Convert rectangular fixtures through the production stages, entirely offline."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'test/regression'))
from content_filter import PROCESS  # pyright: ignore[reportMissingImports]
from converter import map_desc

SPEC = importlib.util.spec_from_file_location('artifact_checks', str(REPO / 'test/map-content/check-regression.py'))
assert SPEC is not None and SPEC.loader is not None
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)
OUT = REPO / '.tmp/rectangular-maps'


# Resize the synthetic input bounds and feature positions, preserving fixture topology.
def fixture(width, height):
    tree = ET.parse(str(REPO / 'test/map-content/fixtures/mixed.osm'))
    root = tree.getroot()
    bounds = root.find('bounds')
    assert bounds is not None
    for axis, center, factor in [('lon', 24.002, width / 17), ('lat', 60.001, height / 17)]:
        for end in ('min', 'max'):
            key = end + axis
            bounds.set(key, str(center + (float(bounds.attrib[key]) - center) * factor))
        for node in root.findall('node'):
            node.set(axis, str(center + (float(node.attrib[axis]) - center) * factor))
    return tree, {axis + end.title(): float(bounds.attrib[end + axis])
                  for axis in ('lon', 'lat') for end in ('min', 'max')}


# Measure exported physical dimensions and marker positions without changing tactile scale.
def check_case(width, height, no_borders=False, marker_x=.75):
    name = '{}x{}{}'.format(width, height, '-borderless' if no_borders else '')
    folder = OUT / name
    folder.mkdir(exist_ok=True)
    tree, area = fixture(width, height)
    osm = folder / 'map.osm'
    tree.write(str(osm))
    request = {'printWidthCm': width, 'printHeightCm': height, 'scale': 1400,
               'printingTech': '3d', 'noBorders': no_borders, 'effectiveArea': area,
               'requestId': 'B123456789abcdef/' + name,
               'marker1': {'lon': area['lonMin'] + marker_x * (area['lonMax'] - area['lonMin']),
                           'lat': area['latMin'] + .25 * (area['latMax'] - area['latMin'])}}
    with (folder / 'conversion.log').open('w') as log, contextlib.redirect_stdout(log):
        previous_cwd = Path.cwd()
        try:
            os.chdir(str(REPO / 'converter'))
            with patch.object(PROCESS.subprocess, 'check_call',
                              side_effect=lambda cmd: subprocess.run(cmd, stdout=log, stderr=log, check=True)):
                artifacts, _, _ = PROCESS.run_osm_to_tactile(str(osm), request)
        finally:
            os.chdir(str(previous_cwd))
        map_desc.run_map_desc(artifacts['meta_raw_path'])
        PROCESS.svg_to_pdf(artifacts['svg_path'], str(folder / 'map.pdf'))
    meshes = CHECKS.measure_blend(folder, 1400)
    base = meshes['Base']
    for axis, cm in enumerate((width, height)):
        assert abs(base['max'][axis] - base['min'][axis] - cm * 10) < max(1, cm * 10 * .003), (name, base)
    assert abs(base['max'][2] - base['min'][2] - .6) < .02
    marker = meshes.get('SelectedAddress')
    if marker_x < .04:
        assert marker is None
    else:
        assert marker is not None
        for axis, fraction in enumerate((marker_x, .25)):
            actual = (marker['min'][axis] + marker['max'][axis]) / 2
            expected = base['min'][axis] + fraction * (base['max'][axis] - base['min'][axis])
            assert abs(actual - expected) < .2, (name, actual, expected)
    for filename in ('map.stl', 'map-ways.stl', 'map-rest.stl'):
        _, bounds = CHECKS.inspect_stl(folder / filename)
        if filename == 'map.stl':
            assert abs(bounds[1][0] - bounds[0][0] - width * 10) < max(1, width * 10 * .003)
            assert abs(bounds[1][1] - bounds[0][1] - height * 10) < max(1, height * 10 * .003)
    svg = ET.parse(str(folder / 'map.svg')).getroot()
    assert svg.attrib['width'] == '{:.2f}cm'.format(width)
    assert svg.attrib['height'] == '{:.2f}cm'.format(height + 1)
    box = [float(value) for value in svg.attrib['viewBox'].split()]
    assert abs((box[2] / box[3]) / (width / (height + 1)) - 1) < .003
    pdf = (folder / 'map.pdf').read_bytes()
    page = [float(value) for value in re.findall(rb'/MediaBox\s*\[([^\]]+)\]', pdf)[0].split()]
    assert abs(page[2] - width / 2.54 * 72) < .01
    assert abs(page[3] - (height + 1) / 2.54 * 72) < .01
    content = PROCESS.attach_request_metadata_to_map_content((folder / 'map-content.json').read_bytes(), request)
    (folder / 'map-content.json').write_bytes(content)
    info = PROCESS.build_info_payload(request, {})
    info.update({'addrShort': name, 'addrLong': name, 'lat': 60.001, 'lon': 24.002, 'advancedMode': True})
    (folder / 'info.json').write_text(json.dumps(info))
    assert json.loads(content)['metadata']['requestBody']['printHeightCm'] == height
    print('PASS STL, marker, SVG, PDF and metadata: ' + name)


def main():
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(OUT)], check=True)
    for width, height, borderless, marker in [(20, 10, False, .75), (10, 20, False, .75),
                                             (20, 10, True, .02), (50, 5, False, .75)]:
        check_case(width, height, borderless, marker)


if __name__ == '__main__':
    main()
