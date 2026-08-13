"""Azure AI Foundry adapter tests (SDK mocked — no network/credentials needed)."""

import sys
import types

import pytest

from abslang.evaluators import ObservedStep
from abslang.evaluators.adapters import azure as az


TRACE = [
    ObservedStep(actor="user", action="says", content="Where is order 123?"),
    ObservedStep(actor="assistant", action="calls", target="Order MCP", with_={"orderId": "123"}, tool_call_id="c1"),
    ObservedStep(actor="tool", action="responds", target="Order MCP", content={"status": "shipped"}, tool_call_id="c1"),
    ObservedStep(actor="assistant", action="informs", content="It is on the way"),
]


def _fake_sdk_module():
    class FakeRelevance:
        def __init__(self, model_config=None):
            self.model_config = model_config

        def __call__(self, **kw):
            return {"relevance": 4.0, "gpt_relevance": 4.0, "relevance_reason": "good", **kw}

    class FakeGroundedness:
        def __init__(self, model_config=None):
            self.model_config = model_config

        def __call__(self, **kw):
            return {"groundedness": 5, "groundedness_reason": "grounded", **kw}

    class FakeTaskAdherence:
        def __init__(self, model_config=None):
            self.model_config = model_config

        def __call__(self, **kw):
            return {"label": "pass", "reason": "adherent", **kw}

    class FakeToolCallAccuracy:
        def __init__(self, model_config=None):
            self.model_config = model_config

        def __call__(self, **kw):
            return {"tool_call_accuracy": 3, "tool_call_accuracy_reason": "params ok", **kw}

    mod = types.ModuleType("azure.ai.evaluation")
    mod.GroundednessEvaluator = FakeGroundedness
    mod.RelevanceEvaluator = FakeRelevance
    mod.CoherenceEvaluator = FakeRelevance
    mod.FluencyEvaluator = FakeRelevance
    mod.TaskAdherenceEvaluator = FakeTaskAdherence
    mod.IntentResolutionEvaluator = FakeTaskAdherence
    mod.ToolCallAccuracyEvaluator = FakeToolCallAccuracy
    return mod


@pytest.fixture
def fake_sdk(monkeypatch):
    azure_pkg = types.ModuleType("azure")
    azure_ai = types.ModuleType("azure.ai")
    eval_mod = _fake_sdk_module()
    monkeypatch.setitem(sys.modules, "azure", azure_pkg)
    monkeypatch.setitem(sys.modules, "azure.ai", azure_ai)
    monkeypatch.setitem(sys.modules, "azure.ai.evaluation", eval_mod)
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://x.services.ai.azure.com")
    monkeypatch.setenv("AZURE_OPENAI_KEY", "k")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "dep")
    az._evaluators_cache.clear()
    yield az
    az._evaluators_cache.clear()


# ── normalization ──

class TestNormalize:
    def test_likert_5_divided(self):
        assert az._normalize(4) == pytest.approx(0.8)
        assert az._normalize(5) == pytest.approx(1.0)
        assert az._normalize(3) == pytest.approx(0.6)

    def test_unit_scale_unchanged(self):
        assert az._normalize(0.8) == pytest.approx(0.8)
        assert az._normalize(0.0) == 0.0

    def test_clamped(self):
        assert az._normalize(1.5) == pytest.approx(0.3)  # 1.5/5


class TestExtractResult:
    def test_metric_key(self):
        score, reason = az._extract_result({"relevance": 4.0, "relevance_reason": "good"}, "relevance")
        assert score == pytest.approx(0.8)
        assert reason == "good"

    def test_label_pass(self):
        score, reason = az._extract_result({"label": "pass", "reason": "ok"}, "x")
        assert score == 1.0
        assert reason == "ok"

    def test_label_fail(self):
        score, _ = az._extract_result({"label": "fail", "reason": "bad"}, "x")
        assert score == 0.0

    def test_passed_bool(self):
        score, _ = az._extract_result({"passed": False, "explanation": "nope"}, "x")
        assert score == 0.0


# ── adapter behavior (no SDK / no creds) ──

class TestNotConfigured:
    def test_llm_judge_without_creds(self):
        import asyncio

        r = asyncio.run(az.azure_adapter([], {"type": "llm_judge", "criteria": "x"}))
        assert not r.passed
        assert "not configured" in r.reason.lower()

    def test_unknown_custom_id(self):
        import asyncio

        r = asyncio.run(az.azure_adapter([], {"type": "custom", "id": "azure.nope"}))
        assert not r.passed
        assert "unknown azure custom evaluator" in r.reason.lower()


# ── adapter behavior (mocked SDK) ──

class TestBuiltin:
    def test_relevance_normalizes_and_passes(self, fake_sdk):
        import asyncio

        r = asyncio.run(az.azure_adapter(TRACE, {
            "type": "Relevance", "query": "user.says", "response": "self", "threshold": 0.8,
        }))
        assert r.type == "Relevance"
        assert r.score == pytest.approx(0.8)
        assert r.passed  # 0.8 >= 0.8

    def test_relevance_fails_below_threshold(self, fake_sdk):
        import asyncio

        r = asyncio.run(az.azure_adapter(TRACE, {
            "type": "Relevance", "query": "user.says", "response": "self", "threshold": 0.9,
        }))
        assert r.score == pytest.approx(0.8)
        assert not r.passed  # 0.8 < 0.9

    def test_groundedness_resolves_context(self, fake_sdk):
        import asyncio

        r = asyncio.run(az.azure_adapter(TRACE, {
            "type": "Groundedness", "query": "user.says", "context": "tool.responds",
            "response": "self", "threshold": 0.8,
        }))
        assert r.score == pytest.approx(1.0)  # 5/5
        assert r.passed


class TestCustom:
    def test_task_adherence_conversation(self, fake_sdk):
        import asyncio

        r = asyncio.run(az.azure_adapter(TRACE, {"type": "custom", "id": "azure.task_adherence"}))
        assert r.passed
        assert r.score == 1.0

    def test_tool_call_accuracy_derives_tool_definitions(self, fake_sdk):
        import asyncio

        r = asyncio.run(az.azure_adapter(TRACE, {"type": "custom", "id": "azure.tool_call_accuracy"}))
        # 3/5 = 0.6 >= 0.5 default threshold
        assert r.score == pytest.approx(0.6)
        assert r.passed


class TestToolDefinitions:
    def test_derive(self):
        defs = az._derive_tool_definitions(TRACE)
        assert len(defs) == 1
        fn = defs[0]["function"]
        assert fn["name"] == "Order MCP"
        assert fn["parameters"]["properties"]["orderId"]["type"] == "string"
