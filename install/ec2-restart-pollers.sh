#!/bin/bash

set -e

export LC_ALL=en_US.UTF-8 # Else Python will fail with unicode

sudo killall -9 poller.sh process-request.py || true

cd ~/touch-mapper

for execmode in *; do
    test -d "$execmode/stats" || mkdir "$execmode/stats"
    for worker in $(seq 1 2); do
        work_dir="$(cd $execmode/runtime; pwd)/$worker"
        test -d $work_dir || mkdir $work_dir
        nohup $execmode/dist/poller.sh $execmode $worker &>>/tmp/touch-mapper-start-$execmode &
    done
done

echo "restarting complete"
