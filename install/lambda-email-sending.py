"""
Send email about a Touch Mapper map to given email address.

Sample POST body:
{ "mapUrl": "https://touch-mapper.org/map/fe99742222faf8d1/Augsburg-rest.stl", "meta": { "address": "foo", "size": 17, "permaUrl": "bar" }, "to": "skarkkai@gmail.com", "emailType": "order" }
"""

from __future__ import print_function
import json, boto3, urllib, re

ses = boto3.client('ses')

PLAYFUL_PIXELS_URL = "https://www.playfulpixels.com/en/tactile-map"
MAP_URL_REGEXP = re.compile('^https?://.*touch-mapper.org/map/[^ ]+\.stl')
MAIL_FROM = 'info@touch-mapper.org'

def lambda_handler(event, context):
    print(event['body'])
    req = json.loads(event['body']);
    #if not MAP_URL_REGEXP.match(req['mapUrl']):
    #    raise Exception("invalid map URL:" + req['mapUrl'])

    if req['emailType'] == 'order':
        subject = 'Touch Mapper order link for ' + req['meta']['address']
        metaJson = json.dumps(req['meta'], separators=(',', ':'))
        body = 'Order your Touch Mapper tactile map at:\n\n' \
            + PLAYFUL_PIXELS_URL + '?touchMapFileUrl=' + urllib.quote_plus(req['mapUrl']) + '&mapMeta=' + urllib.quote_plus(metaJson)
    else:
        subject = 'Touch Mapper STL file for ' + req['meta']['address']
        body = 'Download your Touch Mapper tactile map STL file at:\n\n' \
            + req['mapUrl']

    body = body + '\n\n' \
            + 'Address: ' + req['meta']['address'] + '\n' \
            + 'Size: ' + str(req['meta']['size']) + ' cm\n\n' \
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
