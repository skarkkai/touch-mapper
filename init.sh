#!/bin/bash

set -e

BLENDER_DL_URL=http://mirror.cs.umn.edu/blender.org/release/Blender2.78/blender-2.78b-linux-glibc219-x86_64.tar.bz2
BLENDER_VERSION=2.78

# Download Blender. Latest version likely works.
blender_basename=$(basename $BLENDER_DL_URL)
if [[ ! -f $blender_basename ]]; then
    curl -O $BLENDER_DL_URL
    tar xf $blender_basename
    ln -sfn ${blender_basename%.tar.bz2} blender
    (cd blender && patch -p0 -s <../stl-export-blender.patch)
fi

# Create symlinks
ln -s ../OSM2World ../blender converter || true

# Install Python modules for AWS
pip install --target=converter/py-lib/boto3 boto3==1.2.2

# Install Python modules for Blender scripts
curl -o /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py
blender/$BLENDER_VERSION/python/bin/python* /tmp/get-pip.py
blender/$BLENDER_VERSION/python/bin/pip install --target=blender/$BLENDER_VERSION/python/lib/python3.5/svgwrite svgwrite==1.1.9

sudo pip install xlwt xlrd # for translation file conversions
sudo pip install awscli
apt install python3-cairosvg # for SVG to PDF conversion

# Install "jq" and "rename" for install/web-s3.sh
sudo apt install jq rename

# Compile OSM2World
make osm2world

echo "Finished"

