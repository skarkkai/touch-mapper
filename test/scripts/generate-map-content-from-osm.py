#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict


def run_cmd(cmd: list[str], cwd: Path, env: Dict[str, str] | None = None) -> None:
    env_vars = os.environ.copy()
    if env:
        env_vars.update(env)
    completed = subprocess.run(
        cmd,
        cwd=str(cwd),
        env=env_vars,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if completed.stdout:
        print(completed.stdout, file=sys.stderr, end="")
    if completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, cmd, output=completed.stdout)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate map-content.json from a map.osm file using OSM2World + converter.map_desc."
    )
    parser.add_argument("--osm", required=True, help="Path to input .osm file")
    parser.add_argument("--out-dir", required=True, help="Directory for generated files")
    parser.add_argument("--scale", type=int, default=1400, help="TOUCH_MAPPER_SCALE for OSM2World")
    parser.add_argument(
        "--exclude-buildings",
        action="store_true",
        help="Set TOUCH_MAPPER_EXCLUDE_BUILDINGS=true for OSM2World run",
    )
    return parser.parse_args()


def ensure_paths(repo_root: Path, osm_path: Path) -> Path:
    if not osm_path.exists():
        raise FileNotFoundError(f"Input OSM file not found: {osm_path}")
    if osm_path.suffix.lower() != ".osm":
        raise ValueError(f"Input file must end with .osm: {osm_path}")
    jar_path = repo_root / "OSM2World" / "build" / "OSM2World.jar"
    if not jar_path.exists():
        raise FileNotFoundError(f"OSM2World jar not found: {jar_path}")
    return jar_path


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    osm_path = Path(args.osm).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    jar_path = ensure_paths(repo_root, osm_path)
    obj_path = out_dir / "map.obj"
    raw_meta_path = out_dir / "map-meta-raw.json"

    osm2world_cmd = [
        "java",
        "-Xmx1G",
        "-jar",
        str(jar_path),
        "-i",
        str(osm_path),
        "-o",
        str(obj_path),
    ]
    run_cmd(
        osm2world_cmd,
        cwd=repo_root,
        env={
            "TOUCH_MAPPER_SCALE": str(args.scale),
            "TOUCH_MAPPER_EXTRUDER_WIDTH": "0.5",
            "TOUCH_MAPPER_EXCLUDE_BUILDINGS": "true" if args.exclude_buildings else "false",
        },
    )

    if not raw_meta_path.exists():
        raise FileNotFoundError(f"OSM2World did not produce expected file: {raw_meta_path}")

    map_desc_cmd = [sys.executable, "-m", "converter.map_desc", str(raw_meta_path)]
    run_cmd(map_desc_cmd, cwd=repo_root)

    map_meta_path = out_dir / "map-meta.json"
    map_meta_augmented_path = out_dir / "map-meta.augmented.json"
    map_content_path = out_dir / "map-content.json"
    for path in [map_meta_path, map_meta_augmented_path, map_content_path]:
        if not path.exists():
            raise FileNotFoundError(f"converter.map_desc did not produce expected file: {path}")

    result = {
        "repoRoot": str(repo_root),
        "inputOsmPath": str(osm_path),
        "outputDir": str(out_dir),
        "mapObjPath": str(obj_path),
        "mapMetaRawPath": str(raw_meta_path),
        "mapMetaPath": str(map_meta_path),
        "mapMetaAugmentedPath": str(map_meta_augmented_path),
        "mapContentPath": str(map_content_path),
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
