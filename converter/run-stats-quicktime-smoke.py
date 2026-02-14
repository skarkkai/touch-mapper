#!/usr/bin/env python3

"""
Quicktime smoke runner for stats telemetry rollover logic.

This script validates that:
1) every 3 writes advances one virtual day and uploads month data to S3
2) every 3 virtual days advances one virtual month
3) completed month directory is removed after successful final month upload

It uses a fake in-memory S3 resource, so no AWS network calls are made.
"""

import argparse
import datetime
import gzip
import io
import json
import os
import shutil
import sys

import stats_pipeline


class FakeBucket(object):
    def __init__(self, bucket_name, uploads):
        self._bucket_name = bucket_name
        self._uploads = uploads

    def put_object(self, **kwargs):
        key = kwargs.get('Key')
        body = kwargs.get('Body', b'')
        self._uploads.append({
            'bucket': self._bucket_name,
            'key': key,
            'body': body,
            'content_type': kwargs.get('ContentType'),
            'content_encoding': kwargs.get('ContentEncoding')
        })
        return {}


class FakeS3Resource(object):
    def __init__(self):
        self.uploads = []
        self._buckets = {}

    def Bucket(self, bucket_name):
        if bucket_name not in self._buckets:
            self._buckets[bucket_name] = FakeBucket(bucket_name, self.uploads)
        return self._buckets[bucket_name]


def parse_args():
    parser = argparse.ArgumentParser(description='Quicktime telemetry smoke runner')
    parser.add_argument(
        '--root',
        default='.tmp/telemetry-quicktime-smoke',
        help='Temporary root for local stats files (default: .tmp/telemetry-quicktime-smoke)'
    )
    parser.add_argument(
        '--attempts',
        type=int,
        default=9,
        help='How many synthetic stats writes to run (default: 9)'
    )
    parser.add_argument(
        '--bucket',
        default='test.stats.touch-mapper',
        help='Fake bucket name for upload calls (default: test.stats.touch-mapper)'
    )
    parser.add_argument(
        '--keep-files',
        action='store_true',
        help='Keep temporary files after run'
    )
    return parser.parse_args()


def add_months(year, month, offset):
    zero_based = (int(year) * 12 + (int(month) - 1)) + int(offset)
    next_year = zero_based // 12
    next_month = (zero_based % 12) + 1
    return next_year, next_month


def read_quicktime_state(stats_root):
    state_path = os.path.join(stats_root, '.maintenance', 'quicktime-state.json')
    with open(state_path, 'r', encoding='utf8') as handle:
        return json.load(handle)


def uploaded_line_count(upload_entry):
    body = upload_entry['body']
    with gzip.GzipFile(fileobj=io.BytesIO(body), mode='rb') as gz:
        lines = gz.read().decode('utf8').splitlines()
    return len([line for line in lines if line.strip() != ''])


def assert_true(condition, message):
    if not condition:
        raise Exception(message)


def main():
    args = parse_args()
    stats_root = os.path.abspath(args.root)
    if args.attempts <= 0:
        raise Exception('--attempts must be > 0')

    if os.path.isdir(stats_root):
        shutil.rmtree(stats_root)
    os.makedirs(stats_root)

    fake_s3 = FakeS3Resource()
    seed_now = datetime.datetime(2026, 2, 13, 12, 0, 0)
    initial_year = seed_now.year
    initial_month = seed_now.month

    print('Running quicktime smoke: attempts={} root={}'.format(args.attempts, stats_root))
    for attempt in range(1, args.attempts + 1):
        map_id = 'B{:04d}'.format(attempt)
        request_id = map_id + '/QuicktimeSmoke'
        record = {
            'schema_version': 1,
            'timestamp': '2026-02-13T12:00:00Z',
            'event_date': '2026-02-13',
            'day': '13',
            'request_id': request_id,
            'map_id': map_id,
            'status': 'success'
        }
        stats_pipeline.write_attempt_record(
            stats_root_dir=stats_root,
            record=record,
            quicktime_mode=True,
            s3_resource=fake_s3,
            stats_bucket_name=args.bucket,
            now_utc=seed_now
        )

        state = read_quicktime_state(stats_root)
        uploads = len(fake_s3.uploads)
        completed_days = attempt // 3
        completed_months = completed_days // 3
        expected_uploads = completed_days
        expected_day = (completed_days % 3) + 1
        expected_days_elapsed = completed_days % 3
        expected_writes_in_day = attempt % 3
        expected_year, expected_month = add_months(initial_year, initial_month, completed_months)

        assert_true(uploads == expected_uploads, 'upload count mismatch at attempt {}'.format(attempt))
        assert_true(int(state['virtual_year']) == expected_year, 'virtual year mismatch at attempt {}'.format(attempt))
        assert_true(int(state['virtual_month']) == expected_month, 'virtual month mismatch at attempt {}'.format(attempt))
        assert_true(int(state['virtual_day']) == expected_day, 'virtual day mismatch at attempt {}'.format(attempt))
        assert_true(
            int(state['days_elapsed_in_current_month']) == expected_days_elapsed,
            'days_elapsed mismatch at attempt {}'.format(attempt)
        )
        assert_true(
            int(state['writes_in_current_day']) == expected_writes_in_day,
            'writes_in_current_day mismatch at attempt {}'.format(attempt)
        )

        if attempt % 3 == 0:
            upload = fake_s3.uploads[-1]
            month_for_upload_year, month_for_upload_month = add_months(
                initial_year,
                initial_month,
                (completed_days - 1) // 3
            )
            expected_key = stats_pipeline.month_object_key(month_for_upload_year, month_for_upload_month)
            assert_true(upload['key'] == expected_key, 'upload key mismatch at attempt {}'.format(attempt))

            attempts_in_upload_month = attempt - (((completed_days - 1) // 3) * 9)
            expected_lines = attempts_in_upload_month
            actual_lines = uploaded_line_count(upload)
            assert_true(
                actual_lines == expected_lines,
                'uploaded line count mismatch at attempt {} (expected {}, got {})'.format(
                    attempt, expected_lines, actual_lines
                )
            )

        print(
            'attempt={} uploads={} virtual_date={}-{:02d}-{:02d} writes_in_day={} days_elapsed={}'.format(
                attempt,
                uploads,
                int(state['virtual_year']),
                int(state['virtual_month']),
                int(state['virtual_day']),
                int(state['writes_in_current_day']),
                int(state['days_elapsed_in_current_month'])
            )
        )

    if args.attempts >= 9:
        completed_month_path = os.path.join(
            stats_root,
            '{:04d}'.format(initial_year),
            '{:02d}'.format(initial_month)
        )
        assert_true(
            not os.path.isdir(completed_month_path),
            'expected completed month directory to be removed: {}'.format(completed_month_path)
        )

    print('Quicktime smoke passed: uploads={}'.format(len(fake_s3.uploads)))
    if not args.keep_files:
        shutil.rmtree(stats_root)
        print('Removed temporary directory {}'.format(stats_root))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print('Quicktime smoke failed: {}'.format(e))
        sys.exit(1)
