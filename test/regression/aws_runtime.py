"""Exercise worker imports and dashboard AWS calls using the isolated worker runtime."""
import datetime
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
NOW = datetime.datetime(2026, 3, 1, 0, 15)
COLUMNS = ('kind', 'period', 'label', 'attempts', 'successes', 'errors', 'unique_users', 'p50', 'p95', 'maximum')


# Validate real Athena/S3 request models without contacting AWS.
def check_dashboard_sdk(base):
    sys.path.insert(0, str(REPO / "converter"))
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
    assert sys.version_info >= (3, 12), sys.version
    sys.path.insert(0, str(REPO / 'converter'))
    worker = runpy.run_path(str(REPO / 'converter/process-request.py'), run_name='worker_runtime_check')
    runner_log = runpy.run_path(str(REPO / 'converter/runner-log.py'), run_name='runner_log_runtime_check')
    runpy.run_path(str(REPO / 'converter/restart-poller.py'), run_name='restart_runtime_check')
    import boto3  # pyright: ignore[reportMissingImports]
    # The SDK upgrade must retain the worker's S3 and SQS resource interfaces too.
    session = boto3.Session(aws_access_key_id='fixture', aws_secret_access_key='fixture',
                            region_name='eu-west-1')
    assert session.resource('s3').Bucket('fixture').name == 'fixture'
    assert session.resource('sqs').Queue('https://fixture.invalid/queue').url.endswith('/queue')
    base = sys.argv[1]
    from botocore.stub import ANY, Stubber  # pyright: ignore[reportMissingImports]
    sqs = session.resource('sqs')
    queue_url = 'https://sqs.eu-west-1.amazonaws.com/123456789012/fixture'
    with Stubber(sqs.meta.client) as stub, mock.patch.object(boto3, 'resource', return_value=sqs):
        stub.add_response('get_queue_url', {'QueueUrl': queue_url}, {'QueueName': 'fixture'})
        stub.add_response('receive_message', {'Messages': [{'MessageId': 'fixture',
                          'ReceiptHandle': 'receipt', 'Body': '{"scale":1400}'}]},
                          {'QueueUrl': queue_url, 'WaitTimeSeconds': 20})
        stub.add_response('delete_message_batch', {'Successful': [{'Id': 'dummy'}], 'Failed': []},
                          {'QueueUrl': queue_url, 'Entries': [{'Id': 'dummy', 'ReceiptHandle': 'receipt'}]})
        assert worker['receive_sqs_msg']('fixture', 300) == {'scale': 1400}
        stub.assert_no_pending_responses()
    with tempfile.TemporaryDirectory(prefix='worker-sdk-', dir=base) as directory:
        root = Path(directory)
        (root / 'map-meta-raw.json').write_text('{}')
        with mock.patch.object(worker['subprocess'], 'check_call') as child:
            worker['run_osm_to_tactile'](str(root / 'map.osm'), {'scale': 1400, 'size': 17})
        assert child.call_args[0][0][:2] == [sys.executable, str(REPO / 'converter/osm-to-tactile.py')]
        svg = root / 'map.svg'
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
        worker['svg_to_pdf'](str(svg), str(root / 'map.pdf'))
        assert (root / 'map.pdf').read_bytes().startswith(b'%PDF')
        bucket = session.resource('s3').Bucket('fixture')
        stl = root / 'map.stl'
        stl.write_bytes(b'fixture STL')
        with Stubber(bucket.meta.client) as upload:
            upload.add_response('put_object', {}, {'Bucket': 'fixture', 'Key': 'info.json',
                                'Body': b'{}', 'ACL': 'public-read', 'ContentType': 'application/json'})
            for key, content_type in [('map.map-content.json', 'application/json'), ('map.stl', 'application/sla')]:
                upload.add_response('put_object', {}, {'Bucket': 'fixture', 'Key': key, 'Body': ANY,
                                    'ContentEncoding': 'gzip', 'ContentType': content_type})
            worker['upload_primary_assets'](bucket, 'info.json', {}, 'map', 'map.stl',
                                            b'{}', str(stl), {'ContentEncoding': 'gzip'})
            upload.assert_no_pending_responses()
        # The runtime gate must stop before the poller creates locks or receives work.
        dist = root / 'dist'
        dist.mkdir()
        for name in ('worker-python.sh', 'worker-runtime-check.py', 'worker-requirements.txt',
                     'aws-requirements.txt', 'poller.sh'):
            shutil.copyfile(REPO / 'converter' / name, dist / name)
        environment = dict(os.environ, TM_WORKER_PYTHON=str(root / 'missing-python'))
        rejected = subprocess.run(['bash', str(dist / 'poller.sh'), 'test', '1'], env=environment,
                                  capture_output=True, text=True)
        assert rejected.returncode != 0 and 'Worker Python missing' in rejected.stderr
        assert not (root / 'runtime').exists()
        environment['TM_WORKER_PYTHON'] = sys.executable
        (dist / 'aws-requirements.txt').write_text('boto3==0.0.0\n')
        rejected = subprocess.run(['bash', str(dist / 'worker-python.sh'), '--check'], env=environment,
                                  capture_output=True, text=True)
        assert rejected.returncode != 0 and 'expected 0.0.0' in rejected.stderr
    with tempfile.TemporaryDirectory(prefix='runner-worker-', dir=str(base)) as environment_dir:
        daily = runner_log['prepare'](environment_dir, '1', datetime.date(2026, 9, 23))
        assert Path(daily).name == '2026-09-23.log'
    check_dashboard_sdk(base)
    print('Worker runtime, child interpreter, PDF and stubbed SQS/S3/Athena calls passed')


if __name__ == '__main__':
    main()
