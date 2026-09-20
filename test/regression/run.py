#!/usr/bin/env python3
"""Small offline regression suite; add named commands to checks below."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]


# Run each check in isolation and retain diagnostics when anything fails.
def main():
    started = time.monotonic()
    subprocess.run([str(REPO / 'bin/tmpctl'), 'mkdir', '.tmp/regression'], check=True)
    work = Path(tempfile.mkdtemp(prefix='run-', dir=str(REPO / '.tmp/regression')))
    checks = [
        ('Print dimensions', [sys.executable, str(REPO / 'test/regression/rectangular_maps.py')]),
        ('Local preview routes', [sys.executable, str(REPO / 'test/regression/local_preview.py'), str(work)]),
        ('Map history', ['node', str(REPO / 'test/regression/map_history.js')]),
        ('Result history notices', ['node', str(REPO / 'test/regression/result_history.js')]),
        ('Map cards', ['node', str(REPO / 'test/regression/map_cards.js')]),
        ('Print unit inputs', ['node', str(REPO / 'test/regression/print_units.js')]),
        ('Named roads', [sys.executable, str(REPO / 'test/regression/named_roads.py'), str(work)]),
        ('Way segment descriptions', ['node', str(REPO / 'test/regression/way_segments.js')]),
        ('Way plural descriptions', ['node', str(REPO / 'test/regression/way_plurals.js')]),
        ('Area group descriptions', ['node', str(REPO / 'test/regression/area_groups.js')]),
        ('Content filtering', [sys.executable, str(REPO / 'test/regression/content_filter.py'), str(work)]),
        ('Big roads pruning', [sys.executable, str(REPO / 'test/regression/big_roads.py'), str(work)]),
        ('STL export geometry', [str(REPO / 'blender/blender'), '--background',
                                 '--factory-startup', '--threads', '1', '--python-exit-code', '1',
                                 '--python', str(REPO / 'test/regression/stl_exports.py'),
                                 '--', str(REPO), str(work)]),
        ('Deployment gates', [sys.executable, str(REPO / 'test/regression/deployment_gates.py'), str(work)]),
    ]
    for name, command in checks:
        tick = time.monotonic()
        print('RUN ' + name, flush=True)
        try:
            result = subprocess.run(command, cwd=str(REPO), stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, universal_newlines=True,
                                    timeout=25, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
            (work / (name.replace(' ', '-') + '.log')).write_text(result.stdout)
            if result.returncode:
                raise RuntimeError(result.stdout)
        except (OSError, subprocess.TimeoutExpired, RuntimeError) as error:
            print('FAIL {}: {}\nArtifacts: {}'.format(name, error, work), file=sys.stderr)
            return 1
        print('PASS {} ({:.2f}s)'.format(name, time.monotonic() - tick), flush=True)
    subprocess.run([str(REPO / 'bin/tmpctl'), 'rm', str(work)], check=True)
    print('Regression suite passed ({:.2f}s)'.format(time.monotonic() - started))
    return 0


if __name__ == '__main__':
    sys.exit(main())
