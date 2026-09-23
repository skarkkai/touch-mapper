#!/usr/bin/env python3
"""Small offline regression suite; add named commands to checks below."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[2]


def run_checks(checks, work, verbose=False):
    """Run isolated checks, retaining their output when any check fails."""
    for name, command in checks:
        tick = time.monotonic()
        if verbose:
            print('RUN ' + name, flush=True)
        try:
            result = subprocess.run(command, cwd=str(REPO), stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, universal_newlines=True,
                                    timeout=25, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
        except subprocess.TimeoutExpired as error:
            output = error.stdout or ''
            if isinstance(output, bytes):
                output = output.decode('utf-8', errors='replace')
            (work / (name.replace(' ', '-') + '.log')).write_text(output)
            print('FAIL {} (timed out after {}s)\n{}\nArtifacts: {}'.format(
                name, error.timeout, output.rstrip(), work), file=sys.stderr)
            return False
        except OSError as error:
            print('FAIL {}: {}\nArtifacts: {}'.format(name, error, work), file=sys.stderr)
            return False
        (work / (name.replace(' ', '-') + '.log')).write_text(result.stdout)
        if result.returncode:
            print('FAIL {} (exit {})\n{}\nArtifacts: {}'.format(
                name, result.returncode, result.stdout.rstrip(), work), file=sys.stderr)
            return False
        if verbose:
            print('PASS {} ({:.2f}s)'.format(name, time.monotonic() - tick), flush=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verbose', action='store_true', help='show each check and its timing')
    parser.add_argument('--keep-logs', action='store_true', help='retain every check log after success')
    args = parser.parse_args()
    started = time.monotonic()
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', '.tmp/regression'], check=True)
    work = Path(tempfile.mkdtemp(prefix='run-', dir=str(REPO / '.tmp/regression')))
    checks = [
        ('Regression reporting', [sys.executable, str(REPO / 'test/regression/runner_reporting.py'), str(work)]),
        ('Temporary artifact helper', [sys.executable, str(REPO / 'test/regression/tmpctl.py'), str(work)]),
        ('Nightly dashboard', [sys.executable, str(REPO / 'test/regression/dashboard.py'), str(work)]),
        ('Dashboard chart scaling', ['node', str(REPO / 'test/regression/dashboard_charts.js')]),
        ('AWS runtime Python 3.5', [str(REPO / 'blender/blender'), '--background',
                                  '--factory-startup', '--threads', '1', '--python-exit-code', '1',
                                  '--python', str(REPO / 'test/regression/aws_runtime.py'),
                                  '--', str(work)]),
        ('Dashboard maintenance', [sys.executable, str(REPO / 'test/regression/dashboard_maintenance.py'), str(work)]),
        ('Poller startup', [sys.executable, str(REPO / 'test/regression/poller_startup.py'), str(work)]),
        ('Poller restart', [sys.executable, str(REPO / 'test/regression/poller_restart.py'), str(work)]),
        ('Runner log rotation', [sys.executable, str(REPO / 'test/regression/runner_logs.py'), str(work)]),
        ('Attempt telemetry', [sys.executable, str(REPO / 'test/regression/attempt_telemetry.py'), str(work)]),
        ('Subprocess timing', [sys.executable, str(REPO / 'test/regression/subprocess_timing.py')]),
        ('Print dimensions', [sys.executable, str(REPO / 'test/regression/rectangular_maps.py')]),
        ('Stored print dimensions', ['node', str(REPO / 'test/regression/stored_print_dimensions.js')]),
        ('Local preview routes', [sys.executable, str(REPO / 'test/regression/local_preview.py'), str(work)]),
        ('3D preview sizing', ['node', str(REPO / 'test/regression/model_preview.js')]),
        ('Map history', ['node', str(REPO / 'test/regression/map_history.js')]),
        ('Result history notices', ['node', str(REPO / 'test/regression/result_history.js')]),
        ('Map cards', ['node', str(REPO / 'test/regression/map_cards.js')]),
        ('Print unit inputs', ['node', str(REPO / 'test/regression/print_units.js')]),
        ('Named roads', [sys.executable, str(REPO / 'test/regression/named_roads.py'), str(work)]),
        ('Way segment descriptions', ['node', str(REPO / 'test/regression/way_segments.js')]),
        ('Road border locations', ['node', str(REPO / 'test/regression/road_border_locations.js')]),
        ('Roundabout connections', [sys.executable, str(REPO / 'test/regression/roundabout_connections.py'), str(work)]),
        ('Way plural descriptions', ['node', str(REPO / 'test/regression/way_plurals.js')]),
        ('Map description semantics', ['node', str(REPO / 'test/regression/map_description_semantics.js')]),
        ('Area description semantics', ['node', str(REPO / 'test/regression/area_semantics.js')]),
        ('POI description semantics', ['node', str(REPO / 'test/regression/poi_semantics.js')]),
        ('Area group descriptions', ['node', str(REPO / 'test/regression/area_groups.js')]),
        ('Content filtering', [sys.executable, str(REPO / 'test/regression/content_filter.py'), str(work)]),
        ('Big roads pruning', [sys.executable, str(REPO / 'test/regression/big_roads.py'), str(work)]),
        ('STL export geometry', [str(REPO / 'blender/blender'), '--background',
                                 '--factory-startup', '--threads', '1', '--python-exit-code', '1',
                                 '--python', str(REPO / 'test/regression/stl_exports.py'),
                                 '--', str(REPO), str(work)]),
        ('Deployment gates', [sys.executable, str(REPO / 'test/regression/deployment_gates.py'), str(work)]),
    ]
    print('Running {} offline regression checks...'.format(len(checks)), flush=True)
    if not run_checks(checks, work, args.verbose):
        return 1
    if args.keep_logs:
        print('Logs: {}'.format(work))
    else:
        subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'rm', str(work)], check=True)
    print('Regression suite passed: {} checks ({:.2f}s)'.format(len(checks), time.monotonic() - started))
    return 0


if __name__ == '__main__':
    sys.exit(main())
