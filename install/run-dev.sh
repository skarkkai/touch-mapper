#!/bin/bash

script_dir="$( cd $(dirname "${BASH_SOURCE[0]}")/../converter && pwd )"
$script_dir/poller.sh dev 1

