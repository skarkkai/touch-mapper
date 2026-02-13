#!/bin/bash

set -u

script_dir="$(cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd)"
default_work_dir="$script_dir/../runtime/1"
work_dir="$default_work_dir"
request_log=""
interval=1
top_n=25
include_dmesg=true
log_file=""

usage() {
    cat <<'EOF'
Usage: ./bin/monitor-converter.sh [options]

Streams converter diagnostics in one timestamped output:
- vmstat
- top RSS process snapshots
- free/swapon snapshots
- request.log / poller.log / latest-failure.log / prev-request.log tails
- kernel OOM lines (if readable)

Options:
  --work-dir PATH       Worker runtime directory (default: ../runtime/1)
  --request-log PATH    Explicit request log path (default: <work-dir>/request.log)
  --interval N          Sampling interval in seconds (default: 1)
  --top-n N             Number of process rows per snapshot (default: 25)
  --log-file PATH       Also write combined monitor output to PATH
  --no-dmesg            Skip kernel OOM stream
  -h, --help            Show this help
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --work-dir)
            work_dir="$2"
            shift 2
            ;;
        --request-log)
            request_log="$2"
            shift 2
            ;;
        --interval)
            interval="$2"
            shift 2
            ;;
        --top-n)
            top_n="$2"
            shift 2
            ;;
        --log-file)
            log_file="$2"
            shift 2
            ;;
        --no-dmesg)
            include_dmesg=false
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [[ -z "$request_log" ]]; then
    request_log="$work_dir/request.log"
fi

if ! [[ "$interval" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "--interval must be a positive number, got: $interval" >&2
    exit 1
fi

if ! [[ "$top_n" =~ ^[0-9]+$ ]]; then
    echo "--top-n must be an integer, got: $top_n" >&2
    exit 1
fi

if [[ -n "$log_file" ]]; then
    log_dir="$(dirname "$log_file")"
    mkdir -p "$log_dir"
    touch "$log_file"
    exec > >(tee -a "$log_file") 2>&1
fi

timestamp() {
    date '+%Y-%m-%dT%H:%M:%S%z'
}

log_line() {
    local source="$1"
    local line="$2"
    printf '%s [%s] %s\n' "$(timestamp)" "$source" "$line"
}

prefix_stream() {
    local source="$1"
    while IFS= read -r line; do
        log_line "$source" "$line"
    done
}

declare -a bg_pids=()

start_stream() {
    local source="$1"
    local script="$2"
    (
        bash -lc "$script" 2>&1 | prefix_stream "$source"
    ) &
    bg_pids+=("$!")
}

cleanup() {
    for pid in "${bg_pids[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

log_line "monitor" "Starting converter monitor"
log_line "monitor" "work_dir=$work_dir request_log=$request_log interval=${interval}s top_n=$top_n include_dmesg=$include_dmesg log_file=${log_file:-<none>}"
log_line "monitor" "Press Ctrl+C to stop"

request_log_q="$(printf '%q' "$request_log")"
poller_log="$work_dir/poller.log"
latest_failure_log="$work_dir/latest-failure.log"
prev_request_log="$work_dir/prev-request.log"
poller_log_q="$(printf '%q' "$poller_log")"
latest_failure_log_q="$(printf '%q' "$latest_failure_log")"
prev_request_log_q="$(printf '%q' "$prev_request_log")"
interval_q="$(printf '%q' "$interval")"
top_n_q="$(printf '%q' "$top_n")"
swapon_snapshot_cmd="echo 'swapon summary unavailable on this host'"
if swapon --show --noheadings --output NAME,SIZE,USED,PRIO >/dev/null 2>&1; then
    swapon_snapshot_cmd="swapon --show --noheadings --output NAME,SIZE,USED,PRIO"
elif swapon --show --noheadings >/dev/null 2>&1; then
    swapon_snapshot_cmd="swapon --show --noheadings"
elif swapon -s >/dev/null 2>&1; then
    swapon_snapshot_cmd="swapon -s"
fi
swapon_snapshot_cmd_q="$(printf '%q' "$swapon_snapshot_cmd")"

start_stream "vmstat" "vmstat -SM ${interval_q}"
start_stream "ps-top" "while true; do ps -eo pid,ppid,comm,rss,vsz,etime,pcpu,pmem,args --sort=-rss | head -n ${top_n_q}; echo '---'; sleep ${interval_q}; done"
start_stream "mem-swap" "while true; do free -m; bash -lc ${swapon_snapshot_cmd_q}; echo '---'; sleep ${interval_q}; done"
start_stream "request.log" "mkdir -p \"\$(dirname ${request_log_q})\"; touch ${request_log_q}; tail -n 200 -F ${request_log_q}"
start_stream "poller.log" "mkdir -p \"\$(dirname ${poller_log_q})\"; touch ${poller_log_q}; tail -n 200 -F ${poller_log_q}"
start_stream "latest-failure.log" "mkdir -p \"\$(dirname ${latest_failure_log_q})\"; touch ${latest_failure_log_q}; tail -n 120 -F ${latest_failure_log_q}"
start_stream "prev-request.log" "mkdir -p \"\$(dirname ${prev_request_log_q})\"; touch ${prev_request_log_q}; tail -n 120 -F ${prev_request_log_q}"

if [[ "$include_dmesg" == "true" ]]; then
    if dmesg --color=never -T >/dev/null 2>&1; then
        start_stream "kernel-oom" "dmesg --color=never -Tw | grep -Ei --line-buffered 'out of memory|oom-killer|killed process'"
    elif command -v sudo >/dev/null 2>&1 && sudo -n dmesg --color=never -T >/dev/null 2>&1; then
        start_stream "kernel-oom" "sudo -n dmesg --color=never -Tw | grep -Ei --line-buffered 'out of memory|oom-killer|killed process'"
    else
        log_line "monitor" "Skipping kernel OOM stream (dmesg not readable without privileges)"
    fi
fi

wait
