#!/usr/bin/env python3
"""Check converter roundabout identity and its actual localized UI description."""
import json
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from converter.map_desc.map_desc_render import (
    _build_connections_index, _build_connectors_by_coord_key,
    _collect_inferred_named_connectors, _build_way_groups)


def way(osm_id, coords, name=None, roundabout=False):
    tags = {'highway': 'secondary'}
    if name:
        tags['name'] = name
    if roundabout:
        tags['junction'] = 'roundabout'
    return {'osmId': osm_id, 'osmType': 'way', 'tags': tags,
            '_classification': {'subClass': 'A1_secondary_roads'},
            'geometry': {'type': 'line_string', 'coordinates': coords},
            'visibleGeometry': [coords]}


def main():
    # One ring split into three ways, two approaches, and a separate named street
    # joining only the second approach. Connector nodes deliberately absent.
    ring = [way(10, [[0, 0], [10, 0]], roundabout=True),
            way(11, [[10, 0], [5, 10]], roundabout=True),
            way(12, [[5, 10], [0, 0]], roundabout=True)]
    roads = [way(1, [[-10, 0], [0, 0]], 'First Road'),
             way(2, [[20, 0], [10, 0]], 'Second Road'),
             way(3, [[20, 0], [20, -10]], 'Side Street')]
    # Another ring connected by an ordinary road must keep a separate identity.
    other = way(20, [[30, 0], [40, 0], [35, 10], [30, 0]], roundabout=True)
    bridge = way(4, [[5, 10], [30, 0]], 'Bridge Road')
    items = ring + roads + [other, bridge]
    grouped = {'A': {'roads': items}}
    index = _build_connections_index(grouped)
    records = {feature['osmId']: feature for values in index.values() for feature in values}
    identity = records[10]['roundabout']
    assert all(records[i]['roundabout'] == identity for i in [10, 11, 12])
    assert identity['name'] is None
    assert records[20]['roundabout']['id'] != identity['id']
    assert all('roundabout' not in records[i] for i in [1, 2, 3, 4])
    reordered = _build_connections_index({'A': {'roads': list(reversed(items))}})
    assert {f['osmId']: f for values in reordered.values() for f in values} == records

    # Clipping may separate the visible arcs; their source topology still
    # identifies one roundabout, without exposing clipped-away junctions.
    ring[0]['visibleGeometry'] = [[[1, 0], [9, 0]]]
    clipped = _build_connections_index(grouped)
    assert all(f['roundabout'] == identity for values in clipped.values()
               for f in values if f['osmId'] in [10, 11, 12])
    assert not any(f['osmId'] == 10 for f in clipped.get('0.000,0.000', []))
    ring[0]['visibleGeometry'] = [ring[0]['geometry']['coordinates']]

    # A genuine roundabout name can be carried on just one constituent way.
    ring[0]['tags']['name'] = 'Central Circle'
    named = _build_connections_index(grouped)
    assert all(f['roundabout']['name'] == 'Central Circle' for values in named.values()
               for f in values if f['osmId'] in [10, 11, 12])
    del ring[0]['tags']['name']

    connectors = _build_connectors_by_coord_key(_collect_inferred_named_connectors(index))
    groups = _build_way_groups(items, None, connectors, index, True)
    first = next(group for group in groups if group['label'] == 'First Road')
    contacts = [contact for bucket in first['visibleGeometry'] for segment in bucket['segments']
                for event in segment['events'] for contact in event.get('connections', [])]
    assert {contact['osmId'] for contact in contacts} == {1, 10, 12}
    assert sum(bool(contact.get('roundabout')) for contact in contacts) == 2
    output = Path(sys.argv[1]) / 'roundabout-connections.json'
    output.write_text(json.dumps({'A': {'subclasses': [{
        'key': 'A1_secondary_roads', 'kind': 'linear', 'groups': groups}]}}))
    subprocess.run(['node', str(REPO / 'test/regression/roundabout_connections.js'), str(output)], check=True)


if __name__ == '__main__':
    main()
