# Deployed map inspection by map ID

This guide is for inspecting a deployed map (test env) from a URL like:
`https://test.touch-mapper.org/en/map?map=<MAP_ID>`

Use this when you need to validate deployed artifacts (`.map-content.json`, `.stl`, `.svg`, `.pdf`, `.blend`) or compare deployed output with local test fixtures.

## Key idea

`MAP_ID` is persistent. Actual artifact URLs are derived from `info.requestId`, not directly from the page HTML download links.

## URL rules (from deployed app-common.js)

1. v2 ID (starts with `B`):
- info URL: `/map/info/<MAP_ID>.json`
- data prefix: `/map/data/<REQUEST_ID_ENCODED>`

2. v1 ID (legacy lowercase):
- info URL: `/map/<MAP_ID>/info.json`
- data prefix: `/map/<REQUEST_ID_ENCODED>`

3. `REQUEST_ID_ENCODED`:
- Start from `info.requestId` (fallback to `MAP_ID` if missing).
- If it has two segments (`<id>/<name>`), URL-encode only the second segment and keep the slash.

## Minimal inspection workflow

```bash
MAP_ID='B739ab809b79de80'
HOST='https://test.touch-mapper.org'

# Build info URL by ID version
if [[ "$MAP_ID" == B* ]]; then
  INFO_URL="$HOST/map/info/$MAP_ID.json"
else
  INFO_URL="$HOST/map/$MAP_ID/info.json"
fi

# Read key metadata
curl -sSfL "$INFO_URL" | jq '{requestId, printingTech, addrShort, addrLong, printWidthCm, printHeightCm, size, scale}'

REQUEST_ID="$(curl -sSfL "$INFO_URL" | jq -r '.requestId // empty')"
if [[ -z "$REQUEST_ID" ]]; then REQUEST_ID="$MAP_ID"; fi

REQUEST_ID_ENCODED="$(printf '%s' "$REQUEST_ID" | jq -sRr '
  split("/") as $p |
  if ($p|length) > 1 then $p[0] + "/" + ($p[1]|@uri) else $p[0] end
')"

if [[ "$MAP_ID" == B* ]]; then
  BASE="$HOST/map/data/$REQUEST_ID_ENCODED"
else
  BASE="$HOST/map/$REQUEST_ID_ENCODED"
fi

echo "INFO_URL=$INFO_URL"
echo "BASE=$BASE"
```

## Validate deployed artifacts

```bash
for SUFFIX in '.map-content.json' '.stl' '-ways.stl' '-rest.stl' '.svg' '.pdf' '.blend'; do
  URL="${BASE}${SUFFIX}"
  echo "== $URL =="
  curl -sSfL -I "$URL" | sed -n '1p;/content-type/p;/content-encoding/p;/last-modified/p'
done
```

## Read map-content.json safely

CloudFront/S3 may return gzip-encoded JSON even when extension is `.json`.

```bash
curl -sSfL "${BASE}.map-content.json" | gzip -dc | jq -r 'keys'
curl -sSfL "${BASE}.map-content.json" | gzip -dc | jq -r '
  to_entries[]
  | select(.value.subclasses? != null)
  | "\(.key) subclasses=\(.value.subclasses|length)"
'
```

## Compare deployed map-content with local fixture

```bash
curl -sSfL "${BASE}.map-content.json" | gzip -dc | jq -S 'del(.metadata)' > /tmp/live-map-content.json
jq -S 'del(.metadata)' test/data/map-content.json > /tmp/local-map-content.json
diff -u /tmp/local-map-content.json /tmp/live-map-content.json | sed -n '1,200p'
```

## Notes

- Do not use `view-source:` URLs with curl. Fetch the normal page URL.
- Keep to `curl -sSfL` command style in this environment.
- Uploaded `.map-content.json` may include `metadata.requestBody`; remove `metadata` when comparing against local fixtures that do not include upload-time metadata.
- If deployed JS changes URL builders, update this file (and keep AGENTS pointer intact).

## Map bucket access

The map bucket uses a `Private` bucket ACL. A bucket-level `PublicRead` ACL
grants anonymous `ListBucket` access and exposes object names, including map
IDs and stored OSM source names. The browser only needs known object URLs;
map history is stored in the browser and does not enumerate S3.

Bucket and object ACLs are independent. The converter explicitly uploads info
JSON (including progress), map-content JSON, STL, SVG, PDF, and Blender files
with `public-read` object ACLs. Changing the bucket ACL preserves these public
downloads, including existing maps. Stored `.osm.gz` sources keep the default
private object ACL and remain accessible to the converter with its AWS credentials.
Closing enumeration does not make public metadata confidential to someone who
already has its map URL.

This change requires an AWS infrastructure update. From the repository root,
run `make test-aws-install` to apply the test CloudFormation template. For
production, `make prod-aws-install` updates Lambda and prints the separate
required `install/cloudformation-update.sh prod` command; run that command to
update the production stack. Deploying EC2 `dist/` alone does not change bucket
permissions.

After the stack update completes, confirm that an anonymous S3 `ListObjectsV2`
request is denied and that known info, STL, SVG, and map-content URLs remain
readable. The offline `Map bucket access` regression checks the template ACL
and exercises the worker's actual upload calls without AWS access.
