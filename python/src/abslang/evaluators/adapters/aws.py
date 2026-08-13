"""
AWS adapter — Bedrock backend (LLM-as-judge).

Registers an adapter for ``llm_judge`` and ``custom`` evaluators using an Amazon
Bedrock model as the judge (via the Converse API). No spans, no AgentCore: the
adapter builds a judge prompt from the ABS trace and calls a Bedrock model
directly.

The AgentCore Evaluations backend (on-demand ``Evaluate`` over OpenTelemetry
spans) is a separate, later phase — see the plan.
"""

import asyncio
import os
import re
from typing import Any

from .. import ObservedStep, EvalResult
from ..trace_utils import resolve_ref, trace_to_text
from ..builtin_judge import JUDGE_SYSTEM

DEFAULT_MODEL_ID = "anthropic.claude-3-5-haiku-20241022-v1:0"


# ── Config ──

_client: Any = None


def configure(
    region: str | None = None,
    profile: str | None = None,
    evaluator_model: str | None = None,
) -> None:
    """Prepare the AWS adapter. All values default to environment variables."""
    global _client
    if region:
        os.environ["AWS_REGION"] = region
    if profile:
        os.environ["AWS_PROFILE"] = profile
    if evaluator_model:
        os.environ["BEDROCK_EVALUATOR_MODEL_ID"] = evaluator_model
    _client = None


def _get_client() -> Any:
    global _client
    if _client is not None:
        return _client
    try:
        import boto3  # type: ignore

        session_kwargs: dict[str, Any] = {}
        region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
        if region:
            session_kwargs["region_name"] = region
        profile = os.environ.get("AWS_PROFILE")
        if profile:
            session_kwargs["profile_name"] = profile
        _client = boto3.Session(**session_kwargs).client("bedrock-runtime")
        return _client
    except Exception:
        return None


def _model_id() -> str:
    return os.environ.get("BEDROCK_EVALUATOR_MODEL_ID", DEFAULT_MODEL_ID)


# ── Converse call ──

def _converse(system: str, prompt: str) -> str:
    """Call a Bedrock model via the Converse API and return the text reply."""
    client = _get_client()
    if client is None:
        raise RuntimeError("boto3 is not installed or AWS credentials are not configured")
    resp = client.converse(
        modelId=_model_id(),
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"temperature": 0.0, "maxTokens": 512},
    )
    content = resp["output"]["message"]["content"]
    return "".join(block.get("text", "") for block in content if isinstance(block, dict))


# ── Response parsing ──

def _parse_judge_response(content: str) -> tuple[float | None, str]:
    score: float | None = None
    reason = content[:200]
    m = re.search(r"Score:\s*(\d+(?:\.\d+)?)", content)
    if m:
        try:
            score = float(m.group(1))
        except ValueError:
            score = None
    m = re.search(r"Reason:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
    if m:
        reason = m.group(1).strip()[:200]
    return score, reason


def _scale_max(rating_scale: Any) -> int:
    """Return the max of a rating scale like '1-5', '0-1', or a bare number."""
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


# ── Prompt interpolation ──

def _interpolate_prompt(
    template: str,
    evaluation: dict[str, Any],
    trace: list[ObservedStep],
    self_content: str,
) -> str:
    values = {
        "criteria": evaluation.get("criteria", ""),
        "response": resolve_ref(trace, evaluation.get("response"), self_content) or self_content,
        "context": resolve_ref(trace, evaluation.get("context"), self_content),
        "query": resolve_ref(trace, evaluation.get("query"), self_content),
        "trace": trace_to_text(trace),
    }
    out = template
    for key, value in values.items():
        out = out.replace("{{" + key + "}}", value)
    return out


# ── Main adapter ──

async def aws_adapter(
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
) -> EvalResult:
    eval_type = evaluation["type"]

    if eval_type == "llm_judge":
        return await _llm_judge(trace, evaluation)
    if eval_type == "custom":
        return await _custom(trace, evaluation)

    return EvalResult(
        type=eval_type,
        passed=False,
        score=0.0,
        reason=(
            f"AWS adapter does not support '{eval_type}' yet. "
            "The Bedrock backend handles llm_judge and custom; sequence/tool_call "
            "evaluation via AgentCore is a later phase."
        ),
    )


def _not_configured(type_name: str) -> EvalResult:
    return EvalResult(
        type=type_name,
        passed=False,
        score=0.0,
        reason=(
            "AWS Bedrock is not configured. Set it up:\n"
            "  pip install boto3\n"
            "  export AWS_REGION=us-east-1\n"
            "  export BEDROCK_EVALUATOR_MODEL_ID=anthropic.claude-3-5-haiku-20241022-v1:0\n"
            "Ensure the AWS credentials (env vars, ~/.aws/credentials, or IAM role) "
            "have bedrock:InvokeModel permission.\n"
            f"Then: abslang run session.abs.yaml --agent $URL --adapter {type_name}=aws"
        ),
    )


async def _llm_judge(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    criteria = evaluation.get("criteria", "Is the response helpful and accurate?")
    prompt = f"Given this conversation:\n\n{trace_to_text(trace)}\n\nEvaluate: {criteria}"

    try:
        content = await asyncio.to_thread(_converse, JUDGE_SYSTEM, prompt)
        score, reason = _parse_judge_response(content)
        if score is None:
            return EvalResult(type="llm_judge", passed=False, score=0.0,
                              reason=f"[aws] Could not parse score from: {content[:200]}")
        score = max(0.0, min(1.0, score))  # JUDGE_SYSTEM is 0-1
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type="llm_judge",
            passed=score >= threshold,
            score=score,
            reason=f"[aws] {reason}",
        )
    except Exception as e:
        msg = str(e)
        if "boto3" in msg.lower() or "not installed" in msg.lower():
            return _not_configured("llm_judge")
        return EvalResult(type="llm_judge", passed=False, score=0.0, reason=f"AWS Bedrock error: {msg}")


async def _custom(trace: list[ObservedStep], evaluation: dict[str, Any]) -> EvalResult:
    eid = evaluation.get("id", "custom")

    template = evaluation.get("prompt") or evaluation.get("criteria")
    if not template:
        return EvalResult(
            type="custom",
            passed=False,
            score=0.0,
            reason=f"AWS custom evaluator '{eid}' requires a 'prompt' (or 'criteria') field.",
        )

    self_content = ""
    for s in reversed(trace):
        if s.actor == "assistant" and s.content:
            self_content = str(s.content)
            break

    prompt = _interpolate_prompt(template, evaluation, trace, self_content)
    rating_scale = evaluation.get("rating_scale", "1-5")
    scale_max = _scale_max(rating_scale)
    system = (
        f"You are an expert evaluator. Score the response on a scale of 1 to {scale_max} "
        f"based on the given criteria. Be strict but fair. Respond in this format:\n\n"
        f"Score: <number between 1 and {scale_max}>\nReason: <one sentence explaining the score>"
    )

    try:
        content = await asyncio.to_thread(_converse, system, prompt)
        raw_score, reason = _parse_judge_response(content)
        if raw_score is None:
            return EvalResult(type="custom", passed=False, score=0.0,
                              reason=f"[aws:{eid}] Could not parse score from: {content[:200]}")
        score = _normalize(raw_score, scale_max)
        threshold = evaluation.get("threshold", 0.5)
        return EvalResult(
            type="custom",
            passed=score >= threshold,
            score=score,
            reason=f"[aws:{eid}] {reason}",
        )
    except Exception as e:
        msg = str(e)
        if "boto3" in msg.lower() or "not installed" in msg.lower():
            return _not_configured("custom")
        return EvalResult(type="custom", passed=False, score=0.0, reason=f"AWS Bedrock error: {msg}")
