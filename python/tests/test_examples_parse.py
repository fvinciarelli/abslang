"""Every session under examples/ must parse and validate in the Python implementation."""

from pathlib import Path

import pytest

from abslang.parser import parse_multi

EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def _example_files():
    files = sorted(EXAMPLES.glob("*.yaml")) + sorted(EXAMPLES.glob("*.yml"))
    assert files, f"no example files found in {EXAMPLES}"
    return files


@pytest.mark.parametrize("path", _example_files(), ids=lambda p: p.name)
def test_example_parses(path: Path):
    sessions = parse_multi(path.read_text(encoding="utf-8"))
    assert sessions, f"{path.name} produced no sessions"
    for session in sessions:
        assert session.session
        assert session.behaviors
