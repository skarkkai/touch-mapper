#!/usr/bin/python3 -u

import argparse
import re
import os
import subprocess
import json

script_dir = os.path.dirname(os.path.realpath(__file__))


def read_proc_status_kib(field_name):
    try:
        with open('/proc/self/status', 'r') as handle:
            for line in handle:
                if not line.startswith(field_name + ':'):
                    continue
                parts = line.split()
                if len(parts) < 2:
                    return None
                return int(parts[1])
    except Exception:
        return None
    return None


def log_memory_checkpoint(label):
    if not INSTRUMENTATION_ENABLED:
        return
    vm_rss_kib = read_proc_status_kib('VmRSS')
    vm_hwm_kib = read_proc_status_kib('VmHWM')
    if vm_rss_kib is None and vm_hwm_kib is None:
        print('MEMORY:osm-to-tactile:{label} unavailable'.format(label=label))
        return
    vm_rss_mib = (vm_rss_kib / 1024.0) if vm_rss_kib is not None else -1.0
    vm_hwm_mib = (vm_hwm_kib / 1024.0) if vm_hwm_kib is not None else -1.0
    print(
        'MEMORY:osm-to-tactile:{label} VmRSS={rss_kib}kB ({rss_mib:.1f} MiB) VmHWM={hwm_kib}kB ({hwm_mib:.1f} MiB)'.format(
            label=label,
            rss_kib=('?' if vm_rss_kib is None else vm_rss_kib),
            rss_mib=vm_rss_mib,
            hwm_kib=('?' if vm_hwm_kib is None else vm_hwm_kib),
            hwm_mib=vm_hwm_mib
        )
    )


def parse_env_bool(name):
    raw = os.environ.get(name)
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    return None


INSTRUMENTATION_ENABLED = (parse_env_bool('TOUCH_MAPPER_INSTRUMENTATION') is True)


def pretty_json_enabled():
    forced = parse_env_bool('TOUCH_MAPPER_PRETTY_JSON')
    if forced is not None:
        return forced
    return False


def write_json_file(path, value, pretty_json):
    with open(path, 'w') as handle:
        if pretty_json:
            json.dump(value, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            return
        json.dump(value, handle, separators=(',', ':'), ensure_ascii=False)

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Convert .osm file into a tactile map. Writes one or more .stl files in the input file's directory.''')
    parser.add_argument('input', metavar='OSM_FILE', help='input file path')
    parser.add_argument('--foreground', action='store_true', help="open Blender UI, and don't perform STL export")
    parser.add_argument('--scale', metavar='N', type=int, default=3100, help="scale to print in, default 1 : 3100")
    parser.add_argument('--marker1', metavar='MARKER', help="first marker's position relative to top left corner")
    parser.add_argument('--diameter', metavar='METERS', type=int, required=True, help="larger of map area x and y diameter in meters")
    parser.add_argument('--size', metavar='CM', type=float, required=True, help="print size in cm")
    parser.add_argument('--no-borders', action='store_true', help="don't draw borders around the edges")
    parser.add_argument('--exclude-buildings', action='store_true', help="don't include buildings")
    args = parser.parse_args()
    return args

def subprocess_output(cmd, env=None):
    print("running: " + " ".join(cmd) + "  " + str(env))
    en = os.environ.copy()
    if env:
        en.update(env)
    try:
        return subprocess.check_output(cmd, stderr=subprocess.STDOUT, env=en).decode("utf-8")
    except subprocess.CalledProcessError as e:
        print("subprocess failed with error code: {}".format(e.output.decode("utf-8")))
        raise e

def run_osm2world(input_path, output_path, scale, exclude_buildings):
    log_memory_checkpoint('before-osm2world')
    # Code below creates stage "OSM2World raw meta" data.
    osm2world_path = os.path.join(script_dir, 'OSM2World', 'build', 'OSM2World.jar')
    #print(osm2world_path + " " + input_path + " " + output_path)
    cmd = [
        'java', '-Xmx1G',
        '-jar', osm2world_path,
        '-i', input_path,
        '-o', output_path]
    output = subprocess_output(cmd, { 'TOUCH_MAPPER_SCALE': str(scale), 'TOUCH_MAPPER_EXTRUDER_WIDTH': '0.5', 'TOUCH_MAPPER_EXCLUDE_BUILDINGS': ('true' if exclude_buildings else 'false') })
    print(output)

    meta_path = os.path.join(os.path.dirname(output_path), 'map-meta-raw.json')
    if not os.path.exists(meta_path):
        raise Exception("Couldn't find map-meta-raw.json from OSM2World output")
    with open(meta_path, 'r') as f:
        meta = json.load(f)
    write_json_file(meta_path, meta, pretty_json_enabled())
    log_memory_checkpoint('after-osm2world')

    return meta

def run_blender(obj_path, boundary, args):
    log_memory_checkpoint('before-blender')
    blender_dir = os.path.join(script_dir, 'blender')
    blender_env = os.environ.copy()
    blender_env['LD_LIBRARY_PATH'] = os.path.join(blender_dir, 'lib') + ":" + blender_env.get('LD_LIBRARY_PATH', '')
    blender_path = os.path.join(blender_dir, 'blender')
    obj_to_tactile_path = os.path.join(script_dir, 'obj-to-tactile.py')
    blender_args = [
        #'--debug',
        '-noaudio',
        '--factory-startup',
    ]
    script_args = [
        '--scale', str(args.scale),
        '--min-x', str(boundary['minX']),
        '--min-y', str(boundary['minY']),
        '--max-x', str(boundary['maxX']),
        '--max-y', str(boundary['maxY']),
        '--diameter', str(args.diameter),
        '--size', str(args.size),
    ]
    if args.foreground:
        script_args.append('--no-stl-export')
    else:
        blender_args.append('--background')
    if args.no_borders:
        script_args.append('--no-borders')
    if args.marker1:
        script_args.extend(('--marker1', args.marker1))
    cmd = [blender_path] + blender_args + ['--python', obj_to_tactile_path, '--'] + script_args + [obj_path]
    output = subprocess_output(cmd)
    
    # Strip junk output by OBJ importer
    output = re.sub("Warning Cannot scanfill, fallback on a triangle fan.\n", '', output)
    output = re.sub("convertViewVec: called in an invalid context\n", '', output)
    
    print("----------- obj-to-tactile.py output: -----------")
    print(output)
    print("----------- end obj-to-tactile.py output -----------")

    if INSTRUMENTATION_ENABLED:
        blender_memory_matches = re.finditer(
            r'^MEMORY:(?P<label>[^ ]+) VmRSS=(?P<rss>[0-9?]+)kB \([^)]+\) VmHWM=(?P<hwm>[0-9?]+)kB',
            output,
            re.MULTILINE
        )
        blender_peak_hwm = None
        blender_peak_label = None
        for match in blender_memory_matches:
            hwm_raw = match.group('hwm')
            if not hwm_raw.isdigit():
                continue
            hwm_kib = int(hwm_raw)
            if blender_peak_hwm is None or hwm_kib > blender_peak_hwm:
                blender_peak_hwm = hwm_kib
                blender_peak_label = match.group('label')
        if blender_peak_hwm is not None:
            print(
                'MEMORY:osm-to-tactile:blender-subprocess-peak VmHWM={hwm_kib}kB ({hwm_mib:.1f} MiB) at={label}'.format(
                    hwm_kib=blender_peak_hwm,
                    hwm_mib=blender_peak_hwm / 1024.0,
                    label=blender_peak_label
                )
            )
    log_memory_checkpoint('after-blender')
    
    # Find some info from the output
    meta = {}
    iterator = re.compile('^META-START:({.+}):META-END$', re.MULTILINE).finditer(output)
    for match in iterator:
        entry_json = match.group(1);
        meta.update(json.loads(entry_json))
    return meta

def print_size(scale, boundary):
    sizeX = boundary['maxX'] - boundary['minX']
    sizeY = boundary['maxY'] - boundary['minY']
    print("Map is {:.0f} x {:.0f} meters. Selected scale {:.0f} will result in a {:.0f} x {:.0f} mm print.".format(sizeX, sizeY, scale, sizeX / scale * 1000 , sizeY / scale * 1000))

def main():
    log_memory_checkpoint('main-start')
    # Handle command line
    args = do_cmdline()
    osm_path = args.input
    input_basename, input_extension = os.path.splitext(osm_path)
    if input_extension.lower() != '.osm':
        raise Exception("input file must have extension .osm")
    input_dir = os.path.dirname(osm_path)

    # Run OSM2World
    obj_path = input_basename + '.obj'
    meta = run_osm2world(osm_path, obj_path, args.scale, args.exclude_buildings)
    boundary = meta.get('meta', {}).get('boundary')
    if boundary is None:
        raise Exception("map-meta-raw.json missing meta.boundary")

    print_size(args.scale, boundary)

    # Run Blender
    meta_path = input_basename + '-meta.json'
    blender_meta = run_blender(obj_path, boundary, args)
    meta.update(blender_meta)
    write_json_file(meta_path, meta, pretty_json_enabled())
    log_memory_checkpoint('main-end')


if __name__ == "__main__":
    main()
    print("osm-to-tactile finished successfully")
