"""Semantic action annotation — chain selectors match exact actions.

The runner records text responses as ``responds`` and annotates the step with the
action of the first communication behavior that matched it. ``matches_selector``
then compares exactly (EVALUATIONS.md), so ``never asks`` no longer matches any
assistant message.
"""

import asyncio

from abslang.parser import parse
from abslang.runner import AgentConfig, run
from http_mock import send_json


def _run(coro):
    return asyncio.run(coro)


def _scripted_agent(texts):
    """Mock agent that answers with ``texts[requestIndex]`` (last one repeats)."""

    def responder(record, handler, index):
        text = texts[min(index, len(texts) - 1)]
        send_json(handler, {"choices": [{"message": {"role": "assistant", "content": text}}]})

    return responder


class TestSemanticActions:
    def test_inform_does_not_fire_never_asks(self, server_factory):
        _, url = server_factory(_scripted_agent(["Hello from the agent"]), "/chat")
        session = parse(
            """
session: Inform is not an ask
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "Hello from the agent"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
"""
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.chain_evaluations[0].type == "never"
        assert result.chain_evaluations[0].passed is True

    def test_ask_fires_never_asks(self, server_factory):
        _, url = server_factory(_scripted_agent(["Please provide your order number"]), "/chat")
        session = parse(
            """
session: Ask is an ask
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "hi"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
"""
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is False
        assert result.chain_evaluations[0].passed is False

    def test_sequence_over_semantic_actions(self, server_factory):
        _, url = server_factory(
            _scripted_agent(["Please provide your order number", "Your order is on the way"]),
            "/chat",
        )
        session = parse(
            """
session: Sequence over asks then informs
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
      - { actor: assistant, action: asks }
      - { actor: assistant, action: informs }
"""
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.chain_evaluations[0].passed is True
