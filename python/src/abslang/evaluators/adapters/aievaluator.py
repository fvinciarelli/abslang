"""AI Evaluator adapter — LLM-as-judge via aievaluator.dev."""

import json
from typing import Any

import httpx

from .. import ObservedStep, EvalResult, register_adapter

_config: dict[str, str | None] = {
    "api_key": None,
    "engine_url": "https://api.aievaluator.dev",
    "judge_model": "deepseek",
}


def configure(api_key: str | None = None, engine_url: str | None = None, judge_model: str | None = None) -> None:
    if api_key is not None:
        _config["api_key"] = api_key
    if engine_url is not None:
        _config["engine_url"] = engine_url
    if judge_model is not None:
        _config["judge_model"] = judge_model


def get_config() -> dict[str, str | None]:
    return dict(_config)


async def _call_evaluator(trace: list[ObservedStep], criteria: str) -> EvalResult:
    engine_url = _config["engine_url"] or "https://api.aievaluator.dev"

    trace_text = "\n".join(
        f"[{s.actor}] {s.action}{' → ' + s.target if s.target else ''}: "
        f"{s.content if isinstance(s.content, str) else json.dumps(s.content)}"
        for s in trace
    )

    body: dict[str, Any] = {
        "queries": [f"Given this conversation:\n\n{trace_text}\n\nEvaluate: {criteria}"],
        "metrics": ["g_eval"],
        "judge": _config["judge_model"] or "deepseek",
    }

    headers = {"Content-Type": "application/json"}
    if _config["api_key"]:
        headers["X-API-Key"] = _config["api_key"]

    endpoint = (
        f'{engine_url}/api/v1/evaluations/sync'
        if _config["api_key"]
        else f'{engine_url}/api/v1/playground/evaluate'
    )

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(endpoint, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason=f"AI Evaluator request failed: {e}",
        )

    results = data.get("results", [])
    if results:
        r = results[0]
        score = r.get("scores", {}).get("g_eval", 0.5)
        return EvalResult(
            type="llm_judge",
            passed=score >= 0.7,
            score=score,
            reason=r.get("agent_response", "No reason provided by judge"),
        )

    return EvalResult(
        type="llm_judge",
        passed=False,
        score=0.0,
        reason="No result from AI Evaluator",
    )


async def llm_judge_adapter(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    return await _call_evaluator(trace, evaluation.get("criteria", ""))


# Register adapters on import
register_adapter("llm_judge", llm_judge_adapter)
register_adapter("g_eval", llm_judge_adapter)
register_adapter("faithfulness", llm_judge_adapter)
