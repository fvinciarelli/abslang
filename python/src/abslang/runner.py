"""Runner — executes ABS sessions against a real agent."""

import json
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx

from .log import RunLogger
from .parser import Behavior, NormalizedSession, resolve_variables
from .evaluators import (
    ObservedStep,
    EvalResult,
    evaluate_step,
    apply_threshold,
    evaluate_with_adapter,
    evaluate_expected,
    eval_when,
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
    # Model/deployment to send when the endpoint is a raw model (e.g. Azure OpenAI
    # Responses API). Omit it for agent endpoints that own their model.
    model: str | None = None
    forward_auth: bool = False
    authorization: str | None = None
    refresh_url: str | None = None
    refresh_token: str | None = None
    client_id: str | None = None
    stream: bool | None = None
    timeout: int = 300


@dataclass
class StepResult:
    step: int
    behavior: Behavior
    observed: ObservedStep | None = None
    matched: bool = False
    # v0.2: the behavior was optional/requires-gated and intentionally skipped.
    skipped: bool = False
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


def _resolve_forwarded_authorization(
    config: AgentConfig,
    env: Mapping[str, str] | None = None,
) -> str | None:
    """Resolve the raw ``Authorization`` value to forward upstream.

    Order: explicit ``config.authorization`` → ``ABS_AGENT_AUTHORIZATION`` →
    ``HTTP_AUTHORIZATION`` → ``Authorization`` → ``Bearer(ABS_AGENT_TOKEN)``.
    A bare token (no scheme) is normalized to ``Bearer <token>``.
    """
    if not config.forward_auth and not config.authorization:
        return None

    environ = os.environ if env is None else env
    raw = (
        config.authorization
        or environ.get("ABS_AGENT_AUTHORIZATION")
        or environ.get("HTTP_AUTHORIZATION")
        or environ.get("Authorization")
    )

    if raw:
        trimmed = raw.strip()
        if not trimmed:
            return None
        # Already carries a scheme (Bearer, Basic, ...): forward verbatim.
        if " " in trimmed:
            return trimmed
        return f"Bearer {trimmed}"

    token = environ.get("ABS_AGENT_TOKEN")
    if token:
        return f"Bearer {token}"

    raise RuntimeError(
        "Authorization forwarding is enabled but no value was found. "
        "Pass --agent-authorization, or set ABS_AGENT_AUTHORIZATION / HTTP_AUTHORIZATION / ABS_AGENT_TOKEN."
    )


def _build_auth_headers(
    config: AgentConfig,
    env: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Build the auth headers for an agent request (explicit token or forwarded)."""
    if config.auth == "api_key" and config.token:
        return {"X-API-Key": config.token}

    if config.auth in ("bearer", "oauth2") and config.token:
        return {"Authorization": f"Bearer {config.token}"}

    forwarded = _resolve_forwarded_authorization(config, env)
    return {"Authorization": forwarded} if forwarded else {}


async def _openai_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        **_build_auth_headers(config),
    }

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

    async with httpx.AsyncClient(timeout=config.timeout) as client:
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


# ── OpenAI Responses API adapter ──


@dataclass
class _ResponsesState:
    text: str = ""
    calls: dict[Any, dict[str, str]] = field(default_factory=dict)
    order: list[Any] = field(default_factory=list)
    completed: dict[str, Any] | None = None


def _to_responses_input(messages: list[AgentMessage]) -> tuple[list[dict[str, Any]], str | None]:
    """Translate the runner's internal messages into a Responses API ``input`` array."""
    instructions: list[str] = []
    items: list[dict[str, Any]] = []

    for m in messages:
        if m.role == "system":
            if m.content:
                instructions.append(m.content)
            continue

        if m.role == "tool":
            items.append({
                "type": "function_call_output",
                "call_id": m.tool_call_id or "",
                "output": m.content or "",
            })
            continue

        if m.role == "assistant" and m.tool_calls:
            if m.content:
                items.append({"role": "assistant", "content": m.content})
            for tc in m.tool_calls:
                fn = tc.get("function", {})
                items.append({
                    "type": "function_call",
                    "call_id": tc.get("id", ""),
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                })
            continue

        items.append({"role": m.role, "content": m.content or ""})

    return items, "\n\n".join(instructions) if instructions else None


def _parse_responses_output(output: list[dict[str, Any]] | None) -> tuple[str, list[dict[str, Any]]]:
    """Extract text and tool calls from a Responses API ``output`` array."""
    texts: list[str] = []
    tool_calls: list[dict[str, Any]] = []

    for item in output or []:
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if part.get("type") == "output_text" and part.get("text"):
                    texts.append(part["text"])
                elif part.get("type") == "refusal" and part.get("refusal"):
                    texts.append(part["refusal"])
        elif item.get("type") == "function_call":
            arguments = item.get("arguments")
            if not isinstance(arguments, str):
                arguments = json.dumps(arguments if arguments is not None else {})
            tool_calls.append({
                "id": item.get("call_id") or item.get("id") or "",
                "type": "function",
                "function": {"name": item.get("name") or "", "arguments": arguments},
            })

    return "".join(texts), tool_calls


def _apply_responses_event(state: _ResponsesState, event: dict[str, Any]) -> None:
    """Fold a single Responses SSE event into the accumulated state."""
    etype = event.get("type")

    if etype == "response.output_text.delta":
        delta = event.get("delta")
        if isinstance(delta, str):
            state.text += delta

    elif etype == "response.output_item.added":
        item = event.get("item") or {}
        if item.get("type") == "function_call":
            key = item.get("id") or event.get("output_index") or len(state.order)
            if key not in state.calls:
                state.calls[key] = {
                    "id": item.get("call_id") or item.get("id") or "",
                    "name": item.get("name") or "",
                    "arguments": item.get("arguments") or "",
                }
                state.order.append(key)

    elif etype == "response.function_call_arguments.delta":
        key = event.get("item_id") if event.get("item_id") is not None else event.get("output_index")
        call = state.calls.get(key)
        delta = event.get("delta")
        if call is not None and isinstance(delta, str):
            call["arguments"] += delta

    elif etype == "response.function_call_arguments.done":
        key = event.get("item_id") if event.get("item_id") is not None else event.get("output_index")
        call = state.calls.get(key)
        arguments = event.get("arguments")
        if call is not None and isinstance(arguments, str):
            call["arguments"] = arguments

    elif etype == "response.output_item.done":
        item = event.get("item") or {}
        if item.get("type") == "function_call":
            key = item.get("id") or event.get("output_index")
            existing = state.calls.get(key)
            if existing is None:
                existing = {"id": "", "name": "", "arguments": ""}
                state.calls[key] = existing
                state.order.append(key)
            existing["id"] = item.get("call_id") or existing["id"] or item.get("id") or ""
            existing["name"] = item.get("name") or existing["name"] or ""
            if isinstance(item.get("arguments"), str):
                existing["arguments"] = item["arguments"]
        elif item.get("type") == "message" and not state.text:
            content, _ = _parse_responses_output([item])
            if content:
                state.text = content

    elif etype == "response.completed":
        response = event.get("response")
        state.completed = response if isinstance(response, dict) else None

    elif etype == "error":
        raise RuntimeError(f"Responses API error: {event.get('message', json.dumps(event))}")


def _responses_state_to_message(state: _ResponsesState) -> AgentMessage:
    """Build the final assistant message from the accumulated Responses state."""
    content = state.text
    tool_calls: list[dict[str, Any]] = []
    for key in state.order:
        call = state.calls.get(key)
        if call is None:
            continue
        tool_calls.append({
            "id": call["id"],
            "type": "function",
            "function": {"name": call["name"], "arguments": call["arguments"]},
        })

    # ``response.completed`` carries the authoritative output — prefer it.
    if state.completed is not None:
        parsed_content, parsed_calls = _parse_responses_output(state.completed.get("output"))
        if parsed_content or parsed_calls:
            content = parsed_content
            tool_calls = parsed_calls

    return AgentMessage(role="assistant", content=content or None, tool_calls=tool_calls or None)


def _process_responses_sse_line(line: str, state: _ResponsesState) -> None:
    trimmed = line.strip()
    if not trimmed.startswith("data:"):
        return
    data = trimmed[5:].strip()
    if not data or data == "[DONE]":
        return
    try:
        event = json.loads(data)
    except json.JSONDecodeError:
        return  # partial chunk — ignore
    _apply_responses_event(state, event)


async def _responses_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    """OpenAI Responses API adapter (``POST /v1/responses``).

    Streams by default (SSE events) and falls back to JSON when the server ignores
    ``stream``. Set ``config.stream = False`` to force the non-streaming path.
    """
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        **_build_auth_headers(config),
    }

    items, instructions = _to_responses_input(messages)
    stream = config.stream is not False

    body: dict[str, Any] = {
        "input": items,
        "tools": [{
            "type": "function",
            "name": "any",
            "description": "Tool",
            "parameters": {"type": "object", "properties": {}},
        }],
        "tool_choice": "auto",
    }
    # Only send ``model`` when explicitly configured: agent endpoints own their model,
    # raw model endpoints (Azure OpenAI, OpenAI) require it.
    if config.model:
        body["model"] = config.model
    if instructions:
        body["instructions"] = instructions
    if stream:
        body["stream"] = True

    async with httpx.AsyncClient(timeout=config.timeout) as client:
        resp = await client.post(config.url, json=body, headers=headers)

    if resp.status_code >= 400:
        raise RuntimeError(f"Agent returned {resp.status_code}: {resp.text[:200]}")

    content_type = resp.headers.get("content-type", "")
    is_event_stream = stream and "application/json" not in content_type

    if is_event_stream:
        state = _ResponsesState()
        for line in resp.text.split("\n"):
            _process_responses_sse_line(line, state)
        return [_responses_state_to_message(state)]

    data = resp.json()
    content, tool_calls = _parse_responses_output(data.get("output"))
    return [AgentMessage(role="assistant", content=content or None, tool_calls=tool_calls or None)]


async def _claude_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "x-api-key": config.token or "",
        "anthropic-version": "2023-06-01",
        **_build_auth_headers(config),
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

    async with httpx.AsyncClient(timeout=config.timeout) as client:
        resp = await client.post(config.url, json=body, headers=headers)

    if resp.status_code >= 400:
        text = resp.text[:200]
        raise RuntimeError(f"Agent returned {resp.status_code}: {text}")

    data = resp.json()
    content = (data.get("content") or [{}])[0]
    text = content.get("text", json.dumps(data.get("content")))

    return [AgentMessage(role="assistant", content=text)]


async def _gemini_adapter(messages: list[AgentMessage], config: AgentConfig) -> list[AgentMessage]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        **_build_auth_headers(config),
    }

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

    async with httpx.AsyncClient(timeout=config.timeout) as client:
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


COMM_ACTIONS = {"says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows", "hands_off"}
EXEC_ACTIONS = {"calls", "submits", "retrieves", "stores", "updates"}

_AGENT_ADAPTERS = {
    "openai": _openai_adapter,
    "responses": _responses_adapter,
    "response": _responses_adapter,  # alias
    "claude": _claude_adapter,
    "gemini": _gemini_adapter,
    "custom": _openai_adapter,
}


# ── Runner ──

async def run(
    session: NormalizedSession,
    agent_config: AgentConfig,
    row_vars: dict[str, Any] | None = None,
    logger: RunLogger | None = None,
) -> RunResult:
    adapter = _AGENT_ADAPTERS.get(agent_config.format, _openai_adapter)
    trace: list[ObservedStep] = []
    step_results: list[StepResult] = []
    messages: list[AgentMessage] = []
    skipped_ids: set[str] = set()  # v0.2: track skipped optional behaviors
    step_num = 0
    # v0.2 matching cursor: expectations match against the observed steps produced by
    # the current user turn. Required expectations consume one step (matched or not);
    # optionals never consume, so several can match the same response (§7.7).
    turn_start = 0
    turn_consumed = 0

    logger = logger or RunLogger(session=session.session)
    logger.event("session.start", behaviors=len(session.behaviors))

    async def _evaluate_rule(
        rule: dict[str, Any],
        observed: ObservedStep | None,
        behavior: Behavior | None,
        step: int | None,
    ) -> EvalResult:
        """Evaluate one rule, apply threshold, log the result."""
        rule_started = time.perf_counter()
        adapter_result = await evaluate_with_adapter(rule["type"], trace, rule, rule.get("adapter"))
        if adapter_result is not None:
            result = apply_threshold(adapter_result, rule)
        else:
            result = apply_threshold(
                evaluate_step(observed, rule, session.behaviors, trace, behavior), rule
            )
        result.duration_ms = int((time.perf_counter() - rule_started) * 1000)
        logger.event(
            "evaluation.result",
            step=step,
            evaluation_type=result.type,
            adapter=result.adapter,
            passed=result.passed,
            score=result.score,
            threshold=result.threshold,
            code=result.code,
            duration_ms=result.duration_ms,
            reason=result.reason if logger.content_enabled() else None,
        )
        return result

    for behavior in session.behaviors:
        step_num += 1

        # ── v0.2: skip if dependency was not matched ──
        if behavior.requires and behavior.requires in skipped_ids:
            if behavior.id:
                skipped_ids.add(behavior.id)
            logger.event(
                "behavior.skipped", step=step_num, behavior_id=behavior.id,
                actor=behavior.actor, action=behavior.action, reason="requires",
            )
            step_results.append(StepResult(
                step=step_num, behavior=behavior,
                observed=None, matched=False, skipped=True, evaluations=[],
            ))
            continue

        if behavior.actor == "user":
            messages.append(AgentMessage(
                role="user",
                content=str(behavior.content) if isinstance(behavior.content, str)
                else json.dumps(behavior.content),
            ))

            # The user turn is part of the observed trace, so chain selectors can
            # reference it (sequence/within/count with ``actor: user``).
            trace.append(ObservedStep(
                actor="user",
                action=behavior.action,
                id=behavior.id,
                target=behavior.target,
                content=behavior.content,
                with_=behavior.with_,
            ))

            # The agent reply starts after the user step: matching restarts here.
            turn_start = len(trace)
            turn_consumed = 0

            agent_started = time.perf_counter()
            logger.event("agent.request", step=step_num, messages=len(messages))
            try:
                new_msgs = await adapter(list(messages), agent_config)
            except Exception as e:
                logger.event(
                    "agent.error", level="error", step=step_num, error=str(e),
                    duration_ms=int((time.perf_counter() - agent_started) * 1000),
                )
                step_results.append(StepResult(
                    step=step_num, behavior=behavior, matched=False, sent=True,
                ))
                trace.append(ObservedStep(
                    actor="error", action="responds", content=f"Agent error: {e}",
                ))
                continue
            logger.event(
                "agent.response", step=step_num, new_messages=len(new_msgs),
                duration_ms=int((time.perf_counter() - agent_started) * 1000),
            )

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
                            tool_call_id=tc.get("id"),
                        ))
                elif msg.role == "assistant":
                    trace.append(ObservedStep(
                        actor="assistant",
                        action="responds",
                        content=msg.content,
                    ))

            logger.event(
                "behavior.match", step=step_num, behavior_id=behavior.id,
                actor=behavior.actor, action=behavior.action, matched=True, sent=True,
            )
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

            tool_call_id = None
            if last_asst and last_asst.tool_calls:
                for tc in last_asst.tool_calls:
                    if tc.get("function", {}).get("name") == behavior.target:
                        tool_call_id = tc.get("id")
                        break
                if tool_call_id is None:
                    tool_call_id = last_asst.tool_calls[0].get("id")

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

            # Record the tool response in the observed trace (full conversation),
            # and consume its cursor slot so the next expectation reads the
            # agent's continuation instead of this entry.
            trace.append(ObservedStep(
                actor="tool", action="responds",
                id=behavior.id, target=behavior.target,
                content=behavior.content, tool_call_id=tool_call_id,
            ))
            turn_consumed += 1

            agent_started = time.perf_counter()
            logger.event("agent.request", step=step_num, messages=len(messages))
            try:
                new_msgs = await adapter(list(messages), agent_config)
                logger.event(
                    "agent.response", step=step_num, new_messages=len(new_msgs),
                    duration_ms=int((time.perf_counter() - agent_started) * 1000),
                )
                for msg in new_msgs:
                    messages.append(msg)
                    if msg.role == "assistant" and msg.content:
                        trace.append(ObservedStep(
                            actor="assistant", action="responds", content=msg.content,
                        ))
            except Exception as e:
                logger.event(
                    "agent.error", level="error", step=step_num, error=str(e),
                    duration_ms=int((time.perf_counter() - agent_started) * 1000),
                )

            logger.event(
                "behavior.match", step=step_num, behavior_id=behavior.id,
                actor=behavior.actor, action=behavior.action, matched=True,
            )
            step_results.append(StepResult(
                step=step_num,
                behavior=behavior,
                observed=ObservedStep(
                    actor="tool", action="responds",
                    target=behavior.target, content=behavior.content,
                    tool_call_id=tool_call_id,
                ),
                matched=True,
            ))

        else:
            # Match against the current turn's observed steps. The cursor advances only
            # for required expectations; optionals share the same response (§7.7).
            cursor = turn_start + turn_consumed
            observed = trace[cursor] if cursor < len(trace) else None

            # ── v0.2: matches_when overrides default matching ──
            mw = behavior.matches_when
            if mw:
                if mw.get("type") == "contains" and mw.get("value") and observed and observed.content:
                    matched = str(mw["value"]) in str(observed.content)
                elif mw.get("type") == "regex" and mw.get("pattern") and observed and observed.content:
                    try:
                        matched = bool(re.search(mw["pattern"], str(observed.content)))
                    except Exception:
                        matched = False
                elif mw.get("type") == "llm_judge":
                    llm_result = await evaluate_with_adapter("llm_judge", trace, {
                        "type": "llm_judge",
                        "criteria": mw.get("criteria"),
                        "query": str(observed.content) if observed else "",
                    })
                    matched = llm_result.passed if llm_result else False
                else:
                    matched = False
            else:
                # Default matching (v0.1)
                matched = observed is not None and (
                    observed.actor == behavior.actor
                    and (observed.action == behavior.action
                         or (observed.action in COMM_ACTIONS and behavior.action in COMM_ACTIONS)
                         or (observed.action in EXEC_ACTIONS and behavior.action in EXEC_ACTIONS))
                    and (behavior.action in COMM_ACTIONS or not behavior.target or observed.target == behavior.target)
                    and _match_with_params(behavior, observed)
                )

            # Semantic annotation: a matched text response takes the action of the
            # communication behavior that classified it, so chain selectors
            # (never/sequence/count/within) can match exact actions like ``asks``.
            # The behavior id rides along so adapters can resolve refs like
            # ``kb_result.responds``. First match wins; an unmatched response
            # stays ``responds`` with no id.
            if matched and observed:
                if behavior.id:
                    observed.id = behavior.id
                if observed.action == "responds" and behavior.action in COMM_ACTIONS:
                    observed.action = behavior.action

            # ── v0.2: optional — skip if no match ──
            if behavior.optional and not matched:
                if behavior.id:
                    skipped_ids.add(behavior.id)
                logger.event(
                    "behavior.skipped", step=step_num, behavior_id=behavior.id,
                    actor=behavior.actor, action=behavior.action, reason="optional",
                )
                step_results.append(StepResult(
                    step=step_num, behavior=behavior,
                    observed=observed, matched=False, skipped=True, evaluations=[],
                ))
                continue

            # Required expectations consume one observed step (matched or not);
            # optionals never consume so multiple can match the same response.
            if not behavior.optional:
                turn_consumed += 1

            match_observed = observed if matched else None

            logger.event(
                "behavior.match", step=step_num, behavior_id=behavior.id,
                actor=behavior.actor, action=behavior.action, matched=matched,
            )

            # Run step-level evaluations
            eval_results: list[EvalResult] = []
            if behavior.evaluations:
                for rule in behavior.evaluations:
                    eval_results.append(await _evaluate_rule(rule, match_observed, behavior, step_num))

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
            # ── v0.2: expected evaluator (needs step_results) ──
            if rule.get("type") == "expected":
                chain_evals.append(evaluate_expected(
                    [{"behavior_id": s.behavior.id, "matched": s.matched,
                      "behavior_actor": s.behavior.actor, "behavior_action": s.behavior.action,
                      "behavior_target": s.behavior.target}
                     for s in step_results if not s.sent],
                    rule,
                    row_vars or {},
                ))
                continue

            # ── v0.2: when on never ──
            if rule.get("type") == "never" and rule.get("when"):
                if not eval_when(rule["when"], row_vars or {}):
                    chain_evals.append(EvalResult(type="never", passed=True, score=1.0, reason="when condition not met — skipped"))
                    continue
            chain_evals.append(await _evaluate_rule(rule, None, None, None))

    all_evals = [e for s in step_results for e in s.evaluations] + chain_evals

    # Propagate blocking failures → mark downstream evals as inconclusive
    _propagate_blocking(step_results)

    all_evals_final = [e for s in step_results for e in s.evaluations] + chain_evals

    result = RunResult(
        session=session.session,
        agent=agent_config.url,
        passed=all(e.passed or e.inconclusive for e in all_evals_final),
        steps=step_results,
        chain_evaluations=chain_evals,
        steps_total=len(step_results),
        steps_matched=sum(1 for s in step_results if s.matched or s.sent),
        evaluations_total=len(all_evals_final),
        evaluations_passed=sum(1 for e in all_evals_final if e.passed or e.inconclusive),
    )
    logger.event(
        "session.end",
        passed=result.passed,
        steps_total=result.steps_total,
        steps_matched=result.steps_matched,
        evaluations_total=result.evaluations_total,
        evaluations_passed=result.evaluations_passed,
        duration_ms=logger.elapsed_ms(),
    )
    return result


def _try_parse_json(s: str) -> Any:
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return s


def _match_with_params(behavior: Behavior, observed: ObservedStep) -> bool:
    """Validate with / with_only parameter matching for execution actions."""
    if not behavior.with_ and not behavior.with_only:
        return True

    observed_with = observed.with_ or {}

    if behavior.with_only:
        expected_keys = sorted(behavior.with_only.keys())
        observed_keys = sorted(observed_with.keys())
        if len(expected_keys) != len(observed_keys):
            return False
        if expected_keys != observed_keys:
            return False
        for key in expected_keys:
            if json.dumps(observed_with[key], default=str) != json.dumps(behavior.with_only[key], default=str):
                return False
        return True

    if behavior.with_:
        for key, expected in behavior.with_.items():
            if key not in observed_with:
                return False
            if json.dumps(observed_with[key], default=str) != json.dumps(expected, default=str):
                return False
        return True

    return True


def _propagate_blocking(step_results: list[StepResult]) -> None:
    """Mark downstream evaluations as inconclusive after a blocking failure."""
    downstream_blocked = False
    for sr in step_results:
        for ev in sr.evaluations:
            if downstream_blocked:
                ev.inconclusive = True
                ev.reason = "Inconclusive: a blocking evaluation earlier in the session failed."
            elif ev.blocking and not ev.passed:
                downstream_blocked = True
