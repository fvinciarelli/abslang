"""Regression — `when`-gated evaluations must run in real CLI invocations."""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from http_mock import send_json

AGENT_ASKS = "Please provide your order number"
SRC = Path(__file__).resolve().parents[1] / "src"


def _run_cli(session_path: Path, agent_url: str) -> dict:
    env = {**os.environ}
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(SRC), env.get("PYTHONPATH", "")]))
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            "from abslang.cli import main; main()",
            "run",
            str(session_path),
            "--agent",
            agent_url,
            "--format",
            "json",
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.stdout, f"CLI produced no stdout. stderr: {proc.stderr}"
    return json.loads(proc.stdout)


def _write_fixture(has_order_id: bool) -> Path:
    directory = Path(tempfile.mkdtemp(prefix="abs-when-"))
    dataset = directory / "cases.jsonl"
    dataset.write_text(
        json.dumps({"userQuery": "El estado de la orden #8291", "hasOrderId": has_order_id}) + "\n"
    )
    session = directory / "when.abs.yaml"
    session.write_text(
        f"""session: When gating
abs_version: "0.2"
dataset:
  id: cases
  path: {dataset}
behaviors:
  - actor: user
    action: says
    content: "{{{{cases.userQuery}}}}"
  - actor: assistant
    action: asks
    content: "{AGENT_ASKS}"
evaluations:
  - type: never
    match: {{ actor: assistant, action: asks }}
    when: "{{{{cases.hasOrderId}}}} == true"
"""
    )
    return session


def _mock_agent(record, handler, index):
    send_json(handler, {"choices": [{"message": {"role": "assistant", "content": AGENT_ASKS}}]})


class TestWhenGatingThroughCli:
    def test_runs_evaluation_when_condition_is_true(self, server_factory):
        _, url = server_factory(_mock_agent, "/chat")
        session = _write_fixture(True)

        out = _run_cli(session, url)

        assert out["passed"] is False
        never = next(e for e in out["results"][0]["chain_evaluations"] if e["type"] == "never")
        assert never["passed"] is False
        assert "when condition not met" not in never["reason"]

    def test_skips_evaluation_when_condition_is_false(self, server_factory):
        _, url = server_factory(_mock_agent, "/chat")
        session = _write_fixture(False)

        out = _run_cli(session, url)

        assert out["passed"] is True
        never = next(e for e in out["results"][0]["chain_evaluations"] if e["type"] == "never")
        assert never["passed"] is True
        assert "when condition not met" in never["reason"]
