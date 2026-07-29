"""Built-in LLM judge — vendor-neutral, uses whatever API key you have.

Detects available providers from environment variables:
    OPENAI_API_KEY     → GPT-4o
    ANTHROPIC_API_KEY  → Claude Sonnet
    GEMINI_API_KEY     → Gemini Flash

Set ABS_JUDGE_PROVIDER to pick one explicitly.
"""

import json
import os
import re
from typing import Any

import httpx


# ── Judge prompt template ──

JUDGE_SYSTEM = """You are an expert evaluator of AI assistant responses. 
Score the response on a scale of 0.0 to 1.0 based on the given criteria.
Be strict but fair. Respond in this format:

Score: <number between 0.0 and 1.0>
Reason: <one sentence explaining the score>"""


def _build_prompt(trace: list[Any], criteria: str) -> str:
    trace_text = "\n".join(
        f"[{s.actor}] {s.action}{' → ' + s.target if s.target else ''}: "
        f"{s.content if isinstance(s.content, str) else json.dumps(s.content)}"
        for s in trace
    )
    return f"Given this conversation:\n\n{trace_text}\n\nEvaluate: {criteria}"


# ── Provider detection ──

def _detect_provider() -> str | None:
    explicit = os.environ.get("ABS_JUDGE_PROVIDER", "").lower()
    if explicit == "openai" and os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if explicit == "anthropic" and os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if explicit == "gemini" and os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    return None


# ── OpenAI judge ──

async def _judge_openai(trace: list[Any], criteria: str) -> dict:
    api_key = os.environ["OPENAI_API_KEY"]
    model = os.environ.get("ABS_JUDGE_MODEL", "gpt-4o")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": JUDGE_SYSTEM},
                    {"role": "user", "content": _build_prompt(trace, criteria)},
                ],
                "temperature": 0.0,
                "max_tokens": 512,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return _parse_response(content, "openai")


# ── Anthropic judge ──

async def _judge_anthropic(trace: list[Any], criteria: str) -> dict:
    api_key = os.environ["ANTHROPIC_API_KEY"]
    model = os.environ.get("ABS_JUDGE_MODEL", "claude-sonnet-4-20250514")

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "system": JUDGE_SYSTEM,
                "messages": [{"role": "user", "content": _build_prompt(trace, criteria)}],
                "max_tokens": 512,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["content"][0]["text"]
        return _parse_response(content, "anthropic")


# ── Gemini judge ──

async def _judge_gemini(trace: list[Any], criteria: str) -> dict:
    api_key = os.environ["GEMINI_API_KEY"]
    model = os.environ.get("ABS_JUDGE_MODEL", "gemini-2.0-flash")

    full_prompt = f"{JUDGE_SYSTEM}\n\n{_build_prompt(trace, criteria)}"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": full_prompt}]}],
                "generationConfig": {"maxOutputTokens": 512},
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_response(content, "gemini")


# ── Response parser ──

def _parse_response(content: str, provider: str) -> dict:
    score = 0.5
    reason = content[:200]

    score_match = re.search(r"Score:\s*(0?\.?\d+|[01](?:\.\d+)?)", content)
    if score_match:
        try:
            score = float(score_match.group(1))
            score = max(0.0, min(1.0, score))
        except ValueError:
            pass

    reason_match = re.search(r"Reason:\s*(.+?)(?:\n|$)", content, re.IGNORECASE)
    if reason_match:
        reason = reason_match.group(1).strip()[:200]

    return {
        "passed": score >= 0.7,
        "score": score,
        "reason": f"[{provider}] {reason}",
    }


# ── Mock judge (demos/testing, no API key needed) ──

def _mock_judge(trace: list[Any], evaluation: dict[str, Any]) -> Any:
    """Mock judge that returns a fixed score. For demos without API keys."""
    from . import EvalResult
    criteria = evaluation.get("criteria", "")
    # Simple heuristic: check if the last assistant response looks reasonable
    last_content = ""
    for s in reversed(trace):
        if s.actor == "assistant" and s.content:
            last_content = str(s.content)
            break

    # Give a reasonable mock score based on content length and keywords
    score = 0.85  # Default: good
    if not last_content:
        score = 0.3
    elif len(last_content) < 10:
        score = 0.4

    return EvalResult(
        type="llm_judge",
        passed=score >= 0.7,
        score=score,
        reason=f"[mock] Response seems {'good' if score >= 0.7 else 'weak'} "
               f"(content length: {len(last_content)} chars). "
               f"Criteria: {criteria[:80]}",
    )


# ── Main entry point (called from evaluators/__init__.py) ──

async def evaluate(trace: list[Any], evaluation: dict[str, Any]) -> Any:
    """Built-in LLM judge. Returns EvalResult-compatible dict."""
    from . import EvalResult  # Lazy import to avoid circular dependency

    provider = _detect_provider()

    if not provider:
        # Mock judge for demos/testing — no API key needed
        if os.environ.get("ABS_MOCK_JUDGE", "").lower() in ("1", "true", "yes"):
            return _mock_judge(trace, evaluation)
        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason=(
                "No LLM provider available. Set one of:\n"
                "  OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY\n"
                "For demos without API keys: ABS_MOCK_JUDGE=true"
            ),
        )

    criteria = evaluation.get("criteria", "Is the response helpful and accurate?")

    try:
        if provider == "openai":
            result = await _judge_openai(trace, criteria)
        elif provider == "anthropic":
            result = await _judge_anthropic(trace, criteria)
        elif provider == "gemini":
            result = await _judge_gemini(trace, criteria)
        else:
            return EvalResult(type="llm_judge", passed=False, score=0.0, reason=f"Unknown provider: {provider}")

        return EvalResult(
            type="llm_judge",
            passed=result["passed"],
            score=result["score"],
            reason=result["reason"],
        )
    except Exception as e:
        return EvalResult(
            type="llm_judge",
            passed=False,
            score=0.0,
            reason=f"Judge error ({provider}): {e}",
        )
