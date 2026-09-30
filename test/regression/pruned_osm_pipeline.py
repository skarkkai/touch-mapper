#!/usr/bin/env python3
"""Verify pruned maps render and failed reads cannot reuse a prior map."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
WORK = Path(sys.argv[1])
sys.path.insert(0, str(REPO / 'converter'))

spec = importlib.util.spec_from_file_location('osm_to_tactile', str(REPO / 'converter/osm-to-tactile.py'))
assert spec is not None and spec.loader is not None
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)
telemetry = converter.TelemetryLogger(component='pruned-osm-regression')

source = WORK / 'pruned-source.osm'
root = ET.parse(str(REPO / 'test/map-content/fixtures/big-roads.osm')).getroot()
relation = ET.SubElement(root, 'relation', id='300')
ET.SubElement(relation, 'member', type='way', ref='210', role='outer')
ET.SubElement(relation, 'tag', k='type', v='multipolygon')
ET.SubElement(relation, 'tag', k='natural', v='water')
ET.ElementTree(root).write(str(source), encoding='utf-8', xml_declaration=True)

for mode in ('only-big-roads', 'only-named-roads'):
    pruned = WORK / (mode + '.osm')
    subprocess.run([
        'node', str(REPO / 'converter/prune-only-big-roads.js'),
        '--osm', str(source), '--output', str(pruned), '--content-mode', mode,
        '--lon-min', '23.99986731834711', '--lon-max', '24.004132681652887',
        '--lat-min', '59.999931894901', '--lat-max', '60.00206810509899',
        '--map-scale', '1400', '--print-size-cm', '17',
    ], cwd=str(REPO), check=True, stdout=subprocess.PIPE)
    pruned_root = ET.parse(str(pruned)).getroot()
    assert pruned_root.find('way') is not None, mode
    assert pruned_root.find('relation') is not None, mode
    for tag in ('node', 'way', 'relation'):
        elements = pruned_root.findall(tag)
        assert elements and all(element.get('version') == '1' for element in elements), (mode, tag)

    output = WORK / 'map.obj'
    converter.run_osm2world(str(pruned), str(output), 1400, False, telemetry)
    assert output.is_file() and output.stat().st_size > 0, mode
    assert (WORK / 'map-meta-raw.json').is_file(), mode

# A failed source read must clear both outputs from the preceding conversion.
invalid = WORK / 'unversioned.osm'
invalid.write_text('<osm version="0.6"><node id="1" lat="60" lon="24"/></osm>')
output = WORK / 'map.obj'
assert output.exists() and (WORK / 'map-meta-raw.json').exists()
try:
    converter.run_osm2world(str(invalid), str(output), 1400, False, telemetry)
except subprocess.CalledProcessError:
    pass
else:
    raise AssertionError('unversioned OSM unexpectedly rendered')
assert not output.exists(), 'prior OBJ survived failed conversion'
assert not (WORK / 'map-meta-raw.json').exists(), 'prior metadata survived failed conversion'
print('Pruned OSM renders; failed reader cannot reuse prior geometry or metadata')
