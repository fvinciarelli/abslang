"""Reference-based text metrics (f1, bleu, rouge) and ground_truth resolution."""

import pytest

from abslang.evaluators import (
    ObservedStep,
    apply_threshold,
    bleu_metric,
    evaluate_step,
    f1_score_metric,
    rouge_metric,
)
from abslang.parser import Behavior, resolve_variables


# Vectors are shared with the TypeScript implementation (text-metrics.test.ts):
# both implementations must produce the same scores.
VECTORS = [
    ("The cat sat on the mat", "The cat sat on the mat", 1.0, 1.0, 1.0),
    ("The cat sat on the mat", "The cat is on the mat", 0.833333, 0.488923, 0.833333),
    ("The cat sat on the mat", "A dog runs in the park", 0.166667, 0.220896, 0.166667),
    ("paris is the capital of france", "the capital of france is paris", 1.0, 0.668740, 0.666667),
    ("short answer", "a much longer reference answer with many extra words", 0.181818, 0.017434, 0.181818),
    ("", "something", 0.0, 0.0, 0.0),
]


class TestMetricVectors:
    @pytest.mark.parametrize("response,ground_truth,f1,bleu,rouge_l", VECTORS)
    def test_f1(self, response, ground_truth, f1, bleu, rouge_l):
        score, details = f1_score_metric(response, ground_truth)
        assert score == pytest.approx(f1, abs=1e-5)
        assert details["f1"] == pytest.approx(f1, abs=1e-5)

    @pytest.mark.parametrize("response,ground_truth,f1,bleu,rouge_l", VECTORS)
    def test_bleu(self, response, ground_truth, f1, bleu, rouge_l):
        score, _ = bleu_metric(response, ground_truth)
        assert score == pytest.approx(bleu, abs=1e-5)

    @pytest.mark.parametrize("response,ground_truth,f1,bleu,rouge_l", VECTORS)
    def test_rouge_l(self, response, ground_truth, f1, bleu, rouge_l):
        score, details = rouge_metric(response, ground_truth, "rougeL")
        assert score == pytest.approx(rouge_l, abs=1e-5)
        assert details["variant"] == "rougeL"
        assert set(details) >= {"precision", "recall", "f1"}


class TestEvaluateStep:
    def _obs(self, content):
        return ObservedStep(actor="assistant", action="informs", content=content)

    def test_ground_truth_self_uses_declared_content(self):
        behavior = Behavior(
            actor="assistant", action="informs",
            content="The cat sat on the mat",
            evaluations=[{"type": "f1", "ground_truth": "self", "threshold": 0.9}],
        )
        observed = self._obs("The cat sat on the mat")
        rule = behavior.evaluations[0]
        result = apply_threshold(evaluate_step(observed, rule, [behavior], [observed], behavior), rule)
        assert result.passed
        assert result.score == pytest.approx(1.0)
        assert result.threshold == 0.9

    def test_ground_truth_behavior_id_reference(self):
        trace = [
            ObservedStep(actor="user", action="says", content="where is my order"),
            ObservedStep(actor="tool", action="responds", id="kb", content="The order shipped today"),
            ObservedStep(actor="assistant", action="informs", content="Your order shipped today"),
        ]
        behavior = Behavior(
            actor="assistant", action="informs", content="",
            evaluations=[{"type": "f1", "ground_truth": "kb.responds", "response": "self"}],
        )
        result = evaluate_step(trace[-1], behavior.evaluations[0], [behavior], trace, behavior)
        assert result.score > 0.7

    def test_missing_ground_truth(self):
        result = evaluate_step(self._obs("x"), {"type": "bleu"}, [], [], None)
        assert not result.passed
        assert result.code == "evaluator.missing_input"

    def test_invalid_rouge_variant(self):
        result = evaluate_step(
            self._obs("x"), {"type": "rouge", "ground_truth": "x", "variant": "rouge9"}, [], [], None
        )
        assert result.code == "evaluator.invalid_option"

    def test_rouge_metric_selector(self):
        rule = {"type": "rouge", "ground_truth": "the cat sat", "variant": "rouge1", "metric": "recall"}
        result = evaluate_step(self._obs("the cat"), rule, [], [], None)
        assert result.score == pytest.approx(2 / 3)
        assert result.details["metric"] == "recall"
        assert result.details["f1"] == pytest.approx(0.8)

    def test_threshold_sets_code(self):
        rule = {"type": "f1", "ground_truth": "a b c d", "threshold": 0.99}
        result = apply_threshold(
            evaluate_step(self._obs("a b"), rule, [], [], None), rule
        )
        assert not result.passed
        assert result.code == "evaluator.threshold_not_met"
        assert result.threshold == 0.99

    def test_dataset_placeholder_resolved_inside_evaluations(self):
        behavior = Behavior(
            actor="assistant", action="informs", content="{{cases.answer}}",
            evaluations=[{"type": "f1", "ground_truth": "{{cases.expected}}", "threshold": 0.5}],
        )
        resolved = resolve_variables(
            [behavior], {"cases.answer": "refund approved", "cases.expected": "refund approved"}
        )
        assert resolved[0].evaluations[0]["ground_truth"] == "refund approved"
        observed = self._obs("refund approved")
        result = evaluate_step(
            observed, resolved[0].evaluations[0], resolved, [observed], resolved[0]
        )
        assert result.passed
        assert result.score == pytest.approx(1.0)
