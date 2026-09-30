#!/usr/bin/env python3
"""Exercise the API node limit through fetch, status, and private telemetry."""
import contextlib
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import urllib.error
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'converter'))
spec = importlib.util.spec_from_file_location('process_request', str(REPO / 'converter/process-request.py'))
assert spec is not None and spec.loader is not None
worker = importlib.util.module_from_spec(spec)
with mock.patch.dict(sys.modules, {'boto3': types.ModuleType('boto3')}):
    spec.loader.exec_module(worker)

request = {'requestId': 'B123456789abcdef/test', 'contentMode': 'normal',
           'effectiveArea': {'lonMin': 1, 'latMin': 2, 'lonMax': 3, 'latMax': 4}}
work = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='osm-node-limit-', dir=str(work)) as directory:
    records = []
    api_text = b'You requested too many nodes (limit is 50000). Either request a smaller area, or use planet.osm'

    def node_limit(url, timeout, osm_path):
        raise urllib.error.HTTPError(url, 400, 'Bad Request', Message(), io.BytesIO(api_text))

    with mock.patch.object(worker, 'get_osm_main_api', side_effect=node_limit) as fetch, \
            contextlib.redirect_stdout(io.StringIO()):
        try:
            worker.get_osm(request, directory, attempt_records=records)
        except worker.RequestProcessingError as error:
            assert error.code == 'too_many_nodes'
            assert 'smaller area' in error.description
            assert isinstance(error.__cause__, urllib.error.HTTPError)
            node_error = error
        else:
            raise AssertionError('node limit was reported as a generic fetch failure')
    fetch.assert_called_once()
    assert len(records) == 1
    assert records[0]['status'] == 'failed' and records[0]['http_status'] == 400
    assert records[0]['response_excerpt'] == api_text.decode('utf8')

    # Content modes are applied only after the full API download.
    simplified = dict(request, contentMode='only-big-roads')
    simplified_records = []
    with mock.patch.object(worker, 'get_osm_main_api', side_effect=node_limit) as simplified_fetch, \
            contextlib.redirect_stdout(io.StringIO()):
        try:
            worker.get_osm(simplified, directory, attempt_records=simplified_records)
        except worker.RequestProcessingError as error:
            assert error.code == 'too_many_nodes'
        else:
            raise AssertionError('simplified content mode bypassed the node limit')
    assert simplified_fetch.call_args.kwargs['url'] == fetch.call_args.kwargs['url']
    assert simplified_records[0]['http_status'] == 400

    ctx = worker.init_main_context()
    ctx.update(request_body=request, original_request_json=json.dumps(request),
               request_id=request['requestId'], current_stage='get-osm',
               osm_fetch_attempts=records, processing_start_time=worker.time_clock())
    with mock.patch.object(worker, 'write_status_info_json') as write_status, \
            contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        worker.handle_main_exception(ctx, node_error)
    assert ctx['error_code'] == 'too_many_nodes' and ctx['status'] == 'failed'
    assert write_status.call_args.kwargs['error_code'] == 'too_many_nodes'
    saved = worker.build_stats_record(ctx)
    assert saved['error_code'] == 'too_many_nodes' and saved['failure_stage'] == 'get-osm'
    assert json.loads(saved['osm_fetch_attempts_json'])[0]['response_excerpt'] == api_text.decode('utf8')

    def invalid_bounds(url, timeout, osm_path):
        raise urllib.error.HTTPError(url, 400, 'Bad Request', Message(),
                                     io.BytesIO(b'The latitudes must be between -90 and 90.'))

    with mock.patch.object(worker, 'get_osm_main_api', side_effect=invalid_bounds), \
            contextlib.redirect_stdout(io.StringIO()):
        try:
            worker.get_osm(request, directory, attempt_records=[])
        except RuntimeError as error:
            assert isinstance(error.__cause__, urllib.error.HTTPError)
        else:
            raise AssertionError('unrelated HTTP 400 was misclassified')
print('OSM node limit publishes too_many_nodes status and retains HTTP detail in private telemetry')
