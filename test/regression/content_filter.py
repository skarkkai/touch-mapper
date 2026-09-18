#!/usr/bin/env python3
"""Check that filtered reruns use stored OSM and remove selected objects upstream."""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import types
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from converter import map_desc
sys.modules['boto3'] = types.ModuleType('boto3')
SPEC = importlib.util.spec_from_file_location('process_request',
                                          str(REPO / 'converter/process-request.py'))
PROCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROCESS)


class StoredObject:
    def __init__(self, data):
        self.data = data

    def get(self):
        return {'Body': io.BytesIO(self.data)}


class Bucket:
    def __init__(self):
        self.data = None
        self.key = None

    def upload_file(self, filename, key):
        self.data = Path(filename).read_bytes()
        self.key = key

    def Object(self, key):
        self.key = key
        return StoredObject(self.data)


def main():
    work = Path(sys.argv[1])
    source = (b'<osm version="0.6">'
              b'<bounds minlat="60" minlon="24" maxlat="61" maxlon="25"/>'
              b'<node id="1" lat="60" lon="24"><tag k="amenity" v="library"/></node>'
              b'<node id="2" lat="60" lon="24.1"/>'
              b'<way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>'
              b'<way id="11"><nd ref="1"/><nd ref="2"/><tag k="building" v="yes"/>'
              b'<tag k="amenity" v="library"/></way>'
              b'<relation id="20"><member type="way" ref="10" role=""/>'
              b'<member type="way" ref="11" role=""/></relation></osm>')
    source_id = 'B123456789abcdef/example'
    original = work / 'original.osm'
    original.write_bytes(source)
    bucket = Bucket()
    PROCESS.store_filter_source(bucket, source_id, str(original))
    assert gzip.decompress(bucket.data) == source
    request = {'contentMode': 'normal', 'filterSourceRequestId': source_id,
               'excludedFeatures': ['way:10', 'poi:node:1', 'poi:way:11']}
    result = PROCESS.get_osm(request, str(work), bucket)
    assert result[6] == 'stored_map'
    assert bucket.key == 'map/data/' + source_id + '.osm.gz'
    root = ET.parse(str(work / 'map.osm')).getroot()
    assert root.find("way[@id='10']") is not None
    assert root.find("way[@id='10']/tag") is None
    assert len(root.findall("way[@id='10']/nd")) == 2
    assert root.find("way[@id='11']") is not None
    assert root.find("way[@id='11']/tag[@k='building']") is not None
    assert root.find("way[@id='11']/tag[@k='amenity']") is not None
    assert root.find("node[@id='1']") is not None
    assert root.find("node[@id='1']/tag[@k='amenity']") is not None
    relation_members = root.findall("relation[@id='20']/member")
    assert [member.get('ref') for member in relation_members] == ['10', '11']
    # Generated coastal areas are filtered during OSM2World map creation;
    # their stable references must not delete unrelated OSM relations.
    PROCESS.filter_osm_file_for_excluded_features(str(work / 'map.osm'), ['coastline:' + 'a' * 64])
    assert ET.parse(str(work / 'map.osm')).find("relation[@id='20']") is not None
    PROCESS.get_osm({'contentMode': 'normal', 'filterSourceRequestId': source_id,
                     'excludedFeatures': []}, str(work), bucket)
    restored = ET.parse(str(work / 'map.osm')).getroot()
    assert restored.find("way[@id='10']") is not None
    spec = json.loads((REPO / 'converter/map_desc/map-description-classifications.json').read_text())
    item = {'elementType': 'area', 'osmType': 'way', 'osmId': 11,
            'tags': {'amenity': 'library', 'building': 'yes'},
            'geometry': {'type': 'polygon', 'outer': [[0, 0], [1, 0], [1, 1], [0, 0]], 'holes': []},
            'bounds': {'minX': 0, 'minY': 0, 'maxX': 1, 'maxY': 1}}
    map_data = {'meta': {'boundary': {'minX': 0, 'minY': 0, 'maxX': 10, 'maxY': 10}},
                'areas': [item]}
    assert len(map_desc.group_map_data(map_data, spec)['D']) == 1
    assert len(map_desc.group_map_data(map_data, spec,
                                       excluded_poi_refs=['poi:way:11'])['D']) == 0
    subprocess.run(['node', str(REPO / 'test/regression/content_filter_model.js')], check=True)
    print('Stored OSM reuse, physical exclusion, and text-only POI filtering passed')


if __name__ == '__main__':
    main()
