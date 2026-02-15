#!/usr/bin/python3 -u

import sys,os
script_dir = os.path.dirname(__file__)
sys.path.insert(1, "%s/py-lib/boto3" % (script_dir,))
sys.path.insert(1, script_dir)

import re
import boto3  # type: ignore[import-not-found]
import json
import argparse
import urllib.request
import urllib.parse
import subprocess
import functools
import time
import datetime
import gzip
import copy
import io
import signal
import atexit
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional

import stats_pipeline

STORE_AGE = 8640000
time_clock = getattr(time, 'clock', time.time)
INSTRUMENTATION_ENV_VAR = 'TOUCH_MAPPER_INSTRUMENTATION'
TOP_RAM_STAGE_TO_FIELD = {
    'run-osm2world': 'rss_osm2world_kib',
    'run-blender': 'rss_blender_kib',
    'run-clip-2d': 'rss_clip_2d_kib',
}
MAX_RSS_KIB_RE = re.compile(r'^\s*Maximum resident set size \(kbytes\):\s*([0-9]+)\s*$')
MAX_OSM_BYTES_GENERAL = 25 * 1024 * 1024
MAX_OSM_BYTES_ONLY_BIG_ROADS_BEFORE_PRUNE = 70 * 1024 * 1024
STATUS_PROGRESS_SEEN = 20
STATUS_PROGRESS_CONVERTING = 60
STATUS_PROGRESS_UPLOADING_PRIMARY = 80
STATUS_PROGRESS_DONE = 100
NO_GEOMETRY_ERROR_DESCRIPTION = 'Map would contain no geometry in selected area.'


def parse_env_bool(name):
    raw = os.environ.get(name)
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if normalized in ('1', 'true', 'yes', 'on'):
        return True
    if normalized in ('0', 'false', 'no', 'off'):
        return False
    return None


INSTRUMENTATION_ENABLED = (parse_env_bool(INSTRUMENTATION_ENV_VAR) is True)
INFO_JSON_META_DENYLIST = {'nodes', 'ways', 'areas'}
STATS_ENABLED = True
STATS_QUICKTIME_MODE = False
VALID_CONTENT_MODES = set(['normal', 'no-buildings', 'only-big-roads'])
TARGET_ROAD_DENSITY_KM_PER_KM2 = 100.0
VERSION_TAG_PACKAGE_RE = re.compile(r'^package-(.+)$')
CODE_VERSION_WARNING_EMITTED = False
progress_state = {
    'status': 'starting',
    'stage': 'bootstrap',
    'request_id': None,
    'termination_signal': None,
}


def compact_log_text(value, max_length=240):
    text = re.sub(r'\s+', ' ', str(value)).strip()
    if len(text) > max_length:
        return text[:max_length] + '...'
    return text


def log_progress(stage, status=None, request_id=None, detail=None):
    if not INSTRUMENTATION_ENABLED:
        return
    if request_id is not None:
        progress_state['request_id'] = request_id
    if status is not None:
        progress_state['status'] = status
    progress_state['stage'] = stage
    parts = [
        'PROGRESS:process-request:{stage}'.format(stage=stage),
        'ts={ts}'.format(ts=datetime.datetime.utcnow().isoformat() + 'Z'),
        'status={status}'.format(status=progress_state['status']),
    ]
    if progress_state['request_id'] is not None:
        parts.append('requestId={request_id}'.format(request_id=progress_state['request_id']))
    if detail:
        parts.append('detail={detail}'.format(detail=compact_log_text(detail)))
    print(" ".join(parts))


def log_exit_progress():
    if not INSTRUMENTATION_ENABLED:
        return
    parts = [
        'PROGRESS:process-request:exit',
        'ts={ts}'.format(ts=datetime.datetime.utcnow().isoformat() + 'Z'),
        'status={status}'.format(status=progress_state['status']),
        'last_stage={stage}'.format(stage=progress_state['stage']),
    ]
    if progress_state['request_id'] is not None:
        parts.append('requestId={request_id}'.format(request_id=progress_state['request_id']))
    if progress_state['termination_signal'] is not None:
        parts.append('signal={signal}'.format(signal=progress_state['termination_signal']))
    print(" ".join(parts))


def handle_termination_signal(signum, frame):
    if progress_state.get('termination_signal') is None:
        progress_state['termination_signal'] = signum
        log_progress(
            'signal-received',
            status='terminated',
            detail='signal={}'.format(signum)
        )
    raise SystemExit(128 + signum)


if INSTRUMENTATION_ENABLED:
    atexit.register(log_exit_progress)
    signal.signal(signal.SIGTERM, handle_termination_signal)
    signal.signal(signal.SIGINT, handle_termination_signal)


def now_iso_utc():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


def empty_code_version_fields():
    return {  # type: Dict[str, Any]
        'code_branch': None,
        'code_deployed': None,
        'code_commit': None,
    }


def warn_code_version_once(message):
    global CODE_VERSION_WARNING_EMITTED
    if CODE_VERSION_WARNING_EMITTED:
        return
    CODE_VERSION_WARNING_EMITTED = True
    print('code version metadata unavailable: ' + str(message))


def read_code_version_fields(base_dir):
    fields = empty_code_version_fields()
    version_path = os.path.join(base_dir, 'VERSION.txt')
    try:
        with open(version_path, 'r', encoding='utf8') as f:
            version_line = None
            for raw_line in f:
                stripped = raw_line.strip()
                if stripped:
                    version_line = stripped
                    break
    except Exception as e:
        warn_code_version_once('failed to read {} ({})'.format(version_path, e))
        return fields

    if not version_line:
        warn_code_version_once('empty VERSION.txt at {}'.format(version_path))
        return fields

    parts = version_line.split()
    if len(parts) != 4:
        warn_code_version_once(
            'unexpected VERSION.txt format at {} (expected 4 fields, got {}): {}'.format(
                version_path,
                len(parts),
                compact_log_text(version_line)
            )
        )
        return fields

    _, branch, tag, commit = parts
    code_deployed = None
    tag_match = VERSION_TAG_PACKAGE_RE.match(tag)
    if tag_match:
        code_deployed = tag_match.group(1)

    return {
        'code_branch': branch,
        'code_deployed': code_deployed,
        'code_commit': commit,
    }


def stats_root_dir_from_work_dir(work_dir):
    if work_dir:
        runtime_dir = os.path.dirname(os.path.abspath(work_dir))
        environment_dir = os.path.dirname(runtime_dir)
        return os.path.join(environment_dir, 'stats')
    return os.path.join(os.path.dirname(script_dir), 'stats')


def duration_since(start_time):
    if start_time is None:
        return None
    return time_clock() - start_time


def read_process_rss_kib():
    try:
        with open('/proc/self/status', 'r') as f:
            for line in f:
                if line.startswith('VmRSS:'):
                    parts = line.split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception:
        return None
    return None


def track_process_rss_kib(ctx):
    rss_kib = read_process_rss_kib()
    if rss_kib is None:
        return
    ctx['rss_process_request_last_kib'] = rss_kib
    peak = ctx.get('rss_process_request_peak_kib')
    if peak is None or rss_kib > peak:
        ctx['rss_process_request_peak_kib'] = rss_kib


def interpreted_request_bool(request_body, key, default=False):
    if not isinstance(request_body, dict):
        return bool(default)
    return bool(request_body.get(key, default))


def do_cmdline():
    parser = argparse.ArgumentParser(description='''Create STL and put into S3 based on a SQS request''')
    parser.add_argument('--poll-time', metavar='SECONDS', type=int, help="poll for a request at most this long")
    parser.add_argument('--work-dir', metavar='PATH', help="write all files into this directory")
    args = parser.parse_args()
    return args


class RequestProcessingError(Exception):
    def __init__(self, code, description):
        self.code = code
        self.description = description
        super(RequestProcessingError, self).__init__(description)


def raise_too_large_osm(actual_bytes, threshold_bytes, phase_text):
    raise RequestProcessingError(
        code='too_large',
        description='OSM data is {} > {} bytes {}'.format(actual_bytes, threshold_bytes, phase_text)
    )


def ensure_osm_size_limit(actual_bytes, threshold_bytes, phase_text):
    if actual_bytes > threshold_bytes:
        raise_too_large_osm(actual_bytes, threshold_bytes, phase_text)


def map_info_object_name_from_request_id(request_id):
    return 'map/info/' + re.sub(r'\/.+', '.json', request_id) # deadbeef/foo.stl => info/deadbeef.json


def write_info_json(bucket, key, payload, cache_control=None):
    kwargs = {
        'Key': key,
        'Body': json.dumps(payload).encode('utf8'),
        'ACL': 'public-read',
        'ContentType': 'application/json',
    }
    if cache_control is not None:
        kwargs['CacheControl'] = cache_control
    bucket.put_object(**kwargs)


def write_status_info_json(ctx, progress, error_code=None, error_description=None):
    if ctx.get('s3') is None or ctx.get('map_bucket_name') is None or ctx.get('info_object_name') is None:
        return
    status_payload = {
        'requestId': ctx.get('request_id'),
        'status': {
            'progress': int(progress),
        }
    }
    if error_code is not None:
        status_payload['status']['errorCode'] = str(error_code)
    if error_description is not None:
        status_payload['status']['errorDescription'] = str(error_description)
    ctx['status_progress'] = int(progress)
    if error_code is not None:
        ctx['error_code'] = str(error_code)
    if error_description is not None:
        ctx['error_description'] = str(error_description)
    try:
        bucket = ctx['s3'].Bucket(ctx['map_bucket_name'])
        write_info_json(bucket, ctx['info_object_name'], status_payload, cache_control='no-cache')
    except Exception as e:
        print("status info write failed: " + str(e))

def normalize_content_mode(value):
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in VALID_CONTENT_MODES:
            return normalized
    return 'normal'

def ensure_request_content_mode(request_body):
    mode = normalize_content_mode((request_body or {}).get('contentMode'))
    request_body['contentMode'] = mode
    return mode

def build_overpass_interpreter_query(request_body, content_mode):
    eff_area = request_body['effectiveArea']
    bbox = "{},{},{},{}".format(eff_area['latMin'], eff_area['lonMin'], eff_area['latMax'], eff_area['lonMax'])
    if content_mode == 'no-buildings':
        return (
            '[out:xml][timeout:25];'
            '('
            'node({bbox})[~"."~"."]["building"!~"."]["building:part"!~"."];'
            'way({bbox})[~"."~"."]["building"!~"."]["building:part"!~"."];'
            'relation({bbox})[~"."~"."]["building"!~"."]["building:part"!~"."];'
            ');'
            '(._;>;);'
            'out meta;'
        ).format(bbox=bbox)
    if content_mode == 'only-big-roads':
        return (
            '[out:xml][timeout:25];'
            'way({bbox})["highway"]->.all_roads;'
            'way({bbox})["natural"="water"]->.water_areas_a;'
            'way({bbox})["water"]->.water_areas_b;'
            'way({bbox})["landuse"="reservoir"]->.water_areas_c;'
            'way({bbox})["waterway"="riverbank"]->.water_areas_d;'
            'relation({bbox})["natural"="water"]->.water_relations_a;'
            'relation({bbox})["water"]->.water_relations_b;'
            'relation({bbox})["landuse"="reservoir"]->.water_relations_c;'
            'relation({bbox})["waterway"="riverbank"]->.water_relations_d;'
            '('
            '.all_roads;'
            'relation(bw.all_roads);'
            '.water_areas_a;'
            '.water_areas_b;'
            '.water_areas_c;'
            '.water_areas_d;'
            '.water_relations_a;'
            '.water_relations_b;'
            '.water_relations_c;'
            '.water_relations_d;'
            ');'
            '(._;>;);'
            'out meta;'
        ).format(bbox=bbox)
    raise Exception("Unsupported content mode for interpreter query: " + str(content_mode))

def add_or_replace_bounds(osm_data, request_body):
    if isinstance(osm_data, bytes):
        osm_text = osm_data.decode('utf8')
    else:
        osm_text = str(osm_data)
    eff_area = request_body['effectiveArea']
    bounds_line = '  <bounds minlat="{}" minlon="{}" maxlat="{}" maxlon="{}"/>'.format(
        eff_area['latMin'],
        eff_area['lonMin'],
        eff_area['latMax'],
        eff_area['lonMax']
    )
    if re.search(r'<bounds [^>]+/>\s*', osm_text):
        return re.sub(r'<bounds [^>]+/>\s*', bounds_line + '\n', osm_text, count=1)
    if re.search(r'<meta [^>]+/>\s*', osm_text):
        return re.sub(r'(<meta [^>]+/>\s*)', r'\1' + bounds_line + '\n', osm_text, count=1)
    return re.sub(r'(<osm[^>]*>\s*)', r'\1' + bounds_line + '\n', osm_text, count=1)

def write_osm_with_bounds(osm_data, request_body, osm_path):
    with open(osm_path, 'wb') as f:
        f.write(add_or_replace_bounds(osm_data, request_body).encode('utf8'))

def element_tags(elem):
    tags = {}
    for child in list(elem):
        if child.tag != 'tag':
            continue
        key = child.get('k')
        if key is None:
            continue
        tags[key] = child.get('v')
    return tags

def has_building_tags(tags):
    def is_active_building_value(value):
        if value is None:
            return False
        normalized = str(value).strip().lower()
        return normalized != '' and normalized != 'no'
    return (
        is_active_building_value(tags.get('building')) or
        is_active_building_value(tags.get('building:part'))
    )

def parse_osm_tree(osm_path):
    try:
        tree = ET.parse(osm_path)
        return tree
    except Exception as e:
        raise Exception("Can't parse OSM XML at {}: {}".format(osm_path, e))

def set_bounds_on_tree(root, request_body):
    eff_area = request_body['effectiveArea']
    bounds_attrs = {
        'minlat': str(eff_area['latMin']),
        'minlon': str(eff_area['lonMin']),
        'maxlat': str(eff_area['latMax']),
        'maxlon': str(eff_area['lonMax']),
    }
    for child in list(root):
        if child.tag == 'bounds':
            child.attrib = bounds_attrs
            return
    bounds_elem = ET.Element('bounds', bounds_attrs)
    insert_index = 0
    for i, child in enumerate(list(root)):
        if child.tag in ('note', 'meta'):
            insert_index = i + 1
            continue
        if child.tag in ('node', 'way', 'relation'):
            break
        insert_index = i + 1
    root.insert(insert_index, bounds_elem)

def filter_osm_file_for_no_buildings(osm_path, request_body):
    tree = parse_osm_tree(osm_path)
    root = tree.getroot()
    ways = {}
    relations = {}
    for child in list(root):
        elem_id = child.get('id')
        if elem_id is None:
            continue
        if child.tag == 'way':
            ways[elem_id] = child
        elif child.tag == 'relation':
            relations[elem_id] = child

    building_way_ids = set()
    building_relation_ids = set()
    for way_id, way_elem in ways.items():
        if has_building_tags(element_tags(way_elem)):
            building_way_ids.add(way_id)
    for rel_id, rel_elem in relations.items():
        if has_building_tags(element_tags(rel_elem)):
            building_relation_ids.add(rel_id)

    pending_building_relations = list(building_relation_ids)
    seen_building_relations = set()
    while pending_building_relations:
        rel_id = pending_building_relations.pop()
        if rel_id in seen_building_relations:
            continue
        seen_building_relations.add(rel_id)
        rel_elem = relations.get(rel_id)
        if rel_elem is None:
            continue
        for member in rel_elem.findall('member'):
            member_type = member.get('type')
            member_ref = member.get('ref')
            if member_ref is None:
                continue
            if member_type == 'way':
                building_way_ids.add(member_ref)
            elif member_type == 'relation' and member_ref not in seen_building_relations:
                building_relation_ids.add(member_ref)
                pending_building_relations.append(member_ref)

    keep_way_ids = set(ways.keys()) - building_way_ids
    keep_relation_ids = set(relations.keys()) - building_relation_ids

    keep_node_ids = set()
    for way_id in keep_way_ids:
        way_elem = ways.get(way_id)
        if way_elem is None:
            continue
        for nd in way_elem.findall('nd'):
            ref = nd.get('ref')
            if ref is not None:
                keep_node_ids.add(ref)

    for rel_id in keep_relation_ids:
        rel_elem = relations.get(rel_id)
        if rel_elem is None:
            continue
        for member in rel_elem.findall('member'):
            member_type = member.get('type')
            member_ref = member.get('ref')
            if member_ref is None:
                continue
            if member_type == 'node':
                keep_node_ids.add(member_ref)

    new_root = ET.Element(root.tag, root.attrib)
    for child in list(root):
        elem_id = child.get('id')
        if child.tag in ('note', 'meta'):
            new_root.append(copy.deepcopy(child))
            continue
        if child.tag == 'node':
            tags = element_tags(child)
            if has_building_tags(tags):
                continue
            if len(tags) == 0 and elem_id not in keep_node_ids:
                continue
            new_root.append(copy.deepcopy(child))
            continue
        if child.tag == 'way':
            if elem_id in keep_way_ids:
                new_root.append(copy.deepcopy(child))
            continue
        if child.tag == 'relation' and elem_id in keep_relation_ids:
            rel_copy = copy.deepcopy(child)
            for member in list(rel_copy):
                if member.tag != 'member':
                    continue
                member_type = member.get('type')
                member_ref = member.get('ref')
                if member_ref is None:
                    continue
                if member_type == 'way' and member_ref in building_way_ids:
                    rel_copy.remove(member)
                elif member_type == 'relation' and member_ref in building_relation_ids:
                    rel_copy.remove(member)
            new_root.append(rel_copy)

    set_bounds_on_tree(new_root, request_body)
    filtered_tree = ET.ElementTree(new_root)
    with open(osm_path, 'wb') as f:
        filtered_tree.write(f, encoding='UTF-8', xml_declaration=True)

def run_subprocess_with_max_rss_kib(cmd):
    timed_cmd = list(cmd)
    use_time = os.path.exists('/usr/bin/time')
    if use_time:
        timed_cmd = ['/usr/bin/time', '-v'] + timed_cmd

    process = subprocess.Popen(
        timed_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    stdout_data, stderr_data = process.communicate()
    stdout_text = stdout_data.decode('utf8', errors='replace')
    stderr_text = stderr_data.decode('utf8', errors='replace')

    max_rss_kib = None
    if use_time:
        for line in stderr_text.splitlines():
            match = MAX_RSS_KIB_RE.match(line)
            if match is not None:
                try:
                    max_rss_kib = int(match.group(1))
                except Exception:
                    max_rss_kib = None

    if process.returncode != 0:
        raise Exception(
            "command failed ({}) for {} stderr={}".format(
                process.returncode,
                " ".join(cmd),
                compact_log_text(stderr_text, max_length=1000)
            )
        )

    if stdout_text.strip() != '':
        print(stdout_text.strip())

    return max_rss_kib

def prune_osm_file_for_only_big_roads_with_node(osm_path, request_body):
    eff_area = request_body['effectiveArea']
    cmd = [
        'node',
        os.path.join(script_dir, 'prune-only-big-roads.js'),
        '--osm', osm_path,
        '--lon-min', str(eff_area['lonMin']),
        '--lat-min', str(eff_area['latMin']),
        '--lon-max', str(eff_area['lonMax']),
        '--lat-max', str(eff_area['latMax']),
        '--target-density-km-per-km2', str(TARGET_ROAD_DENSITY_KM_PER_KM2),
    ]
    print("running: " + " ".join(cmd))
    return run_subprocess_with_max_rss_kib(cmd)

def get_osm(request_body, work_dir):
    # TODO: verify the requested region isn't too large
    content_mode = ensure_request_content_mode(request_body)
    osm_path = '{}/map.osm'.format(work_dir)
    eff_area = request_body['effectiveArea']
    bbox = "{},{},{},{}".format( eff_area['lonMin'], eff_area['latMin'], eff_area['lonMax'], eff_area['latMax'] )
    if content_mode == 'normal':
        attempts = [
            { 'url': "http://www.overpass-api.de/api/xapi?map?bbox=" + bbox,
              'method': lambda url: get_osm_overpass_api(url=url, timeout=20, request_body=request_body, osm_path=osm_path),
            },
            { 'url': "http://overpass.osm.rambler.ru/cgi/xapi?map?bbox=" + bbox,
              'method': lambda url: get_osm_overpass_api(url=url, timeout=60, request_body=request_body, osm_path=osm_path),
            },
            { 'url': "http://www.overpass-api.de/api/xapi?map?bbox=" + bbox,
              'method': lambda url: get_osm_overpass_api(url=url, timeout=60, request_body=request_body, osm_path=osm_path),
            },
            { 'url': "http://api.openstreetmap.org/api/0.6/map?bbox=" + bbox,
              'method': lambda url: get_osm_main_api(url=url, timeout=120, osm_path=osm_path),
            },
        ]
    else:
        attempts = [
            { 'url': "https://overpass.private.coffee/api/interpreter",
              'method': lambda url: get_osm_overpass_interpreter_api(
                  url=url,
                  timeout=20,
                  request_body=request_body,
                  content_mode=content_mode,
                  osm_path=osm_path
              ),
            },
            { 'url': "https://overpass-api.de/api/interpreter",
              'method': lambda url: get_osm_overpass_interpreter_api(
                  url=url,
                  timeout=40,
                  request_body=request_body,
                  content_mode=content_mode,
                  osm_path=osm_path
              ),
            },
            { 'url': "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
              'method': lambda url: get_osm_overpass_interpreter_api(
                  url=url,
                  timeout=60,
                  request_body=request_body,
                  content_mode=content_mode,
                  osm_path=osm_path
              ),
            },
            { 'url': "http://api.openstreetmap.org/api/0.6/map?bbox=" + bbox,
              'method': lambda url: get_osm_main_api(url=url, timeout=120, osm_path=osm_path),
            },
        ]
    for i, attempt in enumerate(attempts):
        try:
            attempt['method'](attempt['url'])
            fetched_osm_bytes = os.path.getsize(osm_path)
            prune_rss_kib = None
            if content_mode == 'only-big-roads':
                ensure_osm_size_limit(
                    actual_bytes=fetched_osm_bytes,
                    threshold_bytes=MAX_OSM_BYTES_ONLY_BIG_ROADS_BEFORE_PRUNE,
                    phase_text='before pruning'
                )
                prune_rss_kib = prune_osm_file_for_only_big_roads_with_node(osm_path, request_body)
                pruned_osm_bytes = os.path.getsize(osm_path)
                ensure_osm_size_limit(
                    actual_bytes=pruned_osm_bytes,
                    threshold_bytes=MAX_OSM_BYTES_GENERAL,
                    phase_text='after pruning'
                )
            elif content_mode == 'no-buildings':
                ensure_osm_size_limit(
                    actual_bytes=fetched_osm_bytes,
                    threshold_bytes=MAX_OSM_BYTES_GENERAL,
                    phase_text='before pruning'
                )
                filter_osm_file_for_no_buildings(osm_path, request_body)
                pruned_osm_bytes = os.path.getsize(osm_path)
            else:
                ensure_osm_size_limit(
                    actual_bytes=fetched_osm_bytes,
                    threshold_bytes=MAX_OSM_BYTES_GENERAL,
                    phase_text='before pruning'
                )
                pruned_osm_bytes = fetched_osm_bytes
            return osm_path, fetched_osm_bytes, pruned_osm_bytes, prune_rss_kib
        except Exception as e:
            if isinstance(e, RequestProcessingError):
                raise e
            msg = "Can't read map data from " + attempt['url'] + ": " + str(e)
            if i == len(attempts) - 1:
                raise Exception(msg)
            else:
                print(msg)

def get_osm_overpass_api(url, timeout, request_body, osm_path):
    print("getting " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read()
    write_osm_with_bounds(osm_data, request_body, osm_path)

def get_osm_overpass_interpreter_api(url, timeout, request_body, content_mode, osm_path):
    print("getting " + url + " (mode=" + content_mode + ")")
    query = build_overpass_interpreter_query(request_body, content_mode)
    payload = urllib.parse.urlencode({ 'data': query }).encode('utf8')
    request = urllib.request.Request(
        url,
        data=payload,
        headers={ 'Content-Type': 'application/x-www-form-urlencoded' }
    )
    osm_data = urllib.request.urlopen(request, timeout=timeout).read()
    write_osm_with_bounds(osm_data, request_body, osm_path)

def get_osm_main_api(url, timeout, osm_path):
    print("getting " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read()
    with open(osm_path, 'wb') as f:
        f.write(osm_data)

def read_osm_to_tactile_rss_kib(output_dir):
    fields = {}  # type: Dict[str, Optional[int]]
    fields['rss_osm2world_kib'] = None
    fields['rss_blender_kib'] = None
    fields['rss_clip_2d_kib'] = None
    timings_path = os.path.join(output_dir, 'osm-to-tactile-timings.json')
    try:
        with open(timings_path, 'r') as f:
            payload = json.load(f)
    except Exception as e:
        print("warning: can't read {}: {}".format(timings_path, e))
        return fields

    stages = payload.get('stages')
    if not isinstance(stages, list):
        print("warning: invalid stages payload in {}".format(timings_path))
        return fields

    for stage in stages:
        if not isinstance(stage, dict):
            continue
        stage_name = stage.get('name')
        if not isinstance(stage_name, str):
            continue
        field_name = TOP_RAM_STAGE_TO_FIELD.get(stage_name)
        if field_name is None:
            continue
        rss_value = stage.get('maxRssKiB')
        if isinstance(rss_value, int):
            fields[field_name] = rss_value
    return fields

def has_empty_clip_report(output_dir):
    clip_report_path = os.path.join(output_dir, 'map-clip-report.json')
    if not os.path.exists(clip_report_path):
        return False
    try:
        with open(clip_report_path, 'r') as f:
            report = json.load(f)
    except Exception:
        return False
    file_entries = report.get('files')
    if not isinstance(file_entries, list):
        return False
    for entry in file_entries:
        if isinstance(entry, dict) and entry.get('path'):
            return False
    return True

def run_osm_to_tactile(osm_path, request_body):
    output_dir = os.path.dirname(osm_path)
    clip_report_path = os.path.join(output_dir, 'map-clip-report.json')
    try:
        if os.path.exists(clip_report_path):
            os.remove(clip_report_path)
        stl_path = output_dir + '/map.stl'
        if os.path.exists(stl_path):
            os.rename(stl_path, stl_path + ".old")
        args = ['--scale', str(request_body['scale']), '--diameter', str(request_body['diameter']), '--size', str(request_body['size']), ]
        if request_body.get('noBorders', False):
            args.append('--no-borders')
        if not request_body.get('hideLocationMarker', False) and not request_body.get('multipartMode', False) and 'marker1' in request_body:
            eff_area = request_body['effectiveArea']
            marker1x = (request_body['marker1']['lon'] - eff_area['lonMin']) / (eff_area['lonMax'] - eff_area['lonMin'])
            marker1y = (request_body['marker1']['lat'] - eff_area['latMin']) / (eff_area['latMax'] - eff_area['latMin'])
            if 0.04 < marker1x < 0.96 and 0.04 < marker1y < 0.96:
                args.extend([ '--marker1', json.dumps({ 'x': marker1x, 'y': marker1y }) ])
        cmd = ['./osm-to-tactile.py'] + args + [osm_path]
        print("running: " + " ".join(cmd))
        subprocess.check_call(cmd)
        artifact_paths = {
            'stl_path': os.path.join(output_dir, 'map.stl'),
            'stl_ways_path': os.path.join(output_dir, 'map-ways.stl'),
            'stl_rest_path': os.path.join(output_dir, 'map-rest.stl'),
            'svg_path': os.path.join(output_dir, 'map.svg'),
            'blend_path': os.path.join(output_dir, 'map.blend'),
            'meta_raw_path': os.path.join(output_dir, 'map-meta-raw.json'),
        }
        with open(artifact_paths['meta_raw_path'], 'r') as f:
            meta = json.load(f)

        rss_kib = read_osm_to_tactile_rss_kib(os.path.dirname(osm_path))
        return artifact_paths, meta, rss_kib
    except Exception as e:
        if has_empty_clip_report(output_dir):
            raise RequestProcessingError(code='unknown', description=NO_GEOMETRY_ERROR_DESCRIPTION)
        raise Exception("Can't convert map data to STL: " + str(e)) # let's not reveal too much, error msg likely contains paths

# Receive a message from SQS and delete it. Poll up to "poll_time" seconds. Return parsed request, or None if no msg received.
def receive_sqs_msg(queue_name, poll_time):
    end = time_clock() + poll_time
    sqs = boto3.resource('sqs')
    queue = sqs.get_queue_by_name(QueueName = queue_name)
    while end - time_clock() > 20:
        messages = queue.receive_messages(
            WaitTimeSeconds = 20
        )
        if len(messages) > 0:
            message = messages[0]
            print(message.body)

            # Delete message immediately so we won't start looping on it if processing fails
            response = queue.delete_messages(Entries=[{
                'Id': 'dummy',
                'ReceiptHandle': message.receipt_handle,
            }]) # ignore errors

            # Parse
            request = json.loads(message.body)
            # TODO: validate request -- its contents are untrusted
            return request
    return None

def svg_to_pdf(svg_path, pdf_path):
    try:
        # Run conversion in a short-lived subprocess so Cairo/Pango allocations
        # do not remain in process-request.py RSS after PDF generation.
        cmd = [
            sys.executable,
            '-c',
            'import cairosvg,sys; cairosvg.svg2pdf(url=sys.argv[1], write_to=sys.argv[2])',
            svg_path,
            pdf_path
        ]
        return run_subprocess_with_max_rss_kib(cmd)
    except Exception as e:
        raise Exception("Can't convert SVG to PDF: " + str(e))


def gzip_file_to_bytes(path, compresslevel=5, rss_tracker=None):
    out = io.BytesIO()
    with open(path, 'rb') as src:
        with gzip.GzipFile(fileobj=out, mode='wb', compresslevel=compresslevel) as gz:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                gz.write(chunk)
                if rss_tracker is not None:
                    rss_tracker()
    if rss_tracker is not None:
        rss_tracker()
    return out.getvalue()


def upload_primary_assets(bucket, json_object_name, info, name_base,
                          map_object_name, map_content, stl_path, common_args,
                          rss_tracker=None,
                          progress_logger=None):
    # Put the augmented request to S3
    if progress_logger is not None:
        progress_logger('upload-primary-info-json-start', detail='key={}'.format(json_object_name))
    bucket.put_object(
        Key=json_object_name,
        Body=json.dumps(info).encode('utf8'),
        ACL='public-read',
        ContentType='application/json'
    )
    if progress_logger is not None:
        progress_logger('upload-primary-info-json-done', detail='key={}'.format(json_object_name))

    # Map content description is also read on the map display page, so make sure it's uploaded before STL
    map_content_key = name_base + '.map-content.json'
    if progress_logger is not None:
        progress_logger('upload-primary-map-content-start', detail='key={}'.format(map_content_key))
    bucket.put_object(
        Key=map_content_key,
        Body=gzip.compress(map_content, compresslevel=5),
        **common_args,
        ContentType='application/json'
    )
    if rss_tracker is not None:
        rss_tracker()
    if progress_logger is not None:
        progress_logger('upload-primary-map-content-done', detail='key={}'.format(map_content_key))

    # Put full STL file to S3. Completion of this upload makes UI consider the STL creation complete.
    if progress_logger is not None:
        progress_logger('upload-primary-stl-start', detail='key={}'.format(map_object_name))
    bucket.put_object(
        Key=map_object_name,
        Body=gzip_file_to_bytes(stl_path, compresslevel=5, rss_tracker=rss_tracker),
        **common_args,
        ContentType='application/sla'
    )
    if rss_tracker is not None:
        rss_tracker()
    if progress_logger is not None:
        progress_logger('upload-primary-stl-done', detail='key={}'.format(map_object_name))

def attach_request_metadata_to_map_content(map_content, request_body):
    try:
        map_content_json = json.loads(map_content.decode('utf8'))
    except Exception as e:
        raise Exception("Can't parse map-content.json: " + str(e))
    map_content_json['metadata'] = {
        'requestBody': copy.deepcopy(request_body)
    }
    return json.dumps(map_content_json, ensure_ascii=False, separators=(',', ':')).encode('utf8')


def build_info_payload(request_body, meta, status_payload=None):
    # info.json is only map-page bootstrap metadata; omit large geometry arrays.
    info = copy.copy(request_body)
    for key, value in meta.items():
        if key in INFO_JSON_META_DENYLIST:
            continue
        info[key] = value
    if status_payload is not None:
        info['status'] = copy.deepcopy(status_payload)
    return info


def upload_secondary_assets(bucket, name_base, svg_path, pdf_path, stl_ways_path, stl_rest_path, blend_path, common_args, rss_tracker=None, progress_logger=None):
    def upload_blob_from_path(key, path, content_type):
        try:
            if progress_logger is not None:
                progress_logger('upload-secondary-item-start', detail='key={}'.format(key))
            bucket.put_object(
                Key=key,
                Body=gzip_file_to_bytes(path, compresslevel=5, rss_tracker=rss_tracker),
                **common_args,
                ContentType=content_type
            )
            if rss_tracker is not None:
                rss_tracker()
            if progress_logger is not None:
                progress_logger('upload-secondary-item-done', detail='key={}'.format(key))
        except Exception as e:
            print("upload failed for {}: {}".format(key, e))
            if progress_logger is not None:
                progress_logger('upload-secondary-item-failed', detail='key={} error={}'.format(key, e))

    uploads = [
        (name_base + '.svg', svg_path, 'image/svg+xml'),
        (name_base + '.pdf', pdf_path, 'application/pdf'),
        (name_base + '-ways.stl', stl_ways_path, 'application/sla'),
        (name_base + '-rest.stl', stl_rest_path, 'application/sla'),
        (name_base + '.blend', blend_path, 'application/binary')
    ]

    # Upload sequentially to avoid keeping multiple large gzip blobs in memory at once.
    for key, path, content_type in uploads:
        upload_blob_from_path(key, path, content_type)

def run_map_desc(raw_meta_path, profile=None):
    import map_desc
    map_desc.run_map_desc(raw_meta_path, profile=profile)


def init_main_context():
    return {
        's3': None,
        'stats_s3': None,
        'map_bucket_name': None,
        'stats_bucket_name': None,
        'queue_name': None,
        'map_object_name': None,
        'info_object_name': None,
        'map_content_key': None,
        'name_base': None,
        'request_body': None,
        'request_id': None,
        'map_id': None,
        'args': None,
        'stats_root_dir': None,
        'environment': None,
        'worker_name': 'unknown',
        'current_stage': 'bootstrap',
        'failure_stage': None,
        'failure_class': None,
        'failure_message': None,
        'failure_exception': None,
        'error_code': None,
        'error_description': None,
        'status': 'starting',
        'status_progress': None,
        'processing_start_time': None,
        'code_version_fields': empty_code_version_fields(),
        'progress_logger': None,
        'main_start_time': None,
        'timing_get_osm_seconds': None,
        'timing_map_desc_seconds': None,
        'timing_upload_primary_seconds': None,
        'timing_svg_to_pdf_seconds': None,
        'stl_bytes': None,
        'stl_gzip_bytes': None,
        'map_content_gzip_bytes': None,
        'osm_fetched_bytes': None,
        'osm_pruned_bytes': None,
        'rss_osm2world_kib': None,
        'rss_blender_kib': None,
        'rss_clip_2d_kib': None,
        'rss_prune_only_big_roads_kib': None,
        'rss_svg_to_pdf_kib': None,
        'rss_process_request_last_kib': None,
        'rss_process_request_peak_kib': None,
    }


def bootstrap_runtime(ctx):
    ctx['main_start_time'] = time_clock()
    ctx['progress_logger'] = (log_progress if INSTRUMENTATION_ENABLED else None)
    log_progress('main-start', status='running')
    ctx['status'] = 'running'
    ctx['environment'] = os.environ['TM_ENVIRONMENT']
    ctx['queue_name'] = ctx['environment'] + "-requests-touch-mapper"
    ctx['map_bucket_name'] = ctx['environment'] + ".maps.touch-mapper"
    ctx['stats_bucket_name'] = ctx['environment'] + ".stats.touch-mapper"
    ctx['args'] = do_cmdline()
    ctx['stats_root_dir'] = stats_root_dir_from_work_dir(ctx['args'].work_dir)
    ctx['code_version_fields'] = read_code_version_fields(script_dir)
    if ctx['args'].work_dir:
        ctx['worker_name'] = os.path.basename(os.path.normpath(ctx['args'].work_dir))


def init_stats_services(ctx):
    if not STATS_ENABLED:
        return
    try:
        ctx['stats_s3'] = boto3.resource('s3')
        if not STATS_QUICKTIME_MODE:
            try:
                stats_pipeline.run_daily_upload_if_due(
                    stats_root_dir=ctx['stats_root_dir'],
                    s3_resource=ctx['stats_s3'],
                    stats_bucket_name=ctx['stats_bucket_name']
                )
            except Exception as e:
                print("stats daily upload failed: " + str(e))
    except Exception as e:
        print("stats init failed: " + str(e))
        ctx['stats_s3'] = None


def handle_main_exception(ctx, e):
    ctx['failure_exception'] = e
    ctx['failure_stage'] = ctx['current_stage']
    ctx['failure_class'] = e.__class__.__name__
    ctx['failure_message'] = str(e)
    if isinstance(e, RequestProcessingError):
        ctx['error_code'] = e.code
        ctx['error_description'] = e.description
    else:
        ctx['error_code'] = 'unknown'
        ctx['error_description'] = str(e)
    ctx['status'] = 'failed'
    try:
        print("process-request failed: " + str(e))
        log_progress('failed', status='failed', detail=str(e))
        write_status_info_json(
            ctx,
            progress=(ctx.get('status_progress') if ctx.get('status_progress') is not None else STATUS_PROGRESS_SEEN),
            error_code=ctx.get('error_code'),
            error_description=ctx.get('error_description')
        )
    except Exception:
        pass


def build_stats_record(ctx):
    request_body = ctx['request_body']
    total_elapsed = duration_since(ctx['processing_start_time'])
    return {
        'schema_version': 1,
        'timestamp': now_iso_utc(),
        'day': datetime.datetime.utcnow().strftime('%d'),
        'code_branch': ctx['code_version_fields'].get('code_branch'),
        'code_deployed': ctx['code_version_fields'].get('code_deployed'),
        'code_commit': ctx['code_version_fields'].get('code_commit'),
        'request_id': ctx['request_id'],
        'map_id': ctx['map_id'],
        'status': ctx['status'],
        'failure_stage': ctx['failure_stage'],
        'failure_class': ctx['failure_class'],
        'failure_message': ctx['failure_message'],
        'error_code': ctx['error_code'],
        'error_description': ctx['error_description'],
        'termination_signal': progress_state.get('termination_signal'),
        'browser_fingerprint': request_body.get('browserFingerprint'),
        'browser_ip': request_body.get('browserIp'),
        'browser_ip_country': None,
        'browser_ip_country_code': None,
        'browser_ip_region': None,
        'browser_ip_city': None,
        'browser_ip_latitude': None,
        'browser_ip_longitude': None,
        'addr_long': request_body.get('addrLong'),
        'printing_tech': request_body.get('printingTech'),
        'offset_x': request_body.get('offsetX'),
        'offset_y': request_body.get('offsetY'),
        'size_cm': request_body.get('size'),
        'content_mode': request_body.get('contentMode'),
        'hide_location_marker': interpreted_request_bool(request_body, 'hideLocationMarker', False),
        'lon': request_body.get('lon'),
        'lat': request_body.get('lat'),
        'scale': request_body.get('scale'),
        'multipart_mode': interpreted_request_bool(request_body, 'multipartMode', False),
        'no_borders': interpreted_request_bool(request_body, 'noBorders', False),
        'multipart_xpc': request_body.get('multipartXpc'),
        'multipart_ypc': request_body.get('multipartYpc'),
        'advanced_mode': interpreted_request_bool(request_body, 'advancedMode', False),
        'timing_get_osm_seconds': ctx['timing_get_osm_seconds'],
        'timing_map_desc_seconds': ctx['timing_map_desc_seconds'],
        'timing_upload_primary_seconds': ctx['timing_upload_primary_seconds'],
        'timing_svg_to_pdf_seconds': ctx['timing_svg_to_pdf_seconds'],
        'timing_total_seconds': total_elapsed,
        'timing_failed_after_seconds': (total_elapsed if ctx['status'] == 'failed' else None),
        'stl_bytes': ctx['stl_bytes'],
        'stl_gzip_bytes': ctx['stl_gzip_bytes'],
        'map_content_gzip_bytes': ctx['map_content_gzip_bytes'],
        'osm_fetched_bytes': ctx['osm_fetched_bytes'],
        'osm_pruned_bytes': ctx['osm_pruned_bytes'],
        'rss_osm2world_kib': ctx['rss_osm2world_kib'],
        'rss_blender_kib': ctx['rss_blender_kib'],
        'rss_clip_2d_kib': ctx['rss_clip_2d_kib'],
        'rss_prune_only_big_roads_kib': ctx['rss_prune_only_big_roads_kib'],
        'rss_svg_to_pdf_kib': ctx['rss_svg_to_pdf_kib'],
        'rss_process_request_peak_kib': ctx['rss_process_request_peak_kib'],
    }


def write_final_stats_if_possible(ctx):
    if not STATS_ENABLED:
        return
    if ctx['request_body'] is None:
        return
    try:
        track_process_rss_kib(ctx)
        if ctx['stats_root_dir'] is None:
            args = ctx.get('args')
            work_dir = args.work_dir if args else None
            ctx['stats_root_dir'] = stats_root_dir_from_work_dir(work_dir)
        if ctx['map_id'] is None:
            ctx['map_id'] = stats_pipeline.map_id_from_request_id(ctx['request_id'])

        stats_pipeline.write_attempt_record(
            stats_root_dir=ctx['stats_root_dir'],
            record=build_stats_record(ctx),
            quicktime_mode=STATS_QUICKTIME_MODE,
            s3_resource=ctx['stats_s3'],
            stats_bucket_name=ctx['stats_bucket_name']
        )
    except Exception as stats_error:
        print("stats write failed: " + str(stats_error))


def rethrow_failure_if_needed(ctx):
    failure_exception = ctx['failure_exception']
    if failure_exception is None:
        return
    if isinstance(failure_exception, SystemExit):
        raise failure_exception
    if isinstance(failure_exception, KeyboardInterrupt):
        raise failure_exception
    sys.exit(1)


def main():
    # TODO: if output S3 object already exists, exit immediately
    ctx = init_main_context()
    try:
        bootstrap_runtime(ctx)
        track_process_rss_kib(ctx)
        init_stats_services(ctx)
        track_process_rss_kib(ctx)

        # Receive SQS msg
        ctx['current_stage'] = 'poll'
        log_progress('poll-start')
        print("\n\n============= STARTING TO POLL AT %s ===========" % (datetime.datetime.now().isoformat()))
        ctx['request_body'] = receive_sqs_msg(ctx['queue_name'], ctx['args'].poll_time)
        if ctx['request_body'] == None:
            log_progress('poll-empty', status='idle')
            ctx['status'] = 'idle'
            return
        ctx['request_body']['contentMode'] = normalize_content_mode(ctx['request_body'].get('contentMode'))
        ctx['request_id'] = ctx['request_body'].get('requestId')
        ctx['map_id'] = stats_pipeline.map_id_from_request_id(ctx['request_id'])
        ctx['processing_start_time'] = time_clock()
        log_progress('poll-returned', request_id=ctx['request_id'])
        print("Poll returned at %s" % (datetime.datetime.now().isoformat()))
        track_process_rss_kib(ctx)

        # Get OSM data
        ctx['current_stage'] = 'get-osm'
        get_osm_start_time = time_clock()
        log_progress('get-osm-start')
        ctx['s3'] = ctx['stats_s3'] if ctx['stats_s3'] is not None else boto3.resource('s3')
        ctx['map_object_name'] = 'map/data/' + ctx['request_body']['requestId'] + '.stl'
        ctx['info_object_name'] = map_info_object_name_from_request_id(ctx['request_body']['requestId'])
        ctx['name_base'] = ctx['map_object_name'][:-4]
        bucket = ctx['s3'].Bucket(ctx['map_bucket_name'])
        write_status_info_json(ctx, STATUS_PROGRESS_SEEN)
        osm_result = get_osm(ctx['request_body'], ctx['args'].work_dir)
        if osm_result is None:
            raise Exception("OSM path not available")
        osm_path, fetched_osm_bytes, pruned_osm_bytes, prune_rss_kib = osm_result
        ctx['osm_fetched_bytes'] = fetched_osm_bytes
        ctx['osm_pruned_bytes'] = pruned_osm_bytes
        ctx['rss_prune_only_big_roads_kib'] = prune_rss_kib
        ctx['timing_get_osm_seconds'] = duration_since(get_osm_start_time)
        log_progress('get-osm-done')
        track_process_rss_kib(ctx)

        # Convert OSM => STL
        ctx['current_stage'] = 'osm-to-tactile'
        log_progress('osm-to-tactile-start')
        write_status_info_json(ctx, STATUS_PROGRESS_CONVERTING)
        artifacts, meta, rss_kib = run_osm_to_tactile(osm_path, ctx['request_body'])
        ctx['rss_osm2world_kib'] = rss_kib.get('rss_osm2world_kib')
        ctx['rss_blender_kib'] = rss_kib.get('rss_blender_kib')
        ctx['rss_clip_2d_kib'] = rss_kib.get('rss_clip_2d_kib')
        ctx['stl_bytes'] = os.path.getsize(artifacts['stl_path'])
        log_progress('osm-to-tactile-done')
        track_process_rss_kib(ctx)
        raw_meta_path = artifacts['meta_raw_path']

        # Enrich map-meta.json
        ctx['current_stage'] = 'map-desc'
        map_desc_start_time = time_clock()
        log_progress('map-desc-start')
        run_map_desc(raw_meta_path, profile={})
        ctx['timing_map_desc_seconds'] = duration_since(map_desc_start_time)
        log_progress('map-desc-done')
        track_process_rss_kib(ctx)

        ctx['current_stage'] = 'map-content-read'
        map_content_path = os.path.join(os.path.dirname(osm_path), 'map-content.json')
        log_progress('map-content-read-start', detail='path={}'.format(map_content_path))
        with open(map_content_path, 'rb') as f:
            map_content = f.read()
        map_content = attach_request_metadata_to_map_content(map_content, ctx['request_body'])
        ctx['map_content_gzip_bytes'] = len(gzip.compress(map_content, compresslevel=5))
        log_progress('map-content-read-done')
        track_process_rss_kib(ctx)

        common_args = {
            'ACL': 'public-read', 'ContentEncoding': 'gzip',
            'CacheControl': 'max-age=8640000', 'StorageClass': 'GLACIER_IR',
        }

        # Put the augmented request to S3
        ctx['current_stage'] = 'prepare-upload'
        json_object_name = ctx['info_object_name']
        ctx['map_content_key'] = ctx['name_base'] + '.map-content.json'
        info = build_info_payload(
            ctx['request_body'],
            meta,
            status_payload={ 'progress': STATUS_PROGRESS_UPLOADING_PRIMARY }
        )
        ctx['stl_gzip_bytes'] = len(gzip_file_to_bytes(
            artifacts['stl_path'],
            compresslevel=5,
            rss_tracker=functools.partial(track_process_rss_kib, ctx)
        ))
        track_process_rss_kib(ctx)

        # Upload primary assets
        ctx['current_stage'] = 'upload-primary'
        upload_primary_start_time = time_clock()
        log_progress('upload-primary-start')
        write_status_info_json(ctx, STATUS_PROGRESS_UPLOADING_PRIMARY)
        try:
            upload_primary_assets(
                bucket,
                json_object_name,
                info,
                ctx['name_base'],
                ctx['map_object_name'],
                map_content,
                artifacts['stl_path'],
                common_args,
                rss_tracker=functools.partial(track_process_rss_kib, ctx),
                progress_logger=ctx['progress_logger']
            )
        finally:
            ctx['timing_upload_primary_seconds'] = duration_since(upload_primary_start_time)
        log_progress('upload-primary-done')
        map_content = None
        track_process_rss_kib(ctx)

        # Mark map as ready for client polling
        info['status'] = { 'progress': STATUS_PROGRESS_DONE }
        write_info_json(bucket, json_object_name, info)
        ctx['status_progress'] = STATUS_PROGRESS_DONE

        # Create PDF from SVG and put it to S3
        ctx['current_stage'] = 'svg-to-pdf'
        svg_to_pdf_start_time = time_clock()
        log_progress('svg-to-pdf-start')
        pdf_path = os.path.join(os.path.dirname(osm_path), 'map.pdf')
        ctx['rss_svg_to_pdf_kib'] = svg_to_pdf(artifacts['svg_path'], pdf_path)
        ctx['timing_svg_to_pdf_seconds'] = duration_since(svg_to_pdf_start_time)
        log_progress('svg-to-pdf-done')
        track_process_rss_kib(ctx)

        # Upload secondary assets
        ctx['current_stage'] = 'upload-secondary'
        log_progress('upload-secondary-start')
        upload_secondary_assets(
            bucket,
            ctx['name_base'],
            artifacts['svg_path'],
            pdf_path,
            artifacts['stl_ways_path'],
            artifacts['stl_rest_path'],
            artifacts['blend_path'],
            common_args,
            rss_tracker=functools.partial(track_process_rss_kib, ctx),
            progress_logger=ctx['progress_logger']
        )
        log_progress('upload-secondary-done')
        track_process_rss_kib(ctx)

        print("Processing entire request took " + str(time_clock() - ctx['main_start_time']))
        log_progress('complete', status='success')
        ctx['status'] = 'success'
    except BaseException as e:
        track_process_rss_kib(ctx)
        handle_main_exception(ctx, e)
    finally:
        write_final_stats_if_possible(ctx)
        rethrow_failure_if_needed(ctx)

# never output anything

if __name__ == "__main__":
    main()
