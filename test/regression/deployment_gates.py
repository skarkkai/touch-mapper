"""Check real deployment entrypoints in a disposable repository with offline stubs."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]


# Make executable substitutes that record whether deployment reached them.
def script(path, body):
    path.write_text('#!/bin/bash\nset -e\n' + body + '\n')
    path.chmod(0o755)


# Exercise actual Make recipes and scripts without giving them remote tools.
def main():
    fixture = Path(sys.argv[1]) / 'deployment'
    for directory in ('install', 'test/regression', 'web', 'stubs'):
        (fixture / directory).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO / 'Makefile', fixture / 'Makefile')
    # A case-insensitive Mac resolves the OSM2World directory as the build target.
    # Simulate that name collision on every host; the command must still run.
    (fixture / 'osm2world').mkdir(exist_ok=True)
    build = subprocess.run(['make', '-n', 'osm2world'], cwd=str(fixture), check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True)
    assert 'ant clean jar' in build.stdout, build.stdout
    for name in ('web-s3.sh', 'lambda-update.sh', 'cloudformation-update.sh'):
        shutil.copy2(REPO / 'install' / name, fixture / 'install' / name)
    (fixture / 'test/regression/run.py').write_text(
        "import os, sys, time\n"
        "with open(os.environ['GATE_LOG'], 'a') as f: f.write('gate-start\\n')\n"
        "time.sleep(0.05)\n"
        "with open(os.environ['GATE_LOG'], 'a') as f: f.write('gate-end\\n')\n"
        "sys.exit(int(os.environ['GATE_RESULT']))\n")
    script(fixture / 'install/package.sh', 'echo package >> "$GATE_LOG"')
    # Stop a successful direct-script check at its first post-gate step.
    script(fixture / 'install/parameters.sh', 'echo parameters >> "$GATE_LOG"\necho "exit 0"')
    for name in ('ssh', 'rsync', 'aws'):
        script(fixture / 'stubs' / name, 'echo ' + name + ' >> "$GATE_LOG"')
    env = dict(os.environ)
    for key in ('MAKEFLAGS', 'MFLAGS', 'MAKELEVEL'):
        env.pop(key, None)
    env['PATH'] = str(fixture / 'stubs') + os.pathsep + env['PATH']
    log = fixture / 'events'
    env['GATE_LOG'] = str(log)
    cases = []
    for name in ('web-s3.sh', 'lambda-update.sh', 'cloudformation-update.sh'):
        for mode in ('test', 'prod'):
            cases.append(([str(fixture / 'install' / name), mode], ['parameters']))
    for target, after in [('test-install-ec2', ['package', 'rsync', 'ssh']),
                          ('test-restart', ['package', 'ssh']),
                          ('prod-install-ec2', ['package', 'ssh', 'ssh']),
                          ('test-web-s3-install', ['parameters']),
                          ('test-aws-install', ['parameters', 'gate-start', 'gate-end', 'parameters']),
                          ('prod-aws-install', ['parameters'])]:
        cases.append((['make', '-j8', target], after))
    for command, after in cases:
        for status in (1, 0):
            log.write_text('')
            env['GATE_RESULT'] = str(status)
            result = subprocess.run(command, cwd=str(fixture), env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    universal_newlines=True, timeout=5)
            events = log.read_text().splitlines()
            expected = ['gate-start', 'gate-end'] + ([] if status else after)
            assert events == expected, (command, status, events, expected, result.stdout)
            assert (result.returncode != 0) == bool(status), (command, result.stdout)
    # Development entrypoints and standalone packaging retain their previous behavior.
    for command, expected in [(['make', 'package'], ['package']),
                              (['make', 'dev-web-s3-install'], ['parameters']),
                              (['make', 'dev-aws-install'], ['parameters', 'parameters']),
                              (['make', 'prod-web-s3-install'], [])]:
        log.write_text('')
        subprocess.run(command, cwd=str(fixture), env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert log.read_text().splitlines() == expected
    print('Direct scripts, parallel Make, failure barriers, and unchanged dev/package behavior passed')


if __name__ == '__main__':
    main()
