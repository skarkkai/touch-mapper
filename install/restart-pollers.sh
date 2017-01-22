#!/bin/bash

set -e

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 TM-ENVIRONMENT INSTALL-DIR" >&2
    exit 1
fi

environment=$1
install_dir=$2

if [[ ! -x $install_dir/dist/poller.sh ]]; then
  echo "$install_dir/dist/poller.sh not found or not executable" >&2
  exit 1
fi

for worker_name in $( ls -1 $install_dir/runtime | egrep '^[0-9]+$' ); do
  cmd="$install_dir/dist/poller.sh $environment $worker_name"
  echo "Restarting $cmd"
  worker_dir=$install_dir/runtime/$worker_name
  rm -rf $worker_dir.old* || true
  mv $worker_dir $worker_dir.old.$$
  lockfile=$worker_dir.old/lockfile
  if [[ -r $lockfile ]] && ! flock --nonblock $lockfile true; then
    # Lockfile exists and is locked
    pid=$( cat $lockfile )
    pgid=$( < /proc/$pid/stat sed -n '$s/.*) [^ ]* [^ ]* \([^ ]*\).*/\1/p' || true )
    if [[ -n "$pgid" ]]; then
      echo "Killing process group $pgid of process $pid for $lockfile"
      kill -9 -$pgid || true
      sleep 1
    fi
  fi
  $cmd >/dev/null &
done
echo "Restarting finished"
