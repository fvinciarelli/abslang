"""
Azure AI Foundry Evaluation adapter.

Registers an adapter that handles the standard LLM-based dimensions
(Groundedness, Relevance, Coherence, Fluency), free-form ``llm_judge`` via Azure
OpenAI, and vendor-specific ``custom`` evaluators selected by id
(``azure.task_adherence``, ``azure.intent_resolution``, ``azure.tool_call_accuracy``).

Modality A — local SDK: uses ``azure-ai-evaluation`` built-in evaluators with an
Azure OpenAI deployment as the judge. The adapter receives (trace, evaluation),
resolves id-based references, and returns EvalResult. It never re-runs the agent.

Scores are normalized to 0-1 before returning; the runner applies ``threshold``.
"""

import asyncio
import json
import os
from typing import Any

import httpx

from .. import ObservedStep, EvalResult
from ..trace_utils import (
    resolve_ref,
    trace_to_text,
    trace_to_conversation,
    extract_tool_calls,
)
from ..builtin_judge import JUDGE_SYSTEM, _parse_response


# ── Evaluator mapping ──

# standard ABS type -> (evaluator class, metric key, allowed inputs)
EVALUATOR_FACTORIES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "Groundedness": ("GroundednessEvaluator", "groundedness", ("query", "context", "response")),
    "Relevance": ("RelevanceEvaluator", "relevance", ("query", "context", "response")),
    "Coherence": ("CoherenceEvaluator", "coherence", ("query", "response")),
    "Fluency": ("FluencyEvaluator", "fluency", ("response",)),
}

# custom id -> (evaluator class, metric key). Conversation-level agentic evaluators.
CUSTOM_EVALUATORS: dict[str, tuple[str, str]] = {
    "azure.task_adherence": ("TaskAdherenceEvaluator", "task_adherence"),
    "azure.intent_resolution": ("IntentResolutionEvaluator", "intent_resolution"),
    "azure.tool_call_accuracy": ("ToolCallAccuracyEvaluator", "tool_call_accuracy"),
}


# ── Config ──

_evaluators_cache: dict[str, Any] = {}


def configure(
    endpoint: str | None = None,
    api_key: str | None = None,
    deployment: str | None = None,
    api_version: str | None = None,
    project: str | None = None,
) -> None:
    """Prepare the Azure adapter. All values default to environment variables."""
    if endpoint:
        os.environ["AZURE_OPENAI_ENDPOINT"] = endpoint
    if api_key:
        os.environ["AZURE_OPENAI_KEY"] = api_key
    if deployment:
        os.environ["AZURE_OPENAI_DEPLOYMENT"] = deployment
    if api_version:
        os.environ["AZURE_OPENAI_API_VERSION"] = api_version
    if project:
        os.environ["AZURE_AI_PROJECT_CONNECTION_STRING"] = project
    _evaluators_cache.clear()


def _get_model_config() -> dict[str, Any] | None:
    endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT")
    api_key = os.environ.get("AZURE_OPENAI_KEY")
    deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT")
    if not (endpoint and api_key and deployment):
        return None
    cfg: dict[str, Any] = {
        "azure_endpoint": endpoint,
        "api_key": api_key,
        "azure_deployment": deployment,
    }
    api_version = os.environ.get("AZURE_OPENAI_API_VERSION")
    if api_version:
        cfg["api_version"] = api_version
    return cfg


def _sdk_available() -> bool:
    try:
        import azure.ai.evaluation  # noqa: F401

        return True
    except Exception:
        return False


def _make_evaluator(cls_name: str) -> Any:
    if cls_name in _evaluators_cache:
        return _evaluators_cache[cls_name]
    import azure.ai.evaluation as az

    cls = getattr(az, cls_name)
    inst = cls(model_config=_get_model_config())
    _evaluators_cache[cls_name] = inst
    return inst


# ── Result normalization ──

def _normalize(value: float) -> float:
    v = float(value)
    if v > 1.0:
        v = v / 5.0  # 1-5 Likert scale
    return max(0.0, min(1.0, v))


def _extract_result(result: Any, metric_key: str) -> tuple[float, str]:
    """Extract a normalized (score, reason) from a provider result dict."""
    if isinstance(result, dict):
        for key in (metric_key, "score", "value"):
            if key in result and isinstance(result[key], (int, float)):
                return _normalize(result[key]), _extract_reason(result, metric_key)

        label = result.get("label") or result.get("verdict")
        if label is not None:
            passed = str(label).lower() in ("pass", "yes", "true", "good", "correct")
            return (1.0 if passed else 0.0), _extract_reason(result, metric_key)

        if "passed" in result:
            return (1.0 if result["passed"] else 0.0), _extract_reason(result, metric_key)

        for key, value in result.items():
            if isinstance(value, (int, float)) and not key.endswith("_reason"):
                return _normalize(value), _extract_reason(result, metric_key)

        return 0.5, json.dumps(result, default=str)

    # non-dict result
    try:
        return _normalize(float(result)), ""
    except (TypeError, ValueError):
        return 0.5, str(result)[:200]


def _extract_reason(result: dict[str, Any], metric_key: str) -> str:
    for key in (f"{metric_key}_reason", "reason", "explanation", "justification"):
        if result.get(key):
            return str(result[key])
    return ""


# ── Helpers ──

def _not_configured(type_name: str) -> EvalResult:
    return EvalResult(
        type=type_name,
        passed=False,
        score=0.0,
        reason=(
            "Azure AI Evaluation is not configured. Set it up:\n"
            "  pip install azure-ai-evaluation\n"
            "  export AZURE_OPENAI_ENDPOINT=https://<account>.services.ai.azure.com\n"
            "  export AZURE_OPENAI_KEY=...\n"
            "  export AZURE_OPENAI_DEPLOYMENT=<judge-model-deployment>\n"
            f"Then: abslang run session.abs.yaml --agent $URL --adapter {type_name}=azure"
        ),
    )


def _last_assistant_content(trace: list[ObservedStep]) -> str:
    for s in reversed(trace):
        if s.actor == "assistant" and s.content:
            return str(s.content)
    return ""


def _derive_tool_definitions(trace: list[ObservedStep]) -> list[dict[str, Any]]:
    """Derive OpenAI-function tool definitions from observed tool calls."""
    defs: dict[str, dict[str, Any]] = {}
    for s in extract_tool_calls(trace):
        if not s.target or s.target in defs:
            continue
        props: dict[str, Any] = {}
        if isinstance(s.with_, dict):
            for k, v in s.with_.items():
                t = "string"
                if isinstance(v, bool):
                    t = "boolean"
                elif isinstance(v, int):
                    t = "integer"
                elif isinstance(v, float):
                    t = "number"
                elif isinstance(v, (dict, list)):
                    t = "object"
                props[k] = {"type": t}
        defs[s.target] = {
            "type": "function",
            "function": {
                "name": s.target,
                "description": "",
                "parameters": {"type": "object", "properties": props},
            },
        }
    return list(defs.values())


# ── Main adapter ──

async def azure_adapter(
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
) -> EvalResult:
    eval_type = evaluation["type"]

    if eval_type == "llm_judge":
        return await _llm_judge(trace, evaluation)
    if eval_type == "custom":
        return await _custom(trace, evaluation)
    if eval_type in EVALUATOR_FACTORIES:
        return await _builtin(trace, evaluation, eval_type)

    return EvalResult(
        type=eval_type,
        passed=False,
        score=0.0,
        reason=f"Azure adapter does not support evaluator type: {eval_type}",
    )


async def _llm_judge(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    cfg = _get_model_config()
    if not cfg:
        return _not_configured("llm_judge")

    criteria = evaluation.get("criteria", "Is the response helpful and accurate?")
    prompt = f"Given this conversation:\n\n{trace_to_text(trace)}\n\nEvaluate: {criteria}"

    api_version = cfg.get("api_version", "2024-02-15-preview")
    url = (
        f"{cfg['azure_endpoint'].rstrip('/')}/openai/deployments/"
        f"{cfg['azure_deployment']}/chat/completions?api-version={api_version}"
    )
    headers = {"api-key": cfg["api_key"], "Content-Type": "application/json"}
    body = {
        "messages": [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 512,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.post(url, json=body, headers=headers)
        if resp.status_code >= 400:
            return EvalResult(
                type="llm_judge",
                passed=False,
                score=0.0,
                reason=f"Azure judge returned {resp.status_code}: {resp.text[:200]}",
            )
        content = resp.json()["choices"][0]["message"]["content"]
        parsed = _parse_response(content, "azure")
        return EvalResult(
            type="llm_judge",
            passed=parsed["passed"],
            score=parsed["score"],
            reason=parsed["reason"],
        )
    except Exception as e:
        return EvalResult(type="llm_judge", passed=False, score=0.0, reason=f"Azure judge error: {e}")


async def _builtin(
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
    eval_type: str,
) -> EvalResult:
    if not _sdk_available():
        return EvalResult(
            type=eval_type,
            passed=False,
            score=0.0,
            reason="azure-ai-evaluation is not installed. Run: pip install azure-ai-evaluation",
        )
    cfg = _get_model_config()
    if not cfg:
        return _not_configured(eval_type)

    cls_name, metric_key, allowed = EVALUATOR_FACTORIES[eval_type]

    try:
        evaluator = _make_evaluator(cls_name)
    except Exception as e:
        return EvalResult(type=eval_type, passed=False, score=0.0, reason=f"Azure {cls_name} init error: {e}")

    self_content = _last_assistant_content(trace)
    kwargs: dict[str, Any] = {}
    for key in allowed:
        if key == "response":
            kwargs[key] = resolve_ref(trace, evaluation.get("response"), self_content) or self_content
        else:
            kwargs[key] = resolve_ref(trace, evaluation.get(key), self_content)

    try:
        result = await asyncio.to_thread(evaluator, **kwargs)
        score, reason = _extract_result(result, metric_key)
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type=eval_type,
            passed=score >= threshold,
            score=score,
            reason=f"[{metric_key}] {reason}" if reason else f"[{metric_key}] score {score:.2f}",
        )
    except Exception as e:
        return EvalResult(type=eval_type, passed=False, score=0.0, reason=f"Azure {cls_name} error: {e}")


async def _custom(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    eid = evaluation.get("id", "")
    if eid not in CUSTOM_EVALUATORS:
        return EvalResult(
            type="custom",
            passed=False,
            score=0.0,
            reason=f"Unknown Azure custom evaluator: {eid} (available: {', '.join(CUSTOM_EVALUATORS)})",
        )

    if not _sdk_available():
        return EvalResult(
            type="custom",
            passed=False,
            score=0.0,
            reason="azure-ai-evaluation is not installed. Run: pip install azure-ai-evaluation",
        )
    cfg = _get_model_config()
    if not cfg:
        return _not_configured("custom")

    cls_name, metric_key = CUSTOM_EVALUATORS[eid]

    try:
        evaluator = _make_evaluator(cls_name)
    except Exception as e:
        return EvalResult(type="custom", passed=False, score=0.0, reason=f"Azure {cls_name} init error: {e}")

    conv = trace_to_conversation(trace)
    kwargs: dict[str, Any] = {"query": conv["query"], "response": conv["response"]}

    if eid == "azure.tool_call_accuracy":
        td = evaluation.get("tool_definitions") or _derive_tool_definitions(trace)
        if not td:
            return EvalResult(
                type="custom",
                passed=False,
                score=0.0,
                reason="azure.tool_call_accuracy requires tool_definitions (add a tools: block or inline tool_definitions)",
            )
        kwargs["tool_definitions"] = td

    try:
        result = await asyncio.to_thread(evaluator, **kwargs)
        score, reason = _extract_result(result, metric_key)
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type="custom",
            passed=score >= threshold,
            score=score,
            reason=f"[{eid}] {reason}" if reason else f"[{eid}] score {score:.2f}",
        )
    except Exception as e:
        return EvalResult(type="custom", passed=False, score=0.0, reason=f"Azure {eid} error: {e}")
