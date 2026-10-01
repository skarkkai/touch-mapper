#!/usr/bin/env python3
"""A featureless OSM area must become a printable tile with an empty description."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
WORK = Path(sys.argv[1]) / 'empty-map'
WORK.mkdir()
sys.path.insert(0, str(REPO / 'converter'))
import map_desc  # noqa: E402


def triangle_count(path):
    data = path.read_bytes()
    assert len(data) >= 84, path
    count = struct.unpack_from('<I', data, 80)[0]
    assert len(data) == 84 + count * 50, path
    return count


root = ET.Element('osm', version='0.6', generator='TouchMapperRegression')
ET.SubElement(root, 'bounds', minlat='59.999931894901', maxlat='60.00206810509899',
              minlon='23.99986731834711', maxlon='24.004132681652887')
ET.SubElement(root, 'node', id='1', version='1', lat='60.001', lon='24.002')
source = WORK / 'map.osm'
ET.ElementTree(root).write(str(source), encoding='utf-8', xml_declaration=True)
with (WORK / 'conversion.log').open('w') as log:
    subprocess.run([sys.executable, str(REPO / 'converter/osm-to-tactile.py'),
                    str(source), '--scale', '1400', '--print-width-cm', '17',
                    '--print-height-cm', '17', '--no-borders'],
                   cwd=str(REPO), stdout=log, stderr=subprocess.STDOUT, check=True)
assert json.loads((WORK / 'map-clip-report.json').read_text())['files'] == []
assert triangle_count(WORK / 'map.stl') == 12
assert triangle_count(WORK / 'map-ways.stl') == 0
assert triangle_count(WORK / 'map-rest.stl') == 12
assert (WORK / 'map.svg').is_file()
map_desc.run_map_desc(str(WORK / 'map-meta-raw.json'))
content = json.loads((WORK / 'map-content.json').read_text())
assert all(not group['items'] for section in content.values()
           if isinstance(section, dict) for subclass in section.get('subclasses', [])
           for group in subclass.get('groups', []))
# An absent or malformed file list is a failed clip, not a valid empty tile.
spec = importlib.util.spec_from_file_location('osm_to_tactile', str(REPO / 'converter/osm-to-tactile.py'))
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class MalformedClip:
    def __init__(self, report):
        self.report = report

    def run_subprocess(self, _command, depth_offset=0):
        (WORK / 'map-clip-report.json').write_text(json.dumps(self.report))
        return {}


for bad_report in ({}, {'files': [{}]}):
    try:
        converter.run_clip_2d(str(WORK / 'map.obj'),
                              {'minX': 0, 'minY': 0, 'maxX': 1, 'maxY': 1},
                              MalformedClip(bad_report))
    except Exception:
        pass
    else:
        raise AssertionError('Malformed clip report accepted as an empty map')
print('Featureless OSM produces a printable borderless base and empty map content')
