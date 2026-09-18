"""Exercise production road ranking and named-route continuity on a tiny OSM map."""
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / 'test/map-content/fixtures/big-roads.osm'


def kept_ways(work, density, source=SOURCE):
    output = work / ('{}-{}.osm'.format(source.stem, density))
    bounds = ET.parse(str(source)).getroot().find('bounds')
    assert bounds is not None
    subprocess.run([
        'node', str(REPO / 'converter/prune-only-big-roads.js'),
        '--osm', str(source), '--output', str(output),
        '--content-mode', 'only-big-roads',
        '--lon-min', bounds.attrib['minlon'], '--lon-max', bounds.attrib['maxlon'],
        '--lat-min', bounds.attrib['minlat'], '--lat-max', bounds.attrib['maxlat'],
        '--map-scale', '1400', '--print-size-cm', '17',
        '--target-road-density', str(density),
    ], cwd=str(REPO), check=True, stdout=subprocess.PIPE)
    root = ET.parse(str(output)).getroot()
    ways = {way.attrib['id']: way for way in root.findall('way')}
    nodes = {node.attrib['id'] for node in root.findall('node')}
    assert all(nd.attrib['ref'] in nodes for way in ways.values() for nd in way.findall('nd'))
    return set(ways)


def main():
    work = Path(sys.argv[1])
    assert kept_ways(work, 1) == {'201', '202', '203', '204', '205', '206', '207', '209', '210'}
    assert kept_ways(work, 0.1) == {'201', '202', '203', '204', '209', '210'}
    # Prove that 202 only survives because of continuity, not its own rank.
    tree = ET.parse(str(SOURCE))
    name = tree.getroot().find("way[@id='202']/tag[@k='name']")
    assert name is not None
    name.set('v', 'Unrelated street')
    ungrouped = work / 'ungrouped.osm'
    tree.write(str(ungrouped))
    assert '202' not in kept_ways(work, 0.1, ungrouped)
    print('Road rank pruning and complete named route passed')


if __name__ == '__main__':
    main()
