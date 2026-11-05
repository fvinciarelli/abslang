"""Step-level evaluations attached to ``tool responds`` behaviors must run.

Regression: the tool branch used to append a StepResult without evaluating
``behavior.evaluations``, silently dropping schema/contains/exact_match/etc.
"""

import asyncio

from abslang.parser import parse
from abslang.runner import AgentConfig, run
from http_mock import send_json


def _session(tool_content: str) -> str:
    return f"""
session: Tool responds evaluations
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content: {tool_content}
    evaluations:
      - type: schema
        schema:
          type: object
          required: [status]
          properties:
            status: {{ type: string }}

  - actor: assistant
    action: informs
    content: "ok"
"""


def _scripted_agent(record, handler, index):
    if index == 0:
        send_json(handler, {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "Order MCP", "arguments": '{"orderId":"12345"}'},
                    }],
                },
            }],
        })
    else:
        send_json(handler, {"choices": [{"message": {"role": "assistant", "content": "ok"}}]})


def _run_with_tool_response(server_factory, tool_content: str):
    _, url = server_factory(_scripted_agent, "/chat")
    session = parse(_session(tool_content))
    return asyncio.run(run(session, AgentConfig(url=url)))


class TestToolRespondsEvaluations:
    def test_runs_schema_evaluation_on_tool_response(self, server_factory):
        result = _run_with_tool_response(server_factory, '{ status: "in_transit" }')

        assert result.passed is True
        assert result.evaluations_total == 1
        assert result.evaluations_passed == 1

        tool_step = next(step for step in result.steps if step.behavior.actor == "tool")
        assert len(tool_step.evaluations) == 1
        assert tool_step.evaluations[0].type == "schema"
        assert tool_step.evaluations[0].passed is True

    def test_fails_when_tool_response_violates_schema(self, server_factory):
        result = _run_with_tool_response(server_factory, '{ eta: "2026-01-01" }')

        assert result.passed is False
        assert result.evaluations_total == 1
        assert result.evaluations_passed == 0

        tool_step = next(step for step in result.steps if step.behavior.actor == "tool")
        assert tool_step.evaluations[0].type == "schema"
        assert tool_step.evaluations[0].passed is False
        assert 'Missing required field: "status"' in tool_step.evaluations[0].reason
