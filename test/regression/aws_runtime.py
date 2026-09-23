"""Exercise worker imports and dashboard AWS calls using the deployed Python 3.5 runtime."""
import datetime
from pathlib import Path
import runpy
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
NOW = datetime.datetime(2026, 3, 1, 0, 15)
COLUMNS = ('kind', 'period', 'label', 'attempts', 'successes', 'errors', 'unique_users', 'p50', 'p95', 'maximum')


# Validate the packaged SDK's real Athena/S3 request models without contacting AWS.
def check_bundled_sdk(base):
    bundle = REPO / 'converter/py-lib/boto3'
    if not (bundle / 'boto3').is_dir():
        print('Bundled AWS SDK absent; fake-client publication checks still run')
        return
    sys.path.insert(0, str(REPO / "converter"))
    sys.path.insert(0, str(bundle))
    sys.path.insert(0, str(REPO))
    from converter import dashboard as publisher
    import boto3  # pyright: ignore[reportMissingImports]
    from botocore.config import Config  # pyright: ignore[reportMissingImports]
    from botocore.stub import ANY, Stubber  # pyright: ignore[reportMissingImports]
    session = boto3.Session(aws_access_key_id='fixture', aws_secret_access_key='fixture',
                            region_name='eu-west-1')
    options = Config(connect_timeout=5, read_timeout=15, retries={'max_attempts': 2})
    athena = session.client('athena', config=options)
    s3 = session.client('s3', config=options)
    with tempfile.TemporaryDirectory(prefix='dashboard-sdk-', dir=str(base)) as directory:
        path = Path(directory) / 'dashboard.env'
        path.write_text('[dashboard]\nDASHBOARD_PUBLIC_PREFIX=dashboard/fixture-sdk-12345678/\n'
                        'DASHBOARD_WEB_BUCKET=test.touch-mapper.org\n'
                        'DASHBOARD_ATHENA_OUTPUT=s3://fixture-private-results/dashboard/\n')
        with Stubber(athena) as query, Stubber(s3) as upload:
            query.add_response('start_query_execution', {'QueryExecutionId': 'fixture-query'}, {
                'QueryString': publisher.build_query(NOW),
                'QueryExecutionContext': {'Database': 'touch_mapper_stats_test'},
                'WorkGroup': 'primary',
                'ResultConfiguration': {'OutputLocation': 's3://fixture-private-results/dashboard/'}})
            query.add_response('get_query_execution', {
                'QueryExecution': {'Status': {'State': 'SUCCEEDED'}}},
                {'QueryExecutionId': 'fixture-query'})
            query.add_response('get_query_results', {'ResultSet': {
                'ResultSetMetadata': {'ColumnInfo': [{'Name': key, 'Type': 'varchar'} for key in COLUMNS]},
                'Rows': [{'Data': [{'VarCharValue': key} for key in COLUMNS]}]}},
                {'QueryExecutionId': 'fixture-query', 'MaxResults': 1000})
            upload.add_response('put_object', {}, {
                'Bucket': 'test.touch-mapper.org', 'Key': 'dashboard/fixture-sdk-12345678/index.html',
                'Body': ANY, 'ContentType': 'text/html; charset=utf-8', 'CacheControl': 'no-cache'})
            assert publisher.publish_dashboard('test', NOW, str(path), athena, s3)
            query.assert_no_pending_responses()
            upload.assert_no_pending_responses()


# Import the real worker before exercising publication with real SDK clients and fake AWS.
def main():
    assert sys.version_info[:2] == (3, 5), sys.version
    bundle = REPO / 'converter/py-lib/boto3'
    if not (bundle / 'boto3').is_dir():
        print('Bundled AWS SDK absent; Python 3.5 AWS runtime check skipped')
        return
    sys.path.insert(0, str(bundle))
    runpy.run_path(str(REPO / 'converter/process-request.py'), run_name='worker_runtime_check')
    runner_log = runpy.run_path(str(REPO / 'converter/runner-log.py'), run_name='runner_log_runtime_check')
    runpy.run_path(str(REPO / 'converter/restart-poller.py'), run_name='restart_runtime_check')
    import boto3  # pyright: ignore[reportMissingImports]
    # The SDK upgrade must retain the worker's S3 and SQS resource interfaces too.
    session = boto3.Session(aws_access_key_id='fixture', aws_secret_access_key='fixture',
                            region_name='eu-west-1')
    assert session.resource('s3').Bucket('fixture').name == 'fixture'
    assert session.resource('sqs').Queue('https://fixture.invalid/queue').url.endswith('/queue')
    base = sys.argv[sys.argv.index('--') + 1]
    with tempfile.TemporaryDirectory(prefix='runner-py35-', dir=str(base)) as environment_dir:
        daily = runner_log['prepare'](environment_dir, '1', datetime.date(2026, 9, 23))
        assert Path(daily).name == '2026-09-23.log'
    check_bundled_sdk(base)
    print('Python 3.5 worker import and stubbed Athena/S3 dashboard publication passed')


if __name__ == '__main__':
    main()
