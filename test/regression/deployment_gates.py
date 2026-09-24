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
    for directory in ('install', 'test/regression', 'web', 'stubs', 'converter'):
        (fixture / directory).mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO / 'Makefile', fixture / 'Makefile')
    shutil.copyfile(REPO / 'converter/restart-poller.py', fixture / 'converter/restart-poller.py')
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
                          ('prod-install-ec2', ['package', 'ssh', 'ssh']),
                          ('test-web-s3-install', ['parameters']),
                          ('test-aws-install', ['parameters', 'parameters']),
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
    # AWS reports an unchanged stack as an error; that must be an idempotent success.
    script(fixture / 'install/parameters.sh',
           'echo stack_name=TouchMapperTest\necho env_name=test\necho is_dev_env=false\necho domain=test.touch-mapper.org')
    script(fixture / 'stubs/aws',
           'if [[ $2 == update-stack ]]; then echo "No updates are to be performed." >&2; exit 1; fi')
    log.write_text('')
    env['GATE_RESULT'] = '0'
    unchanged = subprocess.run([str(fixture / 'install/cloudformation-update.sh'), 'test'],
                               cwd=str(fixture), env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, universal_newlines=True, timeout=5)
    assert unchanged.returncode == 0 and 'already up to date' in unchanged.stdout, unchanged.stdout
    script(fixture / 'stubs/aws',
           'if [[ $2 == update-stack ]]; then echo "Access denied" >&2; exit 1; fi')
    denied = subprocess.run([str(fixture / 'install/cloudformation-update.sh'), 'test'],
                            cwd=str(fixture), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, universal_newlines=True, timeout=5)
    assert denied.returncode != 0 and 'Access denied' in denied.stdout, denied.stdout
    script(fixture / 'install/parameters.sh', 'echo parameters >> "$GATE_LOG"\necho "exit 0"')
    script(fixture / 'stubs/aws', 'echo aws >> "$GATE_LOG"')
    # Restart streams its helper over SSH and does not package or upload code.
    for target, environment, count in (('test-restart', 'test', '1'),
                                       ('prod-restart', 'prod', '3')):
        log.write_text('')
        restart = subprocess.run(['make', target], cwd=str(fixture), env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 universal_newlines=True, timeout=5)
        assert restart.returncode == 0 and log.read_text().splitlines() == ['ssh'], restart.stdout
        assert 'python3 - /home/ubuntu/touch-mapper/{} {}'.format(environment, count) in restart.stdout
    # Development entrypoints and standalone packaging retain their previous behavior.
    for command, expected in [(['make', 'package'], ['package']),
                              (['make', 'dev-web-s3-install'], ['parameters']),
                              (['make', 'dev-aws-install'], ['parameters', 'parameters']),
                              (['make', 'prod-web-s3-install'], [])]:
        log.write_text('')
        subprocess.run(command, cwd=str(fixture), env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        assert log.read_text().splitlines() == expected
    # Full wrappers must run AWS, wait for the stack, then web, EC2, and restart.
    for name, label in (('lambda-update.sh', 'lambda'),
                        ('cloudformation-update.sh', 'cloudformation'),
                        ('web-s3.sh', 'web')):
        body = 'echo {}:$1 >> "$GATE_LOG"'.format(label)
        if label == 'cloudformation':
            body += '\nexit "${DEPLOY_CF_RESULT:-0}"'
        script(fixture / 'install' / name, body)
    script(fixture / 'stubs/aws', 'echo aws:$* >> "$GATE_LOG"')
    env['GATE_RESULT'] = '0'
    for target, environment, ec2_events in (
            ('test-deploy', 'test', ['package', 'rsync', 'ssh', 'ssh']),
            ('prod-deploy', 'prod', ['package', 'ssh', 'ssh', 'ssh'])):
        log.write_text('')
        env['GATE_RESULT'] = '1'
        blocked = subprocess.run(['make', '-j8', target], cwd=str(fixture), env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 universal_newlines=True, timeout=5)
        assert blocked.returncode != 0 and log.read_text().splitlines() == [
            'gate-start', 'gate-end'], (target, blocked.stdout, log.read_text())
        log.write_text('')
        env['GATE_RESULT'] = '0'
        env['DEPLOY_CF_RESULT'] = '0'
        result = subprocess.run(['make', '-j8', target], cwd=str(fixture), env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                universal_newlines=True, timeout=5)
        expected = ['gate-start', 'gate-end'] + [
            'lambda:' + environment, 'cloudformation:' + environment,
            'aws:cloudformation wait stack-update-complete --stack-name TouchMapper' +
            environment.capitalize(), 'web:' + environment] + ec2_events
        assert result.returncode == 0 and log.read_text().splitlines() == expected, \
            (target, log.read_text(), result.stdout)
        log.write_text('')
        env['DEPLOY_CF_RESULT'] = '1'
        failed = subprocess.run(['make', target], cwd=str(fixture), env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                universal_newlines=True, timeout=5)
        assert failed.returncode != 0, (target, failed.stdout)
        assert log.read_text().splitlines() == ['gate-start', 'gate-end'] + [
            'lambda:' + environment, 'cloudformation:' + environment], log.read_text()
    print('Direct scripts, deployment ordering, failure barriers, and unchanged dev/package behavior passed')


if __name__ == '__main__':
    main()
