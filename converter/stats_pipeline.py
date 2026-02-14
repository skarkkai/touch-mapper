#!/usr/bin/python3

import contextlib
import datetime
import fcntl
import gzip
import ipaddress
import io
import json
import os
import re
import shutil
import time
import urllib.request


QUICKTIME_WRITES_PER_DAY = 3
QUICKTIME_DAYS_PER_MONTH = 3
IP_GEO_LOOKUP_TIMEOUT_SECONDS = 1.5


def map_id_from_request_id(request_id):
    if request_id is None:
        return 'unknown'
    text = str(request_id)
    if text == '':
        return 'unknown'
    return text.split('/', 1)[0]


def month_object_key(year, month):
    return 'stats-json/{year}/{month}/stats-{year}-{month}.jsonl.gz'.format(
        year='{0:04d}'.format(int(year)),
        month='{0:02d}'.format(int(month))
    )


def write_attempt_record(stats_root_dir, record, quicktime_mode=False, s3_resource=None,
                         stats_bucket_name=None, now_utc=None):
    if quicktime_mode:
        return _write_attempt_record_quicktime(
            stats_root_dir=stats_root_dir,
            record=record,
            s3_resource=s3_resource,
            stats_bucket_name=stats_bucket_name,
            now_utc=now_utc
        )
    return _write_attempt_record_real_date(stats_root_dir=stats_root_dir, record=record, now_utc=now_utc)


def run_daily_upload_if_due(stats_root_dir, s3_resource, stats_bucket_name, now_utc=None):
    _ensure_dir(stats_root_dir)
    if now_utc is None:
        now_utc = datetime.datetime.utcnow()
    today = now_utc.date()
    marker_value = today.isoformat()

    maintenance_dir = _maintenance_dir(stats_root_dir)
    _ensure_dir(maintenance_dir)
    lock_path = os.path.join(maintenance_dir, 'upload.lock')
    marker_path = os.path.join(maintenance_dir, 'last-successful-run-utc.txt')

    with _exclusive_lock(lock_path):
        previous_marker = _read_small_text(marker_path)
        if previous_marker == marker_value:
            return False

        flush_day = today - datetime.timedelta(days=1)
        upload_ok = False
        try:
            upload_ok = upload_month_from_local_data(
                stats_root_dir=stats_root_dir,
                s3_resource=s3_resource,
                stats_bucket_name=stats_bucket_name,
                year=flush_day.year,
                month=flush_day.month,
                max_day=flush_day.day
            )
        except Exception as e:
            print('stats daily upload failed: ' + str(e))
            upload_ok = False

        if not upload_ok:
            return False

        if _is_last_day_of_month(flush_day):
            month_dir = _month_dir(stats_root_dir, flush_day.year, flush_day.month)
            if os.path.isdir(month_dir):
                shutil.rmtree(month_dir)
                print('stats cleanup: removed local month directory {}'.format(month_dir))

        _write_small_text_atomic(marker_path, marker_value)
        return True


def upload_month_from_local_data(stats_root_dir, s3_resource, stats_bucket_name, year, month, max_day=None):
    month_dir = _month_dir(stats_root_dir, year, month)
    if not os.path.isdir(month_dir):
        return True

    payload, line_count = _build_month_gzip_payload(month_dir, max_day=max_day)
    if line_count == 0:
        return True

    key = month_object_key(year=year, month=month)
    s3_resource.Bucket(stats_bucket_name).put_object(
        Key=key,
        Body=payload,
        ContentType='application/x-ndjson',
        ContentEncoding='gzip'
    )
    print(
        'stats upload complete: bucket={} key={} lines={}'.format(
            stats_bucket_name, key, line_count
        )
    )
    return True


def _write_attempt_record_real_date(stats_root_dir, record, now_utc=None):
    if now_utc is None:
        now_utc = datetime.datetime.utcnow()
    target_date = now_utc.date()
    record_to_store = dict(record)
    _enrich_record_with_ip_geo(stats_root_dir, record_to_store)
    record_to_store['event_date'] = target_date.isoformat()
    record_to_store['day'] = '{:02d}'.format(target_date.day)
    file_path = _stats_file_path(
        stats_root_dir=stats_root_dir,
        map_id=record_to_store.get('map_id'),
        year=target_date.year,
        month=target_date.month,
        day=target_date.day
    )
    _write_json_atomic(file_path, record_to_store)
    return file_path


def _write_attempt_record_quicktime(stats_root_dir, record, s3_resource, stats_bucket_name, now_utc=None):
    if s3_resource is None:
        raise Exception('quicktime mode requires s3_resource')
    if not stats_bucket_name:
        raise Exception('quicktime mode requires stats_bucket_name')
    if now_utc is None:
        now_utc = datetime.datetime.utcnow()

    maintenance_dir = _maintenance_dir(stats_root_dir)
    _ensure_dir(maintenance_dir)
    lock_path = os.path.join(maintenance_dir, 'quicktime.lock')
    state_path = os.path.join(maintenance_dir, 'quicktime-state.json')

    with _exclusive_lock(lock_path):
        state = _load_quicktime_state(state_path, now_utc)
        year = int(state['virtual_year'])
        month = int(state['virtual_month'])
        day = int(state['virtual_day'])

        record_to_store = dict(record)
        _enrich_record_with_ip_geo(stats_root_dir, record_to_store)
        record_to_store['event_date'] = '{:04d}-{:02d}-{:02d}'.format(year, month, day)
        record_to_store['day'] = '{:02d}'.format(day)

        file_path = _stats_file_path(
            stats_root_dir=stats_root_dir,
            map_id=record_to_store.get('map_id'),
            year=year,
            month=month,
            day=day
        )
        _write_json_atomic(file_path, record_to_store)

        state['writes_in_current_day'] = int(state['writes_in_current_day']) + 1
        if int(state['writes_in_current_day']) >= QUICKTIME_WRITES_PER_DAY:
            upload_ok = False
            try:
                upload_ok = upload_month_from_local_data(
                    stats_root_dir=stats_root_dir,
                    s3_resource=s3_resource,
                    stats_bucket_name=stats_bucket_name,
                    year=year,
                    month=month,
                    max_day=day
                )
            except Exception as e:
                print('stats quicktime upload failed: ' + str(e))
                upload_ok = False

            if upload_ok:
                state['writes_in_current_day'] = 0
                state['days_elapsed_in_current_month'] = int(state['days_elapsed_in_current_month']) + 1

                if int(state['days_elapsed_in_current_month']) >= QUICKTIME_DAYS_PER_MONTH:
                    month_dir = _month_dir(stats_root_dir, year, month)
                    if os.path.isdir(month_dir):
                        shutil.rmtree(month_dir)
                        print('stats quicktime cleanup: removed local month directory {}'.format(month_dir))
                    _advance_quicktime_month(state)
                else:
                    state['virtual_day'] = int(state['virtual_day']) + 1
            else:
                state['writes_in_current_day'] = QUICKTIME_WRITES_PER_DAY - 1

        _write_json_atomic(state_path, state)
        return file_path


def _build_month_gzip_payload(month_dir, max_day=None):
    line_count = 0
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=5) as gz:
        for path in _iter_stats_file_paths(month_dir, max_day=max_day):
            try:
                with open(path, 'r', encoding='utf8') as handle:
                    value = json.load(handle)
            except Exception as e:
                print('stats monthly upload skipping unreadable file {}: {}'.format(path, e))
                continue
            line = json.dumps(value, separators=(',', ':'), ensure_ascii=False) + '\n'
            gz.write(line.encode('utf8'))
            line_count += 1
    if line_count == 0:
        return b'', 0
    return output.getvalue(), line_count


def _iter_stats_file_paths(month_dir, max_day=None):
    day_dirs = []
    for name in os.listdir(month_dir):
        path = os.path.join(month_dir, name)
        if not os.path.isdir(path):
            continue
        if not re.match(r'^[0-9]{1,2}$', name):
            continue
        day = int(name)
        if day < 1 or day > 31:
            continue
        if max_day is not None and day > int(max_day):
            continue
        day_dirs.append((day, name))

    for _day_int, day_name in sorted(day_dirs):
        day_dir = os.path.join(month_dir, day_name)
        for name in sorted(os.listdir(day_dir)):
            if not name.endswith('.json'):
                continue
            path = os.path.join(day_dir, name)
            if os.path.isfile(path):
                yield path


def _load_quicktime_state(state_path, now_utc):
    default_state = {
        'virtual_year': int(now_utc.year),
        'virtual_month': int(now_utc.month),
        'virtual_day': 1,
        'writes_in_current_day': 0,
        'days_elapsed_in_current_month': 0
    }

    if not os.path.isfile(state_path):
        return default_state

    try:
        with open(state_path, 'r', encoding='utf8') as handle:
            value = json.load(handle)
    except Exception:
        return default_state

    state = dict(default_state)
    for key in state.keys():
        raw = value.get(key)
        if isinstance(raw, bool):
            continue
        if isinstance(raw, int):
            state[key] = raw
        elif isinstance(raw, float) and int(raw) == raw:
            state[key] = int(raw)

    if state['virtual_month'] < 1 or state['virtual_month'] > 12:
        state['virtual_month'] = default_state['virtual_month']
    if state['virtual_day'] < 1:
        state['virtual_day'] = 1
    if state['writes_in_current_day'] < 0:
        state['writes_in_current_day'] = 0
    if state['days_elapsed_in_current_month'] < 0:
        state['days_elapsed_in_current_month'] = 0
    return state


def _advance_quicktime_month(state):
    next_month = int(state['virtual_month']) + 1
    next_year = int(state['virtual_year'])
    if next_month > 12:
        next_month = 1
        next_year += 1

    state['virtual_year'] = next_year
    state['virtual_month'] = next_month
    state['virtual_day'] = 1
    state['writes_in_current_day'] = 0
    state['days_elapsed_in_current_month'] = 0


def _enrich_record_with_ip_geo(stats_root_dir, record):
    ip_value = _normalize_ip(record.get('browser_ip'))
    if ip_value is None:
        return

    maintenance_dir = _maintenance_dir(stats_root_dir)
    _ensure_dir(maintenance_dir)
    cache_path = os.path.join(maintenance_dir, 'ip-geo-cache.json')
    lock_path = os.path.join(maintenance_dir, 'ip-geo-cache.lock')

    with _exclusive_lock(lock_path):
        cache = _read_json_object(cache_path)
        cached = cache.get(ip_value)
        if isinstance(cached, dict):
            _apply_geo_fields(record, cached)
            return

        lookup = _lookup_ip_geo(ip_value)
        if lookup is None:
            return

        cache[ip_value] = lookup
        _write_json_atomic(cache_path, cache)
        _apply_geo_fields(record, lookup)


def _normalize_ip(value):
    if value is None:
        return None
    text = str(value).strip()
    if text == '':
        return None
    try:
        ipaddress.ip_address(text)
        return text
    except Exception:
        return None


def _lookup_ip_geo(ip_value):
    url = 'https://ipapi.co/{}/json/'.format(ip_value)
    request = urllib.request.Request(url=url, headers={'User-Agent': 'TouchMapperStats/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=IP_GEO_LOOKUP_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode('utf8'))
    except Exception as e:
        print('stats ip geolocation lookup failed for {}: {}'.format(ip_value, e))
        return None

    if not isinstance(payload, dict):
        return None
    if payload.get('error') is True:
        return None

    return {
        'country': payload.get('country_name') or payload.get('country'),
        'country_code': payload.get('country_code') or payload.get('country'),
        'region': payload.get('region') or payload.get('region_code'),
        'city': payload.get('city'),
        'latitude': _as_float_or_none(payload.get('latitude') or payload.get('lat')),
        'longitude': _as_float_or_none(payload.get('longitude') or payload.get('lon'))
    }


def _apply_geo_fields(record, geo_value):
    record['browser_ip_country'] = geo_value.get('country')
    record['browser_ip_country_code'] = geo_value.get('country_code')
    record['browser_ip_region'] = geo_value.get('region')
    record['browser_ip_city'] = geo_value.get('city')
    record['browser_ip_latitude'] = geo_value.get('latitude')
    record['browser_ip_longitude'] = geo_value.get('longitude')


def _as_float_or_none(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        return float(value)
    except Exception:
        return None


def _month_dir(stats_root_dir, year, month):
    return os.path.join(
        stats_root_dir,
        '{:04d}'.format(int(year)),
        '{:02d}'.format(int(month))
    )


def _stats_file_path(stats_root_dir, map_id, year, month, day):
    safe_map_id = _safe_map_id_for_filename(map_id)
    day_dir = os.path.join(
        stats_root_dir,
        '{:04d}'.format(int(year)),
        '{:02d}'.format(int(month)),
        '{:02d}'.format(int(day))
    )
    _ensure_dir(day_dir)
    return os.path.join(day_dir, safe_map_id + '.json')


def _safe_map_id_for_filename(map_id):
    raw = map_id
    if raw is None:
        raw = 'unknown'
    text = str(raw).strip()
    if text == '':
        text = 'unknown'
    return re.sub(r'[^A-Za-z0-9._-]', '_', text)


def _maintenance_dir(stats_root_dir):
    return os.path.join(stats_root_dir, '.maintenance')


def _read_small_text(path):
    if not os.path.isfile(path):
        return None
    try:
        with open(path, 'r', encoding='utf8') as handle:
            return handle.read().strip()
    except Exception:
        return None


def _read_json_object(path):
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, 'r', encoding='utf8') as handle:
            value = json.load(handle)
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _write_small_text_atomic(path, value):
    _ensure_dir(os.path.dirname(path))
    tmp_path = path + '.tmp-{}-{}'.format(os.getpid(), int(time.time() * 1000))
    with open(tmp_path, 'w', encoding='utf8') as handle:
        handle.write(value)
        handle.write('\n')
    os.replace(tmp_path, path)


def _write_json_atomic(path, value):
    _ensure_dir(os.path.dirname(path))
    tmp_path = path + '.tmp-{}-{}'.format(os.getpid(), int(time.time() * 1000))
    with open(tmp_path, 'w', encoding='utf8') as handle:
        json.dump(value, handle, separators=(',', ':'), ensure_ascii=False)
        handle.write('\n')
    os.replace(tmp_path, path)


def _ensure_dir(path):
    if not path:
        return
    if os.path.isdir(path):
        return
    try:
        os.makedirs(path)
    except OSError:
        if not os.path.isdir(path):
            raise


@contextlib.contextmanager
def _exclusive_lock(path):
    _ensure_dir(os.path.dirname(path))
    handle = open(path, 'a+')
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def _is_last_day_of_month(target_day):
    return (target_day + datetime.timedelta(days=1)).month != target_day.month
