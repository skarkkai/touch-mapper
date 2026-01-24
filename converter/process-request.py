#!/usr/bin/python3 -u

import sys,os
script_dir = os.path.dirname(__file__)
sys.path.insert(1, "%s/py-lib/boto3" % (script_dir,))

import re
import boto3
import json
import argparse
import urllib.request
import subprocess
import functools
import json
import time
import datetime
import math
import gzip
import copy

STORE_AGE = 8640000

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
        progress_updater('converting')
        stl_path = os.path.dirname(osm_path) + '/map.stl'
        if os.path.exists(stl_path):
            os.rename(stl_path, stl_path + ".old")
        args = ['--scale', str(request_body['scale']), '--diameter', str(request_body['diameter']), '--size', str(request_body['size']), ]
        if request_body.get('noBorders', False):
            args.append('--no-borders')
        if request_body.get('excludeBuildings', False):
            args.append('--exclude-buildings')
        if not request_body.get('hideLocationMarker', False) and 'marker1' in request_body:
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
        with open(os.path.dirname(osm_path) + '/map-meta.json', 'r') as f:
            meta = f.read()

        return stl, stl_ways, stl_rest, svg, blend, json.loads(meta)
    except Exception as e:
        raise Exception("Can't convert map data to STL: " + str(e)) # let's not reveal too much, error msg likely contains paths

# Receive a message from SQS and delete it. Poll up to "poll_time" seconds. Return parsed request, or None if no msg received.
def receive_sqs_msg(queue_name, poll_time):
    end = time.clock() + poll_time
    sqs = boto3.resource('sqs')
    queue = sqs.get_queue_by_name(QueueName = queue_name)
    while end - time.clock() > 20:
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
        import cairosvg
        return cairosvg.svg2pdf(url=svg_path)
    except Exception as e:
        raise Exception("Can't convert SVG to PDF: " + str(e))

def main():
    # TODO: if output S3 object already exists, exit immediately
    s3 = None
    try:
        t = time.clock()
        environment = os.environ['TM_ENVIRONMENT']
        queue_name = environment + "-requests-touch-mapper"
        map_bucket_name = environment + ".maps.touch-mapper"
        args = do_cmdline()

        # Receive SQS msg
        print("\n\n============= STARTING TO POLL AT %s ===========" % (datetime.datetime.now().isoformat()))
        request_body = receive_sqs_msg(queue_name, args.poll_time)
        if request_body == None:
            return
        print("Poll returned at %s" % (datetime.datetime.now().isoformat()))

        # Get OSM data
        s3 = boto3.resource('s3')
        map_object_name = 'map/data/' + request_body['requestId'] + '.stl'
        progress_updater = functools.partial(update_progress, s3, map_bucket_name, map_object_name)
        osm_path = get_osm(progress_updater, request_body, args.work_dir)

        # Convert OSM => STL
        stl, stl_ways, stl_rest, svg, blend, meta = run_osm_to_tactile(progress_updater, osm_path, request_body)

        # Put the augmented request to S3. No reduced redundancy, because this provides permanent access to parameters of every map ever created.
        json_object_name = 'map/info/' + re.sub(r'\/.+', '.json', request_body['requestId']) # deadbeef/foo.stl => info/deadbeef.json
        info = copy.copy(request_body)
        info.update(meta)
        s3.Bucket(map_bucket_name).put_object(Key=json_object_name, \
            Body=json.dumps(info).encode('utf8'), ACL='public-read', ContentType='application/json')

        # Put full STL file to S3. Completion of this upload makes UI consider the STL creation complete.
        common_args = {
            'ACL': 'public-read', 'ContentEncoding': 'gzip',
            'CacheControl': 'max-age=8640000', 'StorageClass': 'GLACIER_IR',
        }
        s3.Bucket(map_bucket_name).put_object(
            Key=map_object_name, Body=gzip.compress(stl, compresslevel=5), **common_args, ContentType='application/sla')
        print("Processing main request took " + str(time.clock() - t))

        # Put SVG to S3. Will be available to the user quickly enough.
        name_base = map_object_name[:-4]
        s3.Bucket(map_bucket_name).put_object(
            Key=name_base + '.svg', Body=gzip.compress(svg, compresslevel=5), **common_args, ContentType='image/svg+xml')

        # Create PDF from SVG and put it to S3
        pdf = svg_to_pdf(os.path.dirname(osm_path) + '/map.svg')
        s3.Bucket(map_bucket_name).put_object(
            Key=name_base + '.pdf', Body=gzip.compress(pdf, compresslevel=5), **common_args, ContentType='application/pdf')

        # Put the marginally useful files into S3
        s3.Bucket(map_bucket_name).put_object(
            Key=name_base + '-ways.stl', Body=gzip.compress(stl_ways, compresslevel=5), **common_args, ContentType='application/sla')
        s3.Bucket(map_bucket_name).put_object(
            Key=name_base + '-rest.stl', Body=gzip.compress(stl_rest, compresslevel=5), **common_args, ContentType='application/sla')
        s3.Bucket(map_bucket_name).put_object(
            Key=name_base + '.blend',    Body=gzip.compress(blend, compresslevel=5), **common_args, ContentType='application/binary')

        print("Processing entire request took " + str(time.clock() - t))
    except Exception as e:
        try:
            print("process-request failed: " + str(e))
            if s3 != None:
                # Put map file that contains just the error message in metadata
                s3.Bucket(map_bucket_name).put_object(Key=map_object_name, Body=b'', ACL='public-read', \
                    CacheControl='max-age=8640000', StorageClass='GLACIER_IR', Metadata={ 'error-msg': str(e) })
        except:
            pass
        sys.exit(1)

# never output anything

if __name__ == "__main__":
    main()
