"""Exercise startup logging, attempt IDs, and restart append through the real poller."""
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]


def check_startup(root, environment, configured, locked=False):
    deployment = root / environment
    dist = deployment / 'dist'
    dist.mkdir(parents=True)
    (deployment / 'runtime').mkdir()
    for name in ('poller.sh', 'runner-log.py'):
        shutil.copyfile(REPO / 'converter' / name, dist / name)
    config = deployment / 'dashboard.env'
    if configured:
        config.write_text('[dashboard]\n')
    shell_stubs = root / 'shell-stubs'
    shell_stubs.write_text('''
flock() { return "$POLLER_TEST_LOCK_STATUS"; }
timeout() {
    POLLER_TEST_REQUESTS=$(( ${POLLER_TEST_REQUESTS:-0} + 1 ))
    echo "$TM_POLLER_RUN_ID $TM_ATTEMPT_ID" >> "$POLLER_TEST_IDENTITIES"
    echo "fixture stdout iteration $POLLER_TEST_REQUESTS"
    echo "fixture stderr iteration $POLLER_TEST_REQUESTS" >&2
    if [[ $POLLER_TEST_REQUESTS -eq 1 ]]; then return 7; fi
    if [[ $POLLER_TEST_REQUESTS -eq 3 ]]; then exit 0; fi
}
''')
    env = dict(os.environ, BASH_ENV=str(shell_stubs),
               POLLER_TEST_LOCK_STATUS='1' if locked else '0', POLLER_TEST_REQUESTS='0',
               POLLER_TEST_IDENTITIES=str(root / 'identities'))
    result = subprocess.run(['bash', str(dist / 'poller.sh'), environment, '1'],
                            cwd=str(root), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, universal_newlines=True, timeout=5)
    assert result.returncode == (1 if locked else 0), result.stdout
    runner_dir = deployment / 'logs' / '1'
    if locked:
        assert not runner_dir.exists()
        return
    log_path = runner_dir / (runner_dir.joinpath('current.log').resolve().name)
    assert log_path.name.endswith('.log')
    log = log_path.read_text()
    warning = 'WARNING dashboard publication disabled: missing {}'.format(config)
    expected = int(not configured and environment in ('test', 'prod'))
    assert log.count(warning) == expected, log
    assert log.count('fixture stdout') == 3 and log.count('fixture stderr') == 3, log
    assert 'attempt_failed' in log and 'exit_code=7' in log, log
    assert not (deployment / 'runtime' / '1' / 'request.log').exists()
    identities = (root / 'identities').read_text().splitlines()
    assert len(identities) == 3 and len(set(x.split()[0] for x in identities)) == 1
    assert len(set(x.split()[1] for x in identities)) == 3
    assert all(x.split()[1] in log for x in identities)
    previous_size = log_path.stat().st_size
    subprocess.run(['bash', str(dist / 'poller.sh'), environment, '1'],
                   cwd=str(root), env=env, check=True, timeout=5)
    assert log_path.stat().st_size > previous_size
    restarted = (root / 'identities').read_text().splitlines()
    assert len(restarted) == 6 and restarted[3].split()[0] != identities[0].split()[0]


def check_initial_log_failure(root):
    deployment = root / 'test'
    dist = deployment / 'dist'
    dist.mkdir(parents=True)
    shutil.copyfile(REPO / 'converter/poller.sh', dist / 'poller.sh')
    shutil.copyfile(REPO / 'converter/runner-log.py', dist / 'runner-log.py')
    (deployment / 'logs').write_text('blocks log directory')
    marker = root / 'received-work'
    stubs = root / 'stubs'
    stubs.write_text('flock() { return 0; }\ntimeout() { touch "$TM_WORK_MARKER"; }\n')
    env = dict(os.environ, BASH_ENV=str(stubs), TM_WORK_MARKER=str(marker))
    result = subprocess.run(['bash', str(dist / 'poller.sh'), 'test', '1'],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            universal_newlines=True, timeout=5)
    assert result.returncode != 0 and not marker.exists()


def check_midnight_rotation(root):
    deployment = root / 'prod'
    dist = deployment / 'dist'
    dist.mkdir(parents=True)
    shutil.copyfile(REPO / 'converter/poller.sh', dist / 'poller.sh')
    helper = dist / 'runner-log.py'
    helper.write_text('''import datetime, os, runpy, sys
counter = os.environ['TM_DATE_COUNTER']
try:
    with open(counter) as handle: number = int(handle.read())
except IOError:
    number = 0
with open(counter, 'w') as handle: handle.write(str(number + 1))
day = datetime.date(2026, 9, 23 if number < 2 else 24)
print(runpy.run_path(os.environ['TM_REAL_LOG_HELPER'])['prepare'](sys.argv[1], sys.argv[2], day))
''')
    stubs = root / 'stubs'
    stubs.write_text('''
flock() { return 0; }
timeout() {
    TM_REQUESTS=$(( ${TM_REQUESTS:-0} + 1 ))
    echo "child iteration $TM_REQUESTS"
    if [[ $TM_REQUESTS -eq 2 ]]; then exit 0; fi
}
''')
    env = dict(os.environ, BASH_ENV=str(stubs), TM_REQUESTS='0',
               TM_DATE_COUNTER=str(root / 'counter'),
               TM_REAL_LOG_HELPER=str(REPO / 'converter/runner-log.py'))
    subprocess.run(['bash', str(dist / 'poller.sh'), 'prod', '1'], env=env,
                   check=True, timeout=5)
    previous = (deployment / 'logs/1/2026-09-23.log').read_text()
    current = (deployment / 'logs/1/2026-09-24.log').read_text()
    assert 'child iteration 1' in previous and 'attempt_exit' in previous
    assert 'child iteration 2' in current and 'runner_log_open' in current
    assert (deployment / 'logs/1/current.log').resolve().name == '2026-09-24.log'


def check_graceful_stop(root):
    deployment = root / 'test'
    dist = deployment / 'dist'
    dist.mkdir(parents=True)
    shutil.copyfile(REPO / 'converter/poller.sh', dist / 'poller.sh')
    shutil.copyfile(REPO / 'converter/runner-log.py', dist / 'runner-log.py')
    stubs = root / 'stubs'
    stubs.mkdir()
    timeout_stub = stubs / 'timeout'
    timeout_stub.write_text('#!/bin/bash\ntouch "$TM_STOP_MARKER"\nsleep 0.25\necho completed-work\n')
    timeout_stub.chmod(0o755)
    marker = root / 'started'
    env = dict(os.environ, PATH=str(stubs) + os.pathsep + os.environ['PATH'],
               TM_STOP_MARKER=str(marker))
    poller = subprocess.Popen(['bash', str(dist / 'poller.sh'), 'test', '1'],
                              env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 3
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert marker.exists(), 'poller did not launch its first attempt'
        poller.send_signal(signal.SIGTERM)
        assert poller.wait(timeout=3) == 0
        daily = (deployment / 'logs/1/current.log').resolve().read_text()
        assert daily.count('attempt_start ') == 1, daily
        assert 'completed-work' in daily and 'attempt_exit ' in daily, daily
        assert 'runner_stop ' in daily, daily
    finally:
        if poller.poll() is None:
            poller.kill()
            poller.wait(timeout=3)


def check_boot_helper(root):
    base = root / 'touch-mapper'
    for environment in ('test', 'prod'):
        dist = base / environment / 'dist'
        dist.mkdir(parents=True)
        shutil.copyfile(REPO / 'converter/runner-log.py', dist / 'runner-log.py')
        poller = dist / 'poller.sh'
        poller.write_text('#!/bin/bash\necho "$1/$2" >> "$TM_BOOT_LOG"\n')
        poller.chmod(0o755)
    helper = base / 'test/dist/ec2-restart-pollers.sh'
    shutil.copyfile(REPO / 'install/ec2-restart-pollers.sh', helper)
    stubs = root / 'stubs'
    stubs.mkdir()
    sudo = stubs / 'sudo'
    sudo.write_text('#!/bin/bash\nexit 0\n')
    sudo.chmod(0o755)
    boot_log = root / 'boot.log'
    env = dict(os.environ, PATH=str(stubs) + os.pathsep + os.environ['PATH'], TM_BOOT_LOG=str(boot_log))
    subprocess.run(['bash', str(helper)], env=env, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
    deadline = time.monotonic() + 3
    while (not boot_log.exists() or len(boot_log.read_text().splitlines()) < 4) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sorted(boot_log.read_text().splitlines()) == ['prod/1', 'prod/2', 'prod/3', 'test/1']
    for environment, workers in (('test', ('1',)), ('prod', ('1', '2', '3'))):
        for worker in workers:
            assert (base / environment / 'logs' / worker / 'current.log').is_symlink()
    (base / 'prod/dist/runner-log.py').unlink()
    boot_log.write_text('')
    subprocess.run(['bash', str(helper)], env=env, check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
    deadline = time.monotonic() + 3
    while len(boot_log.read_text().splitlines()) < 4 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert sorted(boot_log.read_text().splitlines()) == ['prod/1', 'prod/2', 'prod/3', 'test/1']
    assert (base / 'prod/runtime/1/poller.log').stat().st_mode & 0o777 == 0o600


def main():
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / '.tmp'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(base)], check=True)
    cases = [('test', False, False), ('prod', False, False),
             ('test', True, False), ('prod', True, False),
             ('dev-fixture', False, False), ('test', False, True)]
    with tempfile.TemporaryDirectory(prefix='poller-startup-', dir=str(base)) as directory:
        for index, case in enumerate(cases):
            check_startup(Path(directory) / str(index), *case)
        check_boot_helper(Path(directory) / 'boot-case')
        check_initial_log_failure(Path(directory) / 'log-failure')
        check_midnight_rotation(Path(directory) / 'rotation')
        check_graceful_stop(Path(directory) / 'graceful-stop')
    print('Poller logging, UTC rotation, graceful stop, and one-test/three-prod boot passed')


if __name__ == '__main__':
    main()
