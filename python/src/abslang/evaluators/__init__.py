"""Built-in evaluators and adapter registry."""

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

from ..parser import Behavior


# ── Types ──

@dataclass
class ObservedStep:
    actor: str
    action: str
    target: str | None = None
    content: Any = None
    with_: dict[str, Any] | None = None


@dataclass
class EvalResult:
    type: str
    passed: bool
    score: float
    reason: str
    blocking: bool = False


@dataclass
class Selector:
    actor: str | None = None
    action: str | None = None
    target: str | None = None


AdapterFunction = Callable[[list[ObservedStep], dict[str, Any]], Awaitable[EvalResult]]


# ── Selector matching ──

def matches_selector(step: ObservedStep, selector: dict[str, Any]) -> bool:
    """Check if an ObservedStep matches a Selector, with communication action equivalence."""
    COMM_ACTIONS = {"says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"}
    if "actor" in selector and step.actor != selector["actor"]:
        return False
    if "action" in selector:
        if step.action == selector["action"]:
            pass  # exact match
        elif step.action in COMM_ACTIONS and selector["action"] in COMM_ACTIONS:
            pass  # communication equivalence
        else:
            return False
    if "target" in selector and step.target != selector["target"]:
        return False
    return True


# ── Built-in step-level evaluators ──

def exact_match(observed: Any, rule: dict[str, Any]) -> EvalResult:
    expected = rule["value"]
    passed = json.dumps(observed, default=str) == json.dumps(expected, default=str)
    return EvalResult(
        type="exact_match",
        passed=passed,
        score=1.0 if passed else 0.0,
        reason=f'Content matches "{expected}"' if passed
        else f'Expected "{expected}", got "{observed}"',
    )


def contains(observed: Any, rule: dict[str, Any]) -> EvalResult:
    obs = str(observed or "")
    search = rule["value"].lower()
    passed = search in obs.lower()
    return EvalResult(
        type="contains",
        passed=passed,
        score=1.0 if passed else 0.0,
        reason=f'Content contains "{rule["value"]}"' if passed
        else f'Expected content to contain "{rule["value"]}", got "{obs[:100]}"',
    )


def regex_match(observed: Any, rule: dict[str, Any]) -> EvalResult:
    obs = str(observed or "")
    pattern = rule["pattern"]
    passed = bool(re.search(pattern, obs))
    return EvalResult(
        type="regex",
        passed=passed,
        score=1.0 if passed else 0.0,
        reason=f"Content matches /{pattern}/" if passed
        else f'Expected content to match /{pattern}/, got "{obs[:100]}"',
    )


def schema_eval(observed: Any, rule: dict[str, Any]) -> EvalResult:
    schema = rule["schema"]
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    additional_props = schema.get("additionalProperties", True) is not False

    if not isinstance(observed, dict):
        return EvalResult(
            type="schema",
            passed=False,
            score=0.0,
            reason=f"Expected an object, got {type(observed).__name__}",
        )

    for key in required:
        if key not in observed:
            return EvalResult(
                type="schema",
                passed=False,
                score=0.0,
                reason=f'Missing required field: "{key}"',
            )

    if not additional_props:
        for key in observed:
            if key not in properties:
                return EvalResult(
                    type="schema",
                    passed=False,
                    score=0.0,
                    reason=f'Unexpected field: "{key}" (additionalProperties: false)',
                )

    for key, prop_schema in properties.items():
        if key in observed:
            ps = prop_schema if isinstance(prop_schema, dict) else {}
            if ps.get("type") == "string" and not isinstance(observed[key], str):
                return EvalResult(
                    type="schema",
                    passed=False,
                    score=0.0,
                    reason=f'Field "{key}" expected string, got {type(observed[key]).__name__}',
                )
            if "enum" in ps and observed[key] not in ps["enum"]:
                return EvalResult(
                    type="schema",
                    passed=False,
                    score=0.0,
                    reason=f'Field "{key}" must be one of {ps["enum"]}, got "{observed[key]}"',
                )

    return EvalResult(
        type="schema",
        passed=True,
        score=1.0,
        reason="Content matches schema",
    )


# ── Chain evaluators ──

def sequence(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    order = rule["order"]
    trace_idx = 0
    for sel in order:
        found = False
        while trace_idx < len(trace):
            if matches_selector(trace[trace_idx], sel):
                found = True
                trace_idx += 1
                break
            trace_idx += 1
        if not found:
            return EvalResult(
                type="sequence",
                passed=False,
                score=0.0,
                reason=f"Step not found in expected order: {json.dumps(sel)}",
            )
    return EvalResult(
        type="sequence",
        passed=True,
        score=1.0,
        reason=f"All {len(order)} steps found in order",
    )


def eventually(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    sel = rule["match"]
    found = any(matches_selector(s, sel) for s in trace)
    return EvalResult(
        type="eventually",
        passed=found,
        score=1.0 if found else 0.0,
        reason="Found matching step" if found
        else f"Never found step matching {json.dumps(sel)}",
    )


def never_eval(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    sel = rule["match"]
    found = any(matches_selector(s, sel) for s in trace)
    return EvalResult(
        type="never",
        passed=not found,
        score=0.0 if found else 1.0,
        reason=f"Found disallowed step matching {json.dumps(sel)}" if found
        else "Disallowed step never occurred",
    )


def count_eval(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    sel = rule["match"]
    n = sum(1 for s in trace if matches_selector(s, sel))
    min_ok = "min" not in rule or n >= rule["min"]
    max_ok = "max" not in rule or n <= rule["max"]
    passed = min_ok and max_ok
    return EvalResult(
        type="count",
        passed=passed,
        score=1.0 if passed else 0.0,
        reason=f'Count {n} within [{rule.get("min", 0)}, {rule.get("max", "∞")}]' if passed
        else f'Count {n} outside [{rule.get("min", 0)}, {rule.get("max", "∞")}]',
    )


def within(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    after_sel = rule["after"]
    match_sel = rule["match"]
    max_steps = rule["max_steps"]

    after_idx = -1
    for i, s in enumerate(trace):
        if matches_selector(s, after_sel):
            after_idx = i
            break

    if after_idx == -1:
        return EvalResult(
            type="within",
            passed=False,
            score=0.0,
            reason=f'"after" selector never matched: {json.dumps(after_sel)}',
        )

    for i in range(after_idx + 1, min(after_idx + max_steps + 1, len(trace))):
        if matches_selector(trace[i], match_sel):
            return EvalResult(
                type="within",
                passed=True,
                score=1.0,
                reason=f"Found within {i - after_idx} steps (max {max_steps})",
            )

    return EvalResult(
        type="within",
        passed=False,
        score=0.0,
        reason=f"Not found within {max_steps} steps of {json.dumps(after_sel)}",
    )


def variable_consistency(
    trace: list[ObservedStep],
    behaviors: list[Behavior],
    rule: dict[str, Any],
) -> EvalResult:
    var_name = rule["variable"]
    values: list[Any] = []
    variables: dict[str, Any] = {}

    for b in behaviors:
        if b.capture and var_name in b.capture:
            val = b.capture[var_name]
            values.append(val)
            variables[var_name] = val

    if len(values) <= 1:
        return EvalResult(
            type="variable_consistency",
            passed=True,
            score=1.0,
            reason=f'Variable "{var_name}" captured {len(values)} time(s) — nothing to compare',
        )

    first = json.dumps(values[0], default=str)
    consistent = all(json.dumps(v, default=str) == first for v in values)
    return EvalResult(
        type="variable_consistency",
        passed=consistent,
        score=1.0 if consistent else 0.0,
        reason=f'Variable "{var_name}" consistent across {len(values)} captures' if consistent
        else f'Variable "{var_name}" has inconsistent values: {[json.dumps(v, default=str) for v in values]}',
    )


# ── Step-level evaluator dispatch ──

def evaluate_step(
    observed: ObservedStep | None,
    evaluation: dict[str, Any],
    behaviors: list[Behavior],
    trace: list[ObservedStep],
) -> EvalResult:
    """Dispatch an evaluation rule to the appropriate built-in evaluator."""
    blocking = evaluation.get("blocking", False)
    etype = evaluation["type"]

    if etype == "exact_match":
        return _with_blocking(exact_match(observed.content if observed else None, evaluation), blocking)
    elif etype == "contains":
        return _with_blocking(contains(observed.content if observed else None, evaluation), blocking)
    elif etype == "regex":
        return _with_blocking(regex_match(observed.content if observed else None, evaluation), blocking)
    elif etype == "schema":
        return _with_blocking(schema_eval(observed.content if observed else None, evaluation), blocking)
    elif etype == "sequence":
        return _with_blocking(sequence(trace, evaluation), blocking)
    elif etype == "eventually":
        return _with_blocking(eventually(trace, evaluation), blocking)
    elif etype == "never":
        return _with_blocking(never_eval(trace, evaluation), blocking)
    elif etype == "count":
        return _with_blocking(count_eval(trace, evaluation), blocking)
    elif etype == "within":
        return _with_blocking(within(trace, evaluation), blocking)
    elif etype == "variable_consistency":
        return _with_blocking(variable_consistency(trace, behaviors, evaluation), blocking)
    elif etype == "tool_call":
        return EvalResult(type="tool_call", passed=True, score=1.0, reason="Tool call validated", blocking=blocking)
    elif etype == "llm_judge":
        return EvalResult(type="llm_judge", passed=False, score=0.0,
                          reason="No LLM judge adapter registered. Use --adapter llm_judge=<provider>.",
                          blocking=blocking)
    elif etype == "groundedness":
        return EvalResult(type="groundedness", passed=False, score=0.0,
                          reason="No groundedness adapter registered.", blocking=blocking)
    elif etype == "bias":
        return EvalResult(type="bias", passed=False, score=0.0,
                          reason="No bias adapter registered.", blocking=blocking)
    elif etype == "toxicity":
        return EvalResult(type="toxicity", passed=False, score=0.0,
                          reason="No toxicity adapter registered.", blocking=blocking)
    elif etype in ("all_of", "any_of", "none_of"):
        return _evaluate_composition(trace, evaluation, behaviors)
    else:
        return EvalResult(
            type=etype,
            passed=False,
            score=0.0,
            reason=f"Unknown evaluator type: {etype}",
            blocking=blocking,
        )


def _with_blocking(result: EvalResult, blocking: bool) -> EvalResult:
    result.blocking = blocking
    return result


def apply_threshold(result: EvalResult, evaluation: dict[str, Any]) -> EvalResult:
    """Apply threshold from evaluation config to a result. Called by the runner."""
    threshold = evaluation.get("threshold")
    if threshold is not None and result.score < threshold:
        result.passed = False
        result.reason = f"{result.reason} (score {result.score} < threshold {threshold})"
    return result


def _evaluate_composition(
    trace: list[ObservedStep],
    rule: dict[str, Any],
    behaviors: list[Behavior],
) -> EvalResult:
    sub_evaluations = rule.get("evaluations", [])
    results = [evaluate_step(None, e, behaviors, trace) for e in sub_evaluations]

    if rule["type"] == "all_of":
        passed = all(r.passed for r in results)
    elif rule["type"] == "any_of":
        passed = any(r.passed for r in results)
    elif rule["type"] == "none_of":
        passed = all(not r.passed for r in results)
    else:
        passed = False

    avg_score = sum(r.score for r in results) / len(results) if results else 0.0
    return EvalResult(
        type=rule["type"],
        passed=passed,
        score=avg_score,
        reason=f"{sum(1 for r in results if r.passed)}/{len(results)} sub-evaluations passed (avg score: {avg_score:.2f})",
    )


# ── Adapter registry ──

_adapters: dict[str, AdapterFunction] = {}

# Import built-in LLM judge (registers itself via setup function below)
from . import builtin_judge as _builtin_judge

# Register built-in LLM judge as default adapter
_adapters["llm_judge"] = _builtin_judge.evaluate
_adapters["g_eval"] = _builtin_judge.evaluate
_adapters["faithfulness"] = _builtin_judge.evaluate


def register_adapter(etype: str, fn: AdapterFunction) -> None:
    """Register an external evaluator adapter."""
    _adapters[etype] = fn


async def evaluate_with_adapter(
    etype: str,
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
) -> EvalResult | None:
    """Try to evaluate using a registered adapter. Returns None if no adapter."""
    adapter = _adapters.get(etype)
    if adapter is None:
        return None
    return await adapter(trace, evaluation)
