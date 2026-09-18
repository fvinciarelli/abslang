"""JSON report serialization.

The shape is stable and identical in the Python and TypeScript implementations
(TypeScript: src/report.ts):
  - only fields that are set are emitted (no null padding); ``blocking`` and
    ``inconclusive`` are always present as booleans
  - durations use snake_case (``duration_ms``) to match the log event schema
  - ``observed`` exposes the agent step plus tool-call arguments under ``with``
"""

from typing import Any


def eval_to_dict(e: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "type": e.type,
        "passed": e.passed,
        "score": e.score,
        "reason": e.reason,
        "blocking": bool(e.blocking),
        "inconclusive": bool(e.inconclusive),
    }
    for key in ("code", "details", "threshold", "adapter", "duration_ms"):
        value = getattr(e, key, None)
        if value is not None:
            data[key] = value
    return data


def observed_to_dict(o: Any) -> dict[str, Any] | None:
    if o is None:
        return None
    out: dict[str, Any] = {}
    for key in ("actor", "action", "target", "content", "tool_call_id"):
        value = getattr(o, key, None)
        if value is not None:
            out[key] = value
    with_ = getattr(o, "with_", None)
    if with_ is not None:
        out["with"] = with_
    return out
