#!/bin/bash

set -e

# Tag release
#branch=$( git rev-parse --abbrev-ref HEAD )
#if [[ $branch != release/* ]]; then
#    echo "Current branch must be release/*, not $branch, maybe create one"
#    exit 1
#fi
time=$( date +%Y%m%d-%H%M%S )
git tag package-$time

cd "$( dirname "${BASH_SOURCE[0]}" )"
rm -rf dist.old
mv dist dist.old || true
mkdir dist
cp -alH ../blender dist/
mkdir dist/OSM2World
cp -alH ../OSM2World/build dist/OSM2World/
cp -plH ../converter/*{py,sh,js} dist/
cp -aH ../converter/map_desc dist/
cp -aH ../converter/py-lib dist/
cp -aH ../install/{ec2-restart-pollers.sh,ec2-init.sh} dist/
echo "$( date +'%Y-%m-%dT%H:%M:%S') $( git rev-parse --abbrev-ref HEAD ) $( git describe --tags ) $( git rev-parse --verify HEAD )" >dist/VERSION.txt
#GZIP=-4 tar czf dist.tgz dist
