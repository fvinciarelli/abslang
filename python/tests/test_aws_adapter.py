"""AWS Bedrock adapter tests (Converse call mocked — no boto3/network needed)."""

import asyncio

import pytest

from abslang.evaluators import ObservedStep
from abslang.evaluators.adapters import aws as aws_mod


TRACE = [
    ObservedStep(actor="user", action="says", content="Where is order 123?"),
    ObservedStep(actor="assistant", action="informs", content="It is on the way"),
]


def _run(coro):
    return asyncio.run(coro)


# ── parsing / normalization ──

class TestParsing:
    def test_parse_score_and_reason(self):
        score, reason = aws_mod._parse_judge_response("Score: 4\nReason: nice work")
        assert score == 4.0
        assert reason == "nice work"

    def test_parse_missing_score(self):
        score, _ = aws_mod._parse_judge_response("no score here")
        assert score is None

    def test_scale_max(self):
        assert aws_mod._scale_max("1-5") == 5
        assert aws_mod._scale_max("0-1") == 1
        assert aws_mod._scale_max(10) == 10

    def test_normalize_likert(self):
        assert aws_mod._normalize(4, 5) == pytest.approx(0.8)

    def test_normalize_unit(self):
        assert aws_mod._normalize(0.6, 1) == pytest.approx(0.6)


class TestInterpolate:
    def test_response_placeholder(self):
        out = aws_mod._interpolate_prompt("Response: {{response}}", {}, TRACE, "It is on the way")
        assert "It is on the way" in out

    def test_criteria_and_query(self):
        out = aws_mod._interpolate_prompt(
            "q={{query}} c={{criteria}}",
            {"criteria": "friendly", "query": "user.says"},
            TRACE,
            "SELF",
        )
        assert "Where is order 123?" in out
        assert "friendly" in out


# ── adapter ──

class TestLlmJudge:
    def test_llm_judge_passes(self, monkeypatch):
        monkeypatch.setattr(aws_mod, "_converse", lambda system, prompt: "Score: 0.8\nReason: good")
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "llm_judge", "criteria": "x", "threshold": 0.8}))
        assert r.passed
        assert r.score == pytest.approx(0.8)
        assert r.reason.startswith("[aws]")

    def test_llm_judge_fails_below_threshold(self, monkeypatch):
        monkeypatch.setattr(aws_mod, "_converse", lambda system, prompt: "Score: 0.3\nReason: weak")
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "llm_judge", "criteria": "x", "threshold": 0.8}))
        assert not r.passed

    def test_unparseable_score(self, monkeypatch):
        monkeypatch.setattr(aws_mod, "_converse", lambda system, prompt: "garbage")
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "llm_judge", "criteria": "x"}))
        assert not r.passed
        assert "could not parse" in r.reason.lower()


class TestCustom:
    def test_custom_likert_normalized(self, monkeypatch):
        monkeypatch.setattr(aws_mod, "_converse", lambda system, prompt: "Score: 4\nReason: good tone")
        r = _run(aws_mod.aws_adapter(TRACE, {
            "type": "custom", "id": "aws.tone", "prompt": "Rate tone ({{response}})",
            "rating_scale": "1-5", "threshold": 0.8,
        }))
        assert r.score == pytest.approx(0.8)
        assert r.passed
        assert r.reason.startswith("[aws:aws.tone]")

    def test_custom_unit_scale(self, monkeypatch):
        monkeypatch.setattr(aws_mod, "_converse", lambda system, prompt: "Score: 0.6\nReason: ok")
        r = _run(aws_mod.aws_adapter(TRACE, {
            "type": "custom", "id": "aws.helpful", "prompt": "Rate helpfulness",
            "rating_scale": "0-1", "threshold": 0.5,
        }))
        assert r.score == pytest.approx(0.6)
        assert r.passed

    def test_custom_requires_prompt(self, monkeypatch):
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "custom", "id": "aws.x"}))
        assert not r.passed
        assert "requires a 'prompt'" in r.reason


class TestErrors:
    def test_boto3_missing(self, monkeypatch):
        def _raise(system, prompt):
            raise RuntimeError("boto3 is not installed or AWS credentials are not configured")

        monkeypatch.setattr(aws_mod, "_converse", _raise)
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "llm_judge", "criteria": "x"}))
        assert not r.passed
        assert "not configured" in r.reason.lower()

    def test_unsupported_type(self):
        r = _run(aws_mod.aws_adapter(TRACE, {"type": "sequence", "order": []}))
        assert not r.passed
        assert "agentcore" in r.reason.lower()
