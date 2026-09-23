#!/usr/bin/env python3
"""Request one dashboard publication after a successful map in this deployment."""
import os
import uuid

from stats_pipeline import _write_small_text_atomic


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _write_small_text_atomic(os.path.join(root, 'dashboard-refresh.txt'), uuid.uuid4().hex)
    print('Dashboard refresh queued for a successful map handled by a new request process in ' + root)


if __name__ == '__main__':
    main()
