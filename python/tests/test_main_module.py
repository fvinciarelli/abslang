"""`python -m abslang` must work (parity with the `abslang` console script)."""

import os
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"


def test_python_m_abslang_runs():
    env = {**os.environ}
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(SRC), env.get("PYTHONPATH", "")]))

    proc = subprocess.run(
        [sys.executable, "-m", "abslang", "--version"],
        capture_output=True,
        text=True,
        env=env,
    )

    assert proc.returncode == 0, proc.stderr
    assert "ABS CLI" in proc.stdout
    assert "version" in proc.stdout
