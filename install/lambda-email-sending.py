from __future__ import print_function

import json, boto3, urllib, re

print('Loading function')
ses = boto3.client('ses')

PLAYFUL_PIXELS_URL = "https://www.playfulpixels.com/en/tactile-map"
MAP_URL_REGEXP = re.compile('^https?://.*touch-mapper.org/map/[^ ]+\.stl')
MAIL_FROM = 'info@touch-mapper.org'

def lambda_handler(event, context):
    print(json.dumps(event))
    if not MAP_URL_REGEXP.match(event['mapUrl']):
        raise Exception("invalid map URL:" + event['mapUrl'])

    if event['emailType'] == 'order':
        subject = 'Touch Mapper order link for ' + event['meta']['address']
        metaJson = json.dumps(event['meta'], separators=(',', ':'))
        body = 'Order your Touch Mapper tactile map at:\n\n' \
            + PLAYFUL_PIXELS_URL + '?touchMapFileUrl=' + urllib.quote_plus(event['mapUrl']) + '&mapMeta=' + urllib.quote_plus(metaJson)
    else:
        subject = 'Touch Mapper STL file for ' + event['meta']['address']
        body = 'Download your Touch Mapper tactile map STL file at:\n\n' \
            + event['mapUrl']

    body = body + '\n\n' \
            + 'Address: ' + event['meta']['address'] + '\n' \
            + 'Size: ' + str(event['meta']['size']) + ' cm\n\n' \
            + ('View map or create more: ' + event['meta']['permaUrl'] + '\n\n' if 'permaUrl' in event['meta'] else '') \
            + 'Sincerely,\n' \
            + 'Touch Mapper'

    ret = ses.send_email(Source=MAIL_FROM,
                         Destination={'ToAddresses': [event['to']]},
                         ReplyToAddresses=[MAIL_FROM],
                         Message={'Subject': {'Data': subject, 'Charset': 'UTF-8'},
                                  'Body': {'Text': {'Data': body, 'Charset': 'UTF-8'}}})
    return ret

