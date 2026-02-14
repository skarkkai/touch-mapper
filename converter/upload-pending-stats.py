#!/usr/bin/python3

import argparse
import datetime
import os
import shutil
import sys

script_dir = os.path.dirname(__file__)
sys.path.insert(1, '%s/py-lib/boto3' % (script_dir,))
sys.path.insert(1, script_dir)

import stats_pipeline


def parse_args():
    parser = argparse.ArgumentParser(
        description='Upload pending local stats JSON files to S3 for one Touch Mapper environment.'
    )
    parser.add_argument(
        'environment',
        choices=['test', 'prod'],
        help='Environment whose local stats should be uploaded.'
    )
    parser.add_argument(
        '--tm-root',
        default='~/touch-mapper',
        help='Touch Mapper root directory on EC2 (default: ~/touch-mapper).'
    )
    parser.add_argument(
        '--keep-local-months',
        action='store_true',
        help='Keep local month directories even if they are already complete.'
    )
    return parser.parse_args()


def iter_month_dirs(stats_root_dir):
    for year_name in sorted(os.listdir(stats_root_dir)):
        year_path = os.path.join(stats_root_dir, year_name)
        if not os.path.isdir(year_path):
            continue
        if not year_name.isdigit() or len(year_name) != 4:
            continue

        for month_name in sorted(os.listdir(year_path)):
            month_path = os.path.join(year_path, month_name)
            if not os.path.isdir(month_path):
                continue
            if not month_name.isdigit():
                continue
            month = int(month_name)
            if month < 1 or month > 12:
                continue

            yield int(year_name), month, month_path


def is_month_before_today(year, month, today):
    return (year < today.year) or (year == today.year and month < today.month)


def main():
    args = parse_args()

    tm_root = os.path.abspath(os.path.expanduser(args.tm_root))
    env_dir = os.path.join(tm_root, args.environment)
    stats_root_dir = os.path.join(env_dir, 'stats')
    stats_bucket_name = args.environment + '.stats.touch-mapper'

    if not os.path.isdir(env_dir):
        print('Environment directory does not exist: {}'.format(env_dir), file=sys.stderr)
        return 2
    if not os.path.isdir(stats_root_dir):
        print('Stats directory does not exist: {}'.format(stats_root_dir), file=sys.stderr)
        return 2

    try:
        import boto3  # type: ignore[import-not-found]
    except ImportError:
        print('boto3 is required. Install with: sudo -H pip3 install --upgrade boto3', file=sys.stderr)
        return 2

    s3_resource = boto3.resource('s3')
    today = datetime.datetime.utcnow().date()

    uploaded_months = 0
    skipped_months = 0
    removed_months = 0

    print('Uploading pending stats for environment={} stats_root={} bucket={}'.format(
        args.environment,
        stats_root_dir,
        stats_bucket_name
    ))

    for year, month, month_path in iter_month_dirs(stats_root_dir):
        ok = stats_pipeline.upload_month_from_local_data(
            stats_root_dir=stats_root_dir,
            s3_resource=s3_resource,
            stats_bucket_name=stats_bucket_name,
            year=year,
            month=month,
            max_day=None
        )

        if not ok:
            skipped_months += 1
            print('skip: failed to upload {:04d}-{:02d}'.format(year, month))
            continue

        uploaded_months += 1

        if (not args.keep_local_months) and is_month_before_today(year, month, today):
            shutil.rmtree(month_path)
            removed_months += 1
            print('cleanup: removed local month directory {}'.format(month_path))

    print('done: uploaded_months={} skipped_months={} removed_months={}'.format(
        uploaded_months,
        skipped_months,
        removed_months
    ))
    return 0


if __name__ == '__main__':
    sys.exit(main())
