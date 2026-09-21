"""Check dashboard startup warnings through the real poller loop, offline."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]


# Run three request iterations with fake remote work and portable lock/date commands.
def check_startup(root: Path, environment: str, configured: bool, locked: bool = False):
    deployment = root / environment
    dist = deployment / 'dist'
    dist.mkdir(parents=True)
    (deployment / 'runtime').mkdir()
    shutil.copyfile(REPO / 'converter/poller.sh', dist / 'poller.sh')
    config = deployment / 'dashboard.env'
    if configured:
        config.write_text('[dashboard]\n')
    shell_stubs = root / 'shell-stubs'
    shell_stubs.write_text('''
flock() { return "$POLLER_TEST_LOCK_STATUS"; }
date() { printf 'fixture startup time\\n'; }
timeout() {
    POLLER_TEST_REQUESTS=$(( ${POLLER_TEST_REQUESTS:-0} + 1 ))
    echo "PROGRESS fixture iteration $POLLER_TEST_REQUESTS"
    if [[ $POLLER_TEST_REQUESTS -eq 3 ]]; then exit 0; fi
}
''')
    env = dict(os.environ, BASH_ENV=str(shell_stubs),
               POLLER_TEST_LOCK_STATUS='1' if locked else '0', POLLER_TEST_REQUESTS='0')
    result = subprocess.run(['bash', str(dist / 'poller.sh'), environment, '1'],
                            cwd=str(root), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, universal_newlines=True, timeout=5)
    assert result.returncode == (1 if locked else 0), result.stdout
    worker = deployment / 'runtime' / '1'
    log = (worker / 'poller.log').read_text()
    warning = 'WARNING: dashboard publication disabled for {}: missing {}'.format(environment, config)
    expected = int(not locked and not configured and environment in ('test', 'prod'))
    assert log.count(warning) == expected, log
    assert log.count('WARNING:') == expected, log
    if locked:
        assert not (worker / 'request.log').exists()
    else:
        assert log.count('last progress marker before poller loop iteration end:') == 2, log
        assert 'PROGRESS fixture iteration 3' in (worker / 'request.log').read_text()


# Cover enabled environments, existing config, disabled development, and lock contention.
def main():
    base = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / '.tmp'
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(base)], check=True)
    cases: list[tuple[str, bool, bool]] = [
        ('test', False, False), ('prod', False, False),
        ('test', True, False), ('prod', True, False),
        ('dev-fixture', False, False), ('test', False, True),
    ]
    with tempfile.TemporaryDirectory(prefix='poller-startup-', dir=str(base)) as directory:
        for index, case in enumerate(cases):
            check_startup(Path(directory) / str(index), *case)
    print('Poller warns once at startup for missing dashboard config and keeps processing')


if __name__ == '__main__':
    main()
