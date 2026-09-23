#!/usr/bin/env python3
"""Exercise naming, actual upstream XML filtering, and description semantics offline."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from converter.map_desc.road_names import resolve_name
from converter.map_desc.map_desc_render import _build_way_groups


def main():
    work = Path(sys.argv[1])
    cases = json.loads((REPO / 'test/regression/road_names.json').read_text())
    root = ET.Element('osm', version='0.6')
    ET.SubElement(root, 'bounds', minlat='60', maxlat='60.002', minlon='24', maxlon='24.004')
    expected = set()
    items = []
    for i, case in enumerate(cases, 1):
        assert resolve_name(case['tags']) == case['name'], case
        for offset, lon in [(0, '24.0002'), (1, '24.0038')]:
            ET.SubElement(root, 'node', id=str(i * 2 + offset), lat=str(60 + i * 0.0001), lon=lon)
        way = ET.SubElement(root, 'way', id=str(i))
        for offset in [0, 1]:
            ET.SubElement(way, 'nd', ref=str(i * 2 + offset))
        tags = dict(case['tags'], highway=['residential', 'footway', 'service'][i % 3])
        for key, value in tags.items():
            if isinstance(value, str):
                ET.SubElement(way, 'tag', k=key, v=value)
        if case['name'] is not None:
            expected.add(str(i))
        items.append({'osmId': i, 'osmType': 'way', 'tags': tags,
                      'geometry': {'type': 'line_string', 'coordinates': [[0, i], [10, i]]}})
    # Rail, water multipolygon with an unnamed highway boundary, and a building.
    for way_id, tags in [(100, {'railway': 'rail'}), (101, {'highway': 'service', 'building': 'yes'}),
                         (102, {'building': 'yes', 'name': 'Building'})]:
        way = ET.SubElement(root, 'way', id=str(way_id))
        for node in [2, 3, 5, 4, 2]:
            ET.SubElement(way, 'nd', ref=str(node))
        for key, value in tags.items():
            if isinstance(value, str):
                ET.SubElement(way, 'tag', k=key, v=value)
    relation = ET.SubElement(root, 'relation', id='200')
    ET.SubElement(relation, 'member', type='way', ref='101', role='outer')
    ET.SubElement(relation, 'tag', k='type', v='multipolygon')
    ET.SubElement(relation, 'tag', k='natural', v='water')
    source = work / 'named-roads.osm'
    ET.ElementTree(root).write(str(source), encoding='utf-8', xml_declaration=True)
    outputs = []
    for density in [1, 100]:
        output = work / ('named-{}.osm'.format(density))
        subprocess.run(['node', str(REPO / 'converter/prune-only-big-roads.js'), '--osm', str(source),
                        '--output', str(output), '--content-mode', 'only-named-roads',
                        '--lon-min', '24', '--lon-max', '24.004', '--lat-min', '60', '--lat-max', '60.002',
                        '--print-size-cm', '17', '--map-scale', '1400', '--target-road-density', str(density)], check=True)
        result = ET.parse(str(output)).getroot()
        ways = {way.attrib['id']: {t.attrib['k']: t.attrib['v'] for t in way.findall('tag')}
                for way in result.findall('way')}
        assert set(ways) == expected | {'100', '101'}, ways
        assert 'highway' not in ways['101'] and 'building' not in ways['101']
        nodes = {node.attrib['id'] for node in result.findall('node')}
        assert all(nd.attrib['ref'] in nodes for nd in result.findall('way/nd'))
        member = result.find('relation/member')
        assert member is not None and member.attrib['ref'] == '101'
        outputs.append(output.read_bytes())
    assert outputs[0] == outputs[1]
    groups = _build_way_groups(items, None, None, {}, False)
    for group in groups:
        for way in group['ways']:
            case = cases[way['osmId'] - 1]
            assert group['isNamed'] == way['isNamed'] == (case['name'] is not None)
            assert way['label'] == case['name']
    (work / 'naming-map-content.json').write_text(json.dumps({'A': {'subclasses': [{
        'key': 'A1_residential', 'name': 'Roads', 'kind': 'linear', 'groups': groups}]}}))
    subprocess.run(['node', str(REPO / 'test/regression/road_names.js'), str(work)], check=True)
    # Verify production request validation and actual subprocess dispatch, without network/AWS.
    import types
    sys.modules["boto3"] = types.ModuleType("boto3")
    spec = importlib.util.spec_from_file_location('request', str(REPO / 'converter/process-request.py'))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    request = {'contentMode': 'only-named-roads', 'size': 17, 'scale': 1400,
               'effectiveArea': {'lonMin': 24, 'lonMax': 24.004, 'latMin': 60, 'latMax': 60.002}}
    assert module.ensure_request_content_mode(request) == 'only-named-roads'
    production = work / 'production.osm'
    production.write_bytes(source.read_bytes())
    module.prune_osm_file_for_simplified_mode_with_node(str(production), request)
    assert production.read_bytes() == outputs[0]
    assert 'targetRoadDensity' not in request
    # Exercise fetch dispatch with local bytes for every mode; no network is reachable.
    def fetch_fixture(**kwargs):
        Path(kwargs['osm_path']).write_bytes(source.read_bytes())
    setattr(module, "get_osm_main_api", fetch_fixture)
    for mode in ['normal', 'no-buildings', 'only-big-roads', 'only-named-roads']:
        mode_request = dict(request, contentMode=mode, targetRoadDensity=37)
        result = module.get_osm(mode_request, str(work))
        assert result is not None
        assert ('targetRoadDensity' in mode_request) == (mode == 'only-big-roads')
        filtered = Path(result[0]).read_bytes()
        if mode == 'normal':
            assert filtered == source.read_bytes()
        elif mode == 'only-named-roads':
            assert filtered == outputs[0]
        elif mode == 'no-buildings':
            assert b'k="building"' not in filtered

    print('Named roads regression passed')


if __name__ == '__main__':
    main()
