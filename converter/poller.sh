#!/bin/bash
# One long-running poller owns a numeric worker directory and a private daily log.

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 TM-ENVIRONMENT WORKER-NAME" >&2
    exit 1
fi
umask 077
dist_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
environment="$1"
worker_name="$2"
if [[ ! "$worker_name" =~ ^[0-9]+$ ]]; then
    echo "Worker name must be numeric" >&2
    exit 1
fi
environment_dir="$(cd "$dist_dir/.." && pwd)"
work_dir="$environment_dir/runtime/$worker_name"
mkdir -p "$work_dir" || exit 1
cd "$dist_dir" || exit 1

exec 200>"$work_dir/lockfile"
flock --exclusive --nonblock 200 || exit 1
stop_requested=0
trap 'stop_requested=1' TERM INT
current_log="$(python3 "$dist_dir/runner-log.py" "$environment_dir" "$worker_name")" || exit 1
exec >>"$current_log" 2>&1
export TM_POLLER_RUN_ID="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
revision="$(awk 'NR==1 {print $4}' VERSION.txt 2>/dev/null)"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO runner_start environment=$environment runner=$worker_name poller_run_id=$TM_POLLER_RUN_ID revision=${revision:-unknown}"
if [[ "$environment" == test || "$environment" == prod ]]; then
    dashboard_config="$environment_dir/dashboard.env"
    if [[ ! -f "$dashboard_config" ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARNING dashboard publication disabled: missing $dashboard_config" >&2
    fi
fi

while true; do
    if [[ $stop_requested -eq 1 ]]; then break; fi
    cd "$dist_dir" || exit 1
    next_log="$(python3 "$dist_dir/runner-log.py" "$environment_dir" "$worker_name")"
    log_status=$?
    if [[ $log_status -ne 0 || -z "$next_log" ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARNING runner log rotation failed; retaining $current_log" >&2
    elif [[ "$next_log" != "$current_log" ]]; then
        if : >>"$next_log"; then
            exec >>"$next_log" 2>&1
            current_log="$next_log"
            echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO runner_log_open path=$current_log"
        else
            echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) WARNING runner log rotation open failed; retaining $current_log" >&2
        fi
    fi
    attempt_id="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO attempt_start runner=$worker_name attempt_id=$attempt_id"
    PYTHONUNBUFFERED=true TM_ENVIRONMENT="$environment" TM_WORKER_NAME="$worker_name" TM_ATTEMPT_ID="$attempt_id" \
        timeout --kill-after=1s 10m ./process-request.py --poll-time 300 --work-dir "$work_dir"
    exit_code=$?
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO attempt_exit runner=$worker_name attempt_id=$attempt_id exit_code=$exit_code"
    if [[ $exit_code -eq 124 || $exit_code -eq 137 || $exit_code -eq 143 ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR attempt_terminated attempt_id=$attempt_id exit_code=$exit_code" >&2
    elif [[ $exit_code -ne 0 ]]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ERROR attempt_failed attempt_id=$attempt_id exit_code=$exit_code" >&2
    fi
done
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) INFO runner_stop environment=$environment runner=$worker_name poller_run_id=$TM_POLLER_RUN_ID"
