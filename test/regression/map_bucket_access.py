"""Keep map downloads public while denying anonymous bucket enumeration."""
import gzip
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import types
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'converter'))


# Exercise the worker's actual uploads without AWS or map conversion processes.
def main() -> None:
    template = json.loads((REPO / 'install/cloudformation.json').read_text())
    assert template['Resources']['MapsBucket']['Properties']['AccessControl'] == 'Private', \
        'The map bucket must not grant anonymous ListBucket access'

    work = Path(sys.argv[1]) / 'map-bucket-access'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(work)], check=True)
    osm = work / 'map.osm'
    osm.write_bytes(b'<osm version="0.6"/>')
    artifacts = {}
    for name, suffix in (('stl_path', '.stl'), ('stl_ways_path', '-ways.stl'),
                         ('stl_rest_path', '-rest.stl'), ('svg_path', '.svg'),
                         ('blend_path', '.blend'), ('meta_raw_path', '-meta-raw.json')):
        artifact = work / ('map' + suffix)
        artifact.write_bytes(b'fixture')
        artifacts[name] = str(artifact)
    (work / 'map.pdf').write_bytes(b'fixture')
    (work / 'map-content.json').write_text('{"metadata":{}}')

    spec = importlib.util.spec_from_file_location('process_request', REPO / 'converter/process-request.py')
    assert spec is not None and spec.loader is not None
    worker = importlib.util.module_from_spec(spec)
    boto = types.ModuleType('boto3')
    s3, bucket = Mock(), Mock()
    s3.Bucket.return_value = bucket
    setattr(boto, 'resource', Mock(return_value=s3))
    with patch.dict(sys.modules, {'boto3': boto}):
        spec.loader.exec_module(worker)

    request_id = 'B123456789abcdef/example'
    request = {'requestId': request_id, 'printWidthCm': 17, 'printHeightCm': 17,
               'scale': 1000, 'contentMode': 'normal'}
    with patch.dict(os.environ, {'TM_ENVIRONMENT': 'test'}), \
            patch.object(worker, 'STATS_ENABLED', False), \
            patch.object(worker, 'do_cmdline', return_value=types.SimpleNamespace(work_dir=str(work), poll_time=30)), \
            patch.object(worker, 'receive_sqs_msg', return_value=request), \
            patch.object(worker, 'get_osm', return_value=(str(osm), osm.stat().st_size,
                                                        osm.stat().st_size, None, 0, 0, 'fixture', 'fixture')), \
            patch.object(worker, 'run_osm_to_tactile', return_value=(artifacts, {'meta': {}}, {})), \
            patch.object(worker, 'run_map_desc'), patch.object(worker, 'svg_to_pdf'):
        worker.main()

    prefix = 'map/data/' + request_id
    public_keys = {'map/info/B123456789abcdef.json'} | {
        prefix + suffix for suffix in ('.map-content.json', '.stl', '.svg', '.pdf',
                                       '-ways.stl', '-rest.stl', '.blend')}
    writes = bucket.put_object.call_args_list
    assert {call.kwargs['Key'] for call in writes} == public_keys
    assert all(call.kwargs['ACL'] == 'public-read' for call in writes), \
        'Known map URLs and progress polling must remain anonymously readable'
    source_upload = bucket.upload_file.call_args
    assert source_upload.args[1] == prefix + '.osm.gz'
    assert not source_upload.kwargs.get('ExtraArgs', {}).get('ACL'), \
        'Stored OSM must retain the default private object ACL'
    assert request['contentFilterAvailable'] is True
    assert all(call.args[0] == 'test.maps.touch-mapper' for call in s3.Bucket.call_args_list)
    assert gzip.decompress(next(call.kwargs['Body'] for call in writes
                                if call.kwargs['Key'] == prefix + '.stl')) == b'fixture'
    print('Map bucket enumeration denied; public downloads and private OSM uploads preserved')


if __name__ == '__main__':
    main()
