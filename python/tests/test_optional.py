"""v0.2 Optional Behaviors — Python tests."""

import pytest
from abslang.parser import parse, parse_yaml
from abslang.evaluators import eval_when, evaluate_expected, EvalResult


# ── eval_when ──

class TestEvalWhen:
    def test_undefined_returns_true(self):
        assert eval_when(None, {}) is True
        assert eval_when("", {}) is True

    def test_boolean_comparisons(self):
        assert eval_when("{{x}} == true", {"x": True}) is True
        assert eval_when("{{x}} == true", {"x": False}) is False
        assert eval_when("{{x}} == false", {"x": False}) is True

    def test_string_comparisons(self):
        assert eval_when("{{x}} == 'hello'", {"x": "hello"}) is True
        assert eval_when("{{x}} == 'hello'", {"x": "world"}) is False

    def test_number_comparisons(self):
        assert eval_when("{{x}} > 5", {"x": 10}) is True
        assert eval_when("{{x}} < 3", {"x": 10}) is False

    def test_not_equal(self):
        assert eval_when("{{x}} != true", {"x": False}) is True
        assert eval_when("{{x}} != 'hello'", {"x": "world"}) is True


# ── expected evaluator ──

class TestExpected:
    def _step(self, step_id, matched=True, actor="assistant", action="asks"):
        return {"behavior_id": step_id, "matched": matched,
                "behavior_actor": actor, "behavior_action": action, "behavior_target": None}

    def test_skips_when_condition_not_met(self):
        result = evaluate_expected(
            [self._step("ask", matched=False)],
            {"behavior": "ask", "when": "{{shouldAsk}} == true"},
            {"shouldAsk": False},
        )
        assert result.passed is True
        assert "when condition not met" in result.reason

    def test_fails_when_expected_behavior_did_not_match(self):
        result = evaluate_expected(
            [self._step("ask", matched=False)],
            {"behavior": "ask", "when": "{{shouldAsk}} == true"},
            {"shouldAsk": True},
        )
        assert result.passed is False

    def test_fails_with_custom_reason(self):
        result = evaluate_expected(
            [self._step("ask", matched=False)],
            {"behavior": "ask", "when": "{{shouldAsk}} == true", "reason": "Should have asked!"},
            {"shouldAsk": True},
        )
        assert result.passed is False
        assert result.reason == "Should have asked!"

    def test_passes_when_behavior_matched(self):
        result = evaluate_expected(
            [self._step("ask", matched=True)],
            {"behavior": "ask", "when": "{{shouldAsk}} == true"},
            {"shouldAsk": True},
        )
        assert result.passed is True

    def test_validates_after_constraint(self):
        steps = [
            {"behavior_id": "user_asks", "matched": True,
             "behavior_actor": "user", "behavior_action": "says", "behavior_target": None},
            {"behavior_id": "ask", "matched": True,
             "behavior_actor": "assistant", "behavior_action": "asks", "behavior_target": None},
        ]
        result = evaluate_expected(steps, {
            "behavior": "ask",
            "after": {"actor": "user", "action": "says"},
        }, {})
        assert result.passed is True

    def test_fails_after_constraint_when_order_wrong(self):
        steps = [
            {"behavior_id": "ask", "matched": True,
             "behavior_actor": "assistant", "behavior_action": "asks", "behavior_target": None},
            {"behavior_id": "user_asks", "matched": True,
             "behavior_actor": "user", "behavior_action": "says", "behavior_target": None},
        ]
        result = evaluate_expected(steps, {
            "behavior": "ask",
            "after": {"actor": "user", "action": "says"},
            "reason": "Should ask after user speaks",
        }, {})
        assert result.passed is False

    def test_fails_when_behavior_not_found(self):
        result = evaluate_expected([], {"behavior": "nonexistent"}, {})
        assert result.passed is False
        assert "not found" in result.reason


# ── Parser: optional and requires ──

class TestParserV02:
    def test_parses_optional_and_requires(self):
        yaml = """
session: Test
abs_version: "0.2"
behaviors:
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
  - id: give_id
    actor: user
    action: says
    content: "{{cases.orderId}}"
    requires: ask_id
"""
        session = parse(yaml)
        assert len(session.behaviors) == 2
        assert session.behaviors[0].optional is True
        assert session.behaviors[1].requires == "ask_id"

    def test_parses_matches_when(self):
        yaml = """
session: Test
abs_version: "0.2"
behaviors:
  - id: ask
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: llm_judge
      criteria: "The agent is requesting the order ID"
"""
        session = parse(yaml)
        mw = session.behaviors[0].matches_when
        assert mw is not None
        assert mw["type"] == "llm_judge"
        assert mw["criteria"] == "The agent is requesting the order ID"

    def test_rejects_invalid_requires_reference(self):
        yaml = """
session: Test
behaviors:
  - actor: user
    action: says
  - actor: assistant
    action: informs
    requires: nonexistent
"""
        with pytest.raises(ValueError, match=r'requires.*nonexistent'):
            parse(yaml)

    def test_rejects_sequence_referencing_optional(self):
        yaml = """
session: Test
behaviors:
  - id: ask
    actor: assistant
    action: asks
    optional: true
  - actor: assistant
    action: informs
evaluations:
  - type: sequence
    order:
      - {actor: assistant, action: asks}
      - {actor: assistant, action: informs}
"""
        with pytest.raises(ValueError, match=r'sequence.*optional'):
            parse(yaml)

    def test_v01_parses_without_optional_fields(self):
        yaml = """
session: Test
behaviors:
  - actor: user
    action: says
    content: hi
evaluations:
  - type: sequence
    order:
      - {actor: user, action: says}
"""
        session = parse(yaml)
        assert len(session.behaviors) == 1
        assert session.behaviors[0].optional is False

    def test_parses_expected_evaluation(self):
        yaml = """
session: Test
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: hi
evaluations:
  - type: expected
    behavior: ask_id
    when: "{{cases.hasOrderId}} == false"
    reason: "Should ask for ID"
"""
        session = parse(yaml)
        ev = session.evaluations[0]
        assert ev["type"] == "expected"
        assert ev["behavior"] == "ask_id"
        assert ev["when"] == "{{cases.hasOrderId}} == false"
        assert ev["reason"] == "Should ask for ID"
