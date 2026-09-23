"""Environment restarts replace only their own runners and verify startup."""
import importlib.util
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('restart_poller', str(REPO / 'converter/restart-poller.py'))
restart_poller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart_poller)

FAKE_POLLER = '''#!/usr/bin/env python3
import fcntl, os, signal, sys, time
base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
worker = sys.argv[2]
work = os.path.join(base, 'runtime', worker)
os.makedirs(work, exist_ok=True)
with open(os.path.join(work, 'lockfile'), 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    with open(os.environ['TM_RESTART_EVENTS'], 'a') as events:
        events.write('start {} {} {}\\n'.format(sys.argv[1], worker, os.getpid()))
    stopping = [False]
    signal.signal(signal.SIGTERM, lambda signum, frame: stopping.__setitem__(0, True))
    while not stopping[0]:
        time.sleep(0.05)
    with open(os.environ['TM_RESTART_EVENTS'], 'a') as events:
        events.write('stop {} {} {}\\n'.format(sys.argv[1], worker, os.getpid()))
'''


def deployed_environment(root, environment):
    env_dir = root / environment
    dist = env_dir / 'dist'
    dist.mkdir(parents=True)
    poller = dist / 'poller.sh'
    poller.write_text(FAKE_POLLER)
    poller.chmod(0o755)
    shutil.copyfile(REPO / 'converter/runner-log.py', dist / 'runner-log.py')
    return env_dir, poller


def wait_for_event(events, expected):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if events.exists() and expected in events.read_text():
            return
        time.sleep(0.01)
    raise AssertionError('missing event: ' + expected)


def main():
    if not Path('/proc/self/cmdline').exists():
        print('Linux /proc restart regression skipped on this host')
        return
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / '.tmp'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(base)], check=True)
    with tempfile.TemporaryDirectory(prefix='poller-restart-', dir=str(base)) as directory:
        root = Path(directory)
        test_dir, test_poller = deployed_environment(root, 'test')
        prod_dir, prod_poller = deployed_environment(root, 'prod')
        events = root / 'events'
        env = dict(os.environ, TM_RESTART_EVENTS=str(events))
        old = []
        try:
            for environment, poller, worker in (('test', test_poller, '1'),
                                                 ('test', test_poller, '2'),
                                                 ('prod', prod_poller, '1')):
                process = subprocess.Popen([str(poller), environment, worker], env=env,
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
                old.append(process)
                wait_for_event(events, 'start {} {} {}'.format(environment, worker, process.pid))
            command = [sys.executable, str(REPO / 'converter/restart-poller.py'),
                       str(test_dir), '1', '--wait-seconds', '3']
            result = subprocess.run(command, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, universal_newlines=True, timeout=6)
            assert result.returncode == 0, result.stdout
            assert old[0].poll() is not None and old[1].poll() is not None
            assert old[2].poll() is None, 'production poller must be untouched'
            running = restart_poller.poller_processes(str(test_dir), 'test')
            assert list(running.values()) == ['1'], running
            new_pid = next(iter(running))
            assert new_pid not in (old[0].pid, old[1].pid)
            assert 'Started test runner 1 pid={}'.format(new_pid) in result.stdout
            assert (test_dir / 'logs/1/current.log').is_symlink()
            # A second restart replaces the runner again, even with a legacy deployed dist.
            (test_dir / 'dist/runner-log.py').unlink()
            second = subprocess.run(command, env=env, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, universal_newlines=True, timeout=6)
            assert second.returncode == 0, second.stdout
            again = restart_poller.poller_processes(str(test_dir), 'test')
            assert len(again) == 1 and new_pid not in again
            assert (test_dir / 'runtime/1/poller.log').stat().st_mode & 0o777 == 0o600
            assert old[2].poll() is None
            # Production restart replaces three prod runners without touching test.
            for worker in ('2', '3'):
                process = subprocess.Popen([str(prod_poller), 'prod', worker], env=env,
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL, start_new_session=True)
                old.append(process)
                wait_for_event(events, 'start prod {} {}'.format(worker, process.pid))
            test_pid = next(iter(again))
            prod_command = [sys.executable, str(REPO / 'converter/restart-poller.py'),
                            str(prod_dir), '3', '--wait-seconds', '3']
            prod_restart = subprocess.run(prod_command, env=env, stdout=subprocess.PIPE,
                                          stderr=subprocess.STDOUT, universal_newlines=True,
                                          timeout=8)
            assert prod_restart.returncode == 0, prod_restart.stdout
            assert all(process.poll() is not None for process in old[2:]), prod_restart.stdout
            prod_running = restart_poller.poller_processes(str(prod_dir), 'prod')
            assert sorted(prod_running.values()) == ['1', '2', '3'], prod_running
            assert all(pid not in [process.pid for process in old[2:]] for pid in prod_running)
            for worker in ('1', '2', '3'):
                assert 'Started prod runner {} pid='.format(worker) in prod_restart.stdout
                assert (prod_dir / 'logs' / worker / 'current.log').is_symlink()
            assert restart_poller.poller_processes(str(test_dir), 'test') == {test_pid: '1'}
            # A held worker lock without a matching poller must fail rather than claim a restart.
            blocked_dir, _ = deployed_environment(root / 'blocked', 'test')
            block_lock = blocked_dir / 'runtime/1/lockfile'
            block_lock.parent.mkdir(parents=True)
            holder = subprocess.Popen([sys.executable, '-c',
                                       'import fcntl,sys,time; f=open(sys.argv[1],"w"); '
                                       'fcntl.flock(f,fcntl.LOCK_EX); print("locked",flush=True); time.sleep(5)',
                                       str(block_lock)], stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, universal_newlines=True)
            try:
                assert holder.stdout.readline().strip() == 'locked'
                blocked = subprocess.run([sys.executable, str(REPO / 'converter/restart-poller.py'),
                                          str(blocked_dir), '1', '--wait-seconds', '0.2'],
                                         env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         universal_newlines=True, timeout=3)
                assert blocked.returncode != 0 and 'Timed out waiting' in blocked.stdout
                assert restart_poller.poller_processes(str(blocked_dir), 'test') == {}
            finally:
                holder.terminate()
                holder.wait(timeout=3)
        finally:
            for process in old:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=3)
            for environment_dir, environment in ((test_dir, 'test'), (prod_dir, 'prod')):
                for pid in restart_poller.poller_processes(str(environment_dir), environment):
                    os.kill(pid, signal.SIGTERM)
            time.sleep(0.1)
    print('Test and production restarts preserve the other environment and reject stuck locks')


if __name__ == '__main__':
    main()
