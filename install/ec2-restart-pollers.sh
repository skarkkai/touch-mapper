#!/bin/bash
# Boot-time bulk launcher. For a controlled deployment restart, use the per-runner commands in doc/development-setup.md.
set -e
umask 077
export LC_ALL=en_US.UTF-8
sudo killall -9 poller.sh process-request.py || true
base_dir="$(cd "$(dirname "$0")/../.." && pwd)"
for execmode in test prod; do
    if [[ "$execmode" == test ]]; then worker_count=1; else worker_count=3; fi
    for worker in $(seq 1 "$worker_count"); do
        environment_dir="$base_dir/$execmode"
        mkdir -p "$environment_dir/runtime/$worker"
        if [[ -f "$environment_dir/dist/runner-log.py" ]]; then
            log_path="$(python3 "$environment_dir/dist/runner-log.py" "$environment_dir" "$worker")"
        else
            # A test-first rollout may reboot before production has the new helper.
            log_path="$environment_dir/runtime/$worker/poller.log"
            : >>"$log_path"
            chmod 600 "$log_path"
            echo "WARNING: $execmode still has the previous distribution; using its legacy poller log" >&2
        fi
        nohup "$environment_dir/dist/poller.sh" "$execmode" "$worker" >>"$log_path" 2>&1 &
    done
done
echo "started one test runner and three production runners"
