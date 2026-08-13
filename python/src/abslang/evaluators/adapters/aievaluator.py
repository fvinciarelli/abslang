"""
AI Evaluator adapter — reference implementation.

Registers a single adapter that handles ALL LLM-based evaluator types
(llm_judge, Groundedness, Relevance, Coherence, Fluency).

Calls POST /api/v1/evaluations/direct via the aievaluator Python package.
No agent call, no double execution. The adapter receives (trace, evaluationRule),
resolves id-based references from the trace, and returns EvalResult.
"""

import json
import os
from typing import Any

from .. import ObservedStep, EvalResult
from ..trace_utils import resolve_ref, trace_to_text


# ── Metric mapping ──

METRIC_MAP = {
    "llm_judge": "g_eval",
    "Groundedness": "hallucination",
    "Relevance": "answer_relevancy",
    "Coherence": "g_eval",
    "Fluency": "g_eval",
    "faithfulness": "faithfulness",
}


# ── Client ──

_client: Any = None


def _get_client() -> Any:
    global _client
    if _client is not None:
        return _client
    try:
        from aievaluator.api.client import APIClient  # type: ignore

        api_key = os.environ.get("AIEVALUATOR_API_KEY")
        engine_url = os.environ.get("AIEVALUATOR_ENGINE_URL", "https://api.aievaluator.dev")

        try:
            from aievaluator.config import resolveApiKey, resolveEngineUrl  # type: ignore
            api_key = resolveApiKey(None) or api_key
            engine_url = resolveEngineUrl(None) or engine_url
        except Exception:
            pass

        _client = APIClient(engine_url, api_key, 60)
        return _client
    except Exception:
        return None


# ── Main adapter ──

async def aievaluator_adapter(
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
) -> EvalResult:
    client = _get_client()
    if not client:
        return EvalResult(
            type=evaluation["type"],
            passed=False,
            score=0.0,
            reason=(
                "AI Evaluator is not installed. Install it and try again:\n"
                "  pip install aievaluator\n"
                "Then: abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator\n"
                "Free tier: 5 evals/day without API key, 100/month with API key.\n"
                "Get a key at: https://aievaluator.dev"
            ),
        )

    eval_type = evaluation["type"]
    metric = METRIC_MAP.get(eval_type, "g_eval")

    # ── Build payload ──

    input_text = ""
    context = ""
    response = ""

    if eval_type == "llm_judge":
        criteria = evaluation.get("criteria", "Is the response helpful and accurate?")
        trace_text = trace_to_text(trace)
        input_text = f"Given this conversation:\n\n{trace_text}\n\nEvaluate: {criteria}"

        last_asst = None
        for s in reversed(trace):
            if s.actor == "assistant":
                last_asst = s
                break
        response = str(last_asst.content) if last_asst and last_asst.content else ""

    if eval_type in ("Groundedness", "Relevance", "Coherence", "Fluency"):
        last_asst = None
        for s in reversed(trace):
            if s.actor == "assistant":
                last_asst = s
                break
        self_content = str(last_asst.content) if last_asst and last_asst.content else ""

        input_text = resolve_ref(trace, evaluation.get("query"), self_content)
        context = resolve_ref(trace, evaluation.get("context"), self_content)
        response = resolve_ref(trace, evaluation.get("response"), self_content)

    # ── Call /api/v1/evaluations/direct via aievaluator APIClient ──

    try:
        body: dict[str, Any] = {
            "rows": [{"input": input_text, "response": response}],
            "metrics": [metric],
        }
        if context:
            body["rows"][0]["context"] = context

        threshold = evaluation.get("threshold")
        if threshold is not None:
            body["thresholds"] = {metric: threshold}

        import httpx
        engine_url = os.environ.get("AIEVALUATOR_ENGINE_URL", "https://api.aievaluator.dev")
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("AIEVALUATOR_API_KEY")
        if api_key:
            headers["X-API-Key"] = api_key

        async with httpx.AsyncClient(timeout=120) as http:
            resp = await http.post(
                f"{engine_url}/api/v1/evaluations/direct",
                json=body,
                headers=headers,
            )

        if resp.status_code >= 400:
            return EvalResult(
                type=eval_type,
                passed=False,
                score=0.0,
                reason=f"AI Evaluator returned {resp.status_code}: {resp.text[:200]}",
            )

        data = resp.json()

        row = (data.get("results") or [{}])[0]
        if not row:
            return EvalResult(type=eval_type, passed=False, score=0.0, reason="No result from AI Evaluator")

        scores = row.get("scores", {})
        score = scores.get(metric, list(scores.values())[0] if scores else 0.5)
        details = row.get("details", {})
        detail = details.get(metric, list(details.values())[0] if details else {})
        reason = detail.get("reason", json.dumps(scores)) if isinstance(detail, dict) else str(detail)
        threshold_value = evaluation.get("threshold", 0.7)

        return EvalResult(
            type=eval_type,
            passed=score >= threshold_value,
            score=score,
            reason=f"[{metric}] {reason}",
        )
    except Exception as e:
        return EvalResult(
            type=eval_type,
            passed=False,
            score=0.0,
            reason=f"AI Evaluator error: {e}",
        )


# ── Registration ──

def configure(
    api_key: str | None = None,
    engine_url: str | None = None,
    judge_model: str | None = None,
) -> None:
    """Prepare the AI Evaluator client.

    Called via --adapter aievaluator / --adapter <type>=aievaluator. Adapter
    registration (default + named) is handled by the CLI's generic adapter setup.
    """
    global _client
    if api_key:
        os.environ["AIEVALUATOR_API_KEY"] = api_key
    if engine_url:
        os.environ["AIEVALUATOR_ENGINE_URL"] = engine_url
    _client = None
