"""The JSON report shape must stay identical in Python and TypeScript.

Mirrors typescript/src/__tests__/report.test.ts — same keys, same omissions.
"""

from abslang.evaluators import EvalResult, ObservedStep
from abslang.report import eval_to_dict, observed_to_dict


def test_eval_to_dict_is_python_typescript_compatible():
    e = EvalResult(
        type="Groundedness",
        passed=False,
        score=0.4,
        reason="score below threshold",
        threshold=0.8,
        adapter="azure",
        code="evaluator.threshold_not_met",
        duration_ms=412,
    )
    assert eval_to_dict(e) == {
        "type": "Groundedness",
        "passed": False,
        "score": 0.4,
        "reason": "score below threshold",
        "blocking": False,
        "inconclusive": False,
        "code": "evaluator.threshold_not_met",
        "threshold": 0.8,
        "adapter": "azure",
        "duration_ms": 412,
    }


def test_eval_to_dict_keeps_details_and_flags():
    e = EvalResult(
        type="llm_judge",
        passed=False,
        score=0,
        reason="unsafe",
        blocking=True,
        inconclusive=True,
        details={"raw": {"verdict": "unsafe"}},
    )
    out = eval_to_dict(e)
    assert out["blocking"] is True
    assert out["inconclusive"] is True
    assert out["details"] == {"raw": {"verdict": "unsafe"}}
    assert "duration_ms" not in out


def test_observed_to_dict_includes_tool_arguments():
    o = ObservedStep(
        actor="assistant",
        action="calls",
        target="Order MCP",
        with_={"orderId": "12345"},
        tool_call_id="call_1",
        id="internal-step-id",
    )
    assert observed_to_dict(o) == {
        "actor": "assistant",
        "action": "calls",
        "target": "Order MCP",
        "with": {"orderId": "12345"},
        "tool_call_id": "call_1",
    }
    assert observed_to_dict(None) is None
