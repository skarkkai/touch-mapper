"""
Send email about a Touch Mapper map to given email address.

Sample POST body:
{ "mapUrl": "https://touch-mapper.org/map/fe99742222faf8d1/Augsburg-rest.stl", "meta": { "address": "foo", "size": 17, "permaUrl": "bar" }, "to": "skarkkai@gmail.com", "emailType": "order" }
"""

from __future__ import print_function
import json, re, math
import boto3  # type: ignore[import-not-found]
from urllib.parse import quote_plus

ses = boto3.client('ses')

PLAYFUL_PIXELS_URL = "https://www.playfulpixels.com/en/tactile-map"
MAP_URL_REGEXP = re.compile(r'^https?://.*touch-mapper.org/map/[^ ]+\.stl')
MAIL_FROM = 'info@touch-mapper.org'

def lambda_handler(event, context):
    print(event['body'])
    req = json.loads(event['body']);
    meta = req['meta']
    has_width = 'printWidthCm' in meta
    has_height = 'printHeightCm' in meta
    if has_width != has_height:
        raise ValueError('Both print dimensions are required')
    width = float(meta['printWidthCm'] if has_width else meta['size'])
    height = float(meta['printHeightCm'] if has_height else meta['size'])
    if not all(math.isfinite(value) and 1 <= value <= 99.9 for value in (width, height)):
        raise ValueError('Invalid print dimensions')
    map_url = req.get('mapUrl') or meta['permaUrl']
    if req.get('emailType') == 'order':
        if width != height:
            raise ValueError('Partner ordering does not support rectangular maps')
        subject = 'Touch Mapper order link for ' + req['meta']['address']
        order_meta = dict(meta, size=width)
        metaJson = json.dumps(order_meta, separators=(',', ':'))
        body = 'Order your Touch Mapper tactile map at:\n\n' \
            + PLAYFUL_PIXELS_URL + '?touchMapFileUrl=' + quote_plus(map_url) + '&mapMeta=' + quote_plus(metaJson)
    else:
        subject = 'Touch Mapper map for ' + req['meta']['address']
        body = 'Open your Touch Mapper tactile map at:\n\n' \
            + map_url

    body = body + '\n\n' \
            + 'Address: ' + req['meta']['address'] + '\n' \
            + 'Size: ' + ('{:g} × {:g}'.format(width, height)) + ' cm\n\n' \
            + ('View map or create more: ' + req['meta']['permaUrl'] + '\n\n' if 'permaUrl' in req['meta'] else '') \
            + 'Sincerely,\n' \
            + 'Touch Mapper'

    ret = ses.send_email(Source=MAIL_FROM,
                         Destination={'ToAddresses': [req['to']]},
                         ReplyToAddresses=[MAIL_FROM],
                         Message={'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                                  'Body': {'Text': {'Data': body, 'Charset': 'UTF-8'}}})
    return {
        "statusCode": 200,
        "headers": {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*",
        },
        "body": "{}"
    }
