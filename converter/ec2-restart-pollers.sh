#!/bin/bash

set -e

export LC_ALL=en_US.UTF-8 # Else Python will fail with unicode

dirname="$( dirname $(readlink -f "$0") )"
execmode=$( curl -s http://169.254.169.254/latest/user-data | egrep '^execmode:' | cut -d : -f 2 )
cores=$( nproc )

cd $dirname

sudo killall -9 poller.sh process-request.py || true

for worker in $(seq 1 $[cores * 3]); do
    work_dir="$(cd $dirname/../runtime; pwd)/$worker"
    test -d $work_dir || mkdir $work_dir
    nohup $dirname/poller.sh $execmode $worker &>>/tmp/touch-mapper-start &
done

echo "restarting complete"

