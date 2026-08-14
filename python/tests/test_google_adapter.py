"""Google Vertex AI adapter tests (SDK + evaluate mocked — no GCP/network needed)."""

import asyncio

import pytest

from abslang.evaluators import ObservedStep
from abslang.evaluators.adapters import google as g


TRACE = [
    ObservedStep(actor="user", action="says", content="Where is order 123?"),
    ObservedStep(actor="assistant", action="informs", content="It is on the way"),
]


def _run(coro):
    return asyncio.run(coro)


# ── parsing / normalization ──

class TestHelpers:
    def test_scale_max(self):
        assert g._scale_max("1-5") == 5
        assert g._scale_max("0-1") == 1
        assert g._scale_max(10) == 10

    def test_normalize_likert(self):
        assert g._normalize(4, 5) == pytest.approx(0.8)

    def test_normalize_unit(self):
        assert g._normalize(0.6, 1) == pytest.approx(0.6)

    def test_resolve_inputs(self):
        v = g._resolve_inputs(TRACE, {"query": "user.says", "response": "self"})
        assert v["prompt"] == "Where is order 123?"
        assert v["response"] == "It is on the way"
        assert "context" in v

    def test_metric_name_of_string(self):
        assert g._metric_name_of("groundedness") == "groundedness"


class FakeTable:
    def __init__(self, columns, row):
        self.columns = columns
        self._row = row

    @property
    def iloc(self):
        return self

    def __getitem__(self, _idx):
        return self._row


class TestExtract:
    def test_score_and_explanation(self):
        table = FakeTable(
            ["groundedness/score", "groundedness/explanation"],
            {"groundedness/score": 0.9, "groundedness/explanation": "good"},
        )
        result = type("R", (), {"metrics_table": table, "summary_metrics": {}})()
        score, reason = g._extract(result, "groundedness")
        assert score == pytest.approx(0.9)
        assert reason == "good"

    def test_fallback_to_mean(self):
        table = FakeTable([], {})
        result = type("R", (), {"metrics_table": table, "summary_metrics": {"fluency/mean": 3.0}})()
        score, _ = g._extract(result, "fluency")
        assert score == pytest.approx(3.0)


# ── adapter (with _evaluate_single mocked) ──

@pytest.fixture
def fake_sdk(monkeypatch):
    import types
    import sys

    mod = types.ModuleType("vertexai")
    monkeypatch.setitem(sys.modules, "vertexai", mod)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    yield g


def _stub_eval(monkeypatch, score, reason=""):
    monkeypatch.setattr(g, "_evaluate_single", lambda metric, variables: (score, reason))
    monkeypatch.setattr(g, "_build_managed_metric", lambda abs_type: (abs_type, abs_type))
    monkeypatch.setattr(g, "_build_custom_metric", lambda name, criteria, scale: (name, name))


class TestLlmJudge:
    def test_likert_normalized(self, fake_sdk, monkeypatch):
        _stub_eval(monkeypatch, 4.0, "good")
        r = _run(g.google_adapter(TRACE, {"type": "llm_judge", "criteria": "x", "rating_scale": "1-5", "threshold": 0.8}))
        assert r.score == pytest.approx(0.8)
        assert r.passed

    def test_fails_below_threshold(self, fake_sdk, monkeypatch):
        _stub_eval(monkeypatch, 2.0, "weak")  # 2/5 = 0.4
        r = _run(g.google_adapter(TRACE, {"type": "llm_judge", "criteria": "x", "threshold": 0.8}))
        assert not r.passed


class TestManaged:
    def test_groundedness(self, fake_sdk, monkeypatch):
        _stub_eval(monkeypatch, 0.9, "grounded")
        r = _run(g.google_adapter(TRACE, {"type": "Groundedness", "query": "user.says", "context": "self", "response": "self", "threshold": 0.8}))
        assert r.type == "Groundedness"
        assert r.score == pytest.approx(0.9)
        assert r.passed

    def test_safety_types_route_to_safety(self, fake_sdk, monkeypatch):
        _stub_eval(monkeypatch, 1.0, "safe")
        r = _run(g.google_adapter(TRACE, {"type": "Violence", "response": "self", "threshold": 0.9}))
        assert r.score == pytest.approx(1.0)
        assert r.passed


class TestCustom:
    def test_custom_requires_criteria(self, fake_sdk, monkeypatch):
        r = _run(g.google_adapter(TRACE, {"type": "custom", "id": "google.tone"}))
        assert not r.passed
        assert "requires" in r.reason

    def test_custom_normalized(self, fake_sdk, monkeypatch):
        _stub_eval(monkeypatch, 4.0, "good tone")
        r = _run(g.google_adapter(TRACE, {"type": "custom", "id": "google.tone", "criteria": "friendly", "rating_scale": "1-5"}))
        assert r.score == pytest.approx(0.8)


class TestErrors:
    def test_no_project(self, monkeypatch):
        import types
        import sys

        monkeypatch.setitem(sys.modules, "vertexai", types.ModuleType("vertexai"))
        monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
        r = _run(g.google_adapter(TRACE, {"type": "Fluency", "response": "self"}))
        assert not r.passed
        assert "not configured" in r.reason.lower()

    def test_unsupported_type(self, fake_sdk):
        r = _run(g.google_adapter(TRACE, {"type": "sequence", "order": []}))
        assert not r.passed
        assert "does not support" in r.reason
