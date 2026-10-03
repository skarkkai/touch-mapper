# Development Setup

This is the authoritative source for local setup and run workflows.

This document contains local setup and deployment-oriented developer workflows.

## Local prerequisites

Run commands from the repository root unless a section says otherwise. Local
builds and offline tests do not require AWS credentials. Development scripts use
Python 3.10+ and Node.js; Blender scripts must use Blender 2.78's bundled Python
3.5. A current Blender installation is not a substitute for that runtime.
The quick regression suite also needs Ant and a JDK that accepts Java 7
source/target because it builds and exercises OSM2World (JDK 17 works; JDK 21
does not).

The converter worker uses **Python 3.12+** in a host-local `worker-venv`.
Blender continues to use its bundled Python 3.5, including SVGWrite. The worker
launches `osm-to-tactile.py` and PDF conversion with its own interpreter, and
`osm-to-tactile.py` launches the unchanged Blender binary explicitly.

Install Python 3.12 with `venv` support and the native Cairo library first
(on Ubuntu 24.04: `sudo apt install python3.12 python3.12-venv libcairo2`).
An older EC2 OS may need an OS upgrade or a separately installed supported
CPython; installing boto3 cannot upgrade Python or the host C library. Do not
replace `/usr/bin/python3`, which system tools and the restart bootstrap use.
For macOS, a Homebrew Python 3.12+ and `brew install cairo` are suitable.

Prepare the local worker from the repository root:

```bash
bash converter/setup-worker-python.sh
bash converter/worker-python.sh --check
bash converter/worker-python.sh converter/process-request.py --help
```

Set `TM_WORKER_BASE_PYTHON=/absolute/path/to/python3.12` when creating the venv
with a separately installed CPython. `TM_WORKER_PYTHON` can select an existing
fully provisioned worker interpreter for manual runs. The default is
`worker-venv/bin/python` beside `converter/` locally or beside `dist/` on EC2.
Missing, old, or incorrectly provisioned environments fail startup before SQS
polling. `--check` validates pinned versions and creates a tiny PDF offline.
AWS dependencies are pinned in `converter/aws-requirements.txt`; PDF dependencies
are pinned in `converter/worker-requirements.txt`. The old `py-lib/boto3` bundle
is neither imported nor packaged. The quick suite requires the worker environment
and verifies real worker imports and stubbed S3/SQS/Athena calls with fake credentials.

### Migrating an existing EC2 worker

Keep `worker-venv` outside `dist/`; create it **on EC2**, never copy a development
venv there. Install a supported host Python and Cairo before replacing `dist/`.
Drain and stop the existing **test** pollers before `make test-install-ec2`:
send SIGTERM to their poller PIDs, let the current request finish (or create
maps to drain their outstanding polls), and verify their worker locks are free.
An artifact replacement changes files used by existing processes, so do not
leave legacy pollers running against the new distribution. Install the new test
distribution with `make test-install-ec2`, then run as `ubuntu` on EC2:

```bash
cd /home/ubuntu/touch-mapper/test
bash dist/setup-worker-python.sh
bash dist/worker-python.sh --check
```

Then run `make test-restart` locally and create a test map. Inspect its
STL, SVG, PDF, description and runner log before production. For production,
drain and stop only the production pollers, use `make prod-install-ec2`, prepare `/home/ubuntu/touch-mapper/prod/worker-venv`
with the same two commands, then `make prod-restart`. The restart helper
validates the new environment before signaling existing pollers. These targets
only install converter artifacts; no CloudFormation/Lambda change is involved.

The first migration creates a fresh venv during a controlled interruption of that environment.
For later dependency updates, drain and stop that environment's workers before
changing its existing venv; do not update packages under running workers. Keep
the previous distribution and its runtime together for rollback. The default
setup interpreter is `python3.12`; specify `TM_WORKER_BASE_PYTHON` on EC2 too
if it is installed elsewhere. Preserve both venvs across artifact deployments.

### Linux

The legacy bootstrap below is Linux-specific: it downloads Linux Blender and
uses `apt`, system Python packages, and Linux filesystem assumptions. Review it
before running it on a new machine; do not run it on macOS.

```bash
./init.sh
```

Install the web dependencies separately with `npm --prefix web install`.

### macOS: quick regression prerequisites

Install Node.js and Python 3.10+ if needed (for example, `brew install node python`).
Install the required Java tools with `brew install ant openjdk@17`, then
select that JDK as shown below.
On Apple Silicon, the official Blender 2.78c binary is Intel-only and needs
Rosetta. Check with `arch -x86_64 /usr/bin/uname -m`; it should print `x86_64`.
If Rosetta is absent, install it using Apple's normal installation flow before
continuing.

Download Blender from the [official 2.78 release directory](https://download.blender.org/release/Blender2.78/).
For a fresh checkout with no existing `blender` or `blender-macos-2.78c` paths:

```bash
python3 bin/tmpctl mkdir .tmp/blender-macos
curl -fL --retry 2 \
  -o .tmp/blender-macos/blender-2.78c-OSX_10.6-x86_64.zip \
  https://download.blender.org/release/Blender2.78/blender-2.78c-OSX_10.6-x86_64.zip
md5 -q .tmp/blender-macos/blender-2.78c-OSX_10.6-x86_64.zip
```

Compare the output with `c21a525c7c2793b619253e431c5503f9`, published in
[release278c.md5](https://download.blender.org/release/Blender2.78/release278c.md5),
before extracting. The checksum detects corruption; the download source is HTTPS.

```bash
unzip -q .tmp/blender-macos/blender-2.78c-OSX_10.6-x86_64.zip \
  -d .tmp/blender-macos/extracted
mv .tmp/blender-macos/extracted/blender-2.78c-OSX_10.6-x86_64 blender-macos-2.78c
mkdir blender
ln -s ../blender-macos-2.78c/blender.app blender/blender.app
ln -s blender.app/Contents/Resources/2.78 blender/2.78
ln -s ../blender converter/blender
ln -s ../OSM2World converter/OSM2World
```

If a link already exists, inspect it rather than overwriting it. Keep the installed
`blender-macos-2.78c` and `blender` directories; only the archive/extraction staging
area is temporary. These runtime paths are ignored by Git and must be installed
or linked separately in each worktree.

Create `blender/blender` with the following launcher, then run `chmod +x blender/blender`:

```sh
#!/bin/sh
# Resolve the app path so bundled Python finds its standard library on macOS.
blender_binary_dir=$(CDPATH= cd -- "$(dirname -- "$0")/blender.app/Contents/MacOS" && pwd -P) || exit 1
exec "$blender_binary_dir/blender" "$@"
```

Use this launcher rather than a symlink directly to the application executable:
launching through a relative symlink can prevent Python from finding `sysconfig`.
Verify the actual Blender runtime, then run the quick suite:

```bash
blender/blender --version
blender/blender --background --factory-startup --threads 1 \
  --python-exit-code 1 --python-expr 'import sys; print(sys.version)'
make test-regression
```

The quick suite prints a short status and summary during normal deployments.
Failures print the failing check's output and retain all check logs under
`.tmp/regression/`. For per-check timings and retained logs on a successful run,
use `make test-regression-verbose`.

Expected versions are Blender 2.78 (2.78c archive) and Python 3.5.2. The quick
suite builds the OSM2World jar itself and needs the worker environment above,
but requires neither AWS access nor Playwright.
`bin/tmpctl` is tracked as executable, but copied checkouts have repeatedly lost
that bit. Automated callers therefore invoke it through Python: `sys.executable`
in Python and `python3` in shell/Node. Restoring the bit alone is not a durable
fix; retain explicit-interpreter calls when adding new artifact workflows. The
quick suite verifies mkdir/removal using a non-executable copy of the real helper.
In a restricted macOS agent sandbox, invoke the quick suite with
`sandbox_permissions: "require_escalated"` because native `time -l` reads
`sysctl kern.clockrate`. No network is used by the suite.

Verified on Apple Silicon with Rosetta on 2026-09-20: the complete quick suite,
including actual Blender STL export and deployment-gate checks, passed in 10.63 s.
This is a local developer test time, not production performance.

### Additional prerequisites for full conversion tests on macOS

The full suite also needs SVG/PDF libraries, web build
dependencies, and Playwright. See [map-content-verification.md](map-content-verification.md).
JDK 17 compilation, the OSM2World regression, CairoSVG PDF creation, bundled
SVGWrite imports, and standalone browser behavior checks have been verified on
Apple Silicon. The full suite is not currently passing on that host: Blender
2.78c under Rosetta hangs in its legacy `BLENDER_RENDER` PNG renderer, including
a 32-by-32 factory-scene render with `--threads 1`. STL-only quick tests pass,
but conversion tests requiring wireframe PNGs time out. Use a compatible Linux
runtime for full conversion verification; do not bypass PNG generation to claim
a passing full suite.
For Java, select a JDK that still accepts this project's Java 7 source/target;
JDK 17 is suitable, while JDK 21 rejects the current Ant compiler settings.
For example, with Homebrew:

```bash
brew install ant openjdk@17 cairo
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
make osm2world
```

Keep modern development packages out of Blender's Python environment:

```bash
python3 bin/tmpctl mkdir .tmp/python-dev
python3 -m venv .tmp/python-dev
source .tmp/python-dev/bin/activate
python -m pip install cairosvg
python -c 'import cairosvg'
python -m pip install --no-compile \
  --target blender/2.78/python/lib/python3.5/svgwrite \
  svgwrite==1.1.9 pyparsing==2.4.7
blender/blender --background --factory-startup --python-exit-code 1 \
  --python-expr 'import sys; sys.path.insert(0, "blender/2.78/python/lib/python3.5/svgwrite"); import svgwrite; print(svgwrite.VERSION)'
```

If CairoSVG cannot find Homebrew's Cairo library, set
`export DYLD_FALLBACK_LIBRARY_PATH="$(brew --prefix cairo)/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"`
in the shell running the conversion tests and repeat the import check. Retain a
UTF-8 locale for converter subprocesses; do not set `LC_ALL=C` to parse timings.

The full suite's reviewed screenshot baselines use Linux fonts. Native macOS
screenshots can differ even when behavior is correct; investigate those
differences and use the matching Linux environment for baseline comparisons.
Do not regenerate accepted screenshots merely to make macOS comparisons pass.

## Setup AWS CLI

```bash
aws configure
```

## Create AWS resources

```bash
make dev-aws-install
```

API Gateway for email-sending Lambda is currently not created automatically.
The same API Gateway endpoints can be reused across Touch Mapper instances.

## Install static website to S3

```bash
make dev-web-s3-install
```

The last output line includes the CloudFront URL (for example `https://something.cloudfront.net`) for accessing the web UI.

## Deployed EC2 layout

The deployed service uses **one EC2 instance with 1 GB RAM in total**. Both
`test` and `prod` run on this same host under `/home/ubuntu/touch-mapper` as the
`ubuntu` user. Currently, **one test poller runs for ease of debugging and three
production pollers run**, for **four pollers on the machine**. All pollers and their converter subprocesses
share the host's memory and CPU resources; the 1 GB budget is for the whole
machine, not for each environment or poller.

The directory layout is:

```text
/home/ubuntu/touch-mapper/
├── test/
│   ├── dist/                       # Installed converter distribution
│   │   ├── poller.sh
│   │   ├── process-request.py
│   │   ├── VERSION.txt
│   │   └── ...                    # Other scripts, libraries and bundled tools
│   ├── worker-venv/                # Host-local Python 3.12+ and pinned dependencies
│   ├── dashboard.env              # Environment-specific host configuration
│   ├── runtime/                   # Created for runtime use
│   │   └── <worker-id>/            # One numerically named directory per poller
│   │       ├── lockfile
│   │       └── ...                # Working files and per-poller state
│   ├── logs/                      # Private runner logs (0700)
│   │   └── <worker-id>/            # One directory per runner (0700)
│   │       ├── YYYY-MM-DD.log      # UTC daily log (0600)
│   │       └── current.log         # Symlink for tail -F
│   └── stats/                     # Created for runtime telemetry
│       ├── .maintenance/          # Shared locks and markers for test
│       └── <year>/<month>/<day>/   # Map-attempt JSON records
└── prod/
    ├── dist/                       # Installed converter distribution
    ├── dashboard.env              # Production dashboard configuration
    ├── runtime/
    │   └── <worker-id>/            # Same per-poller structure as test
    ├── logs/
    │   └── <worker-id>/            # Same private UTC daily logs as test
    └── stats/
        ├── .maintenance/          # Shared locks and markers for prod
        └── <year>/<month>/<day>/
```

`<worker-id>` is a numeric poller identifier such as `1`, `2`, or `3`, not a
literal directory name. Each active poller uses
its own directory. Directories left by older pollers may remain, so counting
runtime directories does not establish how many pollers are currently running.

**`dist/` is the installed artifact.** `runtime/`, `logs/`, and `stats/` are created during
service startup and operation and live outside that artifact. Replacing `dist/`
must preserve the environment's `worker-venv`, runtime data, runner logs, telemetry,
and `dashboard.env`.
Pollers in the same environment share its `stats/` directory; test and production
have separate runtime and telemetry directories even though they share the host.

See [application telemetry](application-stats-telemetry.md) for the stats lifecycle
and [nightly dashboard](nightly-dashboard.md) for dashboard configuration and
publication. The single-core production benchmarking rules remain in `AGENTS.md`;
four running pollers do not imply four dedicated CPU cores.

## Runner logs and controlled EC2 restart

The poller writes all its own output, request-process output, and converter child
output to `logs/<worker-id>/YYYY-MM-DD.log` in its environment. `current.log`
points to the active UTC day. It appends after a same-day restart, switches files
between request-process iterations, and keeps today plus the preceding 29 UTC
dates. A request that spans midnight finishes in its starting file. A new day
begins with `runner_log_rotated` from the existing poller; it is not a new
runner. `runner_stop` includes its signal when a controlled restart requests
shutdown. Worker runtime validation reports the Python and SDK versions at startup. On startup
and once per UTC day, one worker removes expired dated logs across all runners,
including retired ones. The next startup resumes cleanup if an environment was
stopped. Only recognized dated log files are reaped; other files are left alone.
These logs and the local telemetry contain private request data. Keep their
permissions at `0700` for log directories and `0600` for log files.

From EC2 as `ubuntu`, follow one runner with:

```bash
tail -F /home/ubuntu/touch-mapper/prod/logs/1/current.log
```

OSM fetch events show the HTTPS endpoint without its private bounding box;
`attempt=1` means the first source attempt. A successful dashboard publication
writes `dashboard_publish_success` with its trigger. A missing dashboard
configuration is warned about at runner start and daily log rotation.

Search by `attempt_id` (printed at `attempt_start`, in process events, and in
telemetry), or by the map ID:

```bash
grep -n 'attempt_id=<ID>' /home/ubuntu/touch-mapper/prod/logs/*/20??-??-??.log
grep -n 'map_id=<MAP_ID>' /home/ubuntu/touch-mapper/prod/logs/*/20??-??-??.log
```

An `attempt_start` with `attempt_exit` but no `telemetry_written` means the
terminal telemetry write failed, the process stopped before it could write, or
there was no request in that polling interval. Read its exit code and intervening
stage events. `124` means the 10-minute timeout; `137` or `143` indicates a
signal. A hard kill may leave no terminal telemetry, but the log keeps the
attempt ID, last stage, and exit status. The log alone cannot prove the cause of
an old OSM failure unless that attempt was recorded by the new code.

## Full test and production deployments

From the repository root, use `make test-deploy` to run the quick regression,
update test Lambda and CloudFormation, wait for the stack update, publish the
web app, install the EC2 distribution, and restart the test poller. Use
`make prod-deploy` for the same production sequence. It publishes production
web assets directly; `make prod-web-s3-install` remains a reminder-only target.
Each full deployment runs the quick regression once and stops at the first
failed step. They require the existing AWS
credentials, SSH host `tm-ec2`, build tools, and web dependencies.

Production EC2 deployment promotes the `test/dist/` already installed on the
shared server. Run and validate `make test-deploy` first to stage the intended
code; `make prod-deploy` does not package local code for production. A poller
restart waits for active work to drain and can take up to 11 minutes.
The restart message suggests creating maps to wake current long polls; waiting
for the existing polls to time out also allows them to drain.

The individual EC2 install targets replace `dist/` but **do not restart a running poller**.
`make test-restart` now restarts only the installed test environment. It sends
the local restart helper over SSH, asks every existing test poller to stop,
waits for their worker locks to clear (up to 11 minutes), then starts exactly
one test runner and confirms it took the lock. Production pollers are untouched.
The command does not package or upload local code: run `make test-install-ec2`
first when deploying changes, then `make test-restart`. The new poller finishes
its current request-process iteration after SIGTERM; a previously deployed
poller without this drain behavior may interrupt an active map, so restart it
at a quiet time. A stuck lock or failed startup makes the command fail instead
of reporting a successful restart. Its output includes the new PID and daily
log path. To follow it:

```bash
make test-install-ec2
make test-restart
ssh tm-ec2 'tail -F /home/ubuntu/touch-mapper/test/logs/1/current.log'
```

After `make prod-install-ec2` promotes the tested distribution, run
`make prod-restart` at a quiet time. It stops only the production pollers, waits
up to 11 minutes for their worker locks to clear, then starts exactly three
production runners and verifies that each took its lock. Test remains running.
Like `test-restart`, this target uses the code already installed on EC2; it does
not package or upload changes. Restarting an older poller that lacks graceful
drain behavior may interrupt an active map. A stuck lock or failed startup
makes the command fail. The output lists the new PIDs and log paths.

```bash
make prod-install-ec2
make prod-restart
ssh tm-ec2 'tail -F /home/ubuntu/touch-mapper/prod/logs/1/current.log'
```

Check the production runners' `current.log` files for `runner_start` and
`ps -ef | grep '[p]oller.sh'` for three production pollers. The boot-time helper
also starts one test and three production runners. A dashboard refresh requested
by the EC2 install target is published after the next successful map under the
restarted poller.

## Run OSM -> STL converter service (Linux)

This is the Linux service workflow; the poller still requires GNU `timeout
--kill-after`. The macOS instructions above cover local builds and tests, not
running the production poller. On the configured Linux host, run in a separate
terminal tab:

```bash
install/run-dev-converter.sh
```

## Local web development (Linux and macOS)

From the repository root:

```bash
npm --prefix web install
make -C web build-offline
python3 bin/serve-local
```

Then open [http://127.0.0.1:9000/en/](http://127.0.0.1:9000/en/).
`bin/serve-local` handles the extensionless `/en/area`, `/en/map`, and `/en/maps`
routes. Keep it running after a work session. Rebuild with
`make -C web build-offline` in a second terminal after edits, then reload the
browser. The older `make -C web watch` command requires Linux `inotifywait` and
AWS configuration; it is not the macOS workflow.

The offline build uses a development environment stub. Browser tests supply
their own mock configuration. For manual UI inspection without a configured
backend, create the ignored `web/dist/scripts/environment.js` with:

```js
window.TM_ENVIRONMENT = 'dev';
window.TM_DOMAIN = 'dev';
window.TM_REGION = 'eu-west-1';
```

The local server prefers that file over the build's stub. This enables local
settings/preview inspection; submitting real map conversions still needs the
configured AWS queue and converter service. Reuse an existing configured
environment file if available instead of replacing it with the example.

In socket-restricted agent sandboxes, start/check the preview with
`sandbox_permissions: "require_escalated"` on the first attempt.
