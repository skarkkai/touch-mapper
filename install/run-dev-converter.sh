#!/bin/bash

cd "$( dirname "${BASH_SOURCE[0]}" )"
mkdir -p ../runtime
eval $( ./parameters.sh dev | egrep '^env_name=' )
cd ../converter
echo "Starting poller.sh for $env_name, see runtime/1/*.log"
echo "Stop by running: killall -9 poller.sh"
./poller.sh $env_name 1

