"""User turns are part of the observed trace.

Chain selectors documented in EVALUATIONS.md (e.g. ``within`` with
``after: { actor: user, action: says }``) need the user messages the runner sent.
"""

import asyncio

from abslang.parser import parse
from abslang.runner import AgentConfig, run
from http_mock import send_json


def _run(coro):
    return asyncio.run(coro)


def _scripted_agent(texts):
    def responder(record, handler, index):
        text = texts[min(index, len(texts) - 1)]
        send_json(handler, {"choices": [{"message": {"role": "assistant", "content": text}}]})

    return responder


class TestUserTurnsInTrace:
    def test_sequence_within_and_count_over_user_actions(self, server_factory):
        _, url = server_factory(
            _scripted_agent(["Please provide your order number", "Your order is on the way"]),
            "/chat",
        )
        session = parse(
            """
session: User turns in chain selectors
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - actor: assistant
    action: asks
    content: "Please provide your order number"
  - actor: user
    action: says
    content: "8291"
  - actor: assistant
    action: informs
    content: "Your order is on the way"
evaluations:
  - type: sequence
    order:
      - { actor: user, action: says }
      - { actor: assistant, action: asks }
      - { actor: user, action: says }
      - { actor: assistant, action: informs }
  - type: within
    after: { actor: user, action: says }
    match: { actor: assistant, action: asks }
    max_steps: 3
  - type: count
    match: { actor: user, action: says }
    min: 2
    max: 2
"""
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert len(result.chain_evaluations) == 3
        for ev in result.chain_evaluations:
            assert ev.passed is True, f"{ev.type}: {ev.reason}"
        assert result.passed is True

    def test_matching_stays_aligned_after_a_user_step_joins_the_trace(self, server_factory):
        _, url = server_factory(_scripted_agent(["Hello from the agent"]), "/chat")
        session = parse(
            """
session: Matching still aligned
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
"""
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.steps[0].sent is True
        assert result.steps[1].matched is True
