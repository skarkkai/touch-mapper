#!/usr/bin/env python3
"""Check custom relief and category omission through the real offline pipeline."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'test/regression'))
from content_filter import PROCESS  # pyright: ignore[reportMissingImports]
from converter import map_desc

SPEC = importlib.util.spec_from_file_location('artifact_checks', str(REPO / 'test/map-content/check-regression.py'))
assert SPEC is not None and SPEC.loader is not None
CHECKS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKS)
OUT = REPO / '.tmp/print-heights'


# Exercise chosen heights against evaluated geometry, raw metadata, and final descriptions.
def check_case(name, chosen, expected):
    folder = OUT / name
    folder.mkdir(exist_ok=True)
    shutil.copyfile(str(REPO / 'test/map-content/fixtures/no-buildings.osm'), str(folder / 'map.osm'))
    request = dict(chosen, printWidthCm=17, printHeightCm=17, scale=1400, printingTech='3d',
                   hideLocationMarker=True, requestId='B123456789abcdef/' + name)
    with (folder / 'conversion.log').open('w') as log, contextlib.redirect_stdout(log):
        previous = Path.cwd()
        try:
            os.chdir(str(REPO / 'converter'))
            with patch.object(PROCESS.subprocess, 'check_call',
                              side_effect=lambda cmd: subprocess.run(cmd, stdout=log, stderr=log, check=True)):
                artifacts, _, _ = PROCESS.run_osm_to_tactile(str(folder / 'map.osm'), request)
        finally:
            os.chdir(str(previous))
        map_desc.run_map_desc(artifacts['meta_raw_path'])
    meshes = CHECKS.measure_blend(folder, 1400)
    ground = meshes['Base']['max'][2]
    triangles, _ = CHECKS.inspect_stl(folder / 'map.stl')
    contents = json.loads(PROCESS.attach_request_metadata_to_map_content((folder / 'map-content.json').read_bytes(), request))
    (folder / 'map-content.json').write_text(json.dumps(contents))
    classes = CHECKS.classification_ids(contents)
    for section, mesh_name, class_key in [('roads', 'CarRoads', 'A1_local_streets'),
        ('paths', 'PedestrianRoads', 'A2_footpaths_trails'), ('buildings', 'Buildings', 'C3_other_buildings'),
        ('railways', 'Rails', 'A3_rail_lines')]:
        height = expected[section]
        assert contents['metadata']['printHeightsMm'][section] == height
        if height == 0:
            assert mesh_name not in meshes, (name, mesh_name)
            assert not classes.get(class_key), (name, classes)
        else:
            mesh = meshes[mesh_name]
            assert abs(mesh['max'][2] - ground - height) < .02, (name, mesh_name, mesh, height)
            x = mesh['min'][0] + (mesh['max'][0] - mesh['min'][0]) / 4
            y = mesh['min'][1] + (mesh['max'][1] - mesh['min'][1]) / 4
            actual = CHECKS.surface_height(triangles, x, y) - ground
            assert abs(actual - height) < .02, (name, section, actual, height)
    if expected['roads'] and expected['railways'] and chosen['roadHeightMm'] == chosen['railwayHeightMm']:
        assert abs(meshes['CarRoads']['max'][2] - meshes['Rails']['max'][2] - .01) < .003
    # Omission cannot leave a zero-height surface, and water relief stays unchanged.
    assert abs(meshes['WaterAreas']['max'][2] - ground - 1.5) < .08
    assert abs(ground - meshes['Base']['min'][2] - .6) < .02
    (folder / 'info.json').write_text(json.dumps(dict(request, addrShort=name, addrLong=name,
        lat=60.001, lon=24.002, advancedMode=True, contentMode='normal')))
    print('PASS geometry, omissions and applied height metadata: ' + name)


def main():
    subprocess.run([sys.executable, str(REPO / 'bin/tmpctl'), 'mkdir', str(OUT)], check=True)
    cases = [
        ('custom', [3, 4, 5, 3], [3, 4, 5, 2.99]),
        ('maximum', [50.8, .1, 50, 50.8], [50.8, .1, 50, 50.79]),
        ('railway-only', [0, .01, .009, 2], [0, 0, 0, 2]),
        ('no-roads', [0, 2, 3, 1], [0, 2, 3, 1]),
        ('no-paths', [2, 0, 3, 1], [2, 0, 3, 1]),
        ('no-buildings', [2, 3, 0, 1], [2, 3, 0, 1]),
        ('no-railways', [2, 3, 4, 0], [2, 3, 4, 0]),
        ('all-zero', [0, 0, 0, 0], [0, 0, 0, 0])]
    for name, chosen, expected in cases:
        check_case(name, dict(zip(['roadHeightMm', 'pathHeightMm', 'buildingHeightMm', 'railwayHeightMm'], chosen)),
                   dict(zip(['roads', 'paths', 'buildings', 'railways'], expected)))


if __name__ == '__main__':
    main()
