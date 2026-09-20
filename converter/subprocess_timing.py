"""Portable subprocess peak-memory measurements, normalized to KiB."""

import os
import re
import sys
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
