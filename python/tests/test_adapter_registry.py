"""Fase 0 — adapter registry + trace helpers tests."""

import asyncio

import pytest

from abslang.evaluators import (
    ObservedStep,
    EvalResult,
    register_adapter,
    evaluate_with_adapter,
    _adapters,
    _named_adapters,
)
from abslang.evaluators.trace_utils import (
    resolve_ref,
    trace_to_text,
    trace_to_messages,
    trace_to_conversation,
    extract_tool_calls,
    extract_tool_trajectory,
    extract_ground_truth,
)


# ── fixtures ──

@pytest.fixture(autouse=True)
def _clean_registry():
    """Isolate registry state across tests."""
    saved_default = dict(_adapters)
    saved_named = dict(_named_adapters)
    yield
    _adapters.clear()
    _adapters.update(saved_default)
    _named_adapters.clear()
    _named_adapters.update(saved_named)


def _run(coro):
    return asyncio.run(coro)


def _fake_adapter(name="fake"):
    async def fn(trace, evaluation):
        return EvalResult(type=evaluation["type"], passed=True, score=0.9, reason=f"{name}:{evaluation.get('id', '')}")

    return fn


# ── ObservedStep ──

class TestObservedStep:
    def test_tool_call_id_defaults_to_none(self):
        s = ObservedStep(actor="assistant", action="calls", target="T")
        assert s.tool_call_id is None

    def test_tool_call_id_is_preserved(self):
        s = ObservedStep(actor="assistant", action="calls", target="T", tool_call_id="call_1")
        assert s.tool_call_id == "call_1"


# ── registry ──

class TestRegistry:
    def test_default_registration(self):
        register_adapter("llm_judge", _fake_adapter())
        r = _run(evaluate_with_adapter("llm_judge", [], {"type": "llm_judge"}))
        assert r is not None and r.reason.startswith("fake:")

    def test_named_registration_and_selection(self):
        register_adapter("llm_judge", _fake_adapter("azure"), name="azure")
        register_adapter("llm_judge", _fake_adapter("aws"), name="aws")
        r = _run(evaluate_with_adapter("llm_judge", [], {"type": "llm_judge"}, adapter_name="aws"))
        assert r.reason.startswith("aws:")

    def test_named_takes_priority_over_default(self):
        register_adapter("llm_judge", _fake_adapter("default"), name=None)
        register_adapter("llm_judge", _fake_adapter("azure"), name="azure")
        r = _run(evaluate_with_adapter("llm_judge", [], {"type": "llm_judge"}, adapter_name="azure"))
        assert r.reason.startswith("azure:")

    def test_unknown_named_returns_clear_error(self):
        register_adapter("llm_judge", _fake_adapter("default"), name=None)
        r = _run(evaluate_with_adapter("llm_judge", [], {"type": "llm_judge"}, adapter_name="nope"))
        assert not r.passed
        assert "not registered" in r.reason

    def test_no_adapter_returns_none(self):
        assert _run(evaluate_with_adapter("custom", [], {"type": "custom"})) is None


# ── trace_utils ──

TRACE = [
    ObservedStep(actor="user", action="says", content="Where is order 123?"),
    ObservedStep(actor="assistant", action="calls", target="Order MCP", with_={"orderId": "123"}, tool_call_id="c1"),
    ObservedStep(actor="tool", action="responds", target="Order MCP", content={"status": "shipped"}, tool_call_id="c1"),
    ObservedStep(actor="assistant", action="informs", content="It is on the way"),
]


class TestResolveRef:
    def test_self(self):
        assert resolve_ref(TRACE, "self", "SELF") == "SELF"

    def test_id_action(self):
        assert resolve_ref(TRACE, "user.says") == "Where is order 123?"

    def test_id_with_default_action(self):
        assert resolve_ref(TRACE, "tool") == '{"status": "shipped"}'

    def test_comm_action_equivalence(self):
        # assistant "informs" should match a "says" ref (both communication)
        assert resolve_ref(TRACE, "assistant.says") == "It is on the way"

    def test_missing_returns_raw_ref(self):
        assert resolve_ref(TRACE, "nope.says") == "nope.says"


class TestTraceToMessages:
    def test_full_mapping(self):
        msgs = trace_to_messages(TRACE)
        assert [m["role"] for m in msgs] == ["user", "assistant", "tool", "assistant"]
        # assistant tool_call message
        tc_msg = msgs[1]
        assert tc_msg["content"][0]["type"] == "tool_call"
        assert tc_msg["content"][0]["name"] == "Order MCP"
        assert tc_msg["content"][0]["arguments"] == {"orderId": "123"}
        # tool result message references the same id
        assert msgs[2]["tool_call_id"] == "c1"
        assert msgs[2]["content"][0]["type"] == "tool_result"

    def test_consecutive_calls_are_grouped(self):
        trace = [
            ObservedStep(actor="assistant", action="calls", target="A", with_={}, tool_call_id="x"),
            ObservedStep(actor="assistant", action="calls", target="B", with_={}, tool_call_id="y"),
        ]
        msgs = trace_to_messages(trace)
        assert len(msgs) == 1
        assert len(msgs[0]["content"]) == 2
        assert [c["name"] for c in msgs[0]["content"]] == ["A", "B"]

    def test_synthetic_ids_when_missing(self):
        trace = [
            ObservedStep(actor="assistant", action="calls", target="A"),
            ObservedStep(actor="tool", action="responds", target="A", content="ok"),
        ]
        msgs = trace_to_messages(trace)
        call_id = msgs[0]["content"][0]["tool_call_id"]
        assert call_id  # synthetic, non-empty
        assert msgs[1]["tool_call_id"] == call_id  # positional pairing


class TestTraceToConversation:
    def test_query_response_split(self):
        conv = trace_to_conversation(TRACE)
        assert [m["role"] for m in conv["query"]] == ["user"]
        assert [m["role"] for m in conv["response"]] == ["assistant", "tool", "assistant"]


class TestExtractors:
    def test_tool_calls(self):
        assert len(extract_tool_calls(TRACE)) == 1

    def test_tool_trajectory(self):
        assert extract_tool_trajectory(TRACE) == ["Order MCP"]


class TestExtractGroundTruth:
    def test_criteria_becomes_assertions(self):
        gt = extract_ground_truth({"type": "llm_judge", "criteria": "resolves refund"}, TRACE)
        assert gt == {"assertions": ["resolves refund"]}

    def test_sequence_becomes_trajectory(self):
        gt = extract_ground_truth(
            {"type": "sequence", "order": [{"action": "calls", "target": "Order MCP"}]},
            TRACE,
        )
        assert gt == {"expected_trajectory": ["Order MCP"]}

    def test_ground_truth_ref(self):
        gt = extract_ground_truth({"type": "correctness", "ground_truth": "tool.responds"}, TRACE)
        assert gt["expected_response"] == '{"status": "shipped"}'
