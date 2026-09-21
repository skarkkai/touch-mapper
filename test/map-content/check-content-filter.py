#!/usr/bin/env python3
"""Exercise stored-source filtering through real STL, SVG, PDF and descriptions."""
import contextlib
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'test/regression'))
from content_filter import PROCESS, Bucket  # pyright: ignore[reportMissingImports]
from converter import map_desc

SPEC = importlib.util.spec_from_file_location('artifact_checks', str(REPO / 'test/map-content/check-regression.py'))
assert SPEC is not None and SPEC.loader is not None
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)
OUT = REPO / '.tmp/filter-regression'
SOURCE_ID = 'B123456789abcdef/filter-fixture'


# Retain the input exactly as production does, with no network service involved.
def store_source(tree, name):
    path = OUT / (name + '.osm')
    tree.write(str(path))
    bucket = Bucket()
    PROCESS.store_filter_source(bucket, SOURCE_ID, str(path))
    return bucket


# Use production entry points for OSM filtering and conversion, logging each case.
def convert(bucket, name, excluded):
    folder = OUT / name
    folder.mkdir(exist_ok=True)
    request = {'contentMode': 'normal', 'filterSourceRequestId': SOURCE_ID,
               'excludedFeatures': excluded, 'scale': 1400, 'size': 17,
               'diameter': 238, 'hideLocationMarker': True}
    with (folder / 'conversion.log').open('w') as log, contextlib.redirect_stdout(log):
        osm_path = PROCESS.get_osm(request, str(folder), bucket)[0]
        previous_cwd = Path.cwd()
        try:
            os.chdir(str(REPO / 'converter'))
            with patch.object(PROCESS.subprocess, 'check_call',
                              side_effect=lambda cmd: subprocess.run(cmd, stdout=log, stderr=log, check=True)):
                artifacts, meta, _ = PROCESS.run_osm_to_tactile(osm_path, request)
        finally:
            os.chdir(str(previous_cwd))
        map_desc.run_map_desc(artifacts['meta_raw_path'])
        PROCESS.svg_to_pdf(artifacts['svg_path'], str(folder / 'map.pdf'))
    content = json.loads((folder / 'map-content.json').read_text())
    triangles, _ = CHECKS.inspect_stl(folder / 'map.stl')
    assert (folder / 'map.pdf').read_bytes().startswith(b'%PDF-')
    print('PASS conversion: ' + name, flush=True)
    return folder, meta, content, triangles


# Compare the actual printed surface at a point in converter coordinates.
def height_at(result, x, y):
    boundary = result[1]['meta']['boundary']
    return CHECKS.surface_height(result[3], (x - boundary['minX']) / 1.4,
                                (y - boundary['minY']) / 1.4)


def area_refs(result):
    return {ref for area in result[1]['areas'] for ref in area.get('filterRefs', [])}


def svg_polygons(result, fill):
    root = ET.parse(str(result[0] / 'map.svg')).getroot()
    return [polygon.attrib['points'] for group in root.iter(CHECKS.SVG_NS + 'g')
            if group.get('fill') == fill for polygon in group.findall(CHECKS.SVG_NS + 'polygon')]


def main():
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', '.tmp/filter-regression'], check=True)
    original = ET.parse(str(REPO / 'test/map-content/fixtures/mixed.osm'))
    # A second real road keeps the browser's tri-state and retry checks meaningful.
    browser = copy.deepcopy(original)
    for ident, lon in [('201', '24.0002'), ('202', '24.002'), ('203', '24.0036')]:
        ET.SubElement(browser.getroot(), 'node', id=ident, lat='60.0008', lon=lon)
    market = ET.SubElement(browser.getroot(), 'way', id='199')
    for ident in ('201', '202', '203'):
        ET.SubElement(market, 'nd', ref=ident)
    ET.SubElement(market, 'tag', k='highway', v='residential')
    ET.SubElement(market, 'tag', k='name', v='Market Street')
    bucket = store_source(browser, 'roads')
    before = convert(bucket, 'road-original', [])
    after = convert(bucket, 'road-excluded', ['way:101'])
    restored = convert(bucket, 'road-restored', [])
    assert height_at(before, -70, 0) > 1.3
    assert abs(height_at(after, -70, 0) - 0.6) < 0.02
    assert abs(height_at(restored, -70, 0) - height_at(before, -70, 0)) < 0.02
    assert '101' not in CHECKS.classification_ids(after[2])['A1_local_streets']
    assert CHECKS.classification_ids(before[2]) == CHECKS.classification_ids(restored[2])
    assert len(svg_polygons(after, 'rgb(178, 0, 0)')) < len(svg_polygons(before, 'rgb(178, 0, 0)'))

    # A road's way also supplies the geometry of a separately selected lake.
    shared = copy.deepcopy(original)
    way = shared.find("way[@id='103']")
    assert way is not None
    for tag in list(way.findall('tag')):
        way.remove(tag)
    ET.SubElement(way, 'tag', k='highway', v='residential')
    ET.SubElement(way, 'tag', k='name', v='Shore Road')
    relation = ET.SubElement(shared.getroot(), 'relation', id='500')
    ET.SubElement(relation, 'member', type='way', ref='103', role='outer')
    for key, value in [('type', 'multipolygon'), ('natural', 'water'), ('name', 'Lake')]:
        ET.SubElement(relation, 'tag', k=key, v=value)
    bucket = store_source(shared, 'shared')
    before = convert(bucket, 'shared-original', [])
    after = convert(bucket, 'shared-excluded', ['way:103'])
    assert '103' not in CHECKS.classification_ids(after[2])['A1_local_streets']
    assert '500' in CHECKS.classification_ids(after[2])['B1_other_water']
    assert svg_polygons(before, 'rgb(51, 51, 255)') == svg_polygons(after, 'rgb(51, 51, 255)')
    assert abs(height_at(before, -65, 50) - height_at(after, -65, 50)) < 0.02

    # Two generated coastal areas need independent identities and exclusions.
    coast = copy.deepcopy(original)
    for ident, lat, lon in [('900', '59.999', '24.002'), ('901', '60.003', '24.002'),
                            ('910', '60.0003', '24.0005'), ('911', '60.0007', '24.0005'),
                            ('912', '60.0007', '24.001'), ('913', '60.0003', '24.001')]:
        ET.SubElement(coast.getroot(), 'node', id=ident, lat=lat, lon=lon)
    for ident, nodes in [('900', ['900', '901']), ('910', ['910', '911', '912', '913', '910'])]:
        way = ET.SubElement(coast.getroot(), 'way', id=ident)
        for node in nodes:
            ET.SubElement(way, 'nd', ref=node)
        ET.SubElement(way, 'tag', k='natural', v='coastline')
        if ident == '900':
            ET.SubElement(way, 'tag', k='highway', v='residential')
            ET.SubElement(way, 'tag', k='name', v='Coast Road')
    bucket = store_source(coast, 'coast')
    before = convert(bucket, 'coast-original', [])
    refs = area_refs(before)
    assert len(refs) == 2, refs
    # Choose the open coastline's eastern water polygon by its spatial bounds.
    sea = next(area for area in before[1]['areas'] if area.get('filterRefs') and area['bounds']['maxX'] > 100)
    selected = sea['filterRefs'][0]
    after = convert(bucket, 'coast-one-excluded', [selected, 'way:900'])
    assert area_refs(after) == refs - {selected}
    assert '900' not in CHECKS.classification_ids(after[2])['A1_local_streets']
    assert max(height_at(before, x, y) for x in (40, 45, 50) for y in (40, 45, 50)) > 1.1
    assert max(height_at(after, x, y) for x in (40, 45, 50) for y in (40, 45, 50)) < 0.65
    assert len(svg_polygons(after, 'rgb(51, 51, 255)')) < len(svg_polygons(before, 'rgb(51, 51, 255)'))
    removed = convert(bucket, 'coast-all-excluded', sorted(refs))
    assert area_refs(removed) == set()
    restored = convert(bucket, 'coast-restored', [])
    assert area_refs(restored) == refs
    assert svg_polygons(restored, 'rgb(51, 51, 255)') == svg_polygons(before, 'rgb(51, 51, 255)')
    for result in (before, after, removed, restored):
        description_refs = {ref for sub in result[2]['B']['subclasses'] for group in sub['groups']
                            for item in group['items'] for ref in item.get('filterRefs', [])}
        assert description_refs == area_refs(result)
    print('PASS physical exclusions, retained shared boundaries, coastal identities and restoration')


if __name__ == '__main__':
    main()
