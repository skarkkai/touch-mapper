#!/bin/bash
#
# Run me at boot or periodically from cron, I will exit if I'm already running.
#

VERBOSE=true
INSTRUMENTATION_ENABLED=false

case "${TOUCH_MAPPER_INSTRUMENTATION:-}" in
  1|[Tt][Rr][Uu][Ee]|[Yy][Ee][Ss]|[Oo][Nn])
    INSTRUMENTATION_ENABLED=true
    ;;
esac

dirname="$( dirname "${BASH_SOURCE[0]}" )"

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 TM-ENVIRONMENT WORKER-NAME" >&2
    exit 1
fi

environment="$1"
worker_name="$2"
work_dir="$(cd $dirname/../runtime; pwd)/$worker_name"

if [[ ! -d "$work_dir" ]]; then
  if ! mkdir "$work_dir"; then
    echo "can't create $work_dir" >&2
    exit 1
  fi
fi

cd $dirname
(
  flock --exclusive --nonblock 200 || exit 1
  echo $$ >&200
  echo "Starting at $(date --utc --rfc-3339=seconds) as worker $worker_name with environment=$environment"

  # Keep the loop as simple as possible to minimize chance of this process ever exiting
  while true; do
      cd .  # "dist" may have just been replaced due to version update
      PYTHONUNBUFFERED=true TM_ENVIRONMENT=$environment timeout --kill-after=1s 10m ./process-request.py --poll-time 300 --work-dir "$work_dir" &> "$work_dir/request.log"
      exit_code=$?

      if [[ "$INSTRUMENTATION_ENABLED" == "true" ]]; then
        last_progress_line="$(grep -E 'PROGRESS:process-request:' "$work_dir/request.log" | tail -n 1 || true)"
        if [[ -n "$last_progress_line" ]]; then
          echo "last progress marker before poller loop iteration end: $last_progress_line"
        else
          echo "last progress marker before poller loop iteration end: <none found>"
        fi

        if [[ $exit_code -eq 124 ]]; then
          echo "request processing exited with timeout (10m hard limit): exit_code=$exit_code" >&2
        elif [[ $exit_code -eq 137 ]]; then
          echo "request processing exited with SIGKILL (likely timeout --kill-after or external kill): exit_code=$exit_code" >&2
        elif [[ $exit_code -eq 143 ]]; then
          echo "request processing exited with SIGTERM: exit_code=$exit_code" >&2
        fi
      fi

      cp "$work_dir/request.log" "$work_dir/prev-request.log"
      if [[ "$INSTRUMENTATION_ENABLED" == "true" ]]; then
        if [[ $exit_code -ne 0 ]]; then
          $VERBOSE && echo "request processing failed" >&2
          cp "$work_dir/request.log" "$work_dir/latest-failure.log"
        fi
      else
        if [[ $? -ne 0 ]]; then
          $VERBOSE && echo "request processing failed" >&2
          cp "$work_dir/request.log" "$work_dir/latest-failure.log"
        fi
      fi
  done

) 200>"$work_dir/lockfile" &>"$work_dir/poller.log"
