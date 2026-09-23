"""Check concise regression reporting and preserved failure diagnostics."""
from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import sys

import run


def main():
    work = Path(sys.argv[1]) / 'runner-reporting'
    work.mkdir()
    passed = [('Sample check', [sys.executable, '-c', "print('check output')"])]

    output = io.StringIO()
    with redirect_stdout(output):
        assert run.run_checks(passed, work)
    assert output.getvalue() == '', output.getvalue()
    assert (work / 'Sample-check.log').read_text() == 'check output\n'

    output = io.StringIO()
    with redirect_stdout(output):
        assert run.run_checks(passed, work, verbose=True)
    assert 'RUN Sample check\n' in output.getvalue(), output.getvalue()
    assert 'PASS Sample check (' in output.getvalue(), output.getvalue()

    failed = [('Broken check', [sys.executable, '-c',
                                "import sys; print('diagnostic detail'); sys.exit(7)"])]
    error = io.StringIO()
    with redirect_stderr(error):
        assert not run.run_checks(failed, work)
    assert 'FAIL Broken check (exit 7)' in error.getvalue(), error.getvalue()
    assert 'diagnostic detail' in error.getvalue(), error.getvalue()
    assert str(work) in error.getvalue(), error.getvalue()
    assert (work / 'Broken-check.log').read_text() == 'diagnostic detail\n'


if __name__ == '__main__':
    main()
