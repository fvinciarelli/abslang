"""Safety dimension tests — built-in judge with curated rubrics (no API key needed)."""

import asyncio

import pytest

from abslang.evaluators import ObservedStep, _adapters, evaluate_with_adapter
from abslang.evaluators.builtin_judge import SAFETY_RUBRICS, _resolve_criteria, evaluate


TRACE = [
    ObservedStep(actor="user", action="says", content="Hello"),
    ObservedStep(actor="assistant", action="informs", content="This is a normal helpful response to you."),
]


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch):
    monkeypatch.setenv("ABS_MOCK_JUDGE", "true")
    for k in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "ABS_JUDGE_PROVIDER"):
        monkeypatch.delenv(k, raising=False)


class TestRubrics:
    def test_four_safety_types(self):
        assert set(SAFETY_RUBRICS) == {"HateUnfairness", "Violence", "Sexual", "SelfHarm"}

    def test_rubric_selected_by_type(self):
        assert "violence" in _resolve_criteria({"type": "Violence"}).lower()

    def test_criteria_overrides_rubric(self):
        assert _resolve_criteria({"type": "Violence", "criteria": "custom rule"}) == "custom rule"

    def test_prompt_overrides_rubric(self):
        assert _resolve_criteria({"type": "Violence", "prompt": "prompt rule"}) == "prompt rule"

    def test_default_for_llm_judge(self):
        assert "helpful" in _resolve_criteria({"type": "llm_judge"}).lower()


class TestRegistry:
    def test_safety_types_registered(self):
        for t in ("HateUnfairness", "Violence", "Sexual", "SelfHarm"):
            assert t in _adapters


class TestEvaluate:
    def test_violence_type_and_threshold(self):
        r = asyncio.run(evaluate(TRACE, {"type": "Violence", "threshold": 0.9}))
        assert r.type == "Violence"
        assert r.score == pytest.approx(0.85)
        assert not r.passed  # 0.85 < 0.9

    def test_violence_passes_low_threshold(self):
        r = asyncio.run(evaluate(TRACE, {"type": "Violence", "threshold": 0.5}))
        assert r.passed

    def test_llm_judge_default_threshold(self):
        r = asyncio.run(evaluate(TRACE, {"type": "llm_judge", "criteria": "x"}))
        assert r.passed  # 0.85 >= default 0.5

    def test_via_registry(self):
        r = asyncio.run(evaluate_with_adapter("Violence", TRACE, {"type": "Violence", "threshold": 0.9}))
        assert r is not None
        assert r.type == "Violence"
        assert not r.passed
