#!/bin/bash

set -e

cd ~/touch-mapper
nice tar czf /tmp/dist.tgz dist
nice aws s3 cp /tmp/dist.tgz s3://meta.touch-mapper/converter-dist.tgz
