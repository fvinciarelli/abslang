"""Adapter results must honor the evaluation-level `threshold`.

The adapter always returns score 0.9 with passed=True, so the runner is the one
that must apply the threshold (step-level and session-level).
"""

import asyncio

from abslang.evaluators import EvalResult, register_adapter
from abslang.parser import parse
from abslang.runner import AgentConfig, run
from http_mock import send_json


async def _passing_adapter(trace, evaluation):
    return EvalResult(type="custom", passed=True, score=0.9, reason="adapter says pass")


register_adapter("custom", _passing_adapter, name="thresh")

SESSION = """
session: Threshold on adapter results
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    evaluations:
      - type: custom
        adapter: thresh
        threshold: 0.95
      - type: custom
        adapter: thresh
        threshold: 0.5
evaluations:
  - type: custom
    adapter: thresh
    threshold: 0.95
  - type: custom
    adapter: thresh
    threshold: 0.5
"""


def test_runner_applies_threshold_to_adapter_results(server_factory):
    def responder(record, handler, index):
        send_json(handler, {"choices": [{"message": {"role": "assistant", "content": "Hello"}}]})

    _, url = server_factory(responder, "/chat")
    result = asyncio.run(run(parse(SESSION), AgentConfig(url=url)))

    step_evals = result.steps[1].evaluations
    assert [e.passed for e in step_evals] == [False, True]
    assert "threshold" in step_evals[0].reason

    assert [e.passed for e in result.chain_evaluations] == [False, True]
    assert result.passed is False
