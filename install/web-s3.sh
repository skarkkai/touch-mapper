#!/bin/bash

set -e

if [[ $# != 1 ]]; then
    echo "Usage: $0 ENVIRONMENT"
    exit 1
fi
environment=$1

cd "$( dirname "${BASH_SOURCE[0]}" )"
cd ../web
eval $( ../install/parameters.sh $environment )
url=s3://$domain
echo "env_name: $env_name"
echo "S3 web bucket: $url"

# Make sure "web/build" is up to date
ENVIRONMENT=$env_name make build

# build => dist (keep mtimes for unchanged files to avoid unnecessary S3 uploads)
tmp_dist=dist.next
rm -rf "$tmp_dist"
cp -a build "$tmp_dist"
./create-env-js.sh $env_name >"$tmp_dist/scripts/environment.js"
for lang in $(cd "$tmp_dist"; find ?? -type d); do
    (
        cd "$tmp_dist/$lang"
        rename 's/\.html//' *.html
        mv index index.html
    )
done
rm -f "$tmp_dist/.gitignore"

mkdir -p dist
rsync -a --delete --checksum "$tmp_dist"/ dist/
rm -rf "$tmp_dist"

time=$( date +%Y%m%d-%H%M%S )
git tag web-install-$time

# Sync dist to S3
mapfile -t langs < <( cd dist && find ?? -maxdepth 0 -type d )
sync_excludes=()
for lang in "${langs[@]}"; do
    sync_excludes+=( --exclude "$lang/*" )
done
sync_excludes+=(
    --exclude "scripts/three-r182*.js"
    --exclude "scripts/three-addons/*"
    --exclude "scripts/vendor-common.js"
    --exclude "scripts/aws-sdk*.js"
)

# Sync non-locale assets once; locale HTML paths are synced separately with explicit content-type.
aws s3 sync --delete --cache-control must-revalidate "${sync_excludes[@]}" dist/ $url
# Three.js vendor assets are effectively immutable and large. Use size-only matching to avoid
# timestamp-driven re-uploads while still allowing true updates when file sizes change.
aws s3 sync --delete --size-only --cache-control must-revalidate \
    --exclude "*" --include "three-r182*.js" dist/scripts/ $url/scripts/
if [[ -d dist/scripts/three-addons ]]; then
    aws s3 sync --delete --size-only --cache-control must-revalidate dist/scripts/three-addons/ $url/scripts/three-addons/
else
    aws s3 rm --quiet --recursive $url/scripts/three-addons
fi
aws s3 sync --delete --size-only --cache-control must-revalidate \
    --exclude "*" --include "vendor-common.js" --include "aws-sdk*.js" dist/scripts/ $url/scripts/
for lang in "${langs[@]}"; do
    aws s3 sync --delete --cache-control must-revalidate --content-type text/html dist/$lang/ $url/$lang
done


# Invalidate CloudFront
distribution_id=$( aws cloudfront list-distributions | jq --raw-output ".DistributionList.Items[] | select(.Origins.Items[].DomainName == \"$env_name.maps.touch-mapper.s3.amazonaws.com\") | .Id" )
echo "Invalidating $env_name environment CloudFront distribution '$distribution_id'"
aws cloudfront create-invalidation --distribution-id $distribution_id --paths '/*'

echo "Web resources installed to https://$( cat dist/scripts/environment.js  | egrep '^window.TM_DOMAIN' | cut -d "'" -f 2 )"
