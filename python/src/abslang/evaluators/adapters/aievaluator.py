"""AI Evaluator adapter — LLM-as-judge via the aievaluator package.

Uses the official AI Evaluator APIClient for all LLM judge evaluations.
Falls back gracefully if aievaluator is not installed.
"""

from typing import Any

from .. import ObservedStep, EvalResult, register_adapter


def _get_client():
    """Get AI Evaluator APIClient. Returns None if not installed."""
    try:
        from aievaluator.api.client import APIClient  # type: ignore
        from aievaluator.config import resolve_api_key, resolve_engine_url  # type: ignore

        api_key = None
        engine_url = "https://api.aievaluator.dev"
        try:
            api_key = resolve_api_key(None)
            engine_url = resolve_engine_url(None)
        except Exception:
            pass

        return APIClient(engine_url=engine_url, api_key=api_key, timeout=60)
    except ImportError:
        return None


async def llm_judge_adapter(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    """Evaluate using AI Evaluator's LLM judge."""
    client = _get_client()
    if client is None:
        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason="AI Evaluator not installed. Run: pip install aievaluator",
        )

    criteria = evaluation.get("criteria", "Is the response helpful and accurate?")

    # Build a prompt from the trace
    trace_text = "\n".join(
        f"[{s.actor}] {s.action}{' → ' + s.target if s.target else ''}: "
        f"{s.content if isinstance(s.content, str) else str(s.content)}"
        for s in trace
    )

    query = f"Given this conversation:\n\n{trace_text}\n\nEvaluate: {criteria}"

    try:
        # Use playground if no API key (5 free/day), else sync endpoint
        if client.api_key:
            result = await client.evaluate_sync(
                rows=[{"input": query}],
                agent_url="http://localhost/chat",  # Not used — we pass the trace in the query
                agent_format="openai",
                metrics=["g_eval"],
                judge_model=None,  # Use default
            )
        else:
            result = await client.playground_evaluate(
                queries=[query],
                metrics=["g_eval"],
            )

        results = result.get("results", [])
        if results:
            r = results[0]
            score = r.get("scores", {}).get("g_eval", 0.5)
            return EvalResult(
                type="llm_judge",
                passed=score >= 0.7,
                score=score,
                reason=r.get("agent_response", str(r.get("scores", {}))),
            )

        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason="No result from AI Evaluator",
        )

    except Exception as e:
        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason=f"AI Evaluator error: {e}",
        )


# Register adapters
register_adapter("llm_judge", llm_judge_adapter)
register_adapter("g_eval", llm_judge_adapter)
register_adapter("faithfulness", llm_judge_adapter)


# Compatibility alias for the old configure() function
def configure(api_key: str | None = None, engine_url: str | None = None, judge_model: str | None = None) -> None:
    """Configure AI Evaluator. Kept for backwards compatibility with old API."""
    import os
    if api_key:
        os.environ["AIEVALUATOR_API_KEY"] = api_key
    if engine_url:
        os.environ["AIEVALUATOR_ENGINE_URL"] = engine_url


def get_config() -> dict[str, str | None]:
    """Get current config. Kept for backwards compatibility."""
    import os
    return {
        "api_key": os.environ.get("AIEVALUATOR_API_KEY"),
        "engine_url": os.environ.get("AIEVALUATOR_ENGINE_URL", "https://api.aievaluator.dev"),
        "judge_model": "deepseek",
    }
