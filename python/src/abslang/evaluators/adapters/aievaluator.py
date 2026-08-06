"""
AI Evaluator adapter — reference implementation.

Registers a single adapter that handles ALL LLM-based evaluator types
(llm_judge, Groundedness, Relevance, Coherence, Fluency).

The adapter receives (trace, evaluationRule) and returns EvalResult.
It resolves id-based references (query: user_asks.says) from the trace,
maps ABS evaluator types to AI Evaluator metrics, and returns the result.

Other providers (Azure, LangSmith, Galileo, local Ollama) should follow
this same pattern: register one adapter for all types you support,
resolve references from the trace, dispatch by type internally.
"""

import json
from typing import Any

from ..evaluators import ObservedStep, EvalResult, register_adapter


# ── Reference resolution ──

def _resolve_ref(
    ref: str,
    trace: list[ObservedStep],
) -> str:
    """Resolve a reference like 'user_asks.says' or 'kb_result.responds' from the trace.

    'self' is resolved by the caller using the current behavior.
    """
    if ref == "self":
        return ""

    parts = ref.split(".", 1)
    ref_id = parts[0]
    action = parts[1] if len(parts) > 1 else None

    # Default action by actor
    defaults = {"user": "says", "assistant": "informs", "tool": "responds"}
    resolved_action = action or defaults.get(ref_id, "says")

    comm_actions = {"says", "asks", "informs", "greets", "responds",
                    "clarifies", "confirms", "rejects", "suggests", "shows"}

    for step in trace:
        step_matches = step.actor == ref_id
        action_matches = (
            step.action == resolved_action
            or (step.action in comm_actions and resolved_action in comm_actions)
        )
        if step_matches and action_matches:
            return str(step.content) if isinstance(step.content, str) else json.dumps(step.content or "")

    return ref


# ── Metric mapping ──

METRIC_MAP = {
    "llm_judge": "g_eval",
    "Groundedness": "groundedness",
    "Relevance": "relevance",
    "Coherence": "coherence",
    "Fluency": "fluency",
}


# ── AI Evaluator client ──

_client: Any = None


def _get_client() -> Any:
    global _client
    if _client is not None:
        return _client
    try:
        import aievaluator  # type: ignore
        APIClient = getattr(getattr(aievaluator, "api", None), "APIClient", None) or getattr(aievaluator, "APIClient", None)
        if not APIClient:
            return None

        import os
        api_key = os.environ.get("AIEVALUATOR_API_KEY")
        engine_url = os.environ.get("AIEVALUATOR_ENGINE_URL", "https://api.aievaluator.dev")

        try:
            from aievaluator import config  # type: ignore
            if hasattr(config, "resolveApiKey"):
                api_key = config.resolveApiKey(None) or api_key
            if hasattr(config, "resolveEngineUrl"):
                engine_url = config.resolveEngineUrl(None) or engine_url
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
            reason="AI Evaluator not installed. Run: pip install aievaluator",
        )

    eval_type = evaluation["type"]
    metric = METRIC_MAP.get(eval_type, "g_eval")

    # ── Build the evaluation payload ──
    query = ""
    context = ""
    response = ""

    if eval_type == "llm_judge":
        criteria = evaluation.get("criteria", "Is the response helpful and accurate?")
        trace_text = "\n".join(
            f"[{s.actor}] {s.action}{' → ' + s.target if s.target else ''}: "
            f"{s.content if isinstance(s.content, str) else json.dumps(s.content)}"
            for s in trace
        )
        query = f"Given this conversation:\n\n{trace_text}\n\nEvaluate: {criteria}"

    if eval_type in ("Groundedness", "Relevance", "Coherence", "Fluency"):
        # Resolve "self" to the last assistant message
        last_asst = None
        for s in reversed(trace):
            if s.actor == "assistant":
                last_asst = s
                break
        self_content = str(last_asst.content) if last_asst and last_asst.content else ""

        def _resolve(ref: str | None) -> str:
            if not ref:
                return ""
            if ref == "self":
                return self_content
            return _resolve_ref(ref, trace)

        query = _resolve(evaluation.get("query"))
        context = _resolve(evaluation.get("context"))
        response = _resolve(evaluation.get("response"))

    try:
        import httpx

        if client.apiKey:
            input_data: dict[str, str] = {"query": query}
            if context:
                input_data["context"] = context
            if response:
                input_data["response"] = response

            result = client.evaluateSync(
                [input_data],
                "http://localhost/chat",
                "openai",
                [metric],
            )
        else:
            # Playground: 5 free evals/day
            result = client.playgroundEvaluate(
                queries=[query],
                contexts=[context] if context else None,
                responses=[response] if response else None,
                metrics=[metric],
            )

        results = getattr(result, "results", []) or []
        if results:
            r = results[0]
            scores = getattr(r, "scores", {}) or {}
            score = scores.get(metric, scores.get("g_eval", 0.5))
            threshold = evaluation.get("threshold", 0.7)
            reason = getattr(r, "agent_response", None) or json.dumps(scores)
            return EvalResult(
                type=eval_type,
                passed=score >= threshold,
                score=score,
                reason=f"[{metric}] {reason}",
            )

        return EvalResult(
            type=eval_type,
            passed=False,
            score=0.0,
            reason=f"No result from AI Evaluator for metric: {metric}",
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
    """Called via --adapter llm_judge=aievaluator. Registers for all LLM-based types."""
    import os

    global _client
    if api_key:
        os.environ["AIEVALUATOR_API_KEY"] = api_key
    if engine_url:
        os.environ["AIEVALUATOR_ENGINE_URL"] = engine_url
    _client = None

    # Register the same adapter for all LLM-based evaluator types.
    # The adapter dispatches internally based on evaluation.type.
    for t in ("llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency"):
        register_adapter(t, aievaluator_adapter)
