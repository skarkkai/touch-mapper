#!/usr/bin/env python3
"""Check preview route resolution without opening sockets or requiring a web build."""
from pathlib import Path
import runpy
import sys

repo = Path(__file__).resolve().parents[2]
server = runpy.run_path(str(repo / 'bin/serve-local'))
fixture = Path(sys.argv[1]).resolve() / 'preview-fixture'
build = fixture / 'web/build'
for relative in ['en/area.html', 'en/map.html', 'scripts/environment.js']:
    page = build / relative
    page.parent.mkdir(parents=True, exist_ok=True)
    page.write_text('fixture')
handler = object.__new__(server['LocalHandler'])
handler.directory = str(build)
handler.translate_path.__globals__.update(REPO=fixture, BUILD=build)
assert handler.translate_path('/en/area?lat=60') == str(build / 'en/area.html')
assert handler.translate_path('/en/map') == str(build / 'en/map.html')
assert handler.translate_path('/scripts/app-common.js') == str(build / 'scripts/app-common.js')
assert handler.translate_path('/scripts/environment.js') == str(build / 'scripts/environment.js')
deployed = fixture / 'web/dist/scripts/environment.js'
deployed.parent.mkdir(parents=True)
deployed.write_text('configured backend')
assert handler.translate_path('/scripts/environment.js') == str(deployed)
print('Local preview routes passed')
