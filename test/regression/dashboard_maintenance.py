"""Exercise cutoff, upload/report ordering, contention, and independent retries offline."""
import datetime
import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
from unittest import mock
from typing import Dict, Union

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)
from converter import stats_pipeline as stats


# Stub only remote work; use real locks, date handling, local cleanup and markers.
def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, '.tmp')
    os.makedirs(base, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dashboard-maintenance-', dir=base) as root:
        events = []
        state = {'upload': True, 'report': True}  # type: Dict[str, Union[bool, str]]

        def upload(**kwargs):
            events.append(('upload', kwargs['year'], kwargs['month'], kwargs['max_day']))
            if state['upload'] == 'exception':
                raise RuntimeError('AWS unavailable')
            return state['upload']

        def report(now_utc):
            events.append(('report', now_utc.date().isoformat()))
            if state['report'] == 'exception':
                raise RuntimeError('query failed')
            return state['report']

        def run(moment):
            return stats.run_daily_maintenance_if_due(root, None, 'fixture', report, moment)

        moment = datetime.datetime(2026, 3, 1, 0, 15)
        maintenance = os.path.join(root, '.maintenance')
        upload_marker = os.path.join(maintenance, 'last-successful-run-utc.txt')
        report_marker = os.path.join(maintenance, 'last-successful-report-utc.txt')
        with mock.patch.object(stats, 'upload_month_from_local_data', side_effect=upload):
            assert not run(moment.replace(minute=14, second=59))
            assert events == []
            state['upload'] = 'exception'
            assert not run(moment)
            assert events == [('upload', 2026, 2, 28)]
            assert not os.path.exists(upload_marker)
            assert not os.path.exists(report_marker)
            state['upload'] = False
            assert not run(moment)
            assert all(event[0] == 'upload' for event in events)
            events[:] = []
            state['upload'] = True
            state['report'] = 'exception'
            old_month = os.path.join(root, '2026', '02')
            os.makedirs(old_month)
            with contextlib.redirect_stderr(io.StringIO()) as diagnostics:
                assert not run(moment)
            assert 'stats daily maintenance failed: RuntimeError: query failed' in diagnostics.getvalue()
            assert events == [('upload', 2026, 2, 28), ('report', '2026-03-01')]
            assert stats._read_small_text(upload_marker) == '2026-03-01'
            assert not os.path.exists(old_month)
            assert not os.path.exists(report_marker)
            events[:] = []
            state['report'] = False
            assert not run(moment)
            assert events == [('report', '2026-03-01')]
            state['report'] = True
            events[:] = []
            # A busy report lock skips only the pending publication.
            with stats._exclusive_lock(os.path.join(maintenance, 'report.lock')):
                assert not run(moment)
                assert events == []
            assert run(moment)
            assert events == [('report', '2026-03-01')]
            assert stats._read_small_text(report_marker) == '2026-03-01'
            assert not run(moment)
            assert len(events) == 1
            tomorrow = moment + datetime.timedelta(days=1)
            events[:] = []
            # A busy upload lock prevents both tasks until upload is confirmed.
            with stats._exclusive_lock(os.path.join(maintenance, 'upload.lock')):
                assert not run(tomorrow)
                assert events == []
            assert run(tomorrow)
            assert events == [('upload', 2026, 3, 1), ('report', '2026-03-02')]
            events[:] = []
            assert not run(moment)  # A delayed older startup cannot regress either marker.
            assert events == []
            assert stats._read_small_text(upload_marker) == '2026-03-02'
            assert stats._read_small_text(report_marker) == '2026-03-02'
            # Storage failures in maintenance are also isolated from conversion.
            with mock.patch.object(stats, '_ensure_dir', side_effect=OSError('read-only')):
                assert not run(tomorrow + datetime.timedelta(days=1))
        check_web_deployment(root)
        check_poller_publication(os.path.join(root, 'poller'))
        check_worker_callback()
    print('dashboard maintenance regression passed')


# Check a poller's first-map publication independently of daily markers and cutoff.
def check_poller_publication(root):
    events = []
    work = os.path.join(root, 'runtime', '1')
    stats_root = os.path.join(root, 'stats')
    marker = os.path.join(work, 'dashboard-published-poller.txt')
    daily_marker = os.path.join(stats_root, '.maintenance', 'last-successful-report-utc.txt')
    moment = datetime.datetime(2026, 3, 1, 0, 10)

    def report(now_utc):
        events.append('report')
        return True

    def run(now=moment, run_id='first-poller', after_map=False, publish=report, worker=work):
        return stats.run_daily_maintenance_if_due(
            stats_root, None, 'fixture', publish, now,
            poller_run_id=run_id, poller_work_dir=worker, after_map=after_map)

    def upload(**kwargs):
        events.append('upload')
        return True

    with mock.patch.object(stats, 'upload_month_from_local_data', side_effect=upload):
        assert not run()  # No first-map exception merely for starting a worker.
        assert run(after_map=True)
        assert events == ['report']
        assert stats._read_small_text(marker) == 'first-poller'
        assert not os.path.exists(daily_marker)  # 00:10 must not consume the 00:15 run.
        events[:] = []
        assert not run(after_map=True)
        assert events == []

        later = moment.replace(minute=15)
        assert run(now=later)
        assert events == ['upload', 'report']
        assert stats._read_small_text(daily_marker) == '2026-03-01'
        events[:] = []
        assert not run(now=later, after_map=True)
        assert not run(now=later, run_id='restarted-poller')
        assert run(now=later, run_id='restarted-poller', after_map=True)
        assert events == ['report']
        assert stats._read_small_text(marker) == 'restarted-poller'

        events[:] = []
        assert run(now=later, run_id='second-worker', after_map=True,
                   worker=os.path.join(root, 'runtime', '2'))
        assert events == ['report']  # Each poller has its own lifetime.
        events[:] = []
        for callback in (lambda **kwargs: False, mock.Mock(side_effect=RuntimeError('AWS unavailable'))):
            assert not run(now=later, run_id='retry-poller', after_map=True, publish=callback)
            assert stats._read_small_text(marker) == 'restarted-poller'
        with stats._exclusive_lock(os.path.join(stats_root, '.maintenance', 'report.lock')):
            assert not run(now=later, run_id='retry-poller', after_map=True)
        assert events == []
        assert run(now=later, run_id='retry-poller', after_map=True)
        assert events == ['report']

        tomorrow = later + datetime.timedelta(days=1)
        events[:] = []
        assert run(now=tomorrow, run_id='new-day-poller')
        assert events == ['upload', 'report']
        assert not run(now=tomorrow, run_id='new-day-poller', after_map=True)
        assert events == ['upload', 'report']  # A daily publication also counts for this lifetime.


# Only a completed map may request the first-map exception, never an idle or failed attempt.
def check_worker_callback():
    from types import SimpleNamespace
    from content_filter import PROCESS  # pyright: ignore[reportMissingImports]
    ctx = {'stats_s3': object(), 'status': 'idle', 'environment': 'test',
           'stats_root_dir': '/fixture/test/stats', 'stats_bucket_name': 'fixture',
           'args': SimpleNamespace(work_dir='/fixture/test/runtime/1')}
    with mock.patch.dict(os.environ, {'TM_POLLER_RUN_ID': 'poller-identity'}), \
            mock.patch.object(PROCESS.stats_pipeline, 'run_daily_maintenance_if_due') as maintenance:
        for status in ('idle', 'failed', 'running'):
            ctx['status'] = status
            PROCESS.run_stats_maintenance(ctx, after_map=True)
        maintenance.assert_not_called()
        ctx['status'] = 'success'
        PROCESS.run_stats_maintenance(ctx, after_map=True)
        assert maintenance.call_args.kwargs['after_map'] is True
        assert maintenance.call_args.kwargs['poller_run_id'] == 'poller-identity'
        assert maintenance.call_args.kwargs['poller_work_dir'] == '/fixture/test/runtime/1'
        maintenance.reset_mock()
        with mock.patch.dict(os.environ, {'TM_POLLER_RUN_ID': ''}):
            PROCESS.run_stats_maintenance(ctx, after_map=True)
        maintenance.assert_not_called()


# Execute the deployment entrypoint against fake tools and an actual local object tree.
def check_web_deployment(root):
    fixture = os.path.join(root, 'deployment')
    for relative in ('install', 'web/build/en', 'web/build/scripts', 'stubs', 'remote/dashboard/fixture', 'temp'):
        os.makedirs(os.path.join(fixture, relative))
    shutil.copyfile(os.path.join(REPO, 'install/web-s3.sh'), os.path.join(fixture, 'install/web-s3.sh'))

    def write(relative, value):
        path = os.path.join(fixture, relative)
        with open(path, 'w') as handle:
            handle.write(value)
        os.chmod(path, 0o755)

    write('install/parameters.sh', '#!/bin/bash\necho "env_name=test; domain=fixture"\n')
    write('web/create-env-js.sh', '#!/bin/bash\necho "window.TM_DOMAIN=fixture"\n')
    write('web/build/en/index.html', 'new home')
    write('web/build/main.css', 'new style')
    write('remote/dashboard/fixture/index.html', 'keep published dashboard')
    write('remote/obsolete.css', 'delete obsolete asset')
    # The deployment uses Bash 4 mapfile; supply its used subset on macOS Bash 3.
    write('bash-env', 'mapfile() { local line; langs=(); while IFS= read -r line; do langs+=("$line"); done; }\n')
    tool = r'''import fnmatch, os, shutil, sys
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
root = Path(os.environ['DEPLOY_FIXTURE'])
if name == 'rename':
    for item in args[1:]:
        Path(item).rename(Path(item).with_suffix(''))
elif name == 'rsync':
    source, target = map(Path, args[-2:])
    for item in source.rglob('*'):
        relative = item.relative_to(source)
        if item.is_file():
            (target / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(item), str(target / relative))
elif name == 'aws' and args[:2] == ['s3', 'sync']:
    source = Path(args[-2])
    prefix = args[-1].replace('s3://fixture', '').strip('/')
    target = root / 'remote' / prefix
    target.mkdir(parents=True, exist_ok=True)
    rules = [(args[i], args[i+1]) for i in range(len(args)-1) if args[i] in ('--exclude', '--include')]
    for item in list(target.rglob('*')):
        if not item.is_file():
            continue
        relative = str(item.relative_to(target))
        included = True
        for flag, pattern in rules:
            if fnmatch.fnmatch(relative, pattern):
                included = flag == '--include'
        if included and not (source / relative).exists() and '--delete' in args:
            item.unlink()
    for item in source.rglob('*'):
        if item.is_file():
            dest = target / item.relative_to(source)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(str(item), str(dest))
elif name == 'jq':
    sys.stdin.read()
    print('fixture-distribution')
'''
    for name in ('make', 'git', 'rename', 'rsync', 'aws', 'jq'):
        write('stubs/' + name, '#!' + sys.executable + '\n' + tool)
    env = dict(os.environ, DEPLOY_FIXTURE=fixture, BASH_ENV=os.path.join(fixture, 'bash-env'),
               TMPDIR=os.path.join(fixture, 'temp'))
    env['PATH'] = os.path.join(fixture, 'stubs') + os.pathsep + env['PATH']
    result = subprocess.run(['bash', os.path.join(fixture, 'install/web-s3.sh'), 'test'],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            universal_newlines=True, timeout=10)
    assert result.returncode == 0, result.stdout
    with open(os.path.join(fixture, 'remote/dashboard/fixture/index.html')) as handle:
        assert handle.read() == 'keep published dashboard'
    assert not os.path.exists(os.path.join(fixture, 'remote/obsolete.css'))
    assert os.path.exists(os.path.join(fixture, 'remote/main.css'))


if __name__ == '__main__':
    main()
