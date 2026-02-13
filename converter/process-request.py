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
import subprocess
import concurrent.futures
import functools
import json
import time
import datetime
import math
import gzip
import copy
import signal
import atexit
from typing import Optional
from telemetry import TelemetryLogger

STORE_AGE = 8640000
time_clock = getattr(time, 'clock', time.time)
INSTRUMENTATION_ENV_VAR = 'TOUCH_MAPPER_INSTRUMENTATION'


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
COMPONENT_REQUEST = 'request'
COMPONENT_POLL = 'poll'
COMPONENT_OSM_FETCH = 'osm-fetch'
COMPONENT_OSM_TO_TACTILE = 'osm-to-tactile'
COMPONENT_MAP_DESC = 'map-desc'
COMPONENT_MAP_CONTENT = 'map-content'
COMPONENT_UPLOAD_PRIMARY = 'upload-primary'
COMPONENT_SVG_TO_PDF = 'svg-to-pdf'
COMPONENT_UPLOAD_SECONDARY = 'upload-secondary'
progress_state = {
    'status': 'starting',
    'stage': 'bootstrap',
    'request_id': None,
    'termination_signal': None,
}
TELEMETRY = None  # type: Optional[TelemetryLogger]


def read_proc_status_kib(field_name):
    try:
        with open('/proc/self/status', 'r') as f:
            for line in f:
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
        message = 'MEMORY {label} unavailable'.format(label=label)
        if TELEMETRY is not None:
            TELEMETRY.log(message)
        else:
            print(message)
        return
    vm_rss_mib = (vm_rss_kib / 1024.0) if vm_rss_kib is not None else -1.0
    vm_hwm_mib = (vm_hwm_kib / 1024.0) if vm_hwm_kib is not None else -1.0
    message = 'MEMORY {label} VmRSS={rss_kib}kB ({rss_mib:.1f} MiB) VmHWM={hwm_kib}kB ({hwm_mib:.1f} MiB)'.format(
        label=label,
        rss_kib=('?' if vm_rss_kib is None else vm_rss_kib),
        rss_mib=vm_rss_mib,
        hwm_kib=('?' if vm_hwm_kib is None else vm_hwm_kib),
        hwm_mib=vm_hwm_mib
    )
    if TELEMETRY is not None:
        TELEMETRY.log(message)
    else:
        print(message)


def compact_log_text(value, max_length=240):
    text = re.sub(r'\s+', ' ', str(value)).strip()
    if len(text) > max_length:
        return text[:max_length] + '...'
    return text


def _format_max_rss(max_rss_kib):
    if max_rss_kib is None:
        return 'n/a'
    return '{:.1f} MiB'.format(float(max_rss_kib) / 1024.0)


def _max_opt(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return a if a >= b else b


def log_progress(stage, status=None, request_id=None, detail=None):
    if request_id is not None:
        progress_state['request_id'] = request_id
    if status is not None:
        progress_state['status'] = status
    progress_state['stage'] = stage
    fields = {
        'requestId': progress_state['request_id'],
        'status': progress_state['status'],
        'ts': datetime.datetime.utcnow().isoformat() + 'Z',
    }
    if detail:
        fields['detail'] = compact_log_text(detail)
    if TELEMETRY is not None:
        TELEMETRY.log('PROGRESS {stage}'.format(stage=stage), fields=fields)
    else:
        print('PROGRESS {stage}'.format(stage=stage))


def log_exit_progress():
    fields = {
        'last_stage': progress_state['stage'],
        'requestId': progress_state['request_id'],
        'signal': progress_state['termination_signal'],
        'status': progress_state['status'],
        'ts': datetime.datetime.utcnow().isoformat() + 'Z',
    }
    if TELEMETRY is not None:
        TELEMETRY.log('PROGRESS exit', fields=fields)
    else:
        print('PROGRESS exit')


def handle_termination_signal(signum, frame):
    if progress_state.get('termination_signal') is None:
        progress_state['termination_signal'] = signum
        log_progress(
            'signal-received',
            status='terminated',
            detail='signal={}'.format(signum)
        )
        log_memory_checkpoint('signal-{signal}'.format(signal=signum))
    raise SystemExit(128 + signum)


atexit.register(log_exit_progress)
signal.signal(signal.SIGTERM, handle_termination_signal)
signal.signal(signal.SIGINT, handle_termination_signal)

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Create STL and put into S3 based on a SQS request''')
    parser.add_argument('--poll-time', metavar='SECONDS', type=int, help="poll for a request at most this long")
    parser.add_argument('--work-dir', metavar='PATH', help="write all files into this directory")
    args = parser.parse_args()
    return args

def update_progress(s3, map_bucket_name, map_object_name, stage):
    s3.Bucket(map_bucket_name).put_object(Key=map_object_name, ACL='public-read', \
        CacheControl='no-cache', StorageClass='GLACIER_IR', Metadata={ 'processing-stage': stage })


def overpass_map_urls(bbox):
    # Public instances from OSM wiki (current list), using map endpoint for bbox export.
    return [
        "https://overpass-api.de/api/map?bbox=" + bbox,
        "https://overpass.private.coffee/api/map?bbox=" + bbox,
        "https://maps.mail.ru/osm/tools/overpass/api/map?bbox=" + bbox,
    ]


def get_osm(progress_updater, request_body, work_dir, telemetry):
    # TODO: verify the requested region isn't too large
    progress_updater('reading_osm')
    osm_path = '{}/map.osm'.format(work_dir)
    eff_area = request_body['effectiveArea']
    bbox = "{},{},{},{}".format( eff_area['lonMin'], eff_area['latMin'], eff_area['lonMax'], eff_area['latMax'] )
    attempts = [{
          'url': url,
          'method': lambda target_url: get_osm_overpass_api(
              url=target_url,
              timeout=40,
              request_body=request_body,
              osm_path=osm_path,
              telemetry=telemetry
          ),
        } for url in overpass_map_urls(bbox)] + [
        { 'url': "https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox,
          'method': lambda url: get_osm_main_api(url=url, timeout=120, osm_path=osm_path, telemetry=telemetry),
        },
    ]
    for i, attempt in enumerate(attempts):
        try:
            attempt['method'](attempt['url'])
            return osm_path
        except Exception as e:
            msg = "Can't read map data from " + attempt['url'] + ": " + str(e)
            if i == len(attempts) - 1:
                raise Exception(msg)
            else:
                telemetry.log(msg)

def get_osm_overpass_api(url, timeout, request_body, osm_path, telemetry):
    telemetry.log("running: GET " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read().decode('utf8')
    eff_area = request_body['effectiveArea']
    bounds = '  <bounds minlat="{}" minlon="{}" maxlat="{}" maxlon="{}"/>'.format( eff_area['latMin'], eff_area['lonMin'], eff_area['latMax'], eff_area['lonMax'] )
    with open(osm_path, 'wb') as f:
        f.write(bytes(re.sub(r'<meta [^>]+>\n', r'\g<0>' + bounds, osm_data, count=1), 'UTF-8'))

def get_osm_main_api(url, timeout, osm_path, telemetry):
    telemetry.log("running: GET " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read()
    with open(osm_path, 'wb') as f:
        f.write(osm_data)

def run_osm_to_tactile(progress_updater, osm_path, request_body, telemetry):
    try:
        log_memory_checkpoint('before-osm-to-tactile-subprocess')
        progress_updater('converting')
        stl_path = os.path.dirname(osm_path) + '/map.stl'
        if os.path.exists(stl_path):
            os.rename(stl_path, stl_path + ".old")
        args = ['--scale', str(request_body['scale']), '--diameter', str(request_body['diameter']), '--size', str(request_body['size']), ]
        if request_body.get('noBorders', False):
            args.append('--no-borders')
        if request_body.get('excludeBuildings', False):
            args.append('--exclude-buildings')
        if not request_body.get('hideLocationMarker', False) and not request_body.get('multipartMode', False) and 'marker1' in request_body:
            eff_area = request_body['effectiveArea']
            marker1x = (request_body['marker1']['lon'] - eff_area['lonMin']) / (eff_area['lonMax'] - eff_area['lonMin'])
            marker1y = (request_body['marker1']['lat'] - eff_area['latMin']) / (eff_area['latMax'] - eff_area['latMin'])
            if 0.04 < marker1x < 0.96 and 0.04 < marker1y < 0.96:
                args.extend([ '--marker1', json.dumps({ 'x': marker1x, 'y': marker1y }) ])
        cmd = ['./osm-to-tactile.py'] + args + [osm_path]
        run_result = telemetry.run_subprocess(
            cmd,
            env={
                'TOUCH_MAPPER_LOG_DEPTH_BASE': '2'
            },
            cwd=script_dir,
            depth_offset=1
        )

        with open(os.path.dirname(osm_path) + '/map.stl', 'rb') as f:
            stl = f.read()
        with open(os.path.dirname(osm_path) + '/map-ways.stl', 'rb') as f:
            stl_ways = f.read()
        with open(os.path.dirname(osm_path) + '/map-rest.stl', 'rb') as f:
            stl_rest = f.read()
        with open(os.path.dirname(osm_path) + '/map.svg', 'rb') as f:
            svg = f.read()
        with open(os.path.dirname(osm_path) + '/map.blend', 'rb') as f:
            blend = f.read()
        with open(os.path.dirname(osm_path) + '/map-meta-raw.json', 'r') as f:
            meta = f.read()

        timings_payload = None
        timings_path = os.path.join(os.path.dirname(osm_path), 'osm-to-tactile-timings.json')
        if os.path.exists(timings_path):
            with open(timings_path, 'r') as f:
                timings_payload = json.load(f)

        log_memory_checkpoint('after-osm-to-tactile-subprocess')
        return stl, stl_ways, stl_rest, svg, blend, json.loads(meta), run_result.get('maxRssKiB'), timings_payload
    except Exception as e:
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

def svg_to_pdf(svg_path):
    try:
        import cairosvg  # type: ignore[import-not-found]
        return cairosvg.svg2pdf(url=svg_path)
    except Exception as e:
        raise Exception("Can't convert SVG to PDF: " + str(e))


def upload_primary_assets(bucket, json_object_name, info, name_base,
                          map_object_name, map_content, stl, common_args,
                          progress_logger=None):
    # Put the augmented request to S3. No reduced redundancy, because this provides permanent access to
    # parameters of created maps (obsolete logic since maps are now available for only a few months)
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
    if progress_logger is not None:
        progress_logger('upload-primary-map-content-done', detail='key={}'.format(map_content_key))

    # Put full STL file to S3. Completion of this upload makes UI consider the STL creation complete.
    if progress_logger is not None:
        progress_logger('upload-primary-stl-start', detail='key={}'.format(map_object_name))
    bucket.put_object(
        Key=map_object_name,
        Body=gzip.compress(stl, compresslevel=5),
        **common_args,
        ContentType='application/sla'
    )
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


def build_info_payload(request_body, meta):
    # info.json is only map-page bootstrap metadata; omit large geometry arrays.
    info = copy.copy(request_body)
    for key, value in meta.items():
        if key in INFO_JSON_META_DENYLIST:
            continue
        info[key] = value
    return info


def upload_secondary_assets(bucket, name_base, svg, pdf, stl_ways, stl_rest, blend, common_args, progress_logger=None, live_logger=None):
    def upload_blob(key, body, content_type):
        try:
            if progress_logger is not None:
                progress_logger('upload-secondary-item-start', detail='key={}'.format(key))
            bucket.put_object(
                Key=key,
                Body=gzip.compress(body, compresslevel=5),
                **common_args,
                ContentType=content_type
            )
            if progress_logger is not None:
                progress_logger('upload-secondary-item-done', detail='key={}'.format(key))
        except Exception as e:
            if live_logger is not None:
                live_logger("upload failed for {}: {}".format(key, e))
            else:
                print("upload failed for {}: {}".format(key, e))
            if progress_logger is not None:
                progress_logger('upload-secondary-item-failed', detail='key={} error={}'.format(key, e))

    uploads = [
        (name_base + '.svg', svg, 'image/svg+xml'),
        (name_base + '.pdf', pdf, 'application/pdf'),
        (name_base + '-ways.stl', stl_ways, 'application/sla'),
        (name_base + '-rest.stl', stl_rest, 'application/sla'),
        (name_base + '.blend', blend, 'application/binary')
    ]

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(uploads)) as executor:
        futures = [executor.submit(upload_blob, key, body, content_type) for key, body, content_type in uploads]
        for future in futures:
            try:
                future.result()
            except Exception as e:
                if live_logger is not None:
                    live_logger("upload worker failed: {}".format(e))
                else:
                    print("upload worker failed: {}".format(e))

def run_map_desc(raw_meta_path, profile=None):
    import map_desc
    map_desc.run_map_desc(raw_meta_path, profile=profile)

def main():
    global TELEMETRY
    # TODO: if output S3 object already exists, exit immediately
    TELEMETRY = TelemetryLogger(component=COMPONENT_REQUEST, base_depth=0)
    s3 = None
    map_bucket_name = None
    map_object_name = None
    name_base = None
    request_max_rss_kib = None
    request_entire_start = time_clock()
    request_id = None
    try:
        progress_logger = log_progress
        log_progress('main-start', status='running')
        environment = os.environ['TM_ENVIRONMENT']
        queue_name = environment + "-requests-touch-mapper"
        map_bucket_name = environment + ".maps.touch-mapper"
        args = do_cmdline()
        log_memory_checkpoint('main-start')

        # Receive SQS msg
        poll_stage = TELEMETRY.start_stage('poll', component=COMPONENT_POLL)
        log_progress('poll-start')
        request_body = receive_sqs_msg(queue_name, args.poll_time)
        if request_body == None:
            log_progress('poll-empty', status='idle')
            poll_node = TELEMETRY.end_stage(poll_stage, own_max_rss_kib=None)
            request_max_rss_kib = _max_opt(request_max_rss_kib, poll_node.get('maxRssKiB'))
            return
        request_id = request_body.get('requestId')
        log_progress('poll-returned', request_id=request_id)
        poll_node = TELEMETRY.end_stage(poll_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, poll_node.get('maxRssKiB'))
        log_memory_checkpoint('after-receive-sqs')

        # Get OSM data
        get_osm_stage = TELEMETRY.start_stage('get-osm', component=COMPONENT_OSM_FETCH)
        log_progress('get-osm-start')
        s3 = boto3.resource('s3')
        map_object_name = 'map/data/' + request_body['requestId'] + '.stl'
        name_base = map_object_name[:-4]
        bucket = s3.Bucket(map_bucket_name)
        progress_updater = functools.partial(update_progress, s3, map_bucket_name, map_object_name)
        osm_path = get_osm(progress_updater, request_body, args.work_dir, TELEMETRY)
        if osm_path is None:
            raise Exception("OSM path not available")
        log_progress('get-osm-done')
        get_osm_node = TELEMETRY.end_stage(get_osm_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, get_osm_node.get('maxRssKiB'))
        log_memory_checkpoint('after-get-osm')

        # Convert OSM => STL
        osm_to_tactile_stage = TELEMETRY.start_stage('osm-to-tactile', component=COMPONENT_OSM_TO_TACTILE)
        log_progress('osm-to-tactile-start')
        stl, stl_ways, stl_rest, svg, blend, meta, osm_to_tactile_rss_kib, osm_to_tactile_timings = run_osm_to_tactile(
            progress_updater,
            osm_path,
            request_body,
            TELEMETRY
        )
        if isinstance(osm_to_tactile_timings, dict):
            for child in osm_to_tactile_timings.get('stages', []):
                if isinstance(child, dict):
                    TELEMETRY.attach_external_child(osm_to_tactile_stage, child)
        log_progress('osm-to-tactile-done')
        osm_to_tactile_node = TELEMETRY.end_stage(
            osm_to_tactile_stage,
            own_max_rss_kib=osm_to_tactile_rss_kib
        )
        request_max_rss_kib = _max_opt(request_max_rss_kib, osm_to_tactile_node.get('maxRssKiB'))
        raw_meta_path = os.path.join(os.path.dirname(osm_path), 'map-meta-raw.json')
        log_memory_checkpoint('after-run-osm-to-tactile')

        # Enrich map-meta.json
        map_desc_stage = TELEMETRY.start_stage('map-desc', component=COMPONENT_MAP_DESC)
        log_progress('map-desc-start')
        map_desc_profile = {}
        run_map_desc(raw_meta_path, profile=map_desc_profile)
        for key in ('group-map-data', 'write-map-meta', 'write-map-meta-augmented', 'write-map-content'):
            value = map_desc_profile.get(key)
            if isinstance(value, (int, float)):
                TELEMETRY.attach_external_child(
                    map_desc_stage,
                    {
                        'name': 'map-desc.' + key,
                        'component': 'map-desc',
                        'totalSec': float(value),
                        'selfSec': float(value),
                        'childSec': 0.0,
                        'maxRssKiB': None,
                        'children': [],
                    }
                )
        log_progress('map-desc-done')
        map_desc_node = TELEMETRY.end_stage(map_desc_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, map_desc_node.get('maxRssKiB'))
        log_memory_checkpoint('after-run-map-desc')

        map_content_stage = TELEMETRY.start_stage('map-content-read', component=COMPONENT_MAP_CONTENT)
        map_content_path = os.path.join(os.path.dirname(osm_path), 'map-content.json')
        log_progress('map-content-read-start', detail='path={}'.format(map_content_path))
        with open(map_content_path, 'rb') as f:
            map_content = f.read()
        map_content = attach_request_metadata_to_map_content(map_content, request_body)
        log_progress('map-content-read-done')
        map_content_node = TELEMETRY.end_stage(map_content_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, map_content_node.get('maxRssKiB'))
        log_memory_checkpoint('after-attach-request-metadata')

        common_args = {
            'ACL': 'public-read', 'ContentEncoding': 'gzip',
            'CacheControl': 'max-age=8640000', 'StorageClass': 'GLACIER_IR',
        }

        # Put the augmented request to S3. No reduced redundancy, because this provides permanent access to parameters of created maps.
        json_object_name = 'map/info/' + re.sub(r'\/.+', '.json', request_body['requestId']) # deadbeef/foo.stl => info/deadbeef.json
        info = build_info_payload(request_body, meta)

        upload_primary_stage = TELEMETRY.start_stage('upload-primary', component=COMPONENT_UPLOAD_PRIMARY)
        log_progress('upload-primary-start')
        upload_primary_assets(
            bucket,
            json_object_name,
            info,
            name_base,
            map_object_name,
            map_content,
            stl,
            common_args,
            progress_logger=progress_logger
        )
        log_progress('upload-primary-done')
        upload_primary_node = TELEMETRY.end_stage(upload_primary_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, upload_primary_node.get('maxRssKiB'))
        log_memory_checkpoint('after-upload-primary-assets')

        # Create PDF from SVG and put it to S3
        svg_to_pdf_stage = TELEMETRY.start_stage('svg-to-pdf', component=COMPONENT_SVG_TO_PDF)
        log_progress('svg-to-pdf-start')
        pdf = svg_to_pdf(os.path.dirname(osm_path) + '/map.svg')
        log_progress('svg-to-pdf-done')
        svg_to_pdf_node = TELEMETRY.end_stage(svg_to_pdf_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, svg_to_pdf_node.get('maxRssKiB'))

        upload_secondary_stage = TELEMETRY.start_stage('upload-secondary', component=COMPONENT_UPLOAD_SECONDARY)
        log_progress('upload-secondary-start')
        upload_secondary_assets(
            bucket,
            name_base,
            svg,
            pdf,
            stl_ways,
            stl_rest,
            blend,
            common_args,
            progress_logger=progress_logger,
            live_logger=lambda line: (
                TELEMETRY.log(line, component=COMPONENT_UPLOAD_SECONDARY)
                if TELEMETRY is not None else print(line)
            )
        )
        log_progress('upload-secondary-done')
        upload_secondary_node = TELEMETRY.end_stage(upload_secondary_stage, own_max_rss_kib=None)
        request_max_rss_kib = _max_opt(request_max_rss_kib, upload_secondary_node.get('maxRssKiB'))
        log_memory_checkpoint('after-upload-secondary-assets')

        request_entire_sec = time_clock() - request_entire_start
        TELEMETRY.log(
            "SUMMARY request-entire (total {:.2f}s, maxRSS {})".format(
                request_entire_sec,
                _format_max_rss(request_max_rss_kib)
            )
        )
        timings_dir = args.work_dir if args.work_dir else os.path.dirname(osm_path)
        timings_path = os.path.join(timings_dir, 'request-timings.json')
        TELEMETRY.write_json(
            timings_path,
            extra={
                'requestId': request_id,
                'totals': {
                    'requestEntireSec': request_entire_sec,
                }
            }
        )
        TELEMETRY.log('timings-json: ' + timings_path)
        log_progress('complete', status='success')
    except Exception as e:
        try:
            if TELEMETRY is not None:
                TELEMETRY.log("process-request failed: " + str(e))
            else:
                print("process-request failed: " + str(e))
            log_progress('failed', status='failed', detail=str(e))
            log_memory_checkpoint('failed')
            if s3 != None and map_bucket_name is not None and map_object_name is not None:
                # Put map file that contains just the error message in metadata
                s3.Bucket(map_bucket_name).put_object(Key=map_object_name, Body=b'', ACL='public-read', \
                    CacheControl='max-age=8640000', StorageClass='GLACIER_IR', Metadata={ 'error-msg': str(e) })
        except:
            pass
        sys.exit(1)

# never output anything

if __name__ == "__main__":
    main()
