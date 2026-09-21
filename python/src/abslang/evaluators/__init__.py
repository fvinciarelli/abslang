"""Built-in evaluators and adapter registry."""

import json
import math
import re
from collections import Counter
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
    id: str | None = None


@dataclass
class EvalResult:
    type: str
    passed: bool
    score: float
    reason: str
    blocking: bool = False
    inconclusive: bool = False
    # Machine-readable failure classification (stable across runs) and the
    # raw provider payload when the adapter has one. ``reason`` stays human.
    code: str | None = None
    details: dict[str, Any] | None = None
    # Filled in by ``apply_threshold`` from the evaluation rule; useful for
    # reports and structured logs.
    threshold: float | None = None
    adapter: str | None = None
    duration_ms: int | None = None


@dataclass
class Selector:
    actor: str | None = None
    action: str | None = None
    target: str | None = None


AdapterFunction = Callable[[list[ObservedStep], dict[str, Any]], Awaitable[EvalResult]]


# ── Selector matching ──

def matches_selector(step: ObservedStep, selector: dict[str, Any]) -> bool:
    """Check if an ObservedStep matches a Selector.

    EVALUATIONS.md: "A field that's present must match exactly". Communication
    actions are annotated on the observed step by the runner with the action of
    the behavior that matched it, so exact comparison stays useful.
    """
    if "actor" in selector and step.actor != selector["actor"]:
        return False
    if "action" in selector and step.action != selector["action"]:
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


# ── Reference-based text metrics (deterministic) ──
#
# These compare the observed response against a declared ``ground_truth`` using
# pure algorithms: no model, no network, no adapter. The tokenization and the
# metric variants are part of the contract so every implementation agrees on the
# score (see EVALUATIONS.md).

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
BLEU_MAX_N = 4
ROUGE_VARIANTS = ("rouge1", "rouge2", "rougeL")
ROUGE_METRICS = ("precision", "recall", "f1")


def _tokens(text: Any) -> list[str]:
    return _TOKEN_RE.findall(str(text if text is not None else "").lower())


def _ngrams(tokens: list[str], n: int) -> Counter:
    return Counter(tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1))


def _value_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str)
    except (TypeError, ValueError):
        return str(value)


def _prf(overlap: float, total_observed: float, total_reference: float) -> dict[str, float]:
    precision = overlap / total_observed if total_observed else 0.0
    recall = overlap / total_reference if total_reference else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def f1_score_metric(response: str, ground_truth: str) -> tuple[float, dict[str, Any]]:
    """Token-level (unigram) F1 between response and reference."""
    observed, reference = _tokens(response), _tokens(ground_truth)
    if not observed or not reference:
        return 0.0, _prf(0, len(observed), len(reference))
    overlap = sum((Counter(observed) & Counter(reference)).values())
    scores = _prf(overlap, len(observed), len(reference))
    return scores["f1"], scores


def bleu_metric(response: str, ground_truth: str) -> tuple[float, dict[str, Any]]:
    """BLEU-4 with add-1 smoothing, effective order, and brevity penalty.

    - Add-1 smoothing: ``p_n = (matches + 1) / (total + 1)``.
    - Effective order: orders longer than the observed response are skipped.
    - Brevity penalty: ``min(1, exp(1 - ref_len / obs_len))``.
    """
    observed, reference = _tokens(response), _tokens(ground_truth)
    if not observed or not reference:
        return 0.0, {"precisions": [], "brevity_penalty": 0.0}

    precisions: list[float] = []
    for n in range(1, BLEU_MAX_N + 1):
        total = len(observed) - n + 1
        if total <= 0:
            continue
        matches = sum((_ngrams(observed, n) & _ngrams(reference, n)).values())
        precisions.append((matches + 1) / (total + 1))
    if not precisions:
        return 0.0, {"precisions": [], "brevity_penalty": 0.0}

    log_mean = sum(math.log(p) for p in precisions) / len(precisions)
    brevity_penalty = min(1.0, math.exp(1 - len(reference) / len(observed)))
    score = brevity_penalty * math.exp(log_mean)
    return score, {"precisions": precisions, "brevity_penalty": brevity_penalty}


def _lcs_length(a: list[str], b: list[str]) -> int:
    if not a or not b:
        return 0
    previous = [0] * (len(b) + 1)
    for x in a:
        current = [0]
        for j, y in enumerate(b, 1):
            if x == y:
                current.append(previous[j - 1] + 1)
            else:
                current.append(max(previous[j], current[-1]))
        previous = current
    return previous[-1]


def rouge_metric(response: str, ground_truth: str, variant: str = "rougeL") -> tuple[float, dict[str, Any]]:
    """ROUGE-N (n=1,2) or ROUGE-L F1 between response and reference."""
    observed, reference = _tokens(response), _tokens(ground_truth)
    if variant == "rougeL":
        lcs = _lcs_length(observed, reference)
        scores = _prf(lcs, len(observed), len(reference))
    else:
        n = 1 if variant == "rouge1" else 2
        observed_ngrams, reference_ngrams = _ngrams(observed, n), _ngrams(reference, n)
        overlap = sum((observed_ngrams & reference_ngrams).values())
        scores = _prf(overlap, sum(observed_ngrams.values()), sum(reference_ngrams.values()))
    return scores["f1"], {**scores, "variant": variant}


def _last_assistant_text(trace: list[ObservedStep]) -> str:
    for step in reversed(trace):
        if step.actor == "assistant" and step.content is not None:
            return _value_to_text(step.content)
    return ""


def _metric_inputs(
    observed: ObservedStep | None,
    rule: dict[str, Any],
    trace: list[ObservedStep],
    behavior: Behavior | None,
) -> tuple[str, str]:
    """Resolve ``(response, ground_truth)`` for reference-based metrics.

    ``ground_truth`` accepts the same references as ``query``/``context``/
    ``response`` (``self``, ``behavior_id.action``, ``actor.action``) plus an
    already-resolved literal (e.g. a dataset placeholder). For ``self`` the
    reference is the *declared* content of the behavior carrying the evaluation:
    in ABS the behavior content is the expected value, while the observed step
    is the actual response.
    """
    from .trace_utils import resolve_ref  # local import to avoid a cycle

    declared = _value_to_text(behavior.content) if behavior is not None else ""
    observed_text = (
        _value_to_text(observed.content) if observed is not None else _last_assistant_text(trace)
    )

    gt_ref = rule.get("ground_truth")
    if gt_ref is None:
        raise ValueError('requires a "ground_truth" field')
    if gt_ref == "self":
        ground_truth = declared or observed_text
    else:
        ground_truth = resolve_ref(trace, gt_ref, declared) or declared

    response_ref = rule.get("response")
    if not response_ref or response_ref == "self":
        response = observed_text
    else:
        response = resolve_ref(trace, response_ref, observed_text) or observed_text

    return response, ground_truth


def _reference_metric(
    metric_type: str,
    compute: Callable[[str, str], tuple[float, dict[str, Any]]],
    observed: ObservedStep | None,
    rule: dict[str, Any],
    trace: list[ObservedStep],
    behavior: Behavior | None,
) -> EvalResult:
    try:
        response, ground_truth = _metric_inputs(observed, rule, trace, behavior)
    except ValueError as exc:
        return EvalResult(
            type=metric_type,
            passed=False,
            score=0.0,
            reason=f"{metric_type}: {exc}",
            code="evaluator.missing_input",
        )

    try:
        score, details = compute(response, ground_truth)
    except ValueError as exc:
        return EvalResult(
            type=metric_type,
            passed=False,
            score=0.0,
            reason=f"{metric_type}: {exc}",
            code="evaluator.invalid_option",
        )

    return EvalResult(
        type=metric_type,
        passed=score >= 0.5,  # provisional; apply_threshold refines when set
        score=score,
        reason=f"{metric_type}: score {score:.2f}",
        details=details,
    )


def f1_eval(
    observed: ObservedStep | None,
    rule: dict[str, Any],
    trace: list[ObservedStep],
    behavior: Behavior | None = None,
) -> EvalResult:
    return _reference_metric("f1", f1_score_metric, observed, rule, trace, behavior)


def bleu_eval(
    observed: ObservedStep | None,
    rule: dict[str, Any],
    trace: list[ObservedStep],
    behavior: Behavior | None = None,
) -> EvalResult:
    return _reference_metric("bleu", bleu_metric, observed, rule, trace, behavior)


def rouge_eval(
    observed: ObservedStep | None,
    rule: dict[str, Any],
    trace: list[ObservedStep],
    behavior: Behavior | None = None,
) -> EvalResult:
    variant = str(rule.get("variant", "rougeL"))
    metric = str(rule.get("metric", "f1"))
    if variant not in ROUGE_VARIANTS:
        return EvalResult(
            type="rouge",
            passed=False,
            score=0.0,
            reason=f'rouge: unknown variant "{variant}" (use rouge1, rouge2, rougeL)',
            code="evaluator.invalid_option",
        )
    if metric not in ROUGE_METRICS:
        return EvalResult(
            type="rouge",
            passed=False,
            score=0.0,
            reason=f'rouge: unknown metric "{metric}" (use precision, recall, f1)',
            code="evaluator.invalid_option",
        )

    def compute(response: str, ground_truth: str) -> tuple[float, dict[str, Any]]:
        score, details = rouge_metric(response, ground_truth, variant)
        return float(details[metric]), {**details, "metric": metric}

    return _reference_metric("rouge", compute, observed, rule, trace, behavior)


# ── Step-level evaluator dispatch ──

def evaluate_step(
    observed: ObservedStep | None,
    evaluation: dict[str, Any],
    behaviors: list[Behavior],
    trace: list[ObservedStep],
    behavior: Behavior | None = None,
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
    elif etype == "f1":
        return _with_blocking(f1_eval(observed, evaluation, trace, behavior), blocking)
    elif etype == "bleu":
        return _with_blocking(bleu_eval(observed, evaluation, trace, behavior), blocking)
    elif etype == "rouge":
        return _with_blocking(rouge_eval(observed, evaluation, trace, behavior), blocking)
    elif etype == "llm_judge":
        return EvalResult(type="llm_judge", passed=False, score=0.0,
                          reason="No LLM judge adapter registered. Use --adapter llm_judge=<provider>.",
                          blocking=blocking, code="adapter.not_configured")
    elif etype in ("Groundedness", "Relevance", "Coherence", "Fluency"):
        return EvalResult(type=etype, passed=False, score=0.0,
                          reason=f"No adapter registered for {etype}. Use --adapter {etype}=<provider>.",
                          blocking=blocking, code="adapter.not_configured")
    elif etype in ("all_of", "any_of", "none_of"):
        return _evaluate_composition(trace, evaluation, behaviors)
    else:
        return EvalResult(
            type=etype,
            passed=False,
            score=0.0,
            reason=f"Unknown evaluator type: {etype}",
            blocking=blocking,
            code="evaluator.unknown_type",
        )


def _with_blocking(result: EvalResult, blocking: bool) -> EvalResult:
    result.blocking = blocking
    return result


def apply_threshold(result: EvalResult, evaluation: dict[str, Any]) -> EvalResult:
    """Apply threshold from evaluation config to a result. Called by the runner."""
    result.adapter = result.adapter or evaluation.get("adapter")
    threshold = evaluation.get("threshold")
    if threshold is not None:
        result.threshold = threshold
        if result.score < threshold:
            result.passed = False
            result.reason = f"{result.reason} (score {result.score} < threshold {threshold})"
            result.code = result.code or "evaluator.threshold_not_met"
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


def _scan_when_operand(expression: str, i: int) -> tuple[str, int]:
    """Return the atomic operand starting at ``i`` (for unary-negation wrapping)."""
    while i < len(expression) and expression[i] in " \t":
        i += 1
    if i >= len(expression):
        return "", i
    ch = expression[i]
    if ch == "(":
        depth = 0
        j = i
        while j < len(expression):
            if expression[j] == "(":
                depth += 1
            elif expression[j] == ")":
                depth -= 1
                if depth == 0:
                    return expression[i : j + 1], j + 1
            j += 1
        return expression[i:], len(expression)
    if ch in "'\"":
        quote = ch
        j = i + 1
        while j < len(expression) and expression[j] != quote:
            if expression[j] == "\\" and j + 1 < len(expression):
                j += 1
            j += 1
        if j < len(expression):
            j += 1
        return expression[i:j], j
    j = i
    while j < len(expression) and (expression[j].isalnum() or expression[j] in "._"):
        j += 1
    return expression[i:j], j


def _normalize_when(expression: str) -> str:
    """Translate a ``when`` expression to Python-native syntax.

    Canonical ABS operators are ``&&``, ``||``, ``!`` (C-style). The word
    synonyms ``and``/``or``/``not`` (any case) are accepted for portability,
    plus ``===``/``!==`` and ``true``/``false`` in any case. Quoted string
    literals are left untouched. Unary negation binds to the immediately
    following value, mirroring JS semantics: ``!{{x}}`` or ``!({{x}} == 1)``.

    Mirrors ``normalizeWhenExpression`` in typescript/src/evaluators/builtin.ts.
    """
    out: list[str] = []
    i = 0
    n = len(expression)
    while i < n:
        ch = expression[i]
        # String literals: copy verbatim — never touch their contents.
        if ch in "'\"":
            quote = ch
            j = i + 1
            while j < n and expression[j] != quote:
                if expression[j] == "\\" and j + 1 < n:
                    j += 1
                j += 1
            if j < n:
                j += 1
            out.append(expression[i:j])
            i = j
            continue
        # Words: and/or/not synonyms and boolean literals (case-insensitive).
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (expression[j].isalnum() or expression[j] == "_"):
                j += 1
            word = expression[i:j]
            lower = word.lower()
            if lower == "and":
                out.append("and")
                i = j
                continue
            if lower == "or":
                out.append("or")
                i = j
                continue
            if lower == "not":
                operand, i = _scan_when_operand(expression, j)
                out.append(f"not ({operand})")
                continue
            if lower == "true":
                out.append("True")
                i = j
                continue
            if lower == "false":
                out.append("False")
                i = j
                continue
            out.append(word)
            i = j
            continue
        # Operators (longest first: !== contains !=, === contains ==).
        if expression.startswith("!==", i):
            out.append("!=")
            i += 3
            continue
        if expression.startswith("===", i):
            out.append("==")
            i += 3
            continue
        if expression.startswith("&&", i):
            out.append("and")
            i += 2
            continue
        if expression.startswith("||", i):
            out.append("or")
            i += 2
            continue
        if ch == "!" and not expression.startswith("!=", i):
            operand, i = _scan_when_operand(expression, i + 1)
            out.append(f"not ({operand})")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def eval_when(expression: str | None, row_vars: dict[str, Any]) -> bool:
    """Evaluate a ``when`` expression against dataset row variables.

    Accepted operators: ``&&``, ``||``, ``!`` (canonical) and the word
    synonyms ``and``/``or``/``not`` in any case; comparisons ``==``, ``!=``,
    ``<``, ``>``, ``<=``, ``>=`` (``===``/``!==`` also accepted); booleans
    ``true``/``false`` in any case; ``{{column}}`` references. Mirrors
    ``evalWhen`` in typescript/src/evaluators/builtin.ts.
    """
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
    resolved = _normalize_when(resolved)

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
