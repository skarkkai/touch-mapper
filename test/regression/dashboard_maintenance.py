"""Exercise cutoff, upload/report ordering, contention, and independent retries offline."""
import datetime
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
            assert not run(moment)
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
    print('dashboard maintenance regression passed')


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
