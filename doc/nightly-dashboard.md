# Nightly map-creation dashboard

The converter publishes a self-contained HTML/SVG dashboard for `test` and `prod`.
The first worker startup at or after **00:15 UTC** performs maintenance: it uploads
the previous UTC day's telemetry and only then publishes the dashboard. This is
not an independent clock or scheduler; no worker startup means no publication.

## EC2-only configuration

Test and production run on the same EC2 server, with independent deployment
directories. Each deployed `dist/dashboard.py` reads `../dashboard.env` relative
to its own location, regardless of the worker's current working directory:

- Test: `/home/ubuntu/touch-mapper/test/dashboard.env`
- Production: `/home/ubuntu/touch-mapper/prod/dashboard.env`

These files sit beside `dist/`, `stats/`, and `runtime/`, so replacing `dist/`
during deployment preserves configuration. Publication is disabled independently
for an environment when its file is absent; it does not read the other
environment's file or `/etc/touch-mapper/dashboard.env`.

If the file is missing, each test/prod `poller.sh` process writes a warning to
stderr once at startup, after acquiring its worker lock and before entering its
request loop. The existing stderr redirection records it in
`/home/ubuntu/touch-mapper/<environment>/runtime/<worker>/poller.log`, including
the missing configuration's full path. It is not repeated for each request.
The poller continues processing maps normally.

Each file is INI data with a single `[dashboard]` section, not a shell script.
Configuration lookup needs no server or environment name. The publisher still
uses the worker's existing `TM_ENVIRONMENT` value (`test` or `prod`) to select the
Athena database, label the report, and validate that the destination bucket
matches the worker's environment.

Use these keys in each file:

| Key | Value |
| --- | --- |
| `DASHBOARD_PUBLIC_PREFIX` | `dashboard/` followed by a host-generated opaque token of 16–128 ASCII letters, digits, underscores or hyphens, and a trailing slash |
| `DASHBOARD_WEB_BUCKET` | `test.touch-mapper.org` for test; `touch-mapper.org` for prod |
| `DASHBOARD_ATHENA_WORKGROUP` | Optional workgroup name; default `primary` |
| `DASHBOARD_ATHENA_OUTPUT` | Optional private `s3://bucket/prefix/` query-results location; omit when the workgroup supplies it |

Generate a distinct unpredictable token for each environment on EC2, for example
with `openssl rand -hex 24`. Use the generated token in place of `<TEST_TOKEN>` or
`<PROD_TOKEN>` below.

`/home/ubuntu/touch-mapper/test/dashboard.env`:

```ini
[dashboard]
DASHBOARD_PUBLIC_PREFIX=dashboard/<TEST_TOKEN>/
DASHBOARD_WEB_BUCKET=test.touch-mapper.org
DASHBOARD_ATHENA_WORKGROUP=primary
```

`/home/ubuntu/touch-mapper/prod/dashboard.env`:

```ini
[dashboard]
DASHBOARD_PUBLIC_PREFIX=dashboard/<PROD_TOKEN>/
DASHBOARD_WEB_BUCKET=touch-mapper.org
DASHBOARD_ATHENA_WORKGROUP=primary
```

Create the files as the `ubuntu` worker account and set permissions to `600`.
If the selected workgroup does not supply a private S3 results location, add
`DASHBOARD_ATHENA_OUTPUT=s3://your-private-results-bucket/dashboard-test/` to the
test file and the corresponding results prefix to the production file. This
location stores Athena's query output; the publisher reads those results and
uploads the finished HTML to `DASHBOARD_WEB_BUCKET` under
`DASHBOARD_PUBLIC_PREFIX`. Both environments can use the same workgroup.

Do not commit the real prefixes, URLs, or populated configuration files.
Protect configuration with host
permissions readable by the worker account. Configuration is parsed as data;
URLs, traversal, alternate buckets, and paths outside `dashboard/` are rejected.
Athena results must be private; the publisher rejects either public web bucket as
a query-results destination. Configure result retention/lifecycle separately.

The destination is the configured prefix plus `index.html`. The S3 website must
make that object publicly readable through its existing website policy. The
unlisted path is **obscurity, not authentication**: anyone obtaining its URL can
read it. Ordinary website sync excludes the entire generic `dashboard/` prefix
from deletion, so deployments neither disclose nor need to know the token.

## Open the dashboard

After the first successful publication, open the URL for the environment in your
browser:

| Environment | Dashboard URL |
| --- | --- |
| Test | `https://test.touch-mapper.org/dashboard/<TEST_TOKEN>/index.html` |
| Production | `https://touch-mapper.org/dashboard/<PROD_TOKEN>/index.html` |

Replace the token placeholder with the token in that environment's
`DASHBOARD_PUBLIC_PREFIX` in `dashboard.env`. More generally, the URL is
`https://<DASHBOARD_WEB_BUCKET>/<DASHBOARD_PUBLIC_PREFIX>index.html`; the prefix
already includes `dashboard/` and its trailing slash. There is no `/en/` segment
in the dashboard URL.

The page is served through the existing public website domain, so no EC2 hostname
or port is needed. There is no link to it in the normal website navigation;
bookmark the full URL. The page becomes available only after an eligible worker
startup successfully queries Athena and uploads the HTML. Its “Generated” time
shows when the displayed report was last published; reloading the page does not
run a new Athena query.

## Deployment prerequisites

Package both `converter/dashboard.py` and `converter/dashboard_html.py` alongside
the worker. The publisher imports `boto3` only when running a publication.
The shared instance role needs access for both environments: Athena
`StartQueryExecution`, `GetQueryExecution`, `GetQueryResults`, and
`StopQueryExecution` access on the selected workgroup;
Glue catalog/table read access; read access to the environment's telemetry
objects; and write/read access to the private Athena results location (plus any
required KMS permissions). Give it `s3:PutObject` on the configured web-bucket
prefix. No website-wide deletion permission is needed by this publisher.

The existing Glue databases are `touch_mapper_stats_test` and
`touch_mapper_stats_prod`, with table `application_stats_json`. Verify deployed
Glue columns match `install/cloudformation.json`. An Athena workgroup must either
supply a results location or the deployment configuration must specify one. The report
uses the current schema; absent measurements in older records remain null.

## Report schema and metrics

`build_report` emits schema version 1. Only the following public fields survive
mapping; arbitrary Athena columns and labels are discarded or mapped to unknown.

- `environment`, `generated_at` (UTC), and `coverage.start` / `coverage.end` give
  the 30 completed UTC day operations window.
- `daily` and `monthly` contain `period`, `attempts`, `successes`, `errors`,
  `unique_users`, `p50_seconds`, and `p95_seconds`. Daily periods are ISO dates;
  monthly periods are `YYYY-MM`. Daily contains exactly 30 buckets. Monthly
  starts at the earliest available completed-day attempt and includes the current
  partial month through yesterday. Missing buckets contain zero counts and null
  percentiles; with no history there is one empty current covered-month bucket.
- `summary` contains those same metrics plus `success_rate` (0–100 or null when
  there are no attempts). Unique users and percentiles are recalculated over the
  whole window, never summed or averaged from daily aggregates.
- `errors` contains descending `{label, count}` aggregates. Recognized specific
  structured codes (currently `too_large`) take precedence. Unknown/missing codes
  fall back to a fixed allowlist of failure stages and exception classes. Unknown
  categories are collapsed, not rendered as arbitrary source strings.
- `rss` contains `stage`, `p50_kib`, `p95_kib`, `max_kib`, and
  `p95_capacity_percent` for OSM2World, Blender, clip-2d and the converter process.
  The capacity denominator is 1,048,576 KiB (1 GiB). Stage peaks may overlap and
  must not be added. These are observed worker measurements, not a performance
  benchmark or a guarantee of total machine memory consumption.
- `timings` contains `stage`, `p50_seconds`, and `p95_seconds` for available stored
  stage durations: OSM fetch, named/big-road pruning, map description, primary
  upload, SVG-to-PDF, and end to end. OSM fetch excludes previous failed fetch
  attempts. No durations are invented for stages absent from the Athena schema.
- `usage` has `printing_technology`, `content_mode`, `multipart`, and `countries`
  arrays of `{label, count}`. Countries are the top ten allowlisted ISO codes by
  attempts, with safe `unknown` fallback. Printing/content/multipart categories
  also use explicit allowlists.

Attempts include only terminal `success` and `failed` records, excluding idle
polls. End-to-end duration is worker request pickup to terminal state, including
failed attempts when measured; it excludes time waiting in the queue. SQL
`approx_percentile` ignores missing/negative measurements. Missing RSS/timing is
shown as unavailable, never as zero. `approx_distinct` counts nonempty browser
fingerprints; fingerprints themselves never leave Athena, and unidentifiable
attempts do not contribute to that estimate. Approximate users are neither
verified people nor additive across periods. All grouping uses recorded UTC
telemetry dates and excludes today. Each trend selector displays one metric and
one unit at a time.

No raw request IDs, addresses, IPs, fingerprints, coordinates, error descriptions
or exception messages are selected into query results or embedded in HTML. Safe
category constraints apply in both SQL and report mapping. This is aggregate
reporting, not differential privacy: small aggregate counts remain visible.

## Retry and publication semantics

Telemetry upload and dashboard publication have separate success markers and
locks. Upload failure prevents publication. Successful upload remains marked if
the report fails, so the next eligible worker startup retries only publication.
Maintenance exceptions do not interrupt map conversion. Concurrent worker starts
do not race the same maintenance stage. A failed report never records success.

A publication issues one aggregate Athena query. Explicit projected year/month
predicates exclude future partitions and restrict recent operations to the months
intersecting the 30-day window; timestamp predicates retain exact UTC day
boundaries. Monthly history still scans all available historical months. Athena
may inline common table expressions and repeat scans across aggregate branches,
so check query duration and bytes scanned when enabling publication.
Polling is bounded to 120
seconds and a timed-out query is cancelled. Athena failures propagate a generic
error without query diagnostics. After all result pages arrive, the publisher
validates/maps aggregates, renders the entire HTML in memory, then performs one
S3 `PutObject`. S3 replaces the destination object atomically: clients see the
previous complete report or the next complete report, never a partially uploaded
page. Failed queries/rendering cause no web-bucket write; failed writes leave the
report marker unset. Query retries start afresh on later worker starts.

`Cache-Control: no-cache` requests revalidation; CloudFront policies must respect
this header or otherwise use a suitably short TTL for the dashboard prefix.
Athena and upload activity are best-effort maintenance, separate from map output.
The monthly aggregate is regenerated from currently available history at every
publication, so retention/removal of telemetry can change historical buckets.

## Local verification

The deterministic dashboard regression in `make test-regression` uses fixture
Athena rows and fake AWS clients, without network calls. It covers UTC bucketing,
empty periods, report percentiles, privacy grouping, prefix checks, query failure
and successful publication ordering. It also exercises test and production
deployments on one host, resolving separate configuration files from another
working directory and disabling only the environment whose config is absent.
Render the fixture to a project `.tmp/`
file and copy it into the ignored local `web/build/` preview for visual QA. Check
both desktop and narrow viewport layouts, metric selectors, table overflow,
keyboard focus and missing-value labels. The fixture is demonstration data, not
production telemetry. Follow `doc/development-setup.md` to keep the local preview
at `http://127.0.0.1:9000/en/` running.

To reproduce the local synthetic report after `make -C web build-offline`:

```bash
python3 bin/tmpctl mkdir .tmp/dashboard
python3 - <<'PYTHON'
import datetime, json, sys
from pathlib import Path
sys.path.insert(0, 'converter')
from dashboard import build_report
from dashboard_html import render_report
rows = json.loads(Path('test/regression/fixtures/dashboard-athena.json').read_text())
report = build_report(rows, 'test', datetime.datetime(2026, 3, 1, 0, 15))
page = render_report(report)
Path('.tmp/dashboard/fixture.html').write_text(page)
Path('web/build/dashboard-fixture.html').write_text(page)
PYTHON
```

With the local server running, open `http://127.0.0.1:9000/dashboard-fixture.html`.
This local fixture route is unrelated to either environment's unlisted dashboard prefix.
