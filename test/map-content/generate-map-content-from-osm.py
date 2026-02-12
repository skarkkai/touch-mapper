#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List


def _stage_start(log_prefix: str, name: str) -> float:
    now = time.time()
    print(f"{log_prefix} START {name}", file=sys.stderr)
    return now


def _stage_done(log_prefix: str, name: str, start: float) -> float:
    duration = time.time() - start
    print(f"{log_prefix} DONE {name} ({duration:.2f}s)", file=sys.stderr)
    return duration


def run_cmd(cmd: List[str], cwd: Path, env: Dict[str, str] | None = None) -> None:
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
    if completed.returncode != 0:
        if completed.stdout:
            print(completed.stdout, file=sys.stderr, end="")
        raise subprocess.CalledProcessError(completed.returncode, cmd, output=completed.stdout)


def _parse_env_bool(name: str) -> bool | None:
    raw = os.environ.get(name)
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    return None


def pretty_json_enabled(pretty_arg: bool | None) -> bool:
    if pretty_arg is not None:
        return pretty_arg
    forced = _parse_env_bool("TOUCH_MAPPER_PRETTY_JSON")
    if forced is not None:
        return forced
    # This tool is development-only under test/map-content; default to pretty output.
    return True


def rewrite_json(path: Path, pretty_json: bool) -> None:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    with path.open("w", encoding="utf-8") as handle:
        if pretty_json:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            return
        json.dump(payload, handle, separators=(",", ":"), ensure_ascii=False)


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
    parser.add_argument(
        "--with-blender",
        action="store_true",
        help="Also run Blender tactile export to produce STL/SVG/BLEND outputs.",
    )
    parser.add_argument(
        "--diameter",
        type=int,
        help="Larger of map area x and y diameter in meters (required with --with-blender).",
    )
    parser.add_argument(
        "--size",
        type=float,
        help="Output print size in cm (required with --with-blender).",
    )
    parser.add_argument(
        "--no-borders",
        action="store_true",
        help="Pass --no-borders to obj-to-tactile.py when running with --with-blender.",
    )
    parser.add_argument(
        "--marker1",
        help="Marker JSON passed through to obj-to-tactile.py when running with --with-blender.",
    )
    parser.add_argument(
        "--pretty-json",
        dest="pretty_json",
        action="store_true",
        default=None,
        help="Write generated JSON with indentation.",
    )
    parser.add_argument(
        "--compact-json",
        dest="pretty_json",
        action="store_false",
        help="Write generated JSON without indentation.",
    )
    parser.add_argument("--log-prefix", default="", help="Optional log prefix for stage timing output")
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


def read_boundary(raw_meta_path: Path) -> Dict[str, float]:
    with raw_meta_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    boundary = payload.get("meta", {}).get("boundary")
    if not isinstance(boundary, dict):
        raise ValueError(f"map-meta-raw.json missing meta.boundary object: {raw_meta_path}")

    result: Dict[str, float] = {}
    for key in ("minX", "minY", "maxX", "maxY"):
        value = boundary.get(key)
        if not isinstance(value, (int, float)):
            raise ValueError(f"meta.boundary.{key} missing or non-numeric in {raw_meta_path}")
        result[key] = float(value)
    return result


def run_blender_export(
    repo_root: Path,
    obj_path: Path,
    raw_meta_path: Path,
    args: argparse.Namespace,
) -> None:
    if args.diameter is None or args.size is None:
        raise ValueError("--diameter and --size are required when --with-blender is set")

    blender_dir = repo_root / "converter" / "blender"
    blender_path = blender_dir / "blender"
    obj_to_tactile_path = repo_root / "converter" / "obj-to-tactile.py"
    if not blender_path.exists():
        raise FileNotFoundError(f"Blender binary not found: {blender_path}")
    if not obj_to_tactile_path.exists():
        raise FileNotFoundError(f"obj-to-tactile.py not found: {obj_to_tactile_path}")

    boundary = read_boundary(raw_meta_path)
    blender_cmd = [
        str(blender_path),
        "-noaudio",
        "--factory-startup",
        "--background",
        "--python",
        str(obj_to_tactile_path),
        "--",
        "--scale",
        str(args.scale),
        "--min-x",
        str(boundary["minX"]),
        "--min-y",
        str(boundary["minY"]),
        "--max-x",
        str(boundary["maxX"]),
        "--max-y",
        str(boundary["maxY"]),
        "--diameter",
        str(args.diameter),
        "--size",
        str(args.size),
    ]
    if args.no_borders:
        blender_cmd.append("--no-borders")
    if args.marker1:
        blender_cmd.extend(["--marker1", args.marker1])
    blender_cmd.append("--export-wireframe-png")
    blender_cmd.append(str(obj_path))

    inherited_ld_library_path = os.environ.get("LD_LIBRARY_PATH", "")
    combined_ld_library_path = str(blender_dir / "lib")
    if inherited_ld_library_path:
        combined_ld_library_path += ":" + inherited_ld_library_path
    run_cmd(
        blender_cmd,
        cwd=repo_root,
        env={
            "LD_LIBRARY_PATH": combined_ld_library_path,
        },
    )


def main() -> int:
    args = parse_args()
    pretty_json = pretty_json_enabled(args.pretty_json)
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from converter.map_desc import run_map_desc

    osm_path = Path(args.osm).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    raw_log_prefix = args.log_prefix.strip()
    log_prefix = f"{raw_log_prefix} " if raw_log_prefix else ""
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
    timings: Dict[str, float] = {}

    osm2world_start = _stage_start(log_prefix, "run-osm2world")
    run_cmd(
        osm2world_cmd,
        cwd=repo_root,
        env={
            "TOUCH_MAPPER_SCALE": str(args.scale),
            "TOUCH_MAPPER_EXTRUDER_WIDTH": "0.5",
            "TOUCH_MAPPER_EXCLUDE_BUILDINGS": "true" if args.exclude_buildings else "false",
        },
    )
    timings["run-osm2world"] = _stage_done(log_prefix, "run-osm2world", osm2world_start)

    if not raw_meta_path.exists():
        raise FileNotFoundError(f"OSM2World did not produce expected file: {raw_meta_path}")
    rewrite_json(raw_meta_path, pretty_json)

    map_desc_start = _stage_start(log_prefix, "run-map-desc")
    map_desc_profile: Dict[str, float] = {}
    run_map_desc(str(raw_meta_path), profile=map_desc_profile, pretty_json=pretty_json)
    timings["run-map-desc"] = _stage_done(log_prefix, "run-map-desc", map_desc_start)
    for key, value in sorted(map_desc_profile.items()):
        timings["run-map-desc." + key] = value

    if args.with_blender:
        blender_start = _stage_start(log_prefix, "run-blender")
        run_blender_export(repo_root, obj_path, raw_meta_path, args)
        timings["run-blender"] = _stage_done(log_prefix, "run-blender", blender_start)

    map_meta_path = out_dir / "map-meta.json"
    map_meta_augmented_path = out_dir / "map-meta.augmented.json"
    map_content_path = out_dir / "map-content.json"
    for generated in [map_meta_path, map_meta_augmented_path, map_content_path]:
        if not generated.exists():
            raise FileNotFoundError(f"converter.map_desc did not produce expected file: {generated}")

    blender_output_paths = {}
    if args.with_blender:
        blender_output_paths = {
            "mapStlPath": str(out_dir / "map.stl"),
            "mapWaysStlPath": str(out_dir / "map-ways.stl"),
            "mapRestStlPath": str(out_dir / "map-rest.stl"),
            "mapSvgPath": str(out_dir / "map.svg"),
            "mapBlendPath": str(out_dir / "map.blend"),
            "mapWireframeFlatPath": str(out_dir / "map-wireframe-flat.png"),
            "mapWireframePath": str(out_dir / "map-wireframe.png"),
        }
        for name, file_path in blender_output_paths.items():
            if not Path(file_path).exists():
                raise FileNotFoundError(f"Blender did not produce expected file ({name}): {file_path}")

    result = {
        "repoRoot": str(repo_root),
        "inputOsmPath": str(osm_path),
        "outputDir": str(out_dir),
        "mapObjPath": str(obj_path),
        "mapMetaRawPath": str(raw_meta_path),
        "mapMetaPath": str(map_meta_path),
        "mapMetaAugmentedPath": str(map_meta_augmented_path),
        "mapContentPath": str(map_content_path),
        "timings": timings,
    }
    result.update(blender_output_paths)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
