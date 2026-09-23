#!/usr/bin/env python3
"""Open a private UTC daily runner log and reap expired logs for one environment."""
import datetime
import fcntl
import os
import re
import sys

LOG_NAME = re.compile(r'^\d{4}-\d{2}-\d{2}\.log$')
RUNNER_NAME = re.compile(r'^[0-9]+$')
RETENTION_DAYS = 30


def prepare(environment_dir, runner, today=None):
    if not RUNNER_NAME.match(runner):
        raise ValueError('runner name must be numeric')
    today = today or datetime.datetime.utcnow().date()
    root = os.path.join(environment_dir, 'logs')
    runner_dir = os.path.join(root, runner)
    for directory in (root, runner_dir):
        try:
            os.mkdir(directory, 0o700)
        except OSError:
            if not os.path.isdir(directory) or os.path.islink(directory):
                raise
        os.chmod(directory, 0o700)
    filename = today.isoformat() + '.log'
    path = os.path.join(runner_dir, filename)
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    os.close(fd)
    os.chmod(path, 0o600)
    link = os.path.join(runner_dir, 'current.log')
    temporary_link = os.path.join(runner_dir, '.current-' + str(os.getpid()))
    try:
        os.symlink(filename, temporary_link)
        os.replace(temporary_link, link)
    finally:
        if os.path.lexists(temporary_link):
            os.unlink(temporary_link)
    try:
        reap(root, today)
    except OSError as error:
        print('{} WARNING runner_log_cleanup_failed error={}'.format(
            datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z', error), file=sys.stderr)
    return path


def reap(root, today):
    lock_path = os.path.join(root, '.cleanup.lock')
    fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
    os.fchmod(fd, 0o600)
    try:
        with os.fdopen(fd, 'r+') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            marker = os.path.join(root, '.last-cleanup-utc')
            try:
                with open(marker) as source:
                    if source.read().strip() == today.isoformat():
                        return
            except IOError:
                pass
            oldest = today - datetime.timedelta(days=RETENTION_DAYS - 1)
            for runner in os.listdir(root):
                if not RUNNER_NAME.match(runner):
                    continue
                runner_dir = os.path.join(root, runner)
                if not os.path.isdir(runner_dir) or os.path.islink(runner_dir):
                    continue
                for name in os.listdir(runner_dir):
                    if not LOG_NAME.match(name):
                        continue
                    try:
                        date = datetime.datetime.strptime(name[:10], '%Y-%m-%d').date()
                    except ValueError:
                        continue
                    if date < oldest:
                        path = os.path.join(runner_dir, name)
                        if os.path.isfile(path) and not os.path.islink(path):
                            os.unlink(path)
            with open(marker, 'w') as target:
                target.write(today.isoformat() + '\n')
            os.chmod(marker, 0o600)
    except Exception:
        # fdopen owns the descriptor after entry; an exception before entry does not.
        try:
            os.close(fd)
        except OSError:
            pass
        raise


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: runner-log.py ENVIRONMENT_DIR RUNNER_NUMBER')
    print(prepare(sys.argv[1], sys.argv[2]))


if __name__ == '__main__':
    main()
