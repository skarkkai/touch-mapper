"""Offline startup check, also runnable by an old system Python for clear errors."""
import sys

if sys.version_info < (3, 12):
    sys.exit('Worker requires Python 3.12+; found ' + sys.version.split()[0])

import importlib.metadata
from pathlib import Path


def check_requirements(path):
    for line in path.read_text().splitlines():
        if line.startswith('-r '):
            check_requirements(path.parent / line[3:])
        elif line and not line.startswith('#'):
            name, version = line.split('==')
            actual = importlib.metadata.version(name)
            if actual != version:
                sys.exit('Worker dependency {}: expected {}, found {}; rerun setup-worker-python.sh'.format(
                    name, version, actual))


check_requirements(Path(__file__).with_name('worker-requirements.txt'))
import boto3  # pyright: ignore[reportMissingImports]
from botocore.config import Config  # pyright: ignore[reportMissingImports]
import cairosvg  # pyright: ignore[reportMissingImports]

# Imports alone do not establish that the host's native Cairo library works.
assert cairosvg.svg2pdf(bytestring=b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').startswith(b'%PDF')
print('Worker runtime ready: Python {} boto3 {}'.format(sys.version.split()[0], boto3.__version__), file=sys.stderr)
