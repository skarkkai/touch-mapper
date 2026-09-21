"""Prove the real temporary-artifact helper works without executable permission."""
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]


# A copied checkout must still create and clean artifacts through its interpreter.
def main():
    fixture = Path(sys.argv[1]) / 'tmpctl-checkout'
    (fixture / 'bin').mkdir(parents=True)
    helper = fixture / 'bin/tmpctl'
    shutil.copyfile(str(REPO / 'bin/tmpctl'), str(helper))
    helper.chmod(0o644)
    assert helper.stat().st_mode & 0o111 == 0
    subprocess.run([sys.executable, str(helper), 'mkdir', '.tmp/nested/artifacts'], check=True)
    artifacts = fixture / '.tmp/nested/artifacts'
    assert artifacts.is_dir()
    (artifacts / 'proof.txt').write_text('artifact')
    subprocess.run([sys.executable, str(helper), 'rm', '.tmp/nested'], check=True)
    assert not artifacts.parent.exists()
    # Explicit interpretation must preserve the helper's safety boundary too.
    result = subprocess.run([sys.executable, str(helper), 'mkdir', 'outside'],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert result.returncode != 0
    assert not (fixture / 'outside').exists()
    print('temporary artifact helper regression passed')


if __name__ == '__main__':
    main()
