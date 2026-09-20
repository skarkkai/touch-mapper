# Development Setup

This is the authoritative source for local setup and run workflows.

This document contains local setup and deployment-oriented developer workflows.

## Local prerequisites

Run commands from the repository root unless a section says otherwise. Local
builds and offline tests do not require AWS credentials. Development scripts use
Python 3.10+ and Node.js; Blender scripts must use Blender 2.78's bundled Python
3.5. A current Blender installation is not a substitute for that runtime.

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
On Apple Silicon, the official Blender 2.78c binary is Intel-only and needs
Rosetta. Check with `arch -x86_64 /usr/bin/uname -m`; it should print `x86_64`.
If Rosetta is absent, install it using Apple's normal installation flow before
continuing.

Download Blender from the [official 2.78 release directory](https://download.blender.org/release/Blender2.78/).
For a fresh checkout with no existing `blender` or `blender-macos-2.78c` paths:

```bash
bin/tmpctl mkdir .tmp/blender-macos
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

Expected versions are Blender 2.78 (2.78c archive) and Python 3.5.2. The quick
suite needs neither a rebuilt OSM2World jar nor CairoSVG, AWS, or Playwright.
`bin/tmpctl` is tracked as executable; preserve Git executable bits when copying
a checkout. In a restricted macOS agent sandbox, invoke the quick suite with
`sandbox_permissions: "require_escalated"` because native `time -l` reads
`sysctl kern.clockrate`. No network is used by the suite.

Verified on Apple Silicon with Rosetta on 2026-09-20: the complete quick suite,
including actual Blender STL export and deployment-gate checks, passed in 10.63 s.
This is a local developer test time, not production performance.

### Additional prerequisites for full conversion tests on macOS

The full suite also needs a compiled OSM2World jar, SVG/PDF libraries, web build
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
bin/tmpctl mkdir .tmp/python-dev
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
