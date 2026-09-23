#!/usr/bin/env python3
"""Gracefully replace an environment's pollers with the requested runner count.

This script is sent over SSH on stdin, so it also works before it is installed in dist.
"""
import argparse
import errno
import fcntl
import os
import signal
import subprocess
import sys
import time

DEFAULT_WAIT_SECONDS = 660  # The poller's 10-minute timeout plus shutdown grace.
STARTUP_WAIT_SECONDS = 8


def poller_processes(environment_dir, environment):
    """Find only poller.sh processes for this deployment, including old subshells."""
    dist_dir = os.path.realpath(os.path.join(environment_dir, 'dist'))
    poller_path = os.path.join(dist_dir, 'poller.sh')
    found = {}
    for name in os.listdir('/proc'):
        if not name.isdigit() or int(name) == os.getpid():
            continue
        pid = int(name)
        try:
            with open('/proc/{}/cmdline'.format(pid), 'rb') as source:
                args = [part.decode('utf8', errors='replace')
                        for part in source.read().split(b'\0') if part]
        except (IOError, OSError):
            continue
        for index, token in enumerate(args):
            if os.path.basename(token) != 'poller.sh' or index + 3 != len(args):
                continue
            if args[index + 1] != environment or not args[index + 2].isdigit():
                continue
            if os.path.isabs(token):
                matches = os.path.realpath(token) == poller_path
            elif os.path.normpath(token).endswith(environment + '/dist/poller.sh'):
                matches = True
            else:
                try:
                    process_cwd = os.path.realpath('/proc/{}/cwd'.format(pid))
                    matches = os.path.realpath(os.path.join(process_cwd, token)) == poller_path
                except OSError:
                    matches = False
            if matches:
                found[pid] = args[index + 2]
            break
    return found


def worker_lock_available(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (IOError, OSError) as error:
            if error.errno in (errno.EAGAIN, errno.EACCES):
                return False
            raise
        fcntl.flock(fd, fcntl.LOCK_UN)
        return True
    finally:
        os.close(fd)


def active_lock_paths(environment_dir, desired_count):
    runtime_dir = os.path.join(environment_dir, 'runtime')
    if not os.path.isdir(runtime_dir):
        os.mkdir(runtime_dir, 0o700)
    names = set(str(number) for number in range(1, desired_count + 1))
    for name in os.listdir(runtime_dir):
        if name.isdigit() and os.path.isfile(os.path.join(runtime_dir, name, 'lockfile')):
            names.add(name)
    paths = []
    for name in sorted(names, key=int):
        worker_dir = os.path.join(runtime_dir, name)
        if not os.path.isdir(worker_dir):
            os.mkdir(worker_dir, 0o700)
        paths.append(os.path.join(worker_dir, 'lockfile'))
    return paths


def wait_for_stop(environment_dir, environment, lock_paths, wait_seconds):
    deadline = time.monotonic() + wait_seconds
    next_report = time.monotonic() + 30
    while True:
        running = poller_processes(environment_dir, environment)
        locked = [path for path in lock_paths if not worker_lock_available(path)]
        if not running and not locked:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Timed out waiting for old {} pollers and worker locks to stop; no new poller started'.format(environment))
        if time.monotonic() >= next_report:
            print('Waiting for {} pollers to drain: pids={} locks={}'.format(
                environment, sorted(running), [os.path.basename(os.path.dirname(path)) for path in locked]), flush=True)
            next_report = time.monotonic() + 30
        time.sleep(0.2)


def daily_log_path(environment_dir, worker):
    helper = os.path.join(environment_dir, 'dist', 'runner-log.py')
    if os.path.isfile(helper):
        output = subprocess.check_output([sys.executable, helper, environment_dir, worker])
        return output.decode('utf8').strip()
    # Support the installed distribution during a test-first migration.
    path = os.path.join(environment_dir, 'runtime', worker, 'poller.log')
    print('WARNING: installed distribution has no runner-log.py; using {}'.format(path), file=sys.stderr)
    return path


def start_poller(environment_dir, environment, worker):
    dist_dir = os.path.join(environment_dir, 'dist')
    poller_path = os.path.join(dist_dir, 'poller.sh')
    if not os.path.isfile(poller_path):
        raise RuntimeError('Missing deployed poller: {}'.format(poller_path))
    log_path = daily_log_path(environment_dir, worker)
    fd = os.open(log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
        process_env = os.environ.copy()
        process_env['LC_ALL'] = 'en_US.UTF-8'
        process = subprocess.Popen([poller_path, environment, worker],
                                   cwd=dist_dir, env=process_env, stdin=subprocess.DEVNULL,
                                   stdout=fd, stderr=subprocess.STDOUT,
                                   start_new_session=True, close_fds=True)
    finally:
        os.close(fd)
    lock_path = os.path.join(environment_dir, 'runtime', worker, 'lockfile')
    deadline = time.monotonic() + STARTUP_WAIT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError('Poller {} exited during startup (status {}); see {}'.format(
                worker, process.returncode, log_path))
        if not worker_lock_available(lock_path):
            # Do not report a process that acquired the lock and exited immediately.
            time.sleep(0.3)
            if process.poll() is None and not worker_lock_available(lock_path):
                return process.pid, log_path
        time.sleep(0.1)
    raise RuntimeError('Poller {} did not acquire its worker lock; see {}'.format(worker, log_path))


def restart(environment_dir, desired_count, wait_seconds=DEFAULT_WAIT_SECONDS):
    environment_dir = os.path.realpath(environment_dir)
    environment = os.path.basename(environment_dir)
    if environment not in ('test', 'prod') or desired_count < 1 or desired_count > 3:
        raise ValueError('expected a test/prod environment and one to three runners')
    if not os.path.isdir(os.path.join(environment_dir, 'dist')):
        raise RuntimeError('Missing deployed dist directory in {}'.format(environment_dir))
    restart_lock = os.path.join(environment_dir, '.restart.lock')
    fd = os.open(restart_lock, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = poller_processes(environment_dir, environment)
        print('Stopping {} {} poller process(es) in {}'.format(len(old), environment, environment_dir), flush=True)
        for pid in old:
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError as error:
                if error.errno != errno.ESRCH:
                    raise
        wait_for_stop(environment_dir, environment,
                      active_lock_paths(environment_dir, desired_count), wait_seconds)
        started = []
        for number in range(1, desired_count + 1):
            pid, log_path = start_poller(environment_dir, environment, str(number))
            started.append(pid)
            print('Started {} runner {} pid={} log={}'.format(environment, number, pid, log_path), flush=True)
        return started


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment_dir')
    parser.add_argument('runner_count', type=int)
    parser.add_argument('--wait-seconds', type=float, default=DEFAULT_WAIT_SECONDS)
    args = parser.parse_args()
    try:
        restart(args.environment_dir, args.runner_count, args.wait_seconds)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print('Poller restart failed: {}'.format(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
