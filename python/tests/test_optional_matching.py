"""v0.2 optional matching — §7.7: optionals never consume an observed step.

A skipped optional must not shift the cursor: the next required behavior still
matches the same agent response. A matched optional must not consume either, so
several optionals can activate from one response.
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


class TestOptionalMatching:
    def test_required_behavior_matches_after_a_skipped_optional(self, server_factory):
        _, url = server_factory(_scripted_agent(["Hello from the agent"]), "/chat")
        session = parse(
            '''
session: Skipped optional
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
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
'''
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.steps[1].skipped is True
        assert result.steps[2].matched is True

    def test_matches_reply_to_user_turn_activated_by_optional(self, server_factory):
        httpd, url = server_factory(
            _scripted_agent(["Please provide your order number", "Your order is on the way"]),
            "/chat",
        )
        session = parse(
            '''
session: Matched optional
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
'''
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.steps[1].matched is True
        assert result.steps[2].sent is True
        assert result.steps[3].matched is True
        assert len(httpd.requests) == 2

    def test_several_optionals_from_one_response(self, server_factory):
        httpd, url = server_factory(
            _scripted_agent(
                ["I need your order ID and your email", "Got it", "Your order is on the way"]
            ),
            "/chat",
        )
        session = parse(
            '''
session: Multiple optionals
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order ID"
  - id: ask_email
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "email"
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - id: user_gives_email
    actor: user
    action: says
    content: "franco@mail.com"
    requires: ask_email
  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
'''
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.steps[1].matched is True  # ask_id
        assert result.steps[2].matched is True  # ask_email — same response
        assert result.steps[5].matched is True  # final answer
        assert len(httpd.requests) == 3

    def test_cursor_survives_a_requires_gated_user_turn(self, server_factory):
        httpd, url = server_factory(_scripted_agent(["Hello from the agent"]), "/chat")
        session = parse(
            '''
session: Gated user turn
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
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
'''
        )

        result = _run(run(session, AgentConfig(url=url)))

        assert result.passed is True
        assert result.steps[1].skipped is True
        assert result.steps[2].skipped is True  # gated user turn, never sent
        assert result.steps[3].matched is True
        assert len(httpd.requests) == 1
