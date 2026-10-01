"""Exercise height forwarding, raw omissions, persistence, and telemetry offline."""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from converter.print_heights import (normalize_print_heights, applied_print_heights,
                                    add_print_height_arguments, height_values_from_arguments)
from content_filter import PROCESS


# Exercise worker failure publication without contacting SQS, S3, or OSM.
def check_invalid_height_status(work):
    for field in ['roadHeightMm', 'pathHeightMm', 'buildingHeightMm', 'railwayHeightMm']:
        request = {'requestId': 'B123456789abcdef/heights', 'size': 17, field: None}
        ctx = PROCESS.init_main_context()
        s3 = Mock()
        bucket = s3.Bucket.return_value

        def bootstrap(context):
            context.update(args=argparse.Namespace(poll_time=30, work_dir=str(work)),
                           queue_name='test-queue', map_bucket_name='test-maps', stats_s3=s3)

        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            stack.enter_context(patch.object(PROCESS, 'init_main_context', return_value=ctx))
            stack.enter_context(patch.object(PROCESS, 'bootstrap_runtime', side_effect=bootstrap))
            stack.enter_context(patch.object(PROCESS, 'receive_sqs_msg', return_value=request))
            for name in ['init_stats_services', 'track_process_rss_kib',
                         'write_final_stats_if_possible', 'run_stats_maintenance']:
                stack.enter_context(patch.object(PROCESS, name))
            get_osm = stack.enter_context(patch.object(PROCESS, 'get_osm'))
            try:
                PROCESS.main()
            except SystemExit as error:
                assert error.code == 1
            else:
                raise AssertionError('Invalid height must fail the request')

        get_osm.assert_not_called()
        bucket.put_object.assert_called_once()
        uploaded = bucket.put_object.call_args[1]
        assert uploaded['Key'] == 'map/info/B123456789abcdef.json'
        assert uploaded['CacheControl'] == 'no-cache'
        payload = json.loads(uploaded['Body'].decode('utf8'))
        assert payload['requestId'] == request['requestId']
        assert payload['status']['progress'] == PROCESS.STATUS_PROGRESS_SEEN
        assert payload['status']['errorCode'] == 'unknown'
        assert field in payload['status']['errorDescription']


def main():
    work = Path(sys.argv[1]) / 'print-heights'
    work.mkdir()
    check_invalid_height_status(work)
    defaults = normalize_print_heights({})
    assert defaults == {'roadHeightMm': .82, 'pathHeightMm': 1.5, 'buildingHeightMm': 2.9, 'railwayHeightMm': .81}
    for value in [0, .009, .01, -.01]:
        assert applied_print_heights({key: value for key in defaults}) == dict.fromkeys(['roads', 'paths', 'buildings', 'railways'], 0)
    assert applied_print_heights({'roadHeightMm': .010001})['roads'] == .010001
    for value in [-5, .05, 50.8, 1000]:
        assert normalize_print_heights({'roadHeightMm': value})['roadHeightMm'] == value
    for value in [None, '', True, float('nan'), float('inf'), 'oops']:
        try:
            normalize_print_heights({'roadHeightMm': value})
        except (TypeError, ValueError):
            pass
        else:
            raise AssertionError(value)
    assert applied_print_heights({'roadHeightMm': 2, 'railwayHeightMm': 2})['railways'] == 1.99
    assert applied_print_heights({'roadHeightMm': 0, 'railwayHeightMm': 2})['railways'] == 2
    assert applied_print_heights({'roadHeightMm': 2, 'railwayHeightMm': 0})['railways'] == 0
    parser = argparse.ArgumentParser()
    add_print_height_arguments(parser)
    args = parser.parse_args(['--road-height-mm', '100', '--path-height-mm', '0', '--railway-height-mm', '100'])
    assert height_values_from_arguments(args)['roadHeightMm'] == 100
    request = dict(defaults, roadHeightMm=100, pathHeightMm=0, railwayHeightMm=100,
                   size=17, scale=1400, requestId='B123456789abcdef/heights')
    (work / 'map-meta-raw.json').write_text('{}')
    with patch.object(PROCESS.subprocess, 'check_call') as run:
        PROCESS.run_osm_to_tactile(str(work / 'map.osm'), request)
    command = run.call_args[0][0]
    for key, flag in [('roadHeightMm', '--road-height-mm'), ('pathHeightMm', '--path-height-mm'),
                      ('buildingHeightMm', '--building-height-mm'), ('railwayHeightMm', '--railway-height-mm')]:
        assert float(command[command.index(flag) + 1]) == request[key]
    persisted = json.loads(PROCESS.attach_request_metadata_to_map_content(
        b'{"metadata":{"printHeightsMm":{"railways":99.99}}}', request))
    assert persisted['metadata']['printHeightsMm']['railways'] == 99.99
    assert persisted['metadata']['requestBody']['pathHeightMm'] == 0
    ctx = PROCESS.init_main_context()
    ctx.update(request_body=request, request_id=request['requestId'])
    stats = PROCESS.build_stats_record(ctx)
    schema = json.loads((REPO / 'install/cloudformation.json').read_text())
    columns = schema['Resources']['ApplicationStatsJsonTable']['Properties']['TableInput']['StorageDescriptor']['Columns']
    column_names = {col['Name'] for col in columns}
    for name in ['road', 'path', 'building', 'railway']:
        assert stats[name + '_height_mm'] == request[name + 'HeightMm']
        assert name + '_height_mm' in column_names
    # Suppress the two road tiers at representation creation, including junctions.
    env = dict(os.environ, TOUCH_MAPPER_SCALE='1400', TOUCH_MAPPER_EXTRUDER_WIDTH='0.5',
               TOUCH_MAPPER_EXCLUDE_BUILDINGS='true', TOUCH_MAPPER_EXCLUDE_ROADS='true',
               TOUCH_MAPPER_EXCLUDE_PATHS='true', TOUCH_MAPPER_EXCLUDE_RAILWAYS='false')
    result = subprocess.run(['java', '-Xmx1G', '-jar', str(REPO / 'OSM2World/build/OSM2World.jar'),
                             '-i', str(REPO / 'test/map-content/fixtures/no-buildings.osm'),
                             '-o', str(work / 'map.obj')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert result.returncode == 0, result.stdout.decode()
    text = (work / 'map.obj').read_text()
    assert 'o Road' not in text and 'o Building' not in text and 'o Rail' in text
    raw = json.loads((work / 'map-meta-raw.json').read_text())
    categories = {item.get('tmCategory') for family in ['nodes', 'ways', 'areas'] for item in raw[family]}
    assert not categories.intersection({'Road', 'RoadArea', 'Building', 'BuildingEntrance'})
    assert 'Rail' in categories
    # A road junction must survive even if omitted paths originally had most branches.
    tree = ET.parse(str(REPO / 'test/map-content/fixtures/no-buildings.osm'))
    root = tree.getroot()
    for identifier, lat, lon, highway in [(50, '60.0015', '24.001', 'residential'),
                                         (51, '60.0015', '24.003', 'footway'),
                                         (52, '60.0005', '24.001', 'footway')]:
        ET.SubElement(root, 'node', id=str(identifier), version='1', lat=lat, lon=lon)
        way = ET.SubElement(root, 'way', id=str(identifier + 1000), version='1')
        ET.SubElement(way, 'nd', ref='2')
        ET.SubElement(way, 'nd', ref=str(identifier))
        ET.SubElement(way, 'tag', k='highway', v=highway)
    fixture = work / 'junction.osm'
    tree.write(str(fixture))
    env['TOUCH_MAPPER_EXCLUDE_ROADS'] = 'false'
    result = subprocess.run(['java', '-Xmx1G', '-jar', str(REPO / 'OSM2World/build/OSM2World.jar'),
                             '-i', str(fixture), '-o', str(work / 'junction.obj')],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert result.returncode == 0, result.stdout.decode()
    junction_mesh = (work / 'junction.obj').read_text()
    assert 'o RoadJunction' in junction_mesh, 'omitted paths must not suppress a retained road junction'
    assert '::pedestrian' not in '\n'.join(line for line in junction_mesh.splitlines() if line.startswith('o Road'))
    print('Height defaults, unrestricted converter values, forwarding, telemetry, and upstream omissions passed')


if __name__ == '__main__':
    main()
