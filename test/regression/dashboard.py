"""Exercise aggregate mapping and AWS publication boundaries without network access."""
import datetime
import fnmatch
import contextlib
import io
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest import mock
from typing import Any, Dict

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'converter'))
sys.path.insert(0, str(REPO))
from converter import dashboard as publisher
from converter.dashboard_html import render_report
from aws_runtime import check_bundled_sdk

NOW = datetime.datetime(2026, 3, 1, 0, 15)
COLUMNS = ('kind', 'period', 'label', 'attempts', 'successes', 'errors', 'unique_users', 'p50', 'p95', 'maximum')
FIXTURE = REPO / 'test/regression/fixtures/dashboard-athena.json'


# Model Athena's real header, null-cell, pagination and terminal-state protocol.
class Athena:
    def __init__(self, rows, events, state='SUCCEEDED', environment='test'):
        self.rows, self.events, self.state = rows, events, state
        self.environment = environment

    def start_query_execution(self, **kwargs):
        self.events.append('start')
        assert kwargs['QueryExecutionContext']['Database'] == 'touch_mapper_stats_' + self.environment
        assert "DATE '2026-03-01'" in kwargs['QueryString']
        return {'QueryExecutionId': 'private-query-id'}

    def get_query_execution(self, **kwargs):
        self.events.append('status')
        return {'QueryExecution': {'Status': {'State': self.state, 'StateChangeReason': 'PRIVATE ERROR'}}}

    def get_query_results(self, **kwargs):
        self.events.append('page')
        metadata = {'ColumnInfo': [{'Name': key} for key in COLUMNS]}
        rows = self.rows[2:] if kwargs.get('NextToken') else self.rows[:2]
        data = [{'Data': [{} if row.get(key) is None else {'VarCharValue': str(row[key])}
                          for key in COLUMNS]} for row in rows]
        if not kwargs.get('NextToken'):
            data.insert(0, {'Data': [{'VarCharValue': key} for key in COLUMNS]})
        result: Dict[str, Any] = {'ResultSet': {'ResultSetMetadata': metadata, 'Rows': data}}
        if not kwargs.get('NextToken'):
            result['NextToken'] = 'second-page'
        return result

    def stop_query_execution(self, **kwargs):
        self.events.append('cancel')


class S3:
    def __init__(self, events):
        self.events, self.objects = events, []

    def put_object(self, **kwargs):
        self.events.append('put')
        assert kwargs['Body'].endswith(b'</html>')
        assert kwargs['ContentType'] == 'text/html; charset=utf-8'
        self.objects.append(kwargs)


# Exercise independent deployments on one host from a different working directory.
def check_deployment_configs(root, rows):
    modules = {}
    for environment in ('test', 'prod'):
        dist = root / environment / 'dist'
        dist.mkdir(parents=True)
        module_path = dist / 'dashboard.py'
        shutil.copyfile(REPO / 'converter/dashboard.py', module_path)
        spec = importlib.util.spec_from_file_location('dashboard_' + environment, str(module_path))
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules[environment] = module
        (dist.parent / 'dashboard.env').write_text(
            '[dashboard]\nDASHBOARD_PUBLIC_PREFIX=dashboard/fixture-{}-only-123456/\n'
            'DASHBOARD_WEB_BUCKET={}\n'.format(environment, publisher.BUCKETS[environment]))
    previous_cwd = os.getcwd()
    try:
        # Even when started in prod's runtime, test must read test's config.
        runtime = root / 'prod' / 'runtime' / '1'
        runtime.mkdir(parents=True)
        os.chdir(str(runtime))
        for environment, module in modules.items():
            config = module.load_config(environment)
            events = []
            s3 = S3(events)
            report = module.publish_dashboard(environment, NOW,
                athena=Athena(rows, events, environment=environment), s3=s3)
            assert report['environment'] == environment
            assert config['database'] == 'touch_mapper_stats_' + environment
            assert s3.objects[0]['Bucket'] == publisher.BUCKETS[environment]
            assert s3.objects[0]['Key'] == 'dashboard/fixture-{}-only-123456/index.html'.format(environment)
        (root / 'test' / 'dashboard.env').unlink()
        events = []
        assert modules['test'].publish_dashboard('test', NOW,
            athena=Athena(rows, events), s3=S3(events)) is False
        assert events == []  # An absent test config must not use prod's config.
    finally:
        os.chdir(previous_cwd)


# Verify real contracts: completed UTC periods, nulls, percentiles and privacy projection.
def main():
    check_dashboard_cache_behavior()
    check_reliability_metrics()
    for moment, upper, lower in [(datetime.datetime(2026, 1, 1), ('2025', '12'), ('2025', '12')),
                                 (datetime.datetime(2026, 3, 1), ('2026', '02'), ('2026', '01')),
                                 (datetime.datetime(2024, 3, 1), ('2024', '02'), ('2024', '01'))]:
        sql = publisher.build_query(moment)
        assert "\"year\" <= '{}' AND (\"year\" < '{}' OR \"month\" <= '{}')".format(upper[0], upper[0], upper[1]) in sql
        assert "\"year\" >= '{}' AND (\"year\" > '{}' OR \"month\" >= '{}')".format(lower[0], lower[0], lower[1]) in sql
        assert "DATE '{}'".format(moment.date() - datetime.timedelta(days=30)) in sql
    rows = json.loads(FIXTURE.read_text())
    report = publisher.build_report(rows, 'test', NOW)
    assert len(report['daily']) == 30
    assert report['daily'][0]['period'] == '2026-01-30'
    assert report['daily'][-1]['period'] == '2026-02-28'
    assert [row['period'] for row in report['monthly']] == ['2025-12', '2026-01', '2026-02']
    assert report['monthly'][1]['attempts'] == 0
    assert report['monthly'][1]['p50_seconds'] is None
    assert report['daily'][0]['attempts'] == 0
    assert report['daily'][-1]['p95_seconds'] == 95.5
    assert report['summary']['success_rate'] == 90
    assert report['summary']['unique_users'] == 37  # Not a sum of daily distinct estimates.
    assert report['summary']['p50_seconds'] == 31.25
    assert report['rss'][0]['p95_capacity_percent'] == 50
    assert report['rss'][0]['max_kib'] == 786432
    assert report['rss'][2]['p50_kib'] is None
    assert report['timings'][0]['p95_seconds'] == 19.75
    assert publisher.build_report([], 'test', NOW)['summary']['p50_seconds'] is None
    aware = datetime.datetime(2026, 3, 1, 1, 15, tzinfo=datetime.timezone(datetime.timedelta(hours=2)))
    assert publisher.build_report([], 'test', aware)['coverage']['end'] == '2026-02-27'
    leap = publisher.build_report([], 'test', datetime.datetime(2024, 3, 1))
    assert leap['daily'][-1]['period'] == '2024-02-29'
    assert leap['daily'][0]['period'] == '2024-01-31'
    hostile = rows + [
        {'kind': 'errors', 'label': 'PRIVATE ADDRESS<script>', 'attempts': '2'},
        {'kind': 'countries', 'label': 'PRIVATE ADDRESS', 'attempts': '1'},
        {'kind': 'printing_technology', 'label': 'PRIVATE FINGERPRINT', 'attempts': '1'},
        {'kind': 'daily', 'period': '2026-03-01', 'attempts': '99999'},
        {'kind': 'daily', 'period': 'PRIVATE DATE', 'attempts': '99999'},
        {'kind': 'rss', 'label': 'PRIVATE STAGE', 'p95': '12'},
        {'kind': 'summary', 'attempts': '100', 'successes': '90', 'p50': 'nan', 'p95': 'inf', 'request_id': 'PRIVATE REQUEST'}]
    safe = publisher.build_report(hostile, 'test', NOW)
    html = render_report(safe)
    assert 'PRIVATE' not in html and '99999' not in html
    assert safe['summary']['p50_seconds'] is None and safe['summary']['p95_seconds'] is None
    assert 'unknown / unknown' in html and 'Unavailable' in html
    assert '<script src=' not in html and '<link ' not in html
    assert sum(item['count'] for item in safe['errors']) == 12
    assert {'label': 'too_large', 'count': 6} in safe['errors']
    assert {'label': 'get-osm / TimeoutError', 'count': 4} in safe['errors']

    values = {'DASHBOARD_PUBLIC_PREFIX': 'dashboard/fixture-only-not-a-real-url/',
              'DASHBOARD_WEB_BUCKET': 'test.touch-mapper.org'}
    config = publisher.validate_config('test', values)
    publisher.validate_config('prod', dict(values, DASHBOARD_WEB_BUCKET='touch-mapper.org'))
    for prefix in ('', 'dashboard/', '/dashboard/abcdefghijklmnop/', 'dashboard/../abcdefghijklmnop/',
                   'dashboard/abcdefghijklmnop', 'dashboard/abcdefghijklmnop/?q=1',
                   'https://example.invalid/dashboard/abcdefghijklmnop/', 'dashboard/abc%2fdefghijklmnop/'):
        try:
            publisher.validate_config('test', dict(values, DASHBOARD_PUBLIC_PREFIX=prefix))
        except ValueError:
            pass
        else:
            raise AssertionError('unsafe prefix accepted: ' + prefix)
    for environment, bucket in [('prod', 'test.touch-mapper.org'), ('test', 'touch-mapper.org'), ('dev', 'test.touch-mapper.org')]:
        try:
            publisher.validate_config(environment, dict(values, DASHBOARD_WEB_BUCKET=bucket))
        except ValueError:
            pass
        else:
            raise AssertionError('cross-environment destination accepted')

    events = []
    assert publisher.query_rows(Athena(rows, events), publisher.build_query(NOW), config) == rows
    assert events == ['start', 'status', 'page', 'page']
    for state in ('FAILED', 'CANCELLED', 'RUNNING'):
        events[:] = []
        diagnostics = io.StringIO()
        try:
            with contextlib.redirect_stderr(diagnostics):
                publisher.query_rows(Athena(rows, events, state), publisher.build_query(NOW), config,
                                     timeout_seconds=0, sleep=lambda _: None)
        except RuntimeError as error:
            assert 'PRIVATE' not in str(error)
        else:
            raise AssertionError('unsuccessful query accepted')
        assert 'page' not in events
        assert ('cancel' in events) == (state == 'RUNNING')
        if state in ('FAILED', 'CANCELLED'):
            assert 'private-query-id' in diagnostics.getvalue()
            assert 'PRIVATE ERROR' in diagnostics.getvalue()

    base = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / '.tmp'
    base.mkdir(parents=True, exist_ok=True)
    check_bundled_sdk(base)
    with tempfile.TemporaryDirectory(prefix='dashboard-', dir=str(base)) as directory:
        check_deployment_configs(Path(directory) / 'deployments', rows)
        events[:] = []
        assert publisher.publish_dashboard('test', NOW, str(Path(directory) / 'missing.env'),
                                           Athena(rows, events), S3(events)) is False
        assert events == []
        path = Path(directory) / 'dashboard.env'
        path.write_text('[dashboard]\n' + '\n'.join(key + '=' + value for key, value in values.items()))
        assert publisher.load_config('test', str(path)) == config
        events[:] = []
        s3 = S3(events)
        for state in ('FAILED', 'SUCCEEDED'):
            try:
                publisher.publish_dashboard('test', NOW, str(path), Athena(rows, events, state), s3)
            except RuntimeError:
                assert state == 'FAILED'
            assert len(s3.objects) == int(state == 'SUCCEEDED')
        assert events == ['start', 'status', 'start', 'status', 'page', 'page', 'put']
        assert s3.objects[0]['Key'] == values['DASHBOARD_PUBLIC_PREFIX'] + 'index.html'
        events[:] = []
        with mock.patch('dashboard_html.render_report', side_effect=ValueError('render failed')):
            try:
                publisher.publish_dashboard('test', NOW, str(path), Athena(rows, events), s3)
            except ValueError:
                pass
            else:
                raise AssertionError('render failure not propagated')
        assert 'put' not in events and len(s3.objects) == 1
        with mock.patch.object(s3, 'put_object', side_effect=RuntimeError('S3 failed')):
            try:
                publisher.publish_dashboard('test', NOW, str(path), Athena(rows, events), s3)
            except RuntimeError:
                pass
            else:
                raise AssertionError('upload failure not propagated')
    print('Dashboard bucketing, privacy, configuration, pagination, failures and atomic publication passed')


# CloudFront must route dashboard URLs to the uncached web origin while retaining
# the separate map path behavior; the S3 no-cache header alone is insufficient.
def check_dashboard_cache_behavior():
    template = json.loads((REPO / 'install/cloudformation.json').read_text())
    config = template['Resources']['CloudFront']['Properties']['DistributionConfig']
    def route(path):
        return next((item for item in config['CacheBehaviors']
                     if fnmatch.fnmatchcase(path, item['PathPattern'])), config['DefaultCacheBehavior'])
    dashboard = route('/dashboard/opaque-token/index.html')
    assert dashboard['TargetOriginId'] == 'web'
    assert (dashboard['MinTTL'], dashboard['DefaultTTL'], dashboard['MaxTTL']) == (0, 0, 0)
    assert route('/map/example')['TargetOriginId'] == 'maps'
    assert route('/en/')['TargetOriginId'] == 'web'


# Rates use attempt weights; durations stay separated by outcome; month boundaries
# include leap days, and empty periods never invent latency or failure rates.
def check_reliability_metrics():
    rows = [
        {'kind': 'daily', 'period': '2024-02-28', 'attempts': '10', 'errors': '5', 'successes': '5'},
        {'kind': 'daily', 'period': '2024-02-29', 'attempts': '90', 'errors': '9', 'successes': '81'},
        {'kind': 'monthly', 'period': '2024-02', 'attempts': '290', 'errors': '29'},
        {'kind': 'latency_success', 'period': '2024-02-29', 'attempts': '81', 'p50': '20', 'p95': '60'},
        {'kind': 'latency_failed', 'period': '2024-02-29', 'attempts': '9', 'p50': '1', 'p95': '2'},
        {'kind': 'errors_daily', 'period': '2024-02-29', 'label': 'get-osm', 'attempts': '8'},
        {'kind': 'errors_daily', 'period': '2024-02-29', 'label': 'PRIVATE URL', 'attempts': '1'},
        {'kind': 'osm_classes_daily', 'period': '2024-02-29', 'label': 'RequestProcessingError', 'attempts': '2'},
        {'kind': 'osm_classes_daily', 'period': '2024-02-29', 'label': 'PRIVATE URL', 'attempts': '1'},
        {'kind': 'releases', 'label': 'a' * 40, 'attempts': '100', 'errors': '14'},
        {'kind': 'releases', 'label': '<PRIVATE SCRIPT>', 'attempts': '1'}]
    report = publisher.build_report(rows, 'test', datetime.datetime(2024, 3, 1))
    assert abs(report['daily'][-1]['rolling_error_rate'] - 14) < 1e-9  # Not mean(50%, 10%).
    assert report['daily'][0]['error_rate'] is None
    assert report['daily'][5]['rolling_error_rate'] is None
    assert report['recent']['last7']['success_rate'] == 86
    assert report['recent']['previous7']['success_rate'] is None
    assert report['monthly'][0]['attempts_per_day'] == 10
    assert report['monthly'][0]['partial'] is False
    assert report['latency_success'][-1]['p50_seconds'] == 20
    assert report['latency_failed'][-1]['p50_seconds'] == 1
    assert report['latency_success'][0]['p50_seconds'] is None
    assert report['errors_daily'][-1] == {'period': '2024-02-29', 'get-osm': 8, 'unknown': 1}
    assert report['osm_classes_daily'][-1] == {'period': '2024-02-29', 'RequestProcessingError': 2, 'unknown': 1}
    assert len(report['releases']) == 1
    partial = publisher.build_report([{'kind': 'monthly', 'period': '2024-02', 'attempts': '200'}],
                                     'test', datetime.datetime(2024, 2, 21))
    assert partial['monthly'][0]['partial'] is True
    assert partial['monthly'][0]['attempts_per_day'] == 10
    report['summary']['attempts'] = 100
    report['usage']['countries'] = [{'label': 'FI', 'count': 60}, {'label': 'US', 'count': 20}]
    page = render_report(report)
    assert 'PRIVATE' not in page
    titles = ['Daily attempts', 'Monthly attempts', 'Daily failure rate', 'Monthly failure rate']
    positions = [page.index('<h2>' + title + '</h2>') for title in titles]
    assert positions == sorted(positions)
    assert '<h2>Daily errors</h2>' not in page and '<h2>Monthly errors</h2>' not in page
    assert 'Country shares of all map attempts' in page
    assert 'FI: 60 attempts (60.0%)' in page
    assert 'US: 20 attempts (20.0%)' in page
    assert 'Other / unlisted: 20 attempts (20.0%)' in page
    assert page.count('<path d="M100,100') == 3
    assert 'View country data' in page
    assert 'Successful map duration' in page and 'Failed attempt duration' in page
    sql = publisher.build_query(NOW)
    assert "WHERE status='success' GROUP BY 2" in sql
    assert "WHERE status='failed' GROUP BY 2" in sql
    assert "'errors_daily'" in sql and "'osm_classes_daily'" in sql and "'releases'" in sql


if __name__ == '__main__':
    main()
