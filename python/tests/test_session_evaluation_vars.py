"""Dataset-bound values must resolve in session-level (chain) evaluations too.

Regression: behaviors were resolved with the dataset row, but top-level
``evaluations:`` were copied from the document untouched. A sequence selector
like ``target: "{{cases.toolName}}"`` then compared literally against the
observed tool name and never matched.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from http_mock import send_json

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


def _mock_agent(record, handler, index):
    if index == 0:
        send_json(handler, {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "get_weather", "arguments": '{"city":"Paris"}'},
                    }],
                },
            }],
        })
    else:
        send_json(handler, {"choices": [{"message": {"role": "assistant", "content": "done"}}]})


def _write_fixture() -> Path:
    directory = Path(tempfile.mkdtemp(prefix="abs-session-eval-vars-"))
    dataset = directory / "cases.jsonl"
    dataset.write_text(
        json.dumps({
            "query": "What is the weather in Paris?",
            "toolName": "get_weather",
            "city": "Paris",
        }) + "\n"
    )
    session = directory / "session.abs.yaml"
    session.write_text(
        f"""session: Dataset tool name in chain sequence
dataset:
  id: cases
  path: {dataset}
behaviors:
  - actor: user
    action: says
    content: "{{{{cases.query}}}}"

  - actor: assistant
    action: calls
    target: "{{{{cases.toolName}}}}"
    with:
      city: "{{{{cases.city}}}}"

  - actor: tool
    action: responds
    target: "{{{{cases.toolName}}}}"
    content:
      temperature: 20

  - actor: assistant
    action: informs
    content: "done"

evaluations:
  - type: sequence
    order:
      - {{ actor: assistant, action: calls, target: "{{{{cases.toolName}}}}" }}
      - {{ actor: assistant, action: informs }}
"""
    )
    return session


class TestSessionEvaluationVariables:
    def test_resolves_dataset_tool_name_in_sequence(self, server_factory):
        _, url = server_factory(_mock_agent, "/chat")
        session = _write_fixture()

        out = _run_cli(session, url)

        assert out["passed"] is True
        assert out["results"][0]["trace"][1]["behavior"]["target"] == "get_weather"

        sequence = next(
            e for e in out["results"][0]["chain_evaluations"] if e["type"] == "sequence"
        )
        assert sequence["passed"] is True
        assert "{{cases.toolName}}" not in sequence["reason"]
