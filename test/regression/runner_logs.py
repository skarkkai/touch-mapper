"""Private UTC daily log append, rotation, cleanup, and unrelated-file boundaries."""
import datetime
import importlib.util
import multiprocessing
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runner_log', str(REPO / 'converter/runner-log.py'))
runner_log = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner_log)


def concurrent_open(root, runner, today):
    runner_log.prepare(root, runner, today)


def main():
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / '.tmp'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(base)], check=True)
    with tempfile.TemporaryDirectory(prefix='runner-logs-', dir=str(base)) as directory:
        root = Path(directory)
        today = datetime.date(2026, 9, 23)
        logs = root / 'logs'
        retired = logs / '9'
        retired.mkdir(parents=True)
        keep = retired / '2026-08-25.log'  # today minus 29 dates
        expire = retired / '2026-08-24.log'
        older = retired / '2026-08-23.log'
        for path in (keep, expire, older):
            path.write_text(path.name)
        unrelated = retired / 'notes.txt'
        unrelated.write_text('preserve')
        malformed = retired / '2026-13-23.log'
        malformed.write_text('preserve')
        path1 = Path(runner_log.prepare(str(root), '1', today))
        assert path1.name == '2026-09-23.log'
        assert not expire.exists() and not older.exists()
        assert keep.exists() and unrelated.exists() and malformed.exists()
        with path1.open('a') as handle:
            handle.write('before restart\n')
        assert Path(runner_log.prepare(str(root), '1', today)) == path1
        with path1.open('a') as handle:
            handle.write('after restart\n')
        assert path1.read_text() == 'before restart\nafter restart\n'
        path2 = Path(runner_log.prepare(str(root), '2', today))
        assert path2 != path1 and path2.parent.name == '2'
        assert keep.exists()  # exact boundary on today
        next_day = today + datetime.timedelta(days=1)
        rotated = Path(runner_log.prepare(str(root), '1', next_day))
        assert rotated.name == '2026-09-24.log'
        assert (rotated.parent / 'current.log').resolve() == rotated
        assert (path2.parent / 'current.log').resolve() == path2
        assert stat.S_IMODE(path1.stat().st_mode) == 0o600
        assert stat.S_IMODE(rotated.parent.stat().st_mode) == 0o700
        assert stat.S_IMODE(logs.stat().st_mode) == 0o700
        assert not keep.exists()  # expired on the next UTC day
        runner_log.prepare(str(root), '2', next_day + datetime.timedelta(days=1))
        assert not keep.exists()  # retired runner is also reaped
        assert unrelated.exists() and malformed.exists()
        assert (logs / '.cleanup.lock').exists()
        concurrent_day = next_day + datetime.timedelta(days=2)
        retired_old = retired / '2026-08-26.log'
        retired_old.write_text('old')
        processes = [multiprocessing.Process(target=concurrent_open,
                                             args=(str(root), runner, concurrent_day))
                     for runner in ('1', '2')]
        for process in processes:
            process.start()
        for process in processes:
            process.join(timeout=3)
            assert process.exitcode == 0
        assert not retired_old.exists()
        assert (logs / '.last-cleanup-utc').read_text().strip() == concurrent_day.isoformat()
        fresh = root / 'fresh'
        fresh.mkdir()
        new_processes = [multiprocessing.Process(target=concurrent_open,
                                                 args=(str(fresh), runner, today))
                         for runner in ('1', '2')]
        for process in new_processes:
            process.start()
        for process in new_processes:
            process.join(timeout=3)
            assert process.exitcode == 0
        assert (fresh / 'logs/1/current.log').is_symlink()
        assert (fresh / 'logs/2/current.log').is_symlink()
        try:
            runner_log.prepare(str(root), '../escape', today)
            assert False, 'invalid runner name accepted'
        except ValueError:
            pass
    print('Runner logs append, rotate, retain exactly 30 dates, and reap retired runners')


if __name__ == '__main__':
    main()
