#!/usr/bin/env python3
"""Exercise OSM2World's production file reader without a network request."""
import os
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
WORK = Path(sys.argv[1])
JAR = REPO / 'OSM2World/build/OSM2World.jar'


def run(command, env=None):
    result = subprocess.run(command, cwd=str(REPO), env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, universal_newlines=True)
    return result


build = run(['ant', '-f', str(REPO / 'OSM2World/build.xml'), 'clean', 'jar'])
assert build.returncode == 0, build.stdout
assert JAR.is_file(), 'OSM2World jar was not built'

env = dict(os.environ, TOUCH_MAPPER_SCALE='1400',
           TOUCH_MAPPER_EXTRUDER_WIDTH='0.5', TOUCH_MAPPER_EXCLUDE_BUILDINGS='false')
source = REPO / 'test/data/map.osm'
output = WORK / 'map.obj'
conversion = run(['java', '-Xmx1G', '-jar', str(JAR), '-i', str(source), '-o', str(output)], env)
assert conversion.returncode == 0, conversion.stdout
assert output.is_file(), conversion.stdout
assert output.read_bytes() == (REPO / 'test/data/map.obj').read_bytes(), \
    'OSM2World file input changed the expected map geometry'

# The former JOSM fallback supplied fake versions to unversioned elements.
# Osmosis must now reject this local-edit format instead of silently using it.
josm_source = (REPO / 'OSM2World/test/files/validFile.osm').read_text()
assert " version='1'" in josm_source
josm_input = WORK / 'josm-unversioned.osm'
josm_input.write_text(josm_source.replace(" version='1'", '', 1))
josm_output = WORK / 'josm-unversioned.obj'
josm = run(['java', '-Xmx1G', '-jar', str(JAR), '-i', str(josm_input),
            '-o', str(josm_output)], env)
# OSM2World's CLI can return zero after a reader-thread failure, so check
# both the diagnostic and the absence of geometry.
assert 'does not have a version attribute' in josm.stdout, josm.stdout
assert not josm_output.exists(), 'unversioned JOSM input unexpectedly rendered'
print('OSM2World file input: production geometry matches; unversioned JOSM input rejected')
