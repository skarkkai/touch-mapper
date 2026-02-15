# Application Stats Telemetry

This document describes the map-attempt telemetry pipeline and the quicktime simulation mode.

## Overview

`converter/process-request.py` records one telemetry JSON object per map attempt (success or failure) to local disk:

`stats/<year>/<month>/<day>/<map-id>.json`

- `<map-id>` is derived from `requestId` by taking the prefix before `/`.
- If the same map id is written again on the same day, the existing file is overwritten.
- Telemetry write runs in the final step so telemetry failures never affect user-visible processing.

## Deploy code version metadata

Converter telemetry reads deployed `dist/VERSION.txt` (same directory as `process-request.py`) once at process startup.
Expected line format:

`<timestamp> <branch> <tag> <commit>`

Example:

`2026-02-15T08:25:31 touch-mapper.larger-sizes package-20260215-082120 4714eb471656fc2737543657ef5be6e4056bdb11`

Stored telemetry fields:

- `code_branch`: branch value from `VERSION.txt` (example: `touch-mapper.larger-sizes`)
- `code_deployed`: value extracted from `package-*` tag (example: `20260215-082120`)
- `code_commit`: commit hash value from `VERSION.txt`

If `VERSION.txt` is missing/malformed, telemetry processing still succeeds and these fields are stored as `null`.

## RAM telemetry fields

RAM telemetry is always collected from converter subprocess stages using `/usr/bin/time -v` via `converter/telemetry.py` (`maxRssKiB`).
`process-request.py` reads `osm-to-tactile-timings.json` and stores these fixed fields:

- `rss_osm2world_kib`
- `rss_blender_kib`
- `rss_clip_2d_kib`
- `rss_prune_only_big_roads_kib` (from `prune-only-big-roads.js` subprocess in `content_mode=only-big-roads`)

These represent top memory consumers for the converter pipeline and are written as KiB integers.
If timings JSON is missing/malformed or RSS is unavailable, fields are stored as `null` and request processing continues.

## OSM size telemetry fields

Converter telemetry also stores two OSM file size fields (bytes):

- `osm_fetched_bytes`: file size immediately after OSM fetch and before content filtering.
- `osm_pruned_bytes`: file size after content-mode pruning/filtering (`no-buildings`, `only-big-roads`), or same as fetched size when no pruning is applied.

## Browser IP and geolocation

- Browser code also computes a stable hashed fingerprint (`browserFingerprint`) from browser/device properties.
- Converter telemetry stores it as `browser_fingerprint` for approximate unique-visitor counting.
- Browser code (`web/src/scripts/map-creation.js`) performs a best-effort public IP lookup before enqueueing the SQS request and includes `browserIp` in the message body.
- Converter telemetry stores that value as `browser_ip`.
- During per-request stats write, converter performs a best-effort IP geolocation lookup and stores:
  - `browser_ip_country`
  - `browser_ip_country_code`
  - `browser_ip_region`
  - `browser_ip_city`
  - `browser_ip_latitude`
  - `browser_ip_longitude`
- Geolocation results are cached in a local file to avoid repeated lookups:
  - `stats/.maintenance/ip-geo-cache.json`

## S3 monthly object format

Local stats are compacted into one gzipped NDJSON object per month:

`s3://<environment>.stats.touch-mapper/stats-json/<YYYY>/<MM>/stats-<YYYY>-<MM>.jsonl.gz`

- Each line is one JSON object.
- Content encoding is gzip.
- Storage class is left as default `STANDARD` (normal redundancy).

## Normal mode behavior

- At `process-request.py` startup, daily maintenance runs once per UTC day using a lock file.
- The job rebuilds month-to-date NDJSON for the previous UTC day and rewrites the monthly S3 object.
- When the previous day is the final day of a month, the local month directory is deleted after successful upload.

Maintenance files under `stats/.maintenance/`:

- `upload.lock`
- `last-successful-run-utc.txt`

## Quicktime mode behavior

Quicktime mode is controlled by a constant in `converter/process-request.py`:

- `STATS_QUICKTIME_MODE = True`

When enabled:

- Every 3 telemetry writes => one virtual day passes and monthly S3 upload runs.
- Every 3 virtual day rollovers => one virtual month passes and the completed local month directory is deleted.

Quicktime state files under `stats/.maintenance/`:

- `quicktime.lock`
- `quicktime-state.json`

Quicktime exists for end-to-end testing of day/month rollover logic without waiting for real calendar boundaries.

Quicktime smoke runner (local, no AWS calls):

```bash
python3 converter/run-stats-quicktime-smoke.py --root .tmp/telemetry-quicktime-smoke --attempts 9
```

## Athena table

CloudFormation provisions:

- Private stats bucket (`<environment>.stats.touch-mapper`)
- Glue database
- Glue external table `application_stats_json`

Table characteristics:

- JSON SerDe (`org.openx.data.jsonserde.JsonSerDe`)
- Partitioned by `year`, `month`
- Partition projection enabled
- Table location root: `s3://<environment>.stats.touch-mapper/stats-json/`

Query example:

```sql
SELECT status, count(*)
FROM application_stats_json
WHERE year = '2026' AND month = '02'
GROUP BY status;
```

Query example grouped by deployed code commit:

```sql
SELECT code_commit, count(*) AS attempts
FROM application_stats_json
WHERE year = '2026' AND month = '02'
GROUP BY code_commit
ORDER BY attempts DESC;
```

Query example for monthly RAM percentiles:

```sql
SELECT
  format('%s-%02d', year, CAST(month AS INTEGER)) AS year_month,
  approx_percentile(rss_osm2world_kib, 0.5) AS p50_osm2world_kib,
  approx_percentile(rss_osm2world_kib, 0.95) AS p95_osm2world_kib
FROM application_stats_json
WHERE rss_osm2world_kib IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

## Manual pending-stats upload (EC2)

To force-upload all pending local stats JSON files for one environment:

The script is deployed on EC2 at `~/touch-mapper/<environment>/dist/upload-pending-stats.py` for both `test` and `prod`.

```bash
# On EC2 host
cd ~/touch-mapper/<environment>/dist
./upload-pending-stats.py <environment>
```

Examples:

```bash
cd ~/touch-mapper/test/dist
./upload-pending-stats.py
# or explicitly:
./upload-pending-stats.py test

cd ~/touch-mapper/prod/dist
./upload-pending-stats.py
# or explicitly:
./upload-pending-stats.py prod
```

Behavior:
- Uploads each month directory under `~/touch-mapper/<environment>/stats/YYYY/MM/` into:
  - `s3://<environment>.stats.touch-mapper/stats-json/YYYY/MM/stats-YYYY-MM.jsonl.gz`
- Keeps current month local files.
- Removes local past-month directories after successful upload.
- Use `--keep-local-months` to disable cleanup.
