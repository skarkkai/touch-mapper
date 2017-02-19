#!/usr/bin/python3 -u

import argparse
import re
import os
import subprocess
import json

script_dir = os.path.dirname(os.path.realpath(__file__))

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Convert .osm file into a tactile map. Writes one or more .stl files in thee input file's directory.''')
    parser.add_argument('input', metavar='OSM_FILE', help='input file path')
    parser.add_argument('--foreground', action='store_true', help="open Blender UI, and don't perform STL export")
    parser.add_argument('--scale', metavar='N', type=int, default=3100, help="scale to print in, default 1 : 3100")
    parser.add_argument('--marker1', metavar='MARKER', help="first marker's position relative to top left corner")
    parser.add_argument('--diameter', metavar='METERS', type=int, required=True, help="larger of map area x and y diameter in meters")
    parser.add_argument('--no-borders', action='store_true', help="don't draw borders around the edges")
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

def run_osm2world(input_path, output_path, scale):
    osm2world_path = os.path.join(script_dir, 'OSM2World', 'build', 'OSM2World.jar')
    #print(osm2world_path + " " + input_path + " " + output_path)
    cmd = [
        'java', '-Xmx1G',
        '-jar', osm2world_path,
        '-i', input_path,
        '-o', output_path]
    output = subprocess_output(cmd, { 'TOUCH_MAPPER_SCALE' : str(scale), 'TOUCH_MAPPER_EXTRUDER_WIDTH' : '0.4' })
    print(output)

    # Find bounds from output
    m = re.compile('.*Map-boundary:\[ minX=([0-9.-]+) minZ=([0-9.-]+) maxX=([0-9.-]+) maxZ=([0-9.-]+) \]', re.DOTALL).match(output)
    if not m:
        raise Exception("Couldn't find map bounds from OSM2World output")
    bounds = {
        'minX': float(m.group(1)),
        'minY': float(m.group(2)), # change from Z to Y
        'maxX': float(m.group(3)),
        'maxY': float(m.group(4)), # change from Z to Y
    }

    m = re.compile('.*^Object-infos:\[(.+?)\]$', re.DOTALL|re.MULTILINE).match(output)
    if not m:
        raise Exception("Couldn't find object infos from OSM2World output")
    object_infos = json.loads(m.group(1))

    return ({
        'objectInfos': object_infos,
        'bounds': bounds
    })

def run_blender(obj_path, bounds, args):
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
        '--min-x', str(bounds['minX']),
        '--min-y', str(bounds['minY']),
        '--max-x', str(bounds['maxX']),
        '--max-y', str(bounds['maxY']),
        '--diameter', str(args.diameter),
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
    
    # Find some info from the output
    meta = {}
    iterator = re.compile('^META-START:({.+}):META-END$', re.MULTILINE).finditer(output)
    for match in iterator:
        entry_json = match.group(1);
        meta.update(json.loads(entry_json))
    return meta

def print_size(scale, bounds):
    sizeX = bounds['maxX'] - bounds['minX']
    sizeY = bounds['maxY'] - bounds['minY']
    print("Map is {:.0f} x {:.0f} meters. Selected scale {:.0f} will result in a {:.0f} x {:.0f} mm print.".format(sizeX, sizeY, scale, sizeX / scale * 1000 , sizeY / scale * 1000))

def main():
    # Handle command line
    args = do_cmdline()
    osm_path = args.input
    input_basename, input_extension = os.path.splitext(osm_path)
    if input_extension.lower() != '.osm':
        raise Exception("input file must have extension .osm")
    input_dir = os.path.dirname(osm_path)

    # Run OSM2World
    obj_path = input_basename + '.obj'
    meta = run_osm2world(osm_path, obj_path, args.scale)

    print_size(args.scale, meta['bounds'])

    # Run Blender
    meta_path = input_basename + '-meta.json'
    blender_meta = run_blender(obj_path, meta['bounds'], args)
    blender_meta.update(meta['objectInfos'])
    with open(meta_path, 'w') as f:
        f.write(json.dumps(blender_meta))


if __name__ == "__main__":
    main()
    print("osm-to-tactile finished successfully")
