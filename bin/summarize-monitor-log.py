#!/usr/bin/env python3

import argparse
import datetime as dt
import re
from collections import defaultdict
from typing import Dict, List, Optional, Tuple


LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}(?:[ T])\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+\[(?P<src>[^\]]+)\]\s?(?P<msg>.*)$"
)
MEM_RE = re.compile(
    r"(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[(?P<comp>[^\]]+)\]\s+(?:>{2,}\s+)?)?MEMORY\s+(?P<stage>[^ ]+)\s+.*VmHWM=(?P<hwm>[0-9]+)kB"
)
PS_RE = re.compile(
    r"^\s*(?P<pid>[0-9]+)\s+(?P<ppid>[0-9]+)\s+(?P<comm>\S+)\s+(?P<rss>[0-9]+)\s+(?P<vsz>[0-9]+)\s+"
    r"(?P<etime>\S+)\s+(?P<pcpu>\S+)\s+(?P<pmem>\S+)\s+(?P<cmd>.+)$"
)
SWAP_RE = re.compile(
    r"Swap:\s+(?P<total>[0-9]+)\s+(?P<used>[0-9]+)\s+(?P<free>[0-9]+)"
)
POLL_START_RE = re.compile(r"STARTING TO POLL AT\s+(.+?)\s*=*$")
POLL_RETURN_RE = re.compile(r"Poll returned at\s+(.+)$")
PROC_MAIN_RE = re.compile(r"Processing main request took\s+([0-9.]+)")
PROC_ENTIRE_RE = re.compile(r"Processing entire request took\s+([0-9.]+)")
SUMMARY_ENTIRE_RE = re.compile(r"SUMMARY request-entire \(total\s+([0-9.]+)s,")
OSM2WORLD_IGNORED_RE = re.compile(
    r"java\.lang\.IllegalStateException: no connector information has been set for this representation\."
)
KERNEL_TS_IN_MSG_RE = re.compile(
    r"^\[(?P<kts>[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d\d:\d\d:\d\d\s+\d{4})\]"
)
PROGRESS_RE = re.compile(
    r"(?:\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\[(?P<component>[^\]]+)\]\s+(?:>{2,}\s+)?)?PROGRESS\s+(?P<stage>[^\s]+)"
)
KV_FIELD_RE = re.compile(r"(?P<key>[A-Za-z0-9_-]+)=(?P<value>\"(?:\\.|[^\"\\])*\"|[^\s]+)")


def parse_ts(raw: str) -> Optional[dt.datetime]:
    normalized_raw = raw
    tz_colon_match = re.search(r"([+-]\d{2}):(\d{2})$", normalized_raw)
    if tz_colon_match:
        normalized_raw = normalized_raw[:-6] + tz_colon_match.group(1) + tz_colon_match.group(2)

    formats = [
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
    ]
    for fmt in formats:
        try:
            parsed = dt.datetime.strptime(normalized_raw, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed
        except ValueError:
            continue
    if raw.endswith("Z"):
        normalized = raw[:-1] + "+0000"
        try:
            return dt.datetime.strptime(normalized, "%Y-%m-%dT%H:%M:%S.%f%z")
        except ValueError:
            pass
        try:
            return dt.datetime.strptime(normalized, "%Y-%m-%dT%H:%M:%S%z")
        except ValueError:
            pass
    return None


def parse_kv_fields(text: str) -> Dict[str, str]:
    values = {}  # type: Dict[str, str]
    for match in KV_FIELD_RE.finditer(text):
        key = match.group("key")
        value = match.group("value")
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            inner = value[1:-1]
            inner = inner.replace('\\"', '"').replace('\\\\', '\\')
            values[key] = inner
        else:
            values[key] = value
    return values


def mib(kib: int) -> float:
    return kib / 1024.0


def format_dt(value: Optional[dt.datetime]) -> str:
    if value is None:
        return "n/a"
    return value.isoformat()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize Touch Mapper monitor log output."
    )
    parser.add_argument(
        "log_path",
        nargs="?",
        default="/tmp/touch-mapper-monitor.log",
        help="Path to monitor log (default: /tmp/touch-mapper-monitor.log)",
    )
    parser.add_argument(
        "--show-failure-lines",
        type=int,
        default=12,
        help="How many recent failure-signal lines to show (default: 12)",
    )
    args = parser.parse_args()

    start_ts = None  # type: Optional[dt.datetime]
    end_ts = None  # type: Optional[dt.datetime]
    line_count = 0

    mem_peaks = {}  # type: Dict[str, Tuple[int, int, dt.datetime, str, str]]
    # comp -> (hwm_kib, line_no, ts, stage, full_line)

    max_swap_used = -1
    max_swap_total = -1
    max_swap_line = ""

    max_si = -1
    max_si_line = ""
    max_so = -1
    max_so_line = ""

    max_rss_by_comm = {}  # type: Dict[str, Tuple[int, int, dt.datetime, str]]
    # comm -> (rss_kib, line_no, ts, full_line)

    ps_counts_by_ts = defaultdict(
        lambda: {"process_request": 0, "osm2world": 0, "blender": 0}
    )  # type: Dict[dt.datetime, Dict[str, int]]
    max_rss_osm2world = (0, "", None)  # rss_kib, full_line, ts
    max_rss_blender = (0, "", None)  # rss_kib, full_line, ts
    max_rss_process_request = (0, "", None)  # rss_kib, full_line, ts

    poll_starts = []  # type: List[str]
    poll_returns = []  # type: List[str]
    main_durations = []  # type: List[float]
    entire_durations = []  # type: List[float]
    summary_entire_durations = []  # type: List[float]
    ignored_connector_exception_count = 0

    kernel_oom_lines = []  # type: List[Tuple[Optional[dt.datetime], str, Optional[dt.datetime]]]
    failure_signal_lines = []  # type: List[Tuple[Optional[dt.datetime], str]]
    progress_events = []  # type: List[Tuple[int, Optional[dt.datetime], str, str, str, Optional[str], Optional[str], str]]

    failure_patterns = [
        re.compile(r"process-request failed", re.IGNORECASE),
        re.compile(r"Can't convert map data to STL", re.IGNORECASE),
        re.compile(r"request processing failed", re.IGNORECASE),
        re.compile(r"subprocess failed with error code", re.IGNORECASE),
        re.compile(r"timeout", re.IGNORECASE),
        re.compile(r"timed out", re.IGNORECASE),
        re.compile(r"\bTraceback\b"),
        re.compile(r"\bKilled process\b"),
        re.compile(r"\bOut of memory\b"),
        re.compile(r"\bTerminated\b.*timeout .*process-request\.py"),
    ]

    with open(args.log_path, "r", encoding="utf-8", errors="replace") as handle:
        for raw_line in handle:
            line_count += 1
            line = raw_line.rstrip("\n")

            m_line = LINE_RE.match(line)
            if not m_line:
                continue

            ts = parse_ts(m_line.group("ts"))
            src = m_line.group("src")
            msg = m_line.group("msg")
            if ts is not None:
                if start_ts is None or ts < start_ts:
                    start_ts = ts
                if end_ts is None or ts > end_ts:
                    end_ts = ts

            m_mem = MEM_RE.search(msg)
            if m_mem and ts is not None:
                comp = m_mem.group("comp") or src
                stage = m_mem.group("stage")
                hwm_kib = int(m_mem.group("hwm"))
                prev = mem_peaks.get(comp)
                if prev is None or hwm_kib > prev[0]:
                    mem_peaks[comp] = (hwm_kib, line_count, ts, stage, line)

            if src == "mem-swap":
                m_swap = SWAP_RE.search(msg)
                if m_swap:
                    used = int(m_swap.group("used"))
                    total = int(m_swap.group("total"))
                    if used > max_swap_used:
                        max_swap_used = used
                        max_swap_total = total
                        max_swap_line = line

            if src == "vmstat":
                cols = msg.split()
                if cols and cols[0].isdigit() and len(cols) >= 8:
                    si = int(cols[6])
                    so = int(cols[7])
                    if si > max_si:
                        max_si = si
                        max_si_line = line
                    if so > max_so:
                        max_so = so
                        max_so_line = line

            if src == "ps-top":
                m_ps = PS_RE.match(msg)
                if m_ps and ts is not None:
                    comm = m_ps.group("comm")
                    rss_kib = int(m_ps.group("rss"))
                    cmd = m_ps.group("cmd")

                    prev_comm = max_rss_by_comm.get(comm)
                    if prev_comm is None or rss_kib > prev_comm[0]:
                        max_rss_by_comm[comm] = (rss_kib, line_count, ts, line)

                    if "process-request.py" in cmd:
                        ps_counts_by_ts[ts]["process_request"] += 1
                        if rss_kib > max_rss_process_request[0]:
                            max_rss_process_request = (rss_kib, line, ts)
                    if "OSM2World.jar" in cmd:
                        ps_counts_by_ts[ts]["osm2world"] += 1
                        if rss_kib > max_rss_osm2world[0]:
                            max_rss_osm2world = (rss_kib, line, ts)
                    if "/blender/blender" in cmd and "obj-to-tactile.py" in cmd:
                        ps_counts_by_ts[ts]["blender"] += 1
                        if rss_kib > max_rss_blender[0]:
                            max_rss_blender = (rss_kib, line, ts)

            if src == "request.log":
                m_poll_start = POLL_START_RE.search(msg)
                if m_poll_start:
                    poll_starts.append(m_poll_start.group(1))
                m_poll_return = POLL_RETURN_RE.search(msg)
                if m_poll_return:
                    poll_returns.append(m_poll_return.group(1))
                m_main = PROC_MAIN_RE.search(msg)
                if m_main:
                    main_durations.append(float(m_main.group(1)))
                m_entire = PROC_ENTIRE_RE.search(msg)
                if m_entire:
                    entire_durations.append(float(m_entire.group(1)))
                m_summary_entire = SUMMARY_ENTIRE_RE.search(msg)
                if m_summary_entire:
                    summary_entire_durations.append(float(m_summary_entire.group(1)))
                if OSM2WORLD_IGNORED_RE.search(msg):
                    ignored_connector_exception_count += 1

            m_progress = PROGRESS_RE.search(msg)
            if m_progress:
                fields = parse_kv_fields(msg)
                status = fields.get("status")
                request_id = fields.get("requestId")
                component = m_progress.group("component") or src
                progress_events.append(
                    (
                        line_count,
                        ts,
                        src,
                        component,
                        m_progress.group("stage"),
                        status,
                        request_id,
                        line,
                    )
                )

            if src == "kernel-oom":
                kernel_ts = None  # type: Optional[dt.datetime]
                m_kernel_ts = KERNEL_TS_IN_MSG_RE.match(msg)
                if m_kernel_ts:
                    try:
                        kernel_ts = dt.datetime.strptime(
                            m_kernel_ts.group("kts"),
                            "%a %b %d %H:%M:%S %Y"
                        )
                    except ValueError:
                        kernel_ts = None
                kernel_oom_lines.append((ts, line, kernel_ts))

            if any(pattern.search(msg) for pattern in failure_patterns):
                failure_signal_lines.append((ts, line))

    recent_window_seconds = 30
    recent_cutoff = None  # type: Optional[dt.datetime]
    if end_ts is not None:
        recent_cutoff = end_ts - dt.timedelta(seconds=recent_window_seconds)

    def is_recent(entry_ts: Optional[dt.datetime]) -> bool:
        if recent_cutoff is None or entry_ts is None:
            return False
        return entry_ts >= recent_cutoff

    max_concurrency = {
        "process_request": (0, None),
        "osm2world": (0, None),
        "blender": (0, None),
    }  # type: Dict[str, Tuple[int, Optional[dt.datetime]]]
    for ts, counts in ps_counts_by_ts.items():
        for key in max_concurrency:
            if counts[key] > max_concurrency[key][0]:
                max_concurrency[key] = (counts[key], ts)

    print("Monitor Log Summary")
    print("log_path: {}".format(args.log_path))
    print("lines: {}".format(line_count))
    print("time_range: {} .. {}".format(format_dt(start_ts), format_dt(end_ts)))

    print("\nRequest Flow")
    print("poll_starts: {}".format(len(poll_starts)))
    if poll_starts:
        print("last_poll_start: {}".format(poll_starts[-1]))
    print("poll_returns: {}".format(len(poll_returns)))
    if poll_returns:
        print("last_poll_return: {}".format(poll_returns[-1]))
    print("processing_main_count: {}".format(len(main_durations)))
    if main_durations:
        print("processing_main_last_seconds: {:.3f}".format(main_durations[-1]))
    print("processing_entire_count: {}".format(len(entire_durations)))
    if entire_durations:
        print("processing_entire_last_seconds: {:.3f}".format(entire_durations[-1]))
    print("summary_request_entire_count: {}".format(len(summary_entire_durations)))
    if summary_entire_durations:
        print("summary_request_entire_last_seconds: {:.3f}".format(summary_entire_durations[-1]))
    print("osm2world_ignored_connector_exceptions: {}".format(ignored_connector_exception_count))

    print("\nConverter Stage Markers")
    print("progress_markers_total: {}".format(len(progress_events)))
    request_progress = list(progress_events)
    print("request_progress_markers: {}".format(len(request_progress)))
    if request_progress:
        last_event = request_progress[-1]
        last_line_no, last_ts, last_src, _last_component, last_stage, last_status, last_request_id, last_line = last_event
        print(
            "last_request_stage: {} (status={}, ts={}, src={}, line={})".format(
                last_stage,
                (last_status if last_status is not None else "n/a"),
                format_dt(last_ts),
                last_src,
                last_line_no,
            )
        )
        if last_request_id is not None:
            print("last_request_id: {}".format(last_request_id))
        print("  {}".format(last_line))

        saw_complete = any(event[4] == "complete" for event in request_progress)
        saw_failed = any(event[4] == "failed" for event in request_progress)
        saw_exit = any(event[4] == "exit" for event in request_progress)
        saw_signal = any(event[4] == "signal-received" for event in request_progress)
        print("request_saw_complete_marker: {}".format(saw_complete))
        print("request_saw_failed_marker: {}".format(saw_failed))
        print("request_saw_exit_marker: {}".format(saw_exit))
        print("request_saw_signal_marker: {}".format(saw_signal))

        non_exit_request_progress = [event for event in request_progress if event[4] != "exit"]
        if non_exit_request_progress:
            last_non_exit = non_exit_request_progress[-1]
            print(
                "likely_last_completed_stage_before_stop: {} (ts={}, src={}, line={})".format(
                    last_non_exit[4],
                    format_dt(last_non_exit[1]),
                    last_non_exit[2],
                    last_non_exit[0],
                )
            )
            print("  {}".format(last_non_exit[7]))
    else:
        print("No request stage markers found in this log.")

    print("\nMemory Peaks (VmHWM from MEMORY lines)")
    if not mem_peaks:
        print("no MEMORY lines found")
    else:
        for comp in sorted(mem_peaks):
            hwm_kib, line_no, ts, stage, full_line = mem_peaks[comp]
            print(
                "{}: {:.1f} MiB at stage={} (line {}, ts={})".format(
                    comp,
                    mib(hwm_kib),
                    stage,
                    line_no,
                    format_dt(ts),
                )
            )
            print("  {}".format(full_line))

    print("\nProcess RSS Peaks (ps-top sampled)")
    for label, peak in [
        ("osm2world_java", max_rss_osm2world),
        ("blender_obj_to_tactile", max_rss_blender),
        ("process_request", max_rss_process_request),
    ]:
        rss_kib, full_line, ts = peak
        if rss_kib <= 0:
            print("{}: n/a".format(label))
        else:
            print("{}: {:.1f} MiB (ts={})".format(label, mib(rss_kib), format_dt(ts)))
            print("  {}".format(full_line))

    print("\nConcurrency Peaks (ps-top sampled)")
    for key in ["process_request", "osm2world", "blender"]:
        count, ts = max_concurrency[key]
        print("{}: {} at {}".format(key, count, format_dt(ts)))

    print("\nSwap/VMStat")
    if max_swap_used >= 0:
        print("max_swap_used: {} MiB / {} MiB".format(max_swap_used, max_swap_total))
        print("  {}".format(max_swap_line))
    else:
        print("max_swap_used: n/a")
    print("max_vmstat_si: {}".format(max_si if max_si >= 0 else "n/a"))
    if max_si_line:
        print("  {}".format(max_si_line))
    print("max_vmstat_so: {}".format(max_so if max_so >= 0 else "n/a"))
    if max_so_line:
        print("  {}".format(max_so_line))

    print("\nFailure/OOM Signals")
    recent_kernel_oom = [line for ts, line, _kts in kernel_oom_lines if is_recent(ts)]
    same_day_kernel_oom = 0
    if end_ts is not None:
        for _ts, _line, kernel_ts in kernel_oom_lines:
            if kernel_ts is not None and kernel_ts.date() == end_ts.date():
                same_day_kernel_oom += 1
    print("kernel_oom_lines_captured_total: {}".format(len(kernel_oom_lines)))
    print("kernel_oom_lines_same_day_as_capture: {}".format(same_day_kernel_oom))
    print(
        "kernel_oom_lines_recent_{}s: {}".format(
            recent_window_seconds, len(recent_kernel_oom)
        )
    )
    if kernel_oom_lines:
        print("latest_kernel_oom_line: {}".format(kernel_oom_lines[-1][1]))
    recent_failure_signals = [line for ts, line in failure_signal_lines if is_recent(ts)]
    print("failure_signal_lines_total: {}".format(len(failure_signal_lines)))
    print(
        "failure_signal_lines_recent_{}s: {}".format(
            recent_window_seconds, len(recent_failure_signals)
        )
    )
    lines_to_show = recent_failure_signals[-args.show_failure_lines:]
    if not lines_to_show:
        lines_to_show = [line for _ts, line in failure_signal_lines[-args.show_failure_lines:]]
    for line in lines_to_show:
        print(line)

    request_progress_complete = any(event[4] == "complete" for event in request_progress)
    request_progress_last_non_exit_stage = None  # type: Optional[str]
    non_exit_request_progress = [event for event in request_progress if event[4] != "exit"]
    if non_exit_request_progress:
        request_progress_last_non_exit_stage = non_exit_request_progress[-1][4]

    print("\nLikely Cause Hints")
    recent_failure_signal_lines = [line for ts, line in failure_signal_lines if is_recent(ts)]
    likely_timeout = any("timeout" in line.lower() for line in recent_failure_signal_lines)
    likely_oom = (
        (max_si > 0 or max_so > 0 or (max_swap_total > 0 and max_swap_used / max_swap_total > 0.85))
        and same_day_kernel_oom > 0
    )
    if likely_oom:
        print("- OOM pressure signals present (swap/io + kernel oom lines).")
    else:
        print("- OOM not strongly indicated in this capture window.")
    if likely_timeout:
        print("- Timeout-related signals present.")
    else:
        print("- No strong timeout signal detected in failure patterns.")
    if request_progress and not request_progress_complete:
        print(
            "- Converter appears to stop before completion. Last stage marker: {}.".format(
                request_progress_last_non_exit_stage or "n/a"
            )
        )
    if entire_durations:
        print("- At least one request completed end-to-end during this capture.")
    else:
        print("- No full request completion line detected.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
