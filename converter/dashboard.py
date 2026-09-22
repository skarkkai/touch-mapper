#!/usr/bin/env python3
"""Publish an aggregate-only nightly report, independently of map conversion."""
import configparser
import datetime
import math
import os
import re
import sys
import time

BUCKETS = {'test': 'test.touch-mapper.org', 'prod': 'touch-mapper.org'}
ERROR_CODES = ('too_large',)
STAGES = ('bootstrap', 'poll', 'get-osm', 'osm-to-tactile', 'map-desc',
          'map-content-read', 'prepare-upload', 'upload-primary', 'svg-to-pdf', 'upload-secondary')
CLASSES = ('RuntimeError', 'ValueError', 'KeyError', 'TypeError', 'OSError',
           'IOError', 'TimeoutError', 'CalledProcessError', 'ClientError', 'Exception')
RSS = (('OSM2World', 'rss_osm2world_kib'), ('Blender', 'rss_blender_kib'),
       ('clip-2d', 'rss_clip_2d_kib'), ('Converter process', 'rss_process_request_peak_kib'))
TIMINGS = (('OSM fetch', 'timing_get_osm_seconds'),
           ('Named-road pruning', 'timing_prune_only_named_roads_seconds'),
           ('Big-road pruning', 'timing_prune_only_big_roads_seconds'),
           ('Map description', 'timing_map_desc_seconds'),
           ('Primary upload', 'timing_upload_primary_seconds'),
           ('SVG to PDF', 'timing_svg_to_pdf_seconds'), ('End to end', 'timing_total_seconds'))
USAGE = {'printing_technology': ('2d', '3d', 'unknown'),
         'content_mode': ('normal', 'no-buildings', 'only-big-roads', 'only-named-roads', 'unknown'),
         'multipart': ('yes', 'no', 'unknown')}
# ISO 3166-1 country codes: names and arbitrary source text never reach the report.
COUNTRIES = set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split())


# Reject destinations that could disclose reports outside the dedicated host namespace.
def validate_config(environment, values):
    if environment not in BUCKETS:
        raise ValueError('Dashboard environment must be test or prod')
    prefix = values.get('DASHBOARD_PUBLIC_PREFIX', '')
    if not re.fullmatch(r'dashboard/[A-Za-z0-9_-]{16,128}/', prefix):
        raise ValueError('Dashboard prefix must be dashboard/<16-128 opaque characters>/')
    if values.get('DASHBOARD_WEB_BUCKET') != BUCKETS[environment]:
        raise ValueError('Dashboard bucket does not match environment')
    result = {'prefix': prefix, 'bucket': BUCKETS[environment],
              'database': 'touch_mapper_stats_' + environment}
    workgroup = values.get('DASHBOARD_ATHENA_WORKGROUP', 'primary')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', workgroup):
        raise ValueError('Invalid Athena workgroup')
    result['workgroup'] = workgroup
    output = values.get('DASHBOARD_ATHENA_OUTPUT')
    if output:
        if not re.fullmatch(r's3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/[A-Za-z0-9_/-]*', output) or '..' in output:
            raise ValueError('Invalid private Athena result location')
        if output.split('/')[2] in BUCKETS.values():
            raise ValueError('Athena results must not use a public web bucket')
        result['output'] = output
    return result


# Keep configuration beside this deployment's dist directory, independent of cwd.
def default_config_path():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dashboard.env')


# Read configuration as data, never as shell commands or interpolated expressions.
def load_config(environment, path=None):
    if path is None:
        path = default_config_path()
    parser = configparser.ConfigParser(interpolation=None)
    with open(path) as source:
        parser.read_file(source)
    return validate_config(environment, dict((key.upper(), value) for key, value in parser.items('dashboard')))


# Normalize all report boundaries to UTC, including aware test clocks.
def utc_now(now_utc=None):
    value = now_utc or datetime.datetime.now(datetime.timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return value.astimezone(datetime.timezone.utc)


# Only fixed application categories are allowed to escape the telemetry store.
def safe_case(column, allowed, fallback='unknown'):
    values = ','.join("'{}'".format(value) for value in sorted(allowed))
    return "CASE WHEN {0} IN ({1}) THEN {0} ELSE '{2}' END".format(column, values, fallback)


# Ask Athena exclusively for aggregates; never retrieve sensitive record-level values.
def build_query(now_utc=None):
    today = utc_now(now_utc).date()
    start = today - datetime.timedelta(days=30)
    end = today - datetime.timedelta(days=1)
    # Glue projects year/month as strings, with two-digit month directory names.
    upper_partition = ('"year" <= \'{0}\' AND ("year" < \'{0}\' OR "month" <= \'{1}\')').format(
        end.strftime('%Y'), end.strftime('%m'))
    lower_partition = ('"year" >= \'{0}\' AND ("year" > \'{0}\' OR "month" >= \'{1}\')').format(
        start.strftime('%Y'), start.strftime('%m'))
    columns = ['\"timestamp\"', 'status', 'browser_fingerprint', 'failure_stage', 'failure_class',
               'error_code', 'printing_tech', 'content_mode', 'multipart_mode', 'browser_ip_country_code']
    columns += ['"year"', '"month"'] + [column for label, column in RSS + TIMINGS]
    base = ('WITH history AS (SELECT ' + ', '.join(columns) + ' FROM application_stats_json WHERE '
            '{2} AND status IN (\'success\',\'failed\') AND try_cast(substr("timestamp",1,10) AS date) < DATE \'{0}\'), '
            'recent AS (SELECT * FROM history WHERE '
            '{3} AND try_cast(substr("timestamp",1,10) AS date) >= DATE \'{1}\') ').format(
                today, start, upper_partition, lower_partition)
    metrics = ("count(*) attempts, count_if(status='success') successes, "
               "count_if(status <> 'success' OR status IS NULL) errors, "
               "approx_distinct(nullif(browser_fingerprint,'')) unique_users, "
               "approx_percentile(IF(timing_total_seconds>=0,timing_total_seconds,NULL),0.5) p50, "
               "approx_percentile(IF(timing_total_seconds>=0,timing_total_seconds,NULL),0.95) p95, "
               "CAST(NULL AS double) maximum")
    parts = []
    for kind, period, source in [('daily', 'substr("timestamp",1,10)', 'recent'),
                                  ('monthly', 'substr("timestamp",1,7)', 'history'),
                                  ('summary', "''", 'recent')]:
        parts.append("SELECT '{0}' kind, {1} period, '' label, {2} FROM {3}{4}".format(
            kind, period, metrics, source, '' if kind == 'summary' else ' GROUP BY 2'))
    stage = safe_case('failure_stage', STAGES)
    failure = safe_case('failure_class', CLASSES)
    error = "CASE WHEN error_code IN ('too_large') THEN error_code ELSE concat({0}, ' / ', {1}) END".format(stage, failure)
    # Common shape keeps pagination and output validation simple for every section.
    def category(kind, expression, condition=''):
        return ("SELECT '{0}', '', {1}, count(*), 0, 0, 0, CAST(NULL AS double), "
                "CAST(NULL AS double), CAST(NULL AS double) FROM recent {2} GROUP BY 3").format(kind, expression, condition)
    parts.append(category('errors', error, "WHERE status <> 'success' OR status IS NULL"))
    for kind, stages in [('rss', RSS), ('timings', TIMINGS)]:
        for label, column in stages:
            clean = 'IF({0}>=0,{0},NULL)'.format(column)
            parts.append(("SELECT '{0}', '', '{1}', count({2}), 0, 0, 0, approx_percentile({2},0.5), "
                          "approx_percentile({2},0.95), max({2}) FROM recent").format(kind, label, clean))
    parts.append(category('printing_technology', safe_case('printing_tech', USAGE['printing_technology'])))
    parts.append(category('content_mode', safe_case('content_mode', USAGE['content_mode'])))
    parts.append(category('multipart', "CASE WHEN multipart_mode THEN 'yes' WHEN NOT multipart_mode THEN 'no' ELSE 'unknown' END"))
    parts.append(category('countries', safe_case('upper(browser_ip_country_code)', COUNTRIES)))
    return base + '\nUNION ALL\n'.join(parts)


# Keep query diagnostics in private worker logs and out of report data.
def query_rows(client, query, config, timeout_seconds=120, sleep=time.sleep, clock=time.monotonic):
    args = {'QueryString': query, 'QueryExecutionContext': {'Database': config['database']},
            'WorkGroup': config['workgroup']}
    if config.get('output'):
        args['ResultConfiguration'] = {'OutputLocation': config['output']}
    query_id = client.start_query_execution(**args)['QueryExecutionId']
    deadline = clock() + timeout_seconds
    while True:
        execution_status = client.get_query_execution(QueryExecutionId=query_id)['QueryExecution']['Status']
        status = execution_status['State']
        if status == 'SUCCEEDED':
            break
        if status in ('FAILED', 'CANCELLED'):
            print('dashboard Athena query {} {}: {}'.format(
                query_id, status, execution_status.get('StateChangeReason', 'No reason returned')), file=sys.stderr)
            raise RuntimeError('Dashboard aggregate query did not succeed')
        if clock() >= deadline:
            client.stop_query_execution(QueryExecutionId=query_id)
            raise RuntimeError('Dashboard aggregate query timed out')
        sleep(min(1, max(0, deadline - clock())))
    rows, token, first = [], None, True
    while True:
        if clock() >= deadline:
            raise RuntimeError('Dashboard aggregate results timed out')
        request = {'QueryExecutionId': query_id, 'MaxResults': 1000}
        if token:
            request['NextToken'] = token
        page = client.get_query_results(**request)
        headers = [item['Name'] for item in page['ResultSet']['ResultSetMetadata']['ColumnInfo']]
        data = page['ResultSet']['Rows']
        for row in data[1:] if first else data:
            rows.append(dict(zip(headers, [item.get('VarCharValue') for item in row['Data']])))
        first = False
        token = page.get('NextToken')
        if not token:
            return rows


# Untrusted query numbers cannot inject strings or non-finite JSON into HTML.
def number(value, default=None):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else default
    except (ValueError, TypeError, OverflowError):
        return default


# Map the fixed aggregate columns to a small public schema, discarding all others.
def metrics(row):
    return {'attempts': int(number(row.get('attempts'), 0) or 0),
            'successes': int(number(row.get('successes'), 0) or 0),
            'errors': int(number(row.get('errors'), 0) or 0),
            'unique_users': int(number(row.get('unique_users'), 0) or 0),
            'p50_seconds': number(row.get('p50')), 'p95_seconds': number(row.get('p95'))}


# Produce complete UTC buckets while preserving missing measurements as unavailable.
def build_report(rows, environment, now_utc=None):
    if environment not in BUCKETS:
        raise ValueError('Invalid environment')
    now = utc_now(now_utc)
    end = now.date() - datetime.timedelta(days=1)
    start = end - datetime.timedelta(days=29)
    report = {'schema_version': 1, 'environment': environment,
              'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
              'coverage': {'start': str(start), 'end': str(end)},
              'daily': [], 'monthly': [], 'summary': metrics({}), 'errors': [], 'rss': [], 'timings': [],
              'usage': dict((key, []) for key in list(USAGE) + ['countries'])}
    trends = {'daily': {}, 'monthly': {}}
    safe_errors = set(ERROR_CODES) | set(a + ' / ' + b for a in STAGES + ('unknown',) for b in CLASSES + ('unknown',))
    aggregates = {}
    for row in rows:
        kind, label = row.get('kind'), row.get('label')
        if kind in trends:
            period = row.get('period') or ''
            fmt = '%Y-%m-%d' if kind == 'daily' else '%Y-%m'
            try:
                date = datetime.datetime.strptime(period, fmt).date()
            except ValueError:
                continue
            if period != date.strftime(fmt) or date > end or (kind == 'daily' and date < start):
                continue
            trends[kind][period] = metrics(row)
        elif kind == 'summary':
            report['summary'] = metrics(row)
        elif kind in ('rss', 'timings'):
            stages = RSS if kind == 'rss' else TIMINGS
            if label in dict(stages):
                aggregates[(kind, label)] = row
        elif kind == 'errors' or kind in report['usage']:
            allowed = safe_errors if kind == 'errors' else (COUNTRIES | {'unknown'} if kind == 'countries' else set(USAGE[kind]))
            safe_label = label if label in allowed else ('unknown / unknown' if kind == 'errors' else 'unknown')
            target = report['errors'] if kind == 'errors' else report['usage'][kind]
            existing = next((item for item in target if item['label'] == safe_label), None)
            count = int(number(row.get('attempts'), 0) or 0)
            if existing:
                existing['count'] += count
            else:
                target.append({'label': safe_label, 'count': count})
    date = start
    while date <= end:
        key = str(date)
        report['daily'].append(dict(metrics({}), period=key))
        report['daily'][-1].update(trends['daily'].get(key, {}))
        date += datetime.timedelta(days=1)
    first = min(trends['monthly']) if trends['monthly'] else end.strftime('%Y-%m')
    date = datetime.datetime.strptime(first, '%Y-%m').date()
    while date <= end:
        key = date.strftime('%Y-%m')
        item = dict(metrics({}), period=key)
        item.update(trends['monthly'].get(key, {}))
        report['monthly'].append(item)
        date = datetime.date(date.year + (date.month == 12), date.month % 12 + 1, 1)
    for kind, stages in [('rss', RSS), ('timings', TIMINGS)]:
        for label, unused in stages:
            row = aggregates.get((kind, label), {})
            suffix = 'kib' if kind == 'rss' else 'seconds'
            item = {'stage': label, 'p50_' + suffix: number(row.get('p50')), 'p95_' + suffix: number(row.get('p95'))}
            if kind == 'rss':
                item['max_kib'] = number(row.get('maximum'))
                item['p95_capacity_percent'] = None if item['p95_kib'] is None else item['p95_kib'] / 1048576 * 100
            report[kind].append(item)
    attempts = report['summary']['attempts']
    report['summary']['success_rate'] = report['summary']['successes'] / attempts * 100 if attempts else None
    for target in [report['errors']] + list(report['usage'].values()):
        target.sort(key=lambda item: (-item['count'], item['label']))
    report['usage']['countries'] = report['usage']['countries'][:10]
    return report


# Publish exactly once after query completion, mapping, and complete HTML rendering.
def publish_dashboard(environment, now_utc=None, config_path=None,
                      athena=None, s3=None):
    if config_path is None:
        config_path = default_config_path()
    if not os.path.isfile(config_path):
        return False
    config = load_config(environment, config_path)
    if athena is None or s3 is None:
        import boto3  # pyright: ignore[reportMissingImports]
        from botocore.config import Config  # pyright: ignore[reportMissingImports]
        client_config = Config(connect_timeout=5, read_timeout=15, retries={'max_attempts': 2})
        athena = athena or boto3.client('athena', config=client_config)
        s3 = s3 or boto3.client('s3', config=client_config)
    from dashboard_html import render_report
    now = utc_now(now_utc)
    rows = query_rows(athena, build_query(now), config)
    report = build_report(rows, environment, now)
    html = render_report(report).encode('utf-8')
    s3.put_object(Bucket=config['bucket'], Key=config['prefix'] + 'index.html', Body=html,
                  ContentType='text/html; charset=utf-8', CacheControl='no-cache')
    return report
