"""
Google Vertex AI Evaluation adapter.

Routes ABS LLM-based evaluations through the Vertex AI Gen AI Evaluation service
using the classic ``vertexai.evaluation`` SDK (EvalTask + PointwiseMetric) in
bring-your-own-response (BYOR) mode: ABS already has the response, so we evaluate a
single row without model inference.

Scores are normalized to 0-1 before returning; the runner applies ``threshold``.
"""

import asyncio
import os
import re
from typing import Any

from .. import ObservedStep, EvalResult
from ..trace_utils import resolve_ref, trace_to_text


# ── Metric mapping ──

# ABS type -> MetricPromptTemplateExamples.Pointwise attribute name
_POINTWISE_ATTR = {
    "Groundedness": "GROUNDEDNESS",
    "Relevance": "QUESTION_ANSWERING_QUALITY",
    "Coherence": "COHERENCE",
    "Fluency": "FLUENCY",
    # safety types all map to the single SAFETY metric (0=unsafe, 1=safe)
    "HateUnfairness": "SAFETY",
    "Violence": "SAFETY",
    "Sexual": "SAFETY",
    "SelfHarm": "SAFETY",
}

SAFETY_TYPES = {"HateUnfairness", "Violence", "Sexual", "SelfHarm"}


# ── Config ──

def configure(
    project: str | None = None,
    location: str | None = None,
    credentials: str | None = None,
) -> None:
    """Prepare the Google adapter. All values default to environment variables."""
    if project:
        os.environ["GOOGLE_CLOUD_PROJECT"] = project
    if location:
        os.environ["GOOGLE_CLOUD_LOCATION"] = location
    if credentials:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials


def _get_project() -> str | None:
    return os.environ.get("GOOGLE_CLOUD_PROJECT")


def _get_location() -> str:
    return os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")


def _sdk_available() -> bool:
    try:
        import vertexai  # noqa: F401

        return True
    except Exception:
        return False


# ── Helpers ──

def _last_assistant_content(trace: list[ObservedStep]) -> str:
    for s in reversed(trace):
        if s.actor == "assistant" and s.content:
            return str(s.content)
    return ""


def _scale_max(rating_scale: Any) -> int:
    s = str(rating_scale)
    m = re.search(r"(\d+)\s*$", s)
    if m:
        return int(m.group(1))
    return 5


def _normalize(value: float, scale_max: int) -> float:
    v = float(value)
    if scale_max > 1:
        v = v / scale_max
    return max(0.0, min(1.0, v))


def _not_configured(type_name: str) -> EvalResult:
    return EvalResult(
        type=type_name,
        passed=False,
        score=0.0,
        reason=(
            "Google Vertex AI Evaluation is not configured. Set it up:\n"
            "  pip install 'abslang[google]'\n"
            "  export GOOGLE_CLOUD_PROJECT=your-project\n"
            "  export GOOGLE_CLOUD_LOCATION=us-central1\n"
            "  gcloud auth application-default login   # or GOOGLE_APPLICATION_CREDENTIALS\n"
            f"Then: abslang run session.abs.yaml --agent $URL --adapter {type_name}=google"
        ),
    )


def _build_managed_metric(abs_type: str) -> tuple[Any, str]:
    """Return (metric, metric_name) for a managed pointwise metric."""
    from vertexai.evaluation import MetricPromptTemplateExamples

    attr = _POINTWISE_ATTR[abs_type]
    metric = getattr(MetricPromptTemplateExamples.Pointwise, attr)
    if isinstance(metric, str):
        return metric, metric
    name = getattr(metric, "metric", None) or getattr(metric, "metric_name", None) or attr.lower()
    return metric, name


def _build_custom_metric(name: str, criteria: str, scale_max: int) -> tuple[Any, str]:
    from vertexai.evaluation import PointwiseMetric, PointwiseMetricPromptTemplate

    rubric = {str(scale_max): "Excellent — fully meets the criteria."}
    if scale_max > 1:
        rubric[str(scale_max - 1)] = "Good — mostly meets the criteria."
        rubric[str(max(1, scale_max // 2))] = "Partial — meets some criteria."
    rubric["1"] = "Poor — does not meet the criteria."

    template = PointwiseMetricPromptTemplate(
        criteria={"criteria": criteria},
        rating_rubric=rubric,
        input_variables=["prompt", "response"],
    )
    metric = PointwiseMetric(metric=name, metric_prompt_template=template)
    return metric, name


def _extract(result: Any, metric_name: str) -> tuple[float, str]:
    table = getattr(result, "metrics_table", None)
    score: float | None = None
    reason = ""

    if table is not None:
        score_col = f"{metric_name}/score"
        expl_col = f"{metric_name}/explanation"
        try:
            if score_col in table.columns:
                score = float(table.iloc[0][score_col])
            if expl_col in table.columns:
                reason = str(table.iloc[0][expl_col])
        except Exception:
            pass
        if score is None:
            for col in table.columns:
                if col.endswith("/score"):
                    try:
                        score = float(table.iloc[0][col])
                        break
                    except Exception:
                        pass

    if score is None:
        summary = getattr(result, "summary_metrics", {})
        mean_key = f"{metric_name}/mean"
        if summary and mean_key in summary:
            score = float(summary[mean_key])

    if score is None:
        score = 0.0
    return score, reason


def _evaluate_single(metric: Any, variables: dict[str, str]) -> tuple[float, str]:
    """Run a single-row BYOR evaluation. Executed in a thread by the caller."""
    import pandas as pd
    from vertexai.evaluation import EvalTask

    df = pd.DataFrame([variables])
    result = EvalTask(dataset=df, metrics=[metric]).evaluate()
    metric_name = _metric_name_of(metric)
    return _extract(result, metric_name)


def _metric_name_of(metric: Any) -> str:
    if isinstance(metric, str):
        return metric
    return getattr(metric, "metric", None) or getattr(metric, "metric_name", None) or "metric"


# ── Main adapter ──

async def google_adapter(
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
) -> EvalResult:
    eval_type = evaluation["type"]

    if eval_type == "llm_judge":
        return await _llm_judge(trace, evaluation)
    if eval_type == "custom":
        return await _custom(trace, evaluation)
    if eval_type in _POINTWISE_ATTR:
        return await _managed(trace, evaluation, eval_type)

    return EvalResult(
        type=eval_type,
        passed=False,
        score=0.0,
        reason=f"Google adapter does not support evaluator type: {eval_type}",
    )


def _resolve_inputs(trace: list[ObservedStep], evaluation: dict[str, Any]) -> dict[str, str]:
    self_content = _last_assistant_content(trace)
    response = resolve_ref(trace, evaluation.get("response"), self_content) or self_content
    query = resolve_ref(trace, evaluation.get("query"), self_content)
    context = resolve_ref(trace, evaluation.get("context"), self_content)
    if not query:
        query = trace_to_text(trace)
    return {"prompt": query, "context": context, "response": response}


async def _managed(trace: list[ObservedStep], evaluation: dict[str, Any], eval_type: str) -> EvalResult:
    if not _sdk_available():
        return EvalResult(type=eval_type, passed=False, score=0.0,
                          reason="google-cloud-aiplatform is not installed. Run: pip install 'abslang[google]'")
    if not _get_project():
        return _not_configured(eval_type)

    try:
        metric, metric_name = _build_managed_metric(eval_type)
        variables = _resolve_inputs(trace, evaluation)
        score, reason = await asyncio.to_thread(_evaluate_single, metric, variables)
        # SAFETY returns 0=unsafe, 1=safe — already 0-1 and "higher = safer".
        # Other managed metrics are 0-1 (passing rate) — clamp defensively.
        score = max(0.0, min(1.0, score))
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type=eval_type,
            passed=score >= threshold,
            score=score,
            reason=f"[{metric_name}] {reason}" if reason else f"[{metric_name}] score {score:.2f}",
        )
    except Exception as e:
        return EvalResult(type=eval_type, passed=False, score=0.0, reason=f"Google {eval_type} error: {e}")


async def _llm_judge(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    if not _sdk_available():
        return EvalResult(type="llm_judge", passed=False, score=0.0,
                          reason="google-cloud-aiplatform is not installed. Run: pip install 'abslang[google]'")
    if not _get_project():
        return _not_configured("llm_judge")

    criteria = evaluation.get("criteria") or evaluation.get("prompt") or "Is the response helpful and accurate?"
    scale_max = _scale_max(evaluation.get("rating_scale", "1-5"))

    try:
        metric, metric_name = _build_custom_metric("llm_judge", criteria, scale_max)
        variables = _resolve_inputs(trace, evaluation)
        raw_score, reason = await asyncio.to_thread(_evaluate_single, metric, variables)
        score = _normalize(raw_score, scale_max)
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type="llm_judge",
            passed=score >= threshold,
            score=score,
            reason=f"[{metric_name}] {reason}" if reason else f"[{metric_name}] score {score:.2f}",
        )
    except Exception as e:
        return EvalResult(type="llm_judge", passed=False, score=0.0, reason=f"Google judge error: {e}")


async def _custom(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    if not _sdk_available():
        return EvalResult(type="custom", passed=False, score=0.0,
                          reason="google-cloud-aiplatform is not installed. Run: pip install 'abslang[google]'")
    if not _get_project():
        return _not_configured("custom")

    eid = evaluation.get("id", "custom")
    criteria = evaluation.get("criteria") or evaluation.get("prompt")
    if not criteria:
        return EvalResult(type="custom", passed=False, score=0.0,
                          reason=f"Google custom evaluator '{eid}' requires a 'criteria' or 'prompt' field.")
    scale_max = _scale_max(evaluation.get("rating_scale", "1-5"))

    try:
        metric, metric_name = _build_custom_metric(eid, criteria, scale_max)
        variables = _resolve_inputs(trace, evaluation)
        raw_score, reason = await asyncio.to_thread(_evaluate_single, metric, variables)
        score = _normalize(raw_score, scale_max)
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type="custom",
            passed=score >= threshold,
            score=score,
            reason=f"[{eid}] {reason}" if reason else f"[{eid}] score {score:.2f}",
        )
    except Exception as e:
        return EvalResult(type="custom", passed=False, score=0.0, reason=f"Google {eid} error: {e}")
