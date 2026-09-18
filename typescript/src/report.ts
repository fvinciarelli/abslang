/**
 * JSON report serialization.
 *
 * The shape is stable and identical in the TypeScript and Python
 * implementations (Python: src/abslang/report.py):
 *   - only fields that are set are emitted (no null padding); `blocking` and
 *     `inconclusive` are always present as booleans
 *   - durations use snake_case (`duration_ms`) to match the log event schema
 *   - `observed` exposes the agent step plus tool-call arguments under `with`
 */

export function serializeEval(e: any): Record<string, any> {
  const out: Record<string, any> = {
    type: e.type,
    passed: e.passed,
    score: e.score,
    reason: e.reason,
    blocking: e.blocking ?? false,
    inconclusive: e.inconclusive ?? false,
  };
  const optional: Record<string, any> = {
    code: e.code,
    details: e.details,
    threshold: e.threshold,
    adapter: e.adapter,
    duration_ms: e.durationMs,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

export function serializeObserved(o: any): Record<string, any> | null {
  if (!o) return null;
  const out: Record<string, any> = {};
  for (const key of ["actor", "action", "target", "content", "with", "tool_call_id"]) {
    const value = o[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}
