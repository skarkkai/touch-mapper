"""Portable subprocess peak-memory measurements, normalized to KiB."""

import os
import re
import sys
import threading
from typing import List, Optional, Tuple


_LINUX_MAX_RSS_RE = re.compile(
    r'^\s*Maximum resident set size \(kbytes\):\s*([0-9]+)\s*$', re.MULTILINE)
_MACOS_MAX_RSS_RE = re.compile(
    r'^\s*([0-9]+)\s+maximum resident set size\s*$', re.MULTILINE)


# Select the native time interface; unsupported hosts still run the command.
def timed_command(cmd: List[str]) -> Tuple[List[str], Optional[str]]:
    if os.path.exists('/usr/bin/time'):
        if sys.platform == 'linux':
            return ['/usr/bin/time', '-v'] + list(cmd), 'linux'
        if sys.platform == 'darwin':
            return ['/usr/bin/time', '-l'] + list(cmd), 'darwin'
    return list(cmd), None


# macOS reports bytes while GNU time reports KiB; keep telemetry units stable.
def parse_max_rss_kib(stderr: str, time_style: Optional[str]) -> Optional[int]:
    if time_style == 'linux':
        match = _LINUX_MAX_RSS_RE.search(stderr)
        return int(match.group(1)) if match else None
    if time_style == 'darwin':
        match = _MACOS_MAX_RSS_RE.search(stderr)
        return int(match.group(1)) // 1024 if match else None
    return None


def stream_subprocess_output(process, output_log_path=None, capture_limit=1024 * 1024):
    """Tee both pipes live; retain a bounded tail for error and RSS parsing."""
    lock = threading.Lock()
    captured = [bytearray(), bytearray()]
    errors = []
    output_file = None
    if output_log_path:
        fd = None
        try:
            fd = os.open(output_log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            os.fchmod(fd, 0o600)
            output_file = os.fdopen(fd, 'wb')
        except OSError:
            if fd is not None:
                os.close(fd)
            process.kill()
            process.wait()
            process.stdout.close()
            process.stderr.close()
            raise

    def drain(pipe, index):
        try:
            while True:
                chunk = os.read(pipe.fileno(), 4096)
                if not chunk:
                    break
                captured[index].extend(chunk)
                if len(captured[index]) > capture_limit:
                    del captured[index][:-capture_limit]
                with lock:
                    # The poller directs stdout and stderr into one daily log.
                    try:
                        sys.stdout.write(chunk.decode('utf-8', errors='replace'))
                        sys.stdout.flush()
                        if output_file:
                            output_file.write(chunk)
                            output_file.flush()
                    except Exception as error:
                        # Continue draining so a full pipe cannot hang the child.
                        if not errors:
                            errors.append(error)
        except Exception as error:
            errors.append(error)
        finally:
            pipe.close()

    threads = [threading.Thread(target=drain, args=(process.stdout, 0)),
               threading.Thread(target=drain, args=(process.stderr, 1))]
    for thread in threads:
        thread.daemon = True
        thread.start()
    try:
        process.wait()
        for thread in threads:
            thread.join()
    finally:
        if output_file:
            output_file.close()
    if errors:
        raise errors[0]
    return bytes(captured[0]), bytes(captured[1])
