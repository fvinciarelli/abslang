"""Spike — OpenAI Responses adapter + Authorization forwarding (Python)."""

import asyncio

import pytest

from abslang.parser import parse
from abslang.runner import (
    AgentConfig,
    AgentMessage,
    _ResponsesState,
    _apply_responses_event,
    _build_auth_headers,
    _parse_responses_output,
    _resolve_forwarded_authorization,
    _responses_adapter,
    _responses_state_to_message,
    _to_responses_input,
    run,
)
from http_mock import send_json as _send_json
from http_mock import send_sse as _send_sse


def _run(coro):
    return asyncio.run(coro)


# ── auth headers ──

class TestBuildAuthHeaders:
    def test_bearer_token(self):
        headers = _build_auth_headers(AgentConfig(url="x", auth="bearer", token="tok"), {})
        assert headers == {"Authorization": "Bearer tok"}

    def test_api_key(self):
        headers = _build_auth_headers(AgentConfig(url="x", auth="api_key", token="k"), {})
        assert headers == {"X-API-Key": "k"}

    def test_forwards_raw_authorization_from_config(self):
        headers = _build_auth_headers(AgentConfig(url="x", authorization="Bearer incoming"), {})
        assert headers == {"Authorization": "Bearer incoming"}

    def test_normalizes_bare_token_to_bearer(self):
        headers = _build_auth_headers(
            AgentConfig(url="x", forward_auth=True, authorization="eyJ.crud"), {}
        )
        assert headers == {"Authorization": "Bearer eyJ.crud"}

    def test_forwards_from_http_authorization_env(self):
        headers = _build_auth_headers(
            AgentConfig(url="x", forward_auth=True), {"HTTP_AUTHORIZATION": "Bearer http-env"}
        )
        assert headers == {"Authorization": "Bearer http-env"}

    def test_forwards_from_abs_agent_authorization_env(self):
        headers = _build_auth_headers(
            AgentConfig(url="x", forward_auth=True), {"ABS_AGENT_AUTHORIZATION": "Bearer abs-env"}
        )
        assert headers == {"Authorization": "Bearer abs-env"}

    def test_falls_back_to_abs_agent_token(self):
        headers = _build_auth_headers(
            AgentConfig(url="x", forward_auth=True), {"ABS_AGENT_TOKEN": "token-env"}
        )
        assert headers == {"Authorization": "Bearer token-env"}

    def test_explicit_token_wins_over_forwarding(self):
        headers = _build_auth_headers(
            AgentConfig(url="x", auth="bearer", token="explicit", forward_auth=True),
            {"HTTP_AUTHORIZATION": "Bearer inbound"},
        )
        assert headers == {"Authorization": "Bearer explicit"}

    def test_forward_without_source_raises(self):
        with pytest.raises(RuntimeError, match="forwarding is enabled but no value"):
            _resolve_forwarded_authorization(AgentConfig(url="x", forward_auth=True), {})


# ── request translation ──

class TestToResponsesInput:
    def test_system_moves_to_instructions(self):
        items, instructions = _to_responses_input([
            AgentMessage(role="system", content="Be nice"),
            AgentMessage(role="user", content="Hi"),
        ])
        assert instructions == "Be nice"
        assert items == [{"role": "user", "content": "Hi"}]

    def test_tool_calls_and_outputs(self):
        items, _ = _to_responses_input([
            AgentMessage(role="user", content="Where is my order?"),
            AgentMessage(
                role="assistant",
                content=None,
                tool_calls=[{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "Order MCP", "arguments": '{"orderId":"1"}'},
                }],
            ),
            AgentMessage(role="tool", tool_call_id="call_1", name="Order MCP", content='{"status":"shipped"}'),
        ])
        assert items[1] == {
            "type": "function_call",
            "call_id": "call_1",
            "name": "Order MCP",
            "arguments": '{"orderId":"1"}',
        }
        assert items[2] == {
            "type": "function_call_output",
            "call_id": "call_1",
            "output": '{"status":"shipped"}',
        }


# ── response parsing ──

class TestParseResponsesOutput:
    def test_extracts_text_and_function_calls(self):
        content, tool_calls = _parse_responses_output([
            {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Hello"}]},
            {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "F", "arguments": '{"a":1}'},
        ])
        assert content == "Hello"
        assert tool_calls[0]["id"] == "call_1"
        assert tool_calls[0]["function"]["name"] == "F"

    def test_accepts_object_arguments(self):
        _, tool_calls = _parse_responses_output([
            {"type": "function_call", "id": "fc_1", "name": "F", "arguments": {"a": 1}},
        ])
        assert tool_calls[0]["function"]["arguments"] == '{"a": 1}'


class TestApplyResponsesEvent:
    def test_accumulates_text_deltas(self):
        state = _ResponsesState()
        _apply_responses_event(state, {"type": "response.output_text.delta", "delta": "Hel"})
        _apply_responses_event(state, {"type": "response.output_text.delta", "delta": "lo"})
        assert _responses_state_to_message(state).content == "Hello"

    def test_accumulates_function_call_arguments(self):
        state = _ResponsesState()
        _apply_responses_event(state, {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "F", "arguments": ""},
        })
        _apply_responses_event(state, {
            "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": '{"a":',
        })
        _apply_responses_event(state, {
            "type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "1}",
        })
        msg = _responses_state_to_message(state)
        assert msg.tool_calls[0]["id"] == "call_1"
        assert msg.tool_calls[0]["function"]["arguments"] == '{"a":1}'

    def test_completed_output_is_authoritative(self):
        state = _ResponsesState()
        _apply_responses_event(state, {"type": "response.output_text.delta", "delta": "partial"})
        _apply_responses_event(state, {
            "type": "response.completed",
            "response": {"output": [
                {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "final"}]},
            ]},
        })
        assert _responses_state_to_message(state).content == "final"

    def test_error_event_raises(self):
        with pytest.raises(RuntimeError, match="Responses API error: boom"):
            _apply_responses_event(_ResponsesState(), {"type": "error", "message": "boom"})


# ── adapter integration ──

class TestResponsesAdapter:
    def test_streams_sse_and_forwards_authorization(self, server_factory):
        def responder(record, handler, index):
            _send_sse(handler, [
                {
                    "type": "response.output_item.added",
                    "output_index": 0,
                    "item": {
                        "type": "function_call",
                        "id": "fc_1",
                        "call_id": "call_1",
                        "name": "Order MCP",
                        "arguments": "",
                    },
                },
                {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": '{"orderId":'},
                {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": '"12345"}'},
                {
                    "type": "response.completed",
                    "response": {"output": [{
                        "type": "function_call",
                        "id": "fc_1",
                        "call_id": "call_1",
                        "name": "Order MCP",
                        "arguments": '{"orderId":"12345"}',
                    }]},
                },
            ])

        httpd, url = server_factory(responder)
        config = AgentConfig(
            url=url,
            format="responses",
            model="gpt-4o-mini",
            forward_auth=True,
            authorization="Bearer incoming-token",
        )
        messages = _run(_responses_adapter([AgentMessage(role="user", content="Where is my order?")], config))

        req = httpd.requests[0]
        assert req["headers"]["authorization"] == "Bearer incoming-token"
        assert req["body"]["stream"] is True
        assert req["body"]["model"] == "gpt-4o-mini"
        assert req["body"]["input"] == [{"role": "user", "content": "Where is my order?"}]
        assert messages[0].tool_calls[0]["id"] == "call_1"
        assert messages[0].tool_calls[0]["function"]["name"] == "Order MCP"
        assert messages[0].tool_calls[0]["function"]["arguments"] == '{"orderId":"12345"}'

    def test_accumulates_text_without_completed_event(self, server_factory):
        def responder(record, handler, index):
            _send_sse(handler, [
                {"type": "response.output_text.delta", "delta": "Your order "},
                {"type": "response.output_text.delta", "delta": "is on the way"},
            ])

        _, url = server_factory(responder)
        messages = _run(_responses_adapter(
            [AgentMessage(role="user", content="status?")], AgentConfig(url=url)
        ))
        assert messages[0].content == "Your order is on the way"

    def test_omits_model_when_not_configured(self, server_factory):
        def responder(record, handler, index):
            _send_sse(handler, [{"type": "response.output_text.delta", "delta": "ok"}])

        httpd, url = server_factory(responder)
        _run(_responses_adapter([AgentMessage(role="user", content="hi")], AgentConfig(url=url)))
        assert "model" not in httpd.requests[0]["body"]

    def test_parses_non_streaming_json(self, server_factory):
        def responder(record, handler, index):
            _send_json(handler, {
                "output": [
                    {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Shipped"}]},
                    {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "F", "arguments": "{}"},
                ],
            })

        _, url = server_factory(responder)
        messages = _run(_responses_adapter(
            [AgentMessage(role="user", content="status?")],
            AgentConfig(url=url, stream=False),
        ))
        assert messages[0].content == "Shipped"
        assert messages[0].tool_calls[0]["function"]["name"] == "F"


# ── runner end-to-end ──

SESSION_YAML = """
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is order 12345?"
  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"
  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "shipped"
  - actor: assistant
    action: informs
    content: "Your order is on the way"
"""


class TestRunnerResponsesFlow:
    def test_full_tool_round_trip_forwards_auth(self, server_factory):
        def responder(record, handler, index):
            if index == 0:
                _send_sse(handler, [
                    {
                        "type": "response.output_item.added",
                        "output_index": 0,
                        "item": {
                            "type": "function_call",
                            "id": "fc_1",
                            "call_id": "call_1",
                            "name": "Order MCP",
                            "arguments": "",
                        },
                    },
                    {
                        "type": "response.output_item.done",
                        "output_index": 0,
                        "item": {
                            "type": "function_call",
                            "id": "fc_1",
                            "call_id": "call_1",
                            "name": "Order MCP",
                            "arguments": '{"orderId":"12345"}',
                        },
                    },
                ])
            else:
                _send_sse(handler, [
                    {"type": "response.output_text.delta", "delta": "Your order is on the way"},
                    {
                        "type": "response.completed",
                        "response": {"output": [
                            {
                                "type": "message",
                                "role": "assistant",
                                "content": [{"type": "output_text", "text": "Your order is on the way"}],
                            },
                        ]},
                    },
                ])

        httpd, url = server_factory(responder)
        session = parse(SESSION_YAML)
        result = _run(run(session, AgentConfig(
            url=url,
            format="responses",
            forward_auth=True,
            authorization="Bearer e2e",
        )))

        assert result.steps_matched == result.steps_total
        assert httpd.requests[0]["headers"]["authorization"] == "Bearer e2e"
        assert httpd.requests[1]["headers"]["authorization"] == "Bearer e2e"
        # Second request must carry the tool output back to the agent
        assert httpd.requests[1]["body"]["input"][-1] == {
            "type": "function_call_output",
            "call_id": "call_1",
            "output": '{"status": "shipped"}',
        }
