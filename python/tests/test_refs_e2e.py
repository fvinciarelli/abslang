"""Behavior ids on the observed trace + reference resolution in a real run.

A capturing adapter sees the trace the runner produced (including user turns
and tool responses) and resolves the same refs the Azure/Google/AWS adapters use.
"""

import asyncio

from abslang.evaluators import EvalResult, register_adapter
from abslang.evaluators.trace_utils import resolve_ref
from abslang.parser import parse
from abslang.runner import AgentConfig, run
from http_mock import send_json

captured: dict = {}


async def _capture_adapter(trace, evaluation):
    captured["trace"] = list(trace)
    return EvalResult(
        type=evaluation.get("type", "capture_refs"),
        passed=True,
        score=1.0,
        reason="captured",
    )


register_adapter("custom", _capture_adapter, name="capture_refs")

SESSION = """
session: Order status with ids
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "Where is order 12345?"
  - id: lookup
    actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"
  - id: kb_result
    actor: tool
    action: responds
    target: Order MCP
    content:
      status: "shipped"
  - id: answer
    actor: assistant
    action: informs
    content: "Your order is on the way"
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls }
      - { actor: tool, action: responds }
      - { actor: assistant, action: informs }
  - type: custom
    adapter: capture_refs
"""


class TestRefsEndToEnd:
    def test_ids_and_refs_on_the_observed_trace(self, server_factory):
        def responder(record, handler, index):
            if index == 0:
                send_json(handler, {"choices": [{"message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "Order MCP", "arguments": '{"orderId":"12345"}'},
                    }],
                }}]})
            else:
                send_json(handler, {"choices": [{"message": {
                    "role": "assistant",
                    "content": "Your order is on the way",
                }}]})

        _, url = server_factory(responder, "/chat")
        result = asyncio.run(run(parse(SESSION), AgentConfig(url=url)))

        assert result.passed is True
        seq = next(e for e in result.chain_evaluations if e.type == "sequence")
        assert seq.passed is True, seq.reason
        trace = captured["trace"]
        assert [s.id for s in trace] == ["user_asks", "lookup", "kb_result", "answer"]
        assert [(s.actor, s.action) for s in trace] == [
            ("user", "says"),
            ("assistant", "calls"),
            ("tool", "responds"),
            ("assistant", "informs"),
        ]

        assert resolve_ref(trace, "user_asks.says") == "Where is order 12345?"
        assert resolve_ref(trace, "kb_result.responds") == '{"status": "shipped"}'
        assert resolve_ref(trace, "kb_result") == '{"status": "shipped"}'
        assert resolve_ref(trace, "answer.informs") == "Your order is on the way"
