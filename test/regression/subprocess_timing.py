"""Keep subprocess execution and peak-memory units portable across Linux and macOS."""
import contextlib
import importlib.util
import io
import tempfile
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock, patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / 'converter'))
from converter import subprocess_timing as timing, telemetry

spec = importlib.util.spec_from_file_location('process_request', str(REPO / 'converter/process-request.py'))
assert spec is not None and spec.loader is not None
process_request = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {'boto3': types.ModuleType('boto3')}):
    spec.loader.exec_module(process_request)

LINUX_OUTPUT = 'child diagnostic\n\tMaximum resident set size (kbytes): 12345\n'
DARWIN_OUTPUT = 'child diagnostic\n        12641280  maximum resident set size\n'


class SubprocessTimingTests(unittest.TestCase):
    # Selecting an unavailable or unsupported timer must never prevent execution.
    def test_platform_selection(self):
        command = ['example', 'argument with spaces']
        for platform, available, expected in [
            ('linux', True, (['/usr/bin/time', '-v'] + command, 'linux')),
            ('darwin', True, (['/usr/bin/time', '-l'] + command, 'darwin')),
            ('linux', False, (command, None)),
            ('darwin', False, (command, None)),
            ('freebsd', True, (command, None)),
        ]:
            with self.subTest(platform=platform, available=available):
                with patch.object(timing.sys, 'platform', platform), \
                        patch.object(timing.os.path, 'exists', return_value=available):
                    self.assertEqual(timing.timed_command(command), expected)
                self.assertEqual(command, ['example', 'argument with spaces'])

    def test_rss_units_and_missing_statistics(self):
        for output, style, expected in [
            (LINUX_OUTPUT, 'linux', 12345),
            (DARWIN_OUTPUT, 'darwin', 12345),
            ('  12641281 maximum resident set size\n', 'darwin', 12345),
            ('Maximum resident set size (kbytes): 0\n', 'linux', 0),
            ('  0 maximum resident set size\n', 'darwin', 0),
            ('child diagnostic only\n', 'linux', None),
            ('Maximum resident set size (kbytes): invalid\n', 'linux', None),
            ('invalid maximum resident set size\n', 'darwin', None),
            (DARWIN_OUTPUT, 'linux', None),
            (LINUX_OUTPUT, 'darwin', None),
            (LINUX_OUTPUT, None, None),
        ]:
            with self.subTest(output=output, style=style):
                self.assertEqual(timing.parse_max_rss_kib(output, style), expected)

    # Both runners use KiB without changing the child's locale or encoding.
    def test_runners_normalize_rss_and_locale(self):
        command = ['example']
        for style, flag, stderr in [('linux', '-v', LINUX_OUTPUT),
                                    ('darwin', '-l', DARWIN_OUTPUT)]:
            timed = ['/usr/bin/time', flag] + command
            child = Mock(returncode=0)

            for module in (process_request, telemetry):
                with self.subTest(style=style, runner=module.__name__):
                    with patch.object(module, 'timed_command', return_value=(timed, style)), \
                            patch.object(module.subprocess, 'Popen', return_value=child) as popen, \
                            patch.object(module, 'stream_subprocess_output', return_value=(b'child output\n', stderr.encode('utf8'))), \
                            contextlib.redirect_stdout(io.StringIO()):
                        if module is process_request:
                            rss = module.run_subprocess_with_max_rss_kib(command)
                            self.assertNotIn('env', popen.call_args.kwargs,
                                             'request subprocesses must inherit the UTF-8 environment')
                        else:
                            result = module.TelemetryLogger('test').run_subprocess(
                                command, env={'LC_ALL': 'fi_FI.UTF-8', 'TIMING_TEST': 'preserved'})
                            rss = result['maxRssKiB']
                            self.assertIn('child output', result['output'])
                            self.assertIn('child diagnostic', result['output'])
                            self.assertEqual(popen.call_args.kwargs['env']['TIMING_TEST'], 'preserved')
                            self.assertEqual(popen.call_args.kwargs['env']['LC_ALL'], 'fi_FI.UTF-8')
                        self.assertEqual(rss, 12345)
                        self.assertEqual(popen.call_args.args[0], timed)

    # Real processes catch timer flags rejected by the host, and preserve child failures.
    def test_host_processes(self):
        command = [sys.executable, '-c',
                   'import sys; print("timing stdout"); sys.stderr.write("timing stderr\\n")']
        _, style = timing.timed_command(command)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            rss = process_request.run_subprocess_with_max_rss_kib(command)
            logger = telemetry.TelemetryLogger('test')
            result = logger.run_subprocess(command)
        self.assertIn('timing stdout', output.getvalue())
        self.assertIn('timing stdout', result['output'])
        self.assertIn('timing stderr', result['output'])
        self.assertEqual(result['returncode'], 0)
        for value in (rss, result['maxRssKiB']):
            if style:
                self.assertIsInstance(value, int)
                self.assertGreater(value, 0)
            else:
                self.assertIsNone(value)
        failing = [sys.executable, '-c', 'import sys; sys.stderr.write("child failure\\n"); sys.exit(7)']
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(Exception, r'command failed \(7\).*child failure'):
                process_request.run_subprocess_with_max_rss_kib(failing)
            with self.assertRaises(subprocess.CalledProcessError) as error:
                logger.run_subprocess(failing)
            self.assertEqual(error.exception.returncode, 7)
            self.assertIn('child failure', error.exception.output)
            result = logger.run_subprocess(failing, check=False)
        self.assertEqual(result['returncode'], 7)
        self.assertIn('child failure', result['output'])

    def test_streams_both_pipes_before_child_termination(self):
        import time
        import threading
        child = subprocess.Popen([sys.executable, '-c',
                                  'import os,time; os.write(1,b"live-out"); '
                                  'os.write(2,b"live-err"); time.sleep(10)'],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output = io.StringIO()
        result = []
        with contextlib.redirect_stdout(output):
            thread = threading.Thread(target=lambda: result.append(timing.stream_subprocess_output(child)))
            thread.start()
            deadline = time.monotonic() + 2
            while ('live-out' not in output.getvalue() or 'live-err' not in output.getvalue()) \
                    and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertIn('live-out', output.getvalue())
            self.assertIn('live-err', output.getvalue())
            self.assertIsNone(child.poll(), 'output must be visible before child exits')
            child.terminate()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertIn(b'live-out', result[0][0])
        self.assertIn(b'live-err', result[0][1])

    def test_required_output_file_is_complete_when_capture_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'full-output.log')
            child = subprocess.Popen([sys.executable, '-c',
                                      'import os; os.write(1,b"a"*1100000); os.write(2,b"b"*1100000)'],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            with contextlib.redirect_stdout(io.StringIO()):
                stdout, stderr = timing.stream_subprocess_output(child, output_log_path=path)
            self.assertEqual(child.returncode, 0)
            self.assertEqual(len(stdout), 1048576)
            self.assertEqual(len(stderr), 1048576)
            self.assertEqual(Path(path).stat().st_size, 2200000)
            self.assertEqual(Path(path).stat().st_mode & 0o777, 0o600)

    def test_untimed_fallback_executes_child(self):
        command = [sys.executable, '-c', 'print("untimed child")']
        output = io.StringIO()
        with patch.object(process_request, 'timed_command', return_value=(command, None)), \
                patch.object(telemetry, 'timed_command', return_value=(command, None)), \
                contextlib.redirect_stdout(output):
            self.assertIsNone(process_request.run_subprocess_with_max_rss_kib(command))
            result = telemetry.TelemetryLogger('test').run_subprocess(command)
        self.assertIn('untimed child', output.getvalue())
        self.assertEqual(result['returncode'], 0)
        self.assertIn('untimed child', result['output'])
        self.assertIsNone(result['maxRssKiB'])


if __name__ == '__main__':
    unittest.main()
