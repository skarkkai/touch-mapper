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
import socket

import stats_pipeline

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
STATS_ENABLED = True
STATS_QUICKTIME_MODE = False
progress_state = {
    'status': 'starting',
    'stage': 'bootstrap',
    'request_id': None,
    'termination_signal': None,
}


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
        print('MEMORY:process-request:{label} unavailable'.format(label=label))
        return
    vm_rss_mib = (vm_rss_kib / 1024.0) if vm_rss_kib is not None else -1.0
    vm_hwm_mib = (vm_hwm_kib / 1024.0) if vm_hwm_kib is not None else -1.0
    print(
        'MEMORY:process-request:{label} VmRSS={rss_kib}kB ({rss_mib:.1f} MiB) VmHWM={hwm_kib}kB ({hwm_mib:.1f} MiB)'.format(
            label=label,
            rss_kib=('?' if vm_rss_kib is None else vm_rss_kib),
            rss_mib=vm_rss_mib,
            hwm_kib=('?' if vm_hwm_kib is None else vm_hwm_kib),
            hwm_mib=vm_hwm_mib
        )
    )


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
        log_memory_checkpoint('signal-{signal}'.format(signal=signum))
    raise SystemExit(128 + signum)


if INSTRUMENTATION_ENABLED:
    atexit.register(log_exit_progress)
    signal.signal(signal.SIGTERM, handle_termination_signal)
    signal.signal(signal.SIGINT, handle_termination_signal)


def now_iso_utc():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'


def stats_root_dir_from_work_dir(work_dir):
    if work_dir:
        runtime_dir = os.path.dirname(os.path.abspath(work_dir))
        environment_dir = os.path.dirname(runtime_dir)
        return os.path.join(environment_dir, 'stats')
    return os.path.join(os.path.dirname(script_dir), 'stats')


def count_entries(value):
    return len(value) if isinstance(value, list) else None


def extract_boundary(meta):
    if not isinstance(meta, dict):
        return {}
    nested = meta.get('meta')
    if not isinstance(nested, dict):
        return {}
    boundary = nested.get('boundary')
    if isinstance(boundary, dict):
        return boundary
    return {}


def duration_since(start_time):
    if start_time is None:
        return None
    return time_clock() - start_time


def json_profile_or_none(profile):
    if not profile:
        return None
    return json.dumps(profile, separators=(',', ':'), ensure_ascii=False)

def do_cmdline():
    parser = argparse.ArgumentParser(description='''Create STL and put into S3 based on a SQS request''')
    parser.add_argument('--poll-time', metavar='SECONDS', type=int, help="poll for a request at most this long")
    parser.add_argument('--work-dir', metavar='PATH', help="write all files into this directory")
    args = parser.parse_args()
    return args

def update_progress(s3, map_bucket_name, map_object_name, stage):
    s3.Bucket(map_bucket_name).put_object(Key=map_object_name, ACL='public-read', \
        CacheControl='no-cache', StorageClass='GLACIER_IR', Metadata={ 'processing-stage': stage })

def get_osm(progress_updater, request_body, work_dir):
    # TODO: verify the requested region isn't too large
    progress_updater('reading_osm')
    osm_path = '{}/map.osm'.format(work_dir)
    eff_area = request_body['effectiveArea']
    bbox = "{},{},{},{}".format( eff_area['lonMin'], eff_area['latMin'], eff_area['lonMax'], eff_area['latMax'] )
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
    for i, attempt in enumerate(attempts):
        try:
            attempt['method'](attempt['url'])
            return osm_path
        except Exception as e:
            msg = "Can't read map data from " + attempt['url'] + ": " + str(e)
            if i == len(attempts) - 1:
                raise(msg)
            else:
                print(msg)

def get_osm_overpass_api(url, timeout, request_body, osm_path):
    print("getting " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read().decode('utf8')
    eff_area = request_body['effectiveArea']
    bounds = '  <bounds minlat="{}" minlon="{}" maxlat="{}" maxlon="{}"/>'.format( eff_area['latMin'], eff_area['lonMin'], eff_area['latMax'], eff_area['lonMax'] )
    with open(osm_path, 'wb') as f:
        f.write(bytes(re.sub(r'<meta [^>]+>\n', r'\g<0>' + bounds, osm_data, count=1), 'UTF-8'))

def get_osm_main_api(url, timeout, osm_path):
    print("getting " + url)
    osm_data = urllib.request.urlopen(url, timeout=timeout).read()
    with open(osm_path, 'wb') as f:
        f.write(osm_data)

def run_osm_to_tactile(progress_updater, osm_path, request_body):
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
        print("running: " + " ".join(cmd))
        subprocess.check_call(cmd)

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

        log_memory_checkpoint('after-osm-to-tactile-subprocess')
        return stl, stl_ways, stl_rest, svg, blend, json.loads(meta)
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


def upload_secondary_assets(bucket, name_base, svg, pdf, stl_ways, stl_rest, blend, common_args, progress_logger=None):
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
                print("upload worker failed: {}".format(e))

def run_map_desc(raw_meta_path, profile=None):
    import map_desc
    map_desc.run_map_desc(raw_meta_path, profile=profile)

def main():
    # TODO: if output S3 object already exists, exit immediately
    s3 = None
    stats_s3 = None
    map_bucket_name = None
    stats_bucket_name = None
    map_object_name = None
    info_object_name = None
    map_content_key = None
    name_base = None
    request_body = None
    request_id = None
    map_id = None
    args = None
    stats_root_dir = None
    environment = None
    worker_name = 'unknown'
    current_stage = 'bootstrap'
    failure_stage = None
    failure_class = None
    failure_message = None
    failure_exception = None
    status = 'starting'
    processing_start_time = None

    timing_get_osm_seconds = None
    timing_osm_to_tactile_seconds = None
    timing_map_desc_seconds = None
    timing_map_content_read_seconds = None
    timing_upload_primary_seconds = None
    timing_svg_to_pdf_seconds = None
    timing_upload_secondary_seconds = None

    stl = None
    stl_ways = None
    stl_rest = None
    svg = None
    pdf = None
    blend = None
    map_content = None
    info = None
    meta = None
    map_desc_profile = {}

    stl_bytes = None
    stl_gzip_bytes = None
    stl_ways_bytes = None
    stl_rest_bytes = None
    svg_bytes = None
    pdf_bytes = None
    blend_bytes = None
    map_content_bytes = None
    map_content_gzip_bytes = None
    info_json_bytes = None

    try:
        t = time_clock()
        progress_logger = (log_progress if INSTRUMENTATION_ENABLED else None)
        log_progress('main-start', status='running')
        status = 'running'
        environment = os.environ['TM_ENVIRONMENT']
        queue_name = environment + "-requests-touch-mapper"
        map_bucket_name = environment + ".maps.touch-mapper"
        stats_bucket_name = environment + ".stats.touch-mapper"
        args = do_cmdline()
        stats_root_dir = stats_root_dir_from_work_dir(args.work_dir)
        if args.work_dir:
            worker_name = os.path.basename(os.path.normpath(args.work_dir))

        if STATS_ENABLED:
            try:
                stats_s3 = boto3.resource('s3')
                if not STATS_QUICKTIME_MODE:
                    try:
                        stats_pipeline.run_daily_upload_if_due(
                            stats_root_dir=stats_root_dir,
                            s3_resource=stats_s3,
                            stats_bucket_name=stats_bucket_name
                        )
                    except Exception as e:
                        print("stats daily upload failed: " + str(e))
            except Exception as e:
                print("stats init failed: " + str(e))
                stats_s3 = None

        log_memory_checkpoint('main-start')

        # Receive SQS msg
        current_stage = 'poll'
        log_progress('poll-start')
        print("\n\n============= STARTING TO POLL AT %s ===========" % (datetime.datetime.now().isoformat()))
        request_body = receive_sqs_msg(queue_name, args.poll_time)
        if request_body == None:
            log_progress('poll-empty', status='idle')
            status = 'idle'
            return
        request_id = request_body.get('requestId')
        map_id = stats_pipeline.map_id_from_request_id(request_id)
        processing_start_time = time_clock()
        log_progress('poll-returned', request_id=request_id)
        print("Poll returned at %s" % (datetime.datetime.now().isoformat()))
        log_memory_checkpoint('after-receive-sqs')

        # Get OSM data
        current_stage = 'get-osm'
        get_osm_start_time = time_clock()
        log_progress('get-osm-start')
        s3 = stats_s3 if stats_s3 is not None else boto3.resource('s3')
        map_object_name = 'map/data/' + request_body['requestId'] + '.stl'
        name_base = map_object_name[:-4]
        bucket = s3.Bucket(map_bucket_name)
        progress_updater = functools.partial(update_progress, s3, map_bucket_name, map_object_name)
        osm_path = get_osm(progress_updater, request_body, args.work_dir)
        if osm_path is None:
            raise Exception("OSM path not available")
        timing_get_osm_seconds = duration_since(get_osm_start_time)
        log_progress('get-osm-done')
        log_memory_checkpoint('after-get-osm')

        # Convert OSM => STL
        current_stage = 'osm-to-tactile'
        osm_to_tactile_start_time = time_clock()
        log_progress('osm-to-tactile-start')
        stl, stl_ways, stl_rest, svg, blend, meta = run_osm_to_tactile(progress_updater, osm_path, request_body)
        timing_osm_to_tactile_seconds = duration_since(osm_to_tactile_start_time)
        stl_bytes = len(stl)
        stl_ways_bytes = len(stl_ways)
        stl_rest_bytes = len(stl_rest)
        svg_bytes = len(svg)
        blend_bytes = len(blend)
        log_progress('osm-to-tactile-done')
        raw_meta_path = os.path.join(os.path.dirname(osm_path), 'map-meta-raw.json')
        log_memory_checkpoint('after-run-osm-to-tactile')

        # Enrich map-meta.json
        current_stage = 'map-desc'
        map_desc_start_time = time_clock()
        log_progress('map-desc-start')
        map_desc_profile = {}
        run_map_desc(raw_meta_path, profile=map_desc_profile)
        timing_map_desc_seconds = duration_since(map_desc_start_time)
        log_progress('map-desc-done')
        log_memory_checkpoint('after-run-map-desc')

        current_stage = 'map-content-read'
        map_content_read_start_time = time_clock()
        map_content_path = os.path.join(os.path.dirname(osm_path), 'map-content.json')
        log_progress('map-content-read-start', detail='path={}'.format(map_content_path))
        with open(map_content_path, 'rb') as f:
            map_content = f.read()
        map_content = attach_request_metadata_to_map_content(map_content, request_body)
        map_content_bytes = len(map_content)
        map_content_gzip_bytes = len(gzip.compress(map_content, compresslevel=5))
        timing_map_content_read_seconds = duration_since(map_content_read_start_time)
        log_progress('map-content-read-done')
        log_memory_checkpoint('after-attach-request-metadata')

        common_args = {
            'ACL': 'public-read', 'ContentEncoding': 'gzip',
            'CacheControl': 'max-age=8640000', 'StorageClass': 'GLACIER_IR',
        }

        # Put the augmented request to S3. No reduced redundancy, because this provides permanent access to parameters of created maps.
        current_stage = 'prepare-upload'
        json_object_name = 'map/info/' + re.sub(r'\/.+', '.json', request_body['requestId']) # deadbeef/foo.stl => info/deadbeef.json
        info_object_name = json_object_name
        map_content_key = name_base + '.map-content.json'
        info = build_info_payload(request_body, meta)
        info_json_bytes = len(json.dumps(info).encode('utf8'))
        stl_gzip_bytes = len(gzip.compress(stl, compresslevel=5))

        current_stage = 'upload-primary'
        upload_primary_start_time = time_clock()
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
        timing_upload_primary_seconds = duration_since(upload_primary_start_time)
        log_progress('upload-primary-done')
        print("Processing main request took " + str(time_clock() - t))
        log_memory_checkpoint('after-upload-primary-assets')

        # Create PDF from SVG and put it to S3
        current_stage = 'svg-to-pdf'
        svg_to_pdf_start_time = time_clock()
        log_progress('svg-to-pdf-start')
        pdf = svg_to_pdf(os.path.dirname(osm_path) + '/map.svg')
        if isinstance(pdf, bytes):
            pdf_bytes = len(pdf)
        else:
            pdf_bytes = None
        timing_svg_to_pdf_seconds = duration_since(svg_to_pdf_start_time)
        log_progress('svg-to-pdf-done')

        current_stage = 'upload-secondary'
        upload_secondary_start_time = time_clock()
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
            progress_logger=progress_logger
        )
        timing_upload_secondary_seconds = duration_since(upload_secondary_start_time)
        log_progress('upload-secondary-done')
        log_memory_checkpoint('after-upload-secondary-assets')

        print("Processing entire request took " + str(time_clock() - t))
        log_progress('complete', status='success')
        status = 'success'
    except BaseException as e:
        failure_exception = e
        failure_stage = current_stage
        failure_class = e.__class__.__name__
        failure_message = str(e)
        status = 'failed'
        if isinstance(e, Exception):
            try:
                print("process-request failed: " + str(e))
                log_progress('failed', status='failed', detail=str(e))
                log_memory_checkpoint('failed')
                if s3 != None and map_bucket_name is not None and map_object_name is not None:
                    # Put map file that contains just the error message in metadata
                    s3.Bucket(map_bucket_name).put_object(Key=map_object_name, Body=b'', ACL='public-read', \
                        CacheControl='max-age=8640000', StorageClass='GLACIER_IR', Metadata={ 'error-msg': str(e) })
            except Exception:
                pass
    finally:
        if STATS_ENABLED and request_body is not None:
            try:
                if stats_root_dir is None:
                    stats_root_dir = stats_root_dir_from_work_dir((args.work_dir if args else None))
                if map_id is None:
                    map_id = stats_pipeline.map_id_from_request_id(request_id)
                boundary = extract_boundary(meta)
                marker1 = request_body.get('marker1') if isinstance(request_body, dict) else None
                marker1_lat = None
                marker1_lon = None
                has_marker1 = False
                if isinstance(marker1, dict):
                    marker1_lat = marker1.get('lat')
                    marker1_lon = marker1.get('lon')
                    has_marker1 = (marker1_lat is not None and marker1_lon is not None)

                total_elapsed = duration_since(processing_start_time)
                stats_record = {
                    'schema_version': 1,
                    'timestamp': now_iso_utc(),
                    'event_date': datetime.datetime.utcnow().date().isoformat(),
                    'day': datetime.datetime.utcnow().strftime('%d'),
                    'environment': environment,
                    'worker': worker_name,
                    'host': socket.gethostname(),
                    'pid': os.getpid(),
                    'request_id': request_id,
                    'map_id': map_id,
                    'status': status,
                    'failure_stage': failure_stage,
                    'failure_class': failure_class,
                    'failure_message': failure_message,
                    'termination_signal': progress_state.get('termination_signal'),
                    'maps_bucket': map_bucket_name,
                    'map_object_key': map_object_name,
                    'info_object_key': info_object_name,
                    'map_content_key': map_content_key,
                    'browser_fingerprint': request_body.get('browserFingerprint'),
                    'browser_ip': request_body.get('browserIp'),
                    'browser_ip_country': None,
                    'browser_ip_country_code': None,
                    'browser_ip_region': None,
                    'browser_ip_city': None,
                    'browser_ip_latitude': None,
                    'browser_ip_longitude': None,
                    'addr_short': request_body.get('addrShort'),
                    'addr_long': request_body.get('addrLong'),
                    'printing_tech': request_body.get('printingTech'),
                    'offset_x': request_body.get('offsetX'),
                    'offset_y': request_body.get('offsetY'),
                    'size_cm': request_body.get('size'),
                    'exclude_buildings': request_body.get('excludeBuildings'),
                    'hide_location_marker': request_body.get('hideLocationMarker'),
                    'lon': request_body.get('lon'),
                    'lat': request_body.get('lat'),
                    'effective_lon_min': ((request_body.get('effectiveArea') or {}).get('lonMin')),
                    'effective_lon_max': ((request_body.get('effectiveArea') or {}).get('lonMax')),
                    'effective_lat_min': ((request_body.get('effectiveArea') or {}).get('latMin')),
                    'effective_lat_max': ((request_body.get('effectiveArea') or {}).get('latMax')),
                    'scale': request_body.get('scale'),
                    'diameter_m': request_body.get('diameter'),
                    'multipart_mode': request_body.get('multipartMode'),
                    'no_borders': request_body.get('noBorders'),
                    'multipart_xpc': request_body.get('multipartXpc'),
                    'multipart_ypc': request_body.get('multipartYpc'),
                    'advanced_mode': request_body.get('advancedMode'),
                    'marker1_lat': marker1_lat,
                    'marker1_lon': marker1_lon,
                    'has_marker1': has_marker1,
                    'timing_get_osm_seconds': timing_get_osm_seconds,
                    'timing_osm_to_tactile_seconds': timing_osm_to_tactile_seconds,
                    'timing_map_desc_seconds': timing_map_desc_seconds,
                    'timing_map_content_read_seconds': timing_map_content_read_seconds,
                    'timing_upload_primary_seconds': timing_upload_primary_seconds,
                    'timing_svg_to_pdf_seconds': timing_svg_to_pdf_seconds,
                    'timing_upload_secondary_seconds': timing_upload_secondary_seconds,
                    'timing_total_seconds': total_elapsed,
                    'timing_failed_after_seconds': (total_elapsed if status == 'failed' else None),
                    'stl_bytes': stl_bytes,
                    'stl_gzip_bytes': stl_gzip_bytes,
                    'stl_ways_bytes': stl_ways_bytes,
                    'stl_rest_bytes': stl_rest_bytes,
                    'svg_bytes': svg_bytes,
                    'pdf_bytes': pdf_bytes,
                    'blend_bytes': blend_bytes,
                    'map_content_bytes': map_content_bytes,
                    'map_content_gzip_bytes': map_content_gzip_bytes,
                    'info_json_bytes': info_json_bytes,
                    'meta_nodes_count': count_entries((meta or {}).get('nodes') if isinstance(meta, dict) else None),
                    'meta_ways_count': count_entries((meta or {}).get('ways') if isinstance(meta, dict) else None),
                    'meta_areas_count': count_entries((meta or {}).get('areas') if isinstance(meta, dict) else None),
                    'boundary_min_x': boundary.get('minX'),
                    'boundary_min_y': boundary.get('minY'),
                    'boundary_max_x': boundary.get('maxX'),
                    'boundary_max_y': boundary.get('maxY'),
                    'map_desc_profile_json': json_profile_or_none(map_desc_profile),
                }
                stats_pipeline.write_attempt_record(
                    stats_root_dir=stats_root_dir,
                    record=stats_record,
                    quicktime_mode=STATS_QUICKTIME_MODE,
                    s3_resource=stats_s3,
                    stats_bucket_name=stats_bucket_name
                )
            except Exception as stats_error:
                print("stats write failed: " + str(stats_error))

        if failure_exception is not None:
            if isinstance(failure_exception, SystemExit):
                raise failure_exception
            if isinstance(failure_exception, KeyboardInterrupt):
                raise failure_exception
            sys.exit(1)

# never output anything

if __name__ == "__main__":
    main()
