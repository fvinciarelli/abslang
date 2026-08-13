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
    tool_call_id: str | None = None


@dataclass
class EvalResult:
    type: str
    passed: bool
    score: float
    reason: str
    blocking: bool = False
    inconclusive: bool = False


@dataclass
class Selector:
    actor: str | None = None
    action: str | None = None
    target: str | None = None


AdapterFunction = Callable[[list[ObservedStep], dict[str, Any]], Awaitable[EvalResult]]


# ── Selector matching ──

def matches_selector(step: ObservedStep, selector: dict[str, Any]) -> bool:
    """Check if an ObservedStep matches a Selector, with communication and execution action equivalence."""
    COMM_ACTIONS = {"says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"}
    EXEC_ACTIONS = {"calls", "submits", "retrieves", "stores", "updates"}
    if "actor" in selector and step.actor != selector["actor"]:
        return False
    if "action" in selector:
        if step.action == selector["action"]:
            pass  # exact match
        elif step.action in COMM_ACTIONS and selector["action"] in COMM_ACTIONS:
            pass  # communication equivalence
        elif step.action in EXEC_ACTIONS and selector["action"] in EXEC_ACTIONS:
            pass  # execution equivalence
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
    values: list[dict[str, Any]] = []
    variables: dict[str, Any] = {}

    for b in behaviors:
        # Resolve {{var}} references in with and content
        resolved_with = _resolve_var_refs(b.with_, variables) if b.with_ else None
        resolved_content = _resolve_var_refs(b.content, variables)

        # Track references in with
        if b.with_ and _has_var_ref(b.with_, var_name):
            val = _deep_get(resolved_with, var_name)
            if val is not None:
                values.append({"value": val, "source": f"with in step {b.actor}/{b.action}"})

        # Track references in content
        if isinstance(b.content, str) and _has_var_ref_str(b.content, var_name):
            values.append({"value": resolved_content, "source": f"content in step {b.actor}/{b.action}"})

        # Apply captures
        if b.capture and var_name in b.capture:
            val = _resolve_var_refs(b.capture[var_name], variables)
            variables[var_name] = val
            values.append({"value": val, "source": f"capture in step {b.actor}/{b.action}"})

    if len(values) <= 1:
        return EvalResult(
            type="variable_consistency",
            passed=True,
            score=1.0,
            reason=f'Variable "{var_name}" used {len(values)} time(s) — nothing to compare',
        )

    first = json.dumps(values[0]["value"], default=str)
    consistent = all(json.dumps(v["value"], default=str) == first for v in values)
    if not consistent:
        details = ", ".join(f'{v["source"]}: {json.dumps(v["value"], default=str)}' for v in values)
        return EvalResult(
            type="variable_consistency",
            passed=False,
            score=0.0,
            reason=f'Variable "{var_name}" has inconsistent values: {details}',
        )
    return EvalResult(
        type="variable_consistency",
        passed=True,
        score=1.0,
        reason=f'Variable "{var_name}" consistent across {len(values)} uses',
    )


def _has_var_ref(obj: Any, var_name: str) -> bool:
    if isinstance(obj, str):
        return _has_var_ref_str(obj, var_name)
    if isinstance(obj, list):
        return any(_has_var_ref(v, var_name) for v in obj)
    if isinstance(obj, dict):
        return any(_has_var_ref(v, var_name) for v in obj.values())
    return False


def _has_var_ref_str(s: str, var_name: str) -> bool:
    return f"{{{{{var_name}}}}}" in s


def _resolve_var_refs(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, str):
        def _replace(m: re.Match) -> str:
            name = m.group(1)
            return str(variables[name]) if name in variables else f"{{{{{name}}}}}"
        return re.sub(r"\{\{([\w.]+)\}\}", _replace, value)
    if isinstance(value, list):
        return [_resolve_var_refs(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: _resolve_var_refs(v, variables) for k, v in value.items()}
    return value


def _deep_get(obj: Any, key: str) -> Any:
    if isinstance(obj, dict) and key in obj:
        return obj[key]
    if isinstance(obj, dict):
        for v in obj.values():
            found = _deep_get(v, key)
            if found is not None:
                return found
    return None


def tool_call_eval(trace: list[ObservedStep], rule: dict[str, Any]) -> EvalResult:
    """Validate tool calls in the trace."""
    calls = [s for s in trace if s.actor == "assistant" and s.action == "calls"]

    target = rule.get("target")
    expected_with = rule.get("with")

    if target:
        matching = [c for c in calls if c.target == target]
        if not matching:
            observed_targets = [c.target for c in calls]
            return EvalResult(
                type="tool_call",
                passed=False,
                score=0.0,
                reason=f'Tool "{target}" was never called. Observed calls: {", ".join(observed_targets) or "none"}',
            )

        if expected_with:
            for call in matching:
                observed_with = call.with_ or {}
                for key, expected in expected_with.items():
                    if key not in observed_with:
                        return EvalResult(
                            type="tool_call",
                            passed=False,
                            score=0.0,
                            reason=f'Tool "{target}" missing parameter "{key}". Observed: {json.dumps(observed_with)}',
                        )
                    if json.dumps(observed_with[key], default=str) != json.dumps(expected, default=str):
                        return EvalResult(
                            type="tool_call",
                            passed=False,
                            score=0.0,
                            reason=f'Tool "{target}" parameter "{key}" expected {json.dumps(expected)}, got {json.dumps(observed_with[key], default=str)}',
                        )

        return EvalResult(
            type="tool_call",
            passed=True,
            score=1.0,
            reason=f'Tool "{target}" called correctly',
        )

    if not calls:
        return EvalResult(
            type="tool_call",
            passed=False,
            score=0.0,
            reason="No tool calls observed in the trace",
        )

    return EvalResult(
        type="tool_call",
        passed=True,
        score=1.0,
        reason=f"{len(calls)} tool call(s) observed",
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
        return _with_blocking(tool_call_eval(trace, evaluation), blocking)
    elif etype == "llm_judge":
        return EvalResult(type="llm_judge", passed=False, score=0.0,
                          reason="No LLM judge adapter registered. Use --adapter llm_judge=<provider>.",
                          blocking=blocking)
    elif etype in ("Groundedness", "Relevance", "Coherence", "Fluency"):
        return EvalResult(type=etype, passed=False, score=0.0,
                          reason=f"No adapter registered for {etype}. Use --adapter {etype}=<provider>.",
                          blocking=blocking)
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
_named_adapters: dict[tuple[str, str], AdapterFunction] = {}

# Import built-in LLM judge (registers itself via setup function below)
from . import builtin_judge as _builtin_judge

# Register built-in LLM judge as default adapter
_adapters["llm_judge"] = _builtin_judge.evaluate
_adapters["g_eval"] = _builtin_judge.evaluate
_adapters["faithfulness"] = _builtin_judge.evaluate
# Safety dimensions — vendor-agnostic via the built-in judge, overridable by adapters
for _t in ("HateUnfairness", "Violence", "Sexual", "SelfHarm"):
    _adapters[_t] = _builtin_judge.evaluate


def register_adapter(etype: str, fn: AdapterFunction, name: str | None = None) -> None:
    """Register an external evaluator adapter.

    When ``name`` is None the adapter becomes the default for ``etype``.
    When ``name`` is given, it is registered under ``(etype, name)`` so a rule
    can select it per-evaluation via the ``adapter:`` field.
    """
    if name is None:
        _adapters[etype] = fn
    else:
        _named_adapters[(etype, name)] = fn


async def evaluate_with_adapter(
    etype: str,
    trace: list[ObservedStep],
    evaluation: dict[str, Any],
    adapter_name: str | None = None,
) -> EvalResult | None:
    """Try to evaluate using a registered adapter. Returns None if no adapter.

    Resolution order:
    1. ``adapter_name`` selects a named adapter registered for ``(etype, name)``.
       If the name is given but not registered, a clear error result is returned.
    2. Otherwise the default adapter for ``etype`` is used.
    """
    if adapter_name:
        named = _named_adapters.get((etype, adapter_name))
        if named is not None:
            return await named(trace, evaluation)
        return EvalResult(
            type=etype,
            passed=False,
            score=0.0,
            reason=(
                f"Adapter '{adapter_name}' is not registered for '{etype}'. "
                f"Run with --adapter {etype}={adapter_name} (or --adapter {adapter_name})."
            ),
        )
    adapter = _adapters.get(etype)
    if adapter is None:
        return None
    return await adapter(trace, evaluation)


# ── v0.2 — when expression evaluator ──

import re

def eval_when(expression: str | None, row_vars: dict[str, Any]) -> bool:
    """Evaluate a when expression against dataset row variables."""
    if not expression:
        return True

    def _replacer(m: re.Match) -> str:
        name = m.group(1)
        if name in row_vars:
            val = row_vars[name]
            if isinstance(val, str):
                return json.dumps(val)
            return str(val)
        return "undefined"

    resolved = re.sub(r"\{\{([\w.]+)\}\}", _replacer, expression)
    # Normalize JS-style booleans for Python eval
    resolved = resolved.replace("true", "True").replace("false", "False")

    try:
        return bool(eval(resolved, {"__builtins__": {}}, {}))
    except Exception:
        return False


# ── v0.2 — expected evaluator ──

def evaluate_expected(
    step_results: list[dict[str, Any]],
    evaluation: dict[str, Any],
    row_vars: dict[str, Any],
) -> EvalResult:
    """Validate that an optional behavior matched when expected."""
    if not eval_when(evaluation.get("when"), row_vars):
        return EvalResult(type="expected", passed=True, score=1.0, reason="when condition not met — skipped")

    behavior_id = evaluation.get("behavior")
    ref_step = next((s for s in step_results if s.get("behavior_id") == behavior_id), None)

    if not ref_step:
        return EvalResult(type="expected", passed=False, score=0.0,
                          reason=f'Behavior "{behavior_id}" not found in trace')

    if not ref_step.get("matched"):
        msg = evaluation.get("reason") or f'Expected behavior "{behavior_id}" to match, but it did not'
        return EvalResult(type="expected", passed=False, score=0.0, reason=msg)

    # after constraint
    after = evaluation.get("after")
    if after:
        after_idx = next((i for i, s in enumerate(step_results)
                          if (not after.get("actor") or s.get("behavior_actor") == after["actor"])
                          and (not after.get("action") or s.get("behavior_action") == after["action"])
                          and (not after.get("target") or s.get("behavior_target") == after["target"])), -1)
        ref_idx = step_results.index(ref_step)
        if after_idx == -1 or ref_idx <= after_idx:
            msg = evaluation.get("reason") or f'Expected "{behavior_id}" after {json.dumps(after)}, but it did not'
            return EvalResult(type="expected", passed=False, score=0.0, reason=msg)

    return EvalResult(type="expected", passed=True, score=1.0, reason=f'Behavior "{behavior_id}" matched as expected')
