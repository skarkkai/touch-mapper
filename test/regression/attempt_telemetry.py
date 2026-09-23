"""Correlate retries, original requests, and distinct private attempt files."""
import contextlib
import datetime
import gzip
import errno
from email.message import Message
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import urllib.error
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / 'converter'))
from converter import stats_pipeline
spec = importlib.util.spec_from_file_location('process_request', str(REPO / 'converter/process-request.py'))
assert spec is not None and spec.loader is not None
worker = importlib.util.module_from_spec(spec)
with mock.patch.dict(sys.modules, {'boto3': types.ModuleType('boto3')}):
    spec.loader.exec_module(worker)


def main():
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / '.tmp'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(base)], check=True)
    with tempfile.TemporaryDirectory(prefix='attempt-telemetry-', dir=str(base)) as directory:
        root = Path(directory)
        request = {'requestId': 'B123456789abcdef/map.stl', 'contentMode': 'no-buildings',
                   'effectiveArea': {'lonMin': 1, 'latMin': 2, 'lonMax': 3, 'latMax': 4},
                   'addrLong': 'PRIVATE-REQUEST-SENTINEL'}
        original = json.dumps(request, ensure_ascii=False, separators=(',', ':'))
        exact_raw = '{  "requestId" : "B123456789abcdef/map.stl", "value": 1 }'
        message = types.SimpleNamespace(body=exact_raw, receipt_handle='fixture-receipt')
        queue = mock.Mock()
        queue.receive_messages.return_value = [message]
        sqs = mock.Mock()
        sqs.get_queue_by_name.return_value = queue
        with mock.patch.object(worker.boto3, 'resource', return_value=sqs, create=True):
            raw_seen = []
            parsed = worker.receive_sqs_msg('fixture', 30, raw_seen.append)
            assert parsed['value'] == 1 and raw_seen == [exact_raw]
            message.body = '{invalid JSON'
            try:
                worker.receive_sqs_msg('fixture', 30, raw_seen.append)
                assert False, 'invalid JSON was accepted'
            except ValueError:
                assert raw_seen[-1] == '{invalid JSON'
        malformed = worker.init_main_context()
        malformed.update(original_request_json='{invalid JSON', processing_start_time=worker.time_clock(),
                         status='failed', stats_root_dir=str(root / 'malformed-stats'))
        with mock.patch.object(worker.stats_pipeline, 'write_attempt_record', return_value='fixture-record') as write, \
                contextlib.redirect_stdout(io.StringIO()):
            worker.write_final_stats_if_possible(malformed)
        assert write.call_args.kwargs['record']['request_json'] == '{invalid JSON'
        # Fetch tests use normal mode to avoid needing a valid OSM tree.
        request['contentMode'] = 'normal'
        records = []

        def succeed_main(url, timeout, osm_path):
            Path(osm_path).write_bytes(b'<osm/>')

        output = io.StringIO()
        with mock.patch.object(worker, 'get_osm_main_api', side_effect=succeed_main) as main_api, \
                contextlib.redirect_stdout(output):
            result = worker.get_osm(request, directory, attempt_records=records)
        assert result[6] == 'main_api'
        assert [entry['status'] for entry in records] == ['success']
        assert records[0]['url'] == 'https://api.openstreetmap.org/api/0.6/map?bbox=1,2,3,4'
        main_api.assert_called_once()
        assert 'bbox=' not in output.getvalue()

        def busy_main(url, timeout, osm_path):
            raise urllib.error.HTTPError(url, 504, 'Gateway Timeout', Message(),
                                         io.BytesIO(b'SERVICE-PRIVATE-' + b'x' * 9000))

        busy_records = []
        busy_output = io.StringIO()
        with mock.patch.object(worker, 'get_osm_main_api', side_effect=busy_main), \
                contextlib.redirect_stdout(busy_output):
            try:
                worker.get_osm(request, directory, attempt_records=busy_records)
                assert False, 'gateway timeout was swallowed'
            except RuntimeError as error:
                assert isinstance(error.__cause__, urllib.error.HTTPError)
        assert len(busy_records) == 1
        assert busy_records[0]['http_status'] == 504
        assert len(busy_records[0]['response_excerpt'].encode('utf8')) == 4096
        assert 'bbox=' not in busy_output.getvalue() and 'osm_fetch_failed' in busy_output.getvalue()

        def invalid_http(url, timeout, osm_path):
            raise urllib.error.HTTPError(url, 503, 'Busy', Message(), io.BytesIO(b'\xff' * 9000))

        invalid_records = []
        with mock.patch.object(worker, 'get_osm_main_api', side_effect=invalid_http), \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                worker.get_osm(request, directory, attempt_records=invalid_records)
                assert False, 'HTTP error was swallowed'
            except RuntimeError as error:
                assert isinstance(error.__cause__, urllib.error.HTTPError)
        assert len(invalid_records[0]['response_excerpt'].encode('utf8')) <= 4096

        failed_records = []
        with mock.patch.object(worker, 'get_osm_main_api',
                               side_effect=urllib.error.URLError(OSError(errno.ENETUNREACH, 'offline'))), \
                contextlib.redirect_stdout(io.StringIO()):
            try:
                worker.get_osm(request, directory, attempt_records=failed_records)
                assert False, 'terminal OSM failure was swallowed'
            except RuntimeError as error:
                assert isinstance(error.__cause__, urllib.error.URLError)
        assert len(failed_records) == 1
        assert failed_records[0]['errno'] == errno.ENETUNREACH
        ctx = worker.init_main_context()
        ctx.update(request_body=request, original_request_json=original,
                   osm_fetch_attempts=records, request_id=request['requestId'],
                   map_id='B123456789abcdef', processing_start_time=worker.time_clock(),
                   stats_root_dir=str(root / 'stats'), status='failed')
        first = worker.build_stats_record(ctx)
        assert first['schema_version'] == 2
        assert json.loads(first['request_json'])['addrLong'] == 'PRIVATE-REQUEST-SENTINEL'
        assert json.loads(first['request_json'])['contentMode'] == 'no-buildings'
        assert len(json.loads(first['osm_fetch_attempts_json'])) == 1
        now = datetime.datetime(2026, 9, 23)
        path1 = stats_pipeline.write_attempt_record(str(root / 'stats'), first, now_utc=now)
        second = dict(first, attempt_id='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
        path2 = stats_pipeline.write_attempt_record(str(root / 'stats'), second, now_utc=now)
        assert path1 != path2 and Path(path1).exists() and Path(path2).exists()
        assert Path(path1).stat().st_mode & 0o777 == 0o600
        assert Path(path1).parent.stat().st_mode & 0o777 == 0o700
        assert (root / 'stats').stat().st_mode & 0o777 == 0o700
        assert json.loads(Path(path1).read_text())['attempt_id'] == first['attempt_id']
        legacy = Path(path1).parent / 'legacy-map.json'
        legacy.write_text(json.dumps({'schema_version': 1, 'map_id': 'legacy-map'}))
        payload, count = stats_pipeline._build_month_gzip_payload(str(root / 'stats/2026/09'))
        assert count == 3
        uploaded = [json.loads(line) for line in gzip.decompress(payload).decode('utf8').splitlines()]
        assert len(uploaded) == 3 and any(row.get('schema_version') == 1 for row in uploaded)
        # The dashboard query and renderer have no path for these private strings.
        from converter import dashboard
        query = dashboard.build_query(datetime.datetime(2026, 9, 23))
        assert 'request_json' not in query and 'osm_fetch_attempts_json' not in query
        assert 'PRIVATE-REQUEST-SENTINEL' not in query
        from converter.dashboard_html import render_report
        public = dashboard.build_report([{'kind': 'summary', 'attempts': '1',
                                          'request_json': first['request_json'],
                                          'osm_fetch_attempts_json': first['osm_fetch_attempts_json']}],
                                        'test', datetime.datetime(2026, 9, 23))
        html = render_report(public)
        assert 'PRIVATE-REQUEST-SENTINEL' not in html
        assert 'SERVICE-PRIVATE' not in html
        template = json.loads((REPO / 'install/cloudformation.json').read_text())
        columns = template['Resources']['ApplicationStatsJsonTable']['Properties']['TableInput']['StorageDescriptor']['Columns']
        names = {column['Name'] for column in columns}
        assert {'attempt_id', 'worker_name', 'poller_run_id', 'request_json',
                'osm_fetch_attempts_json'} <= names
        with mock.patch.object(worker, 'write_status_info_json'):
            failure_log = io.StringIO()
            try:
                raise RuntimeError('terminal cause sentinel')
            except RuntimeError as error:
                with contextlib.redirect_stderr(failure_log), contextlib.redirect_stdout(failure_log):
                    worker.handle_main_exception(ctx, error)
            assert 'Traceback' in failure_log.getvalue()
            assert 'terminal cause sentinel' in failure_log.getvalue()
    print('Retries, original request, and unique attempt telemetry are correlated')


if __name__ == '__main__':
    main()
