"""Runner — executes ABS sessions against a real agent."""

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

from .parser import Behavior, NormalizedSession, resolve_variables
from .evaluators import (
    ObservedStep,
    EvalResult,
    evaluate_step,
    evaluate_with_adapter,
    matches_selector,
)


# ── Types ──

@dataclass
class AgentMessage:
    role: str
    content: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None


@dataclass
class AgentConfig:
    url: str
    format: str = "openai"
    auth: str = "none"
    token: str | None = None
    refresh_url: str | None = None
    refresh_token: str | None = None
    client_id: str | None = None
    stream: bool = False


@dataclass
class StepResult:
    step: int
    behavior: Behavior
    observed: ObservedStep | None = None
    matched: bool = False
    evaluations: list[EvalResult] = field(default_factory=list)
    sent: bool = False


@dataclass
class RunResult:
    session: str
    agent: str
    passed: bool
    steps: list[StepResult]
    chain_evaluations: list[EvalResult]
    steps_total: int
    steps_matched: int
    evaluations_total: int
    evaluations_passed: int


# ── Agent adapters ──

async def _openai_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {"Content-Type": "application/json"}

    if config.auth == "api_key" and config.token:
        headers["X-API-Key"] = config.token
    elif (config.auth == "bearer" or config.auth == "oauth2") and config.token:
        headers["Authorization"] = f"Bearer {config.token}"

    body: dict[str, Any] = {
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                **({"tool_calls": m.tool_calls} if m.tool_calls else {}),
                **({"tool_call_id": m.tool_call_id} if m.tool_call_id else {}),
                **({"name": m.name} if m.name else {}),
            }
            for m in messages
        ],
        "tools": [{"type": "function", "function": {"name": "any", "description": "Tool", "parameters": {}}}],
        "tool_choice": "auto",
    }
    if config.stream:
        body["stream"] = True

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(config.url, json=body, headers=headers)

    if resp.status_code >= 400:
        text = resp.text[:200]
        raise RuntimeError(f"Agent returned {resp.status_code}: {text}")

    # Handle streaming response
    if config.stream:
        full_content = ""
        tool_calls: list[dict[str, Any]] = []
        for line in resp.text.split("\n"):
            if line.startswith("data: "):
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    parsed = json.loads(data_str)
                    delta = parsed.get("choices", [{}])[0].get("delta", {})
                    if delta.get("content"):
                        full_content += delta["content"]
                    if delta.get("tool_calls"):
                        for tc in delta["tool_calls"]:
                            idx = tc.get("index", 0)
                            while len(tool_calls) <= idx:
                                tool_calls.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                            if tc.get("id"):
                                tool_calls[idx]["id"] = tc["id"]
                            if tc.get("function", {}).get("name"):
                                tool_calls[idx]["function"]["name"] += tc["function"]["name"]
                            if tc.get("function", {}).get("arguments"):
                                tool_calls[idx]["function"]["arguments"] += tc["function"]["arguments"]
                except (json.JSONDecodeError, KeyError):
                    pass
        result = AgentMessage(role="assistant", content=full_content or None)
        if tool_calls:
            result.tool_calls = tool_calls
        return [result]

    data = resp.json()
    choice = data.get("choices", [{}])[0].get("message")

    if not choice:
        return []

    result = AgentMessage(
        role=choice.get("role", "assistant"),
        content=choice.get("content"),
    )

    if choice.get("tool_calls"):
        result.tool_calls = choice["tool_calls"]

    return [result]


async def _claude_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "x-api-key": config.token or "",
        "anthropic-version": "2023-06-01",
    }

    system_msgs = [m for m in messages if m.role == "system"]
    chat_msgs = [m for m in messages if m.role != "system"]

    body: dict[str, Any] = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 1024,
        "messages": [
            {"role": "assistant" if m.role == "assistant" else "user", "content": m.content or ""}
            for m in chat_msgs
        ],
    }

    if system_msgs:
        body["system"] = system_msgs[0].content

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(config.url, json=body, headers=headers)

    if resp.status_code >= 400:
        text = resp.text[:200]
        raise RuntimeError(f"Agent returned {resp.status_code}: {text}")

    data = resp.json()
    content = (data.get("content") or [{}])[0]
    text = content.get("text", json.dumps(data.get("content")))

    return [AgentMessage(role="assistant", content=text)]


async def _gemini_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {"Content-Type": "application/json"}

    contents = [
        {
            "role": "model" if m.role == "assistant" else "user",
            "parts": [{"text": m.content or ""}],
        }
        for m in messages if m.role != "system"
    ]

    url = f'{config.url}{"?key=" + config.token if config.token else ""}'

    body: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 1024},
    }

    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(url, json=body, headers=headers)

    if resp.status_code >= 400:
        text = resp.text[:200]
        raise RuntimeError(f"Agent returned {resp.status_code}: {text}")

    data = resp.json()
    candidate = (data.get("candidates") or [{}])[0]
    text = ""
    if candidate.get("content", {}).get("parts"):
        text = candidate["content"]["parts"][0].get("text", "")

    return [AgentMessage(role="assistant", content=text)]


COMM_ACTIONS = {"says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests"}

_AGENT_ADAPTERS = {
    "openai": _openai_adapter,
    "claude": _claude_adapter,
    "gemini": _gemini_adapter,
    "custom": _openai_adapter,
}


# ── Runner ──

async def run(session: NormalizedSession, agent_config: AgentConfig) -> RunResult:
    adapter = _AGENT_ADAPTERS.get(agent_config.format, _openai_adapter)
    trace: list[ObservedStep] = []
    step_results: list[StepResult] = []
    messages: list[AgentMessage] = []
    step_num = 0

    for behavior in session.behaviors:
        step_num += 1

        if behavior.actor == "user":
            messages.append(AgentMessage(
                role="user",
                content=str(behavior.content) if isinstance(behavior.content, str)
                else json.dumps(behavior.content),
            ))

            try:
                new_msgs = await adapter(list(messages), agent_config)
            except Exception as e:
                step_results.append(StepResult(
                    step=step_num, behavior=behavior, matched=False, sent=True,
                ))
                trace.append(ObservedStep(
                    actor="error", action="responds", content=f"Agent error: {e}",
                ))
                continue

            for msg in new_msgs:
                messages.append(msg)

                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        args = _try_parse_json(tc["function"]["arguments"])
                        trace.append(ObservedStep(
                            actor="assistant",
                            action="calls",
                            target=tc["function"]["name"],
                            with_=args if isinstance(args, dict) else None,
                        ))
                elif msg.role == "assistant":
                    trace.append(ObservedStep(
                        actor="assistant",
                        action="responds",
                        content=msg.content,
                    ))

            step_results.append(StepResult(
                step=step_num, behavior=behavior, matched=False, sent=True,
            ))

        elif behavior.actor == "tool" and behavior.action == "responds":
            # Send tool result back to agent
            last_asst = None
            for m in reversed(messages):
                if m.role == "assistant" and m.tool_calls:
                    last_asst = m
                    break

            if last_asst and last_asst.tool_calls:
                for tc in last_asst.tool_calls:
                    messages.append(AgentMessage(
                        role="tool",
                        tool_call_id=tc["id"],
                        name=tc["function"]["name"],
                        content=json.dumps(behavior.content)
                        if not isinstance(behavior.content, str)
                        else behavior.content,
                    ))

            try:
                new_msgs = await adapter(list(messages), agent_config)
                for msg in new_msgs:
                    messages.append(msg)
                    if msg.role == "assistant" and msg.content:
                        trace.append(ObservedStep(
                            actor="assistant", action="responds", content=msg.content,
                        ))
            except Exception:
                pass

            step_results.append(StepResult(
                step=step_num,
                behavior=behavior,
                observed=ObservedStep(
                    actor="tool", action="responds",
                    target=behavior.target, content=behavior.content,
                ),
                matched=True,
            ))

        else:
            # Match against trace — skip tool/responds steps in the index
            # because they bridge the conversation but don't consume trace entries
            matched_idx = sum(
                1 for s in step_results
                if not s.sent and not (s.behavior.actor == "tool" and s.behavior.action == "responds")
            )
            observed = trace[matched_idx] if matched_idx < len(trace) else None

            # Communication actions are equivalent for matching
            matched = observed is not None and (
                observed.actor == behavior.actor
                and (observed.action == behavior.action
                     or (observed.action in COMM_ACTIONS and behavior.action in COMM_ACTIONS))
                and (not behavior.target or observed.target == behavior.target)
            )

            match_observed = observed if matched else None

            # Run step-level evaluations
            eval_results: list[EvalResult] = []
            if behavior.evaluations:
                for rule in behavior.evaluations:
                    adapter_result = await evaluate_with_adapter(
                        rule["type"], trace, rule,
                    )
                    if adapter_result is not None:
                        eval_results.append(adapter_result)
                    else:
                        eval_results.append(
                            evaluate_step(match_observed, rule, session.behaviors, trace)
                        )

            step_results.append(StepResult(
                step=step_num,
                behavior=behavior,
                observed=match_observed,
                matched=matched,
                evaluations=eval_results,
            ))

    # Chain evaluations
    chain_evals: list[EvalResult] = []
    if session.evaluations:
        for rule in session.evaluations:
            adapter_result = await evaluate_with_adapter(rule["type"], trace, rule)
            if adapter_result is not None:
                chain_evals.append(adapter_result)
            else:
                chain_evals.append(
                    evaluate_step(None, rule, session.behaviors, trace)
                )

    all_evals = [e for s in step_results for e in s.evaluations] + chain_evals

    return RunResult(
        session=session.session,
        agent=agent_config.url,
        passed=all(e.passed for e in all_evals),
        steps=step_results,
        chain_evaluations=chain_evals,
        steps_total=len(step_results),
        steps_matched=sum(1 for s in step_results if s.matched or s.sent),
        evaluations_total=len(all_evals),
        evaluations_passed=sum(1 for e in all_evals if e.passed),
    )


def _try_parse_json(s: str) -> Any:
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s
