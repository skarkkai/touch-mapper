#!/usr/bin/python3

import datetime
import json
import os
import re
import shlex
import subprocess
import time
from typing import Any, Dict, List, Optional


_MAX_RSS_RE = re.compile(r"Maximum resident set size \(kbytes\):\s*([0-9]+)")
_WHITESPACE_RE = re.compile(r"\s")


def utc_ts_fixed() -> str:
    # Fixed-width UTC timestamp without timezone suffix.
    return datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _format_max_rss_mib(max_rss_kib: Optional[int]) -> str:
    if max_rss_kib is None:
        return "n/a"
    return "{:.1f} MiB".format(float(max_rss_kib) / 1024.0)


def _max_opt(a: Optional[int], b: Optional[int]) -> Optional[int]:
    if a is None:
        return b
    if b is None:
        return a
    return a if a >= b else b


def _format_command(cmd: List[str], env: Optional[Dict[str, str]]) -> str:
    rendered_cmd = " ".join(shlex.quote(part) for part in cmd)
    if not env:
        return rendered_cmd
    rendered_env = ",".join(
        "{}={}".format(key, shlex.quote(env[key])) for key in sorted(env.keys())
    )
    return "{} env={}".format(rendered_cmd, rendered_env)


class TelemetryLogger(object):
    def __init__(self, component: str, base_depth: int = 0):
        self.component = component
        self.base_depth = base_depth
        self.started_at_utc = utc_ts_fixed()
        self.ended_at_utc = None  # type: Optional[str]
        self._stack = []  # type: List[Dict[str, Any]]
        self._roots = []  # type: List[Dict[str, Any]]
        self._warned_time_unavailable = False

    def _marker(self, depth: int) -> str:
        if depth <= 0:
            return ""
        return ">>" * depth

    def _line(self, component: str, depth: int, message: str) -> None:
        marker = self._marker(depth)
        infix = (" " + marker + " ") if marker else " "
        print("{} [{}]{}{}".format(utc_ts_fixed(), component, infix, message))

    def _default_component(self) -> str:
        if self._stack:
            return str(self._stack[-1].get("component", self.component))
        return self.component

    def _escape_field_value(self, value: str) -> str:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        if _WHITESPACE_RE.search(value):
            return '"' + escaped + '"'
        return escaped

    def _format_fields(self, fields: Optional[Dict[str, Any]]) -> str:
        if not fields:
            return ""
        parts = []  # type: List[str]
        for key in sorted(fields.keys()):
            value = fields[key]
            if value is None:
                continue
            value_text = self._escape_field_value(str(value))
            parts.append("{}={}".format(key, value_text))
        return " ".join(parts)

    def log(
        self,
        message: str,
        depth: Optional[int] = None,
        component: Optional[str] = None,
        fields: Optional[Dict[str, Any]] = None,
    ) -> None:
        rendered = message
        rendered_fields = self._format_fields(fields)
        if rendered_fields:
            rendered = "{} {}".format(rendered, rendered_fields)
        if depth is None:
            depth = self.current_inline_depth()
        self._line(component or self._default_component(), depth, rendered)

    def current_inline_depth(self) -> int:
        # Depth to use for lines emitted inside the currently active stage.
        if self._stack:
            return self.base_depth + len(self._stack)
        return self.base_depth

    def start_stage(self, name: str, component: Optional[str] = None) -> Dict[str, Any]:
        stage_component = component or self.component
        depth = self.base_depth + len(self._stack)
        stage = {
            "name": name,
            "component": stage_component,
            "depth": depth,
            "startedAtUtc": utc_ts_fixed(),
            "startPerf": time.perf_counter(),
            "childSec": 0.0,
            "childMaxRssKiB": None,  # type: Optional[int]
            "children": [],
        }  # type: Dict[str, Any]
        self._line(stage_component, depth, "START " + name)
        self._stack.append(stage)
        return stage

    def attach_external_child(self, stage: Dict[str, Any], child: Dict[str, Any]) -> None:
        total_sec = float(child.get("totalSec", 0.0))
        stage["childSec"] += total_sec
        stage["children"].append(child)
        child_rss = child.get("maxRssKiB")
        if isinstance(child_rss, int):
            stage["childMaxRssKiB"] = _max_opt(stage["childMaxRssKiB"], child_rss)

    def end_stage(self, stage: Dict[str, Any], own_max_rss_kib: Optional[int] = None) -> Dict[str, Any]:
        if not self._stack or self._stack[-1] is not stage:
            raise RuntimeError("Stage stack mismatch for '{}'".format(stage.get("name")))
        self._stack.pop()

        total_sec = time.perf_counter() - float(stage["startPerf"])
        child_sec = float(stage["childSec"])
        self_sec = total_sec - child_sec
        if self_sec < 0:
            self_sec = 0.0

        max_rss_kib = _max_opt(own_max_rss_kib, stage.get("childMaxRssKiB"))
        node = {
            "name": stage["name"],
            "component": stage["component"],
            "startedAtUtc": stage["startedAtUtc"],
            "endedAtUtc": utc_ts_fixed(),
            "totalSec": total_sec,
            "selfSec": self_sec,
            "childSec": child_sec,
            "maxRssKiB": max_rss_kib,
            "children": stage["children"],
        }  # type: Dict[str, Any]

        self._line(
            stage["component"],
            int(stage["depth"]),
            "DONE {} (total {:.2f}s, self {:.2f}s, child {:.2f}s, maxRSS {})".format(
                stage["name"],
                total_sec,
                self_sec,
                child_sec,
                _format_max_rss_mib(max_rss_kib),
            ),
        )

        if self._stack:
            parent = self._stack[-1]
            parent["childSec"] += total_sec
            parent["childMaxRssKiB"] = _max_opt(parent["childMaxRssKiB"], max_rss_kib)
            parent["children"].append(node)
        else:
            self._roots.append(node)
        return node

    def run_subprocess(
        self,
        cmd: List[str],
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
        output_log_path: Optional[str] = None,
        depth_offset: int = 0,
        component: Optional[str] = None,
        check: bool = True,
    ) -> Dict[str, Any]:
        stage_component = component or self._default_component()
        if self._stack:
            base_depth = int(self._stack[-1]["depth"])
        else:
            base_depth = self.base_depth
        depth = base_depth + depth_offset

        self._line(stage_component, depth, "running: " + _format_command(cmd, env))

        run_env = os.environ.copy()
        if env:
            run_env.update(env)

        timed_cmd = cmd
        using_time = False
        if os.path.exists("/usr/bin/time"):
            timed_cmd = ["/usr/bin/time", "-v"] + cmd
            using_time = True
        else:
            if not self._warned_time_unavailable:
                self._warned_time_unavailable = True
                self._line(
                    stage_component,
                    depth,
                    "note: /usr/bin/time not available, subprocess maxRSS unavailable",
                )

        started = time.perf_counter()
        process = subprocess.Popen(
            timed_cmd,
            cwd=cwd,
            env=run_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout_data, stderr_data = process.communicate()
        elapsed_sec = time.perf_counter() - started

        stdout_text = stdout_data.decode("utf-8", errors="replace")
        stderr_text = stderr_data.decode("utf-8", errors="replace")
        combined_output = stdout_text + stderr_text

        max_rss_kib = None  # type: Optional[int]
        if using_time:
            match = _MAX_RSS_RE.search(stderr_text)
            if match:
                try:
                    max_rss_kib = int(match.group(1))
                except Exception:
                    max_rss_kib = None

        if output_log_path:
            with open(output_log_path, "w", encoding="utf-8") as handle:
                handle.write(combined_output)

        result = {
            "returncode": process.returncode,
            "elapsedSec": elapsed_sec,
            "maxRssKiB": max_rss_kib,
            "output": combined_output,
        }
        if check and process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, cmd, output=combined_output)
        return result

    def finalize(self) -> None:
        self.ended_at_utc = utc_ts_fixed()

    def summary_payload(self, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = {
            "version": 1,
            "component": self.component,
            "startedAtUtc": self.started_at_utc,
            "endedAtUtc": (self.ended_at_utc or utc_ts_fixed()),
            "stages": self._roots,
        }  # type: Dict[str, Any]
        if extra:
            payload.update(extra)
        return payload

    def write_json(self, output_path: str, extra: Optional[Dict[str, Any]] = None) -> None:
        self.finalize()
        payload = self.summary_payload(extra=extra)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
