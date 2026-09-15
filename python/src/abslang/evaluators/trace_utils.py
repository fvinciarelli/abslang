"""Shared trace helpers for evaluator adapters.

Every external evaluator adapter (aievaluator, azure, aws, ...) needs to:
  - resolve id-based references from the trace (`self`, `user_asks.says`, ...),
  - render a trace as readable text for LLM judges,
  - convert an ABS trace into an OpenAI-style message array,
  - extract tool call lists / trajectories,
  - derive ground-truth reference data from an evaluation rule.

This module centralizes that logic so adapters don't duplicate it.
"""

import json
from typing import Any

from . import ObservedStep


# ── Reference resolution ──

COMM_ACTIONS = {"says", "asks", "informs", "greets", "responds",
                "clarifies", "confirms", "rejects", "suggests", "shows"}

_DEFAULT_ACTIONS = {"user": "says", "assistant": "informs", "tool": "responds"}


def resolve_ref(
    trace: list[ObservedStep],
    ref: str | None,
    self_content: str | None = None,
) -> str:
    """Resolve an ABS evaluation input reference to a string.

    Supported forms:
      - ``"self"``               → the content of the behavior carrying the evaluation
      - ``"kb_result"``          → the step matched by that behavior id (default action)
      - ``"kb_result.responds"`` → the same, with an explicit action
      - ``"user.says"``          → legacy actor reference (first step of that actor)

    Behavior-id references take precedence; actor references remain for
    compatibility. Returns the raw ``ref`` unchanged if nothing matches.
    """
    if not ref:
        return ""
    if ref == "self":
        return self_content or ""

    ref_id, _, action = ref.partition(".")
    action = action or None

    # 1) Behavior-id reference. The action is qualified explicitly, or defaults
    #    to the one for the step's actor (user → says, tool → responds, ...).
    for step in trace:
        if step.id != ref_id:
            continue
        wanted = action or _DEFAULT_ACTIONS.get(step.actor, "says")
        if step.action != wanted:
            continue
        return _to_text(step.content)

    # 2) Legacy actor reference (``user.says``). Communication actions stay
    #    equivalent here so existing sessions keep resolving.
    wanted = action or _DEFAULT_ACTIONS.get(ref_id, "says")
    for step in trace:
        if step.actor != ref_id:
            continue
        action_matches = (
            step.action == wanted
            or (step.action in COMM_ACTIONS and wanted in COMM_ACTIONS)
        )
        if action_matches:
            return _to_text(step.content)

    return ref


def _to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    return json.dumps(content, default=str)


# ── Text rendering ──

def trace_to_text(trace: list[ObservedStep]) -> str:
    """Render a trace as a readable multi-line transcript for LLM judges.

    A step shows its ``content``; tool calls show their arguments (``with_``)
    instead, so the judge can see what was called with what. Steps with
    neither render without a trailing colon.
    """
    lines: list[str] = []
    for s in trace:
        head = f"[{s.actor}] {s.action}{' → ' + s.target if s.target else ''}"
        if s.content is not None:
            payload: str | None = _to_text(s.content)
        elif s.with_:
            payload = _to_text(s.with_)
        else:
            payload = None
        lines.append(f"{head}: {payload}" if payload else head)
    return "\n".join(lines)


# ── OpenAI message mapping ──

def trace_to_messages(
    trace: list[ObservedStep],
    tool_call_prefix: str = "call_abs_",
) -> list[dict[str, Any]]:
    """Convert an ABS trace into an OpenAI-style message array.

    Mapping:
      - ``user`` / ``system`` steps          → text messages
      - consecutive ``assistant`` ``calls``  → one assistant message with
        ``tool_call`` content items (parallel tool calls are grouped)
      - ``tool`` ``responds``                → ``tool`` message with a
        ``tool_result`` content item
      - other ``assistant`` steps            → text messages

    ``tool_call_id`` is preserved when present on the ObservedStep; otherwise
    synthetic ids are generated and tool results are paired positionally with the
    most recent assistant tool calls.
    """
    messages: list[dict[str, Any]] = []
    pending_ids: list[str] = []
    seq = 0
    i = 0

    def _next_id() -> str:
        nonlocal seq
        cid = f"{tool_call_prefix}{seq}"
        seq += 1
        return cid

    while i < len(trace):
        s = trace[i]

        # Group consecutive tool calls into a single assistant message
        if s.actor == "assistant" and s.action == "calls":
            content_items: list[dict[str, Any]] = []
            while i < len(trace) and trace[i].actor == "assistant" and trace[i].action == "calls":
                cs = trace[i]
                cid = cs.tool_call_id or _next_id()
                args = cs.with_ if isinstance(cs.with_, dict) else (
                    cs.with_ if cs.with_ is not None else {}
                )
                content_items.append({
                    "type": "tool_call",
                    "tool_call_id": cid,
                    "name": cs.target or "",
                    "arguments": args,
                })
                pending_ids.append(cid)
                i += 1
            messages.append({"role": "assistant", "content": content_items})
            continue

        if s.actor == "tool":
            if s.tool_call_id:
                cid = s.tool_call_id
            elif pending_ids:
                cid = pending_ids.pop(0)
            else:
                cid = _next_id()
            messages.append({
                "role": "tool",
                "tool_call_id": cid,
                "content": [{"type": "tool_result", "tool_result": s.content if s.content is not None else ""}],
            })
            i += 1
            continue

        if s.actor in ("user", "system"):
            messages.append({"role": s.actor, "content": _to_text(s.content)})
        elif s.actor == "assistant":
            messages.append({"role": "assistant", "content": _to_text(s.content)})
        # other actors (human, external, error) are skipped — they carry no
        # OpenAI message equivalent.

        i += 1

    return messages


def trace_to_conversation(
    trace: list[ObservedStep],
    tool_call_prefix: str = "call_abs_",
) -> dict[str, list[dict[str, Any]]]:
    """Split a trace into Azure's ``{query, response}`` conversation shape.

    ``query`` carries the context (system + user messages) and ``response`` carries
    the agent's turns (assistant + tool messages), matching the agent evaluator
    contract documented by Microsoft.
    """
    query: list[dict[str, Any]] = []
    response: list[dict[str, Any]] = []
    for msg in trace_to_messages(trace, tool_call_prefix):
        if msg["role"] in ("system", "user"):
            query.append(msg)
        else:
            response.append(msg)
    return {"query": query, "response": response}


# ── Tool call extraction ──

def extract_tool_calls(trace: list[ObservedStep]) -> list[ObservedStep]:
    """Return the assistant ``calls`` steps in order."""
    return [s for s in trace if s.actor == "assistant" and s.action == "calls"]


def extract_tool_trajectory(trace: list[ObservedStep]) -> list[str]:
    """Return the ordered list of tool names called by the assistant."""
    return [s.target for s in extract_tool_calls(trace) if s.target]


# ── Ground truth derivation ──

def extract_ground_truth(
    evaluation: dict[str, Any],
    trace: list[ObservedStep],
    self_content: str | None = None,
) -> dict[str, Any]:
    """Derive ground-truth reference data from an ABS evaluation rule.

    Returns a dict with any of ``expected_response``, ``assertions``, or
    ``expected_trajectory`` — the reference fields AWS AgentCore (and Azure
    ground-truth evaluators) consume.
    """
    gt: dict[str, Any] = {}

    for key in ("ground_truth", "expected"):
        if evaluation.get(key):
            gt["expected_response"] = resolve_ref(trace, evaluation[key], self_content)

    criteria = evaluation.get("criteria")
    if criteria:
        gt["assertions"] = [criteria]

    order = evaluation.get("order")
    if order:
        names = [
            sel["target"]
            for sel in order
            if isinstance(sel, dict)
            and sel.get("action") == "calls"
            and sel.get("target")
        ]
        if names:
            gt["expected_trajectory"] = names

    return gt
