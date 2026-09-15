/**
 * Shared trace helpers for evaluator adapters.
 *
 * The runner annotates every observed step with the id of the behavior that
 * matched it, so adapters can resolve references like `user_asks.says` or
 * `kb_result.responds` against the trace.
 */

import { ObservedStep } from "./builtin";

export const COMM_ACTIONS = [
  "says",
  "asks",
  "informs",
  "greets",
  "responds",
  "clarifies",
  "confirms",
  "rejects",
  "suggests",
  "shows",
  "hands_off",
];

const DEFAULT_ACTIONS: Record<string, string> = {
  user: "says",
  assistant: "informs",
  tool: "responds",
};

export function toText(content: any): string {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/**
 * Render a trace as a readable multi-line transcript for LLM judges.
 *
 * A step shows its `content`; tool calls show their arguments (`with`)
 * instead, so the judge can see what was called with what. Steps with neither
 * render without a trailing colon.
 */
export function traceToText(trace: ObservedStep[]): string {
  return trace
    .map((s) => {
      const head = `[${s.actor}] ${s.action}${s.target ? " → " + s.target : ""}`;
      let payload: string | null = null;
      if (s.content !== undefined && s.content !== null) payload = toText(s.content);
      else if (s.with && Object.keys(s.with).length > 0) payload = toText(s.with);
      return payload ? `${head}: ${payload}` : head;
    })
    .join("\n");
}

/**
 * Resolve an ABS evaluation input reference to a string.
 *
 * Supported forms:
 *   - `"self"`               → the content of the behavior carrying the evaluation
 *   - `"kb_result"`          → the step matched by that behavior id (default action)
 *   - `"kb_result.responds"` → the same, with an explicit action
 *   - `"user.says"`          → legacy actor reference (first step of that actor)
 *
 * Behavior-id references take precedence; actor references remain for
 * compatibility. Returns the raw `ref` unchanged if nothing matches.
 */
export function resolveRef(
  trace: ObservedStep[],
  ref: string | undefined | null,
  selfContent = ""
): string {
  if (!ref) return "";
  if (ref === "self") return selfContent;

  const dot = ref.indexOf(".");
  const refId = dot >= 0 ? ref.slice(0, dot) : ref;
  const action = dot >= 0 ? ref.slice(dot + 1) : undefined;

  // 1) Behavior-id reference. The action is qualified explicitly, or defaults
  //    to the one for the step's actor (user → says, tool → responds, ...).
  for (const step of trace) {
    if (step.id !== refId) continue;
    const wanted = action ?? DEFAULT_ACTIONS[step.actor] ?? "says";
    if (step.action !== wanted) continue;
    return toText(step.content);
  }

  // 2) Legacy actor reference (`user.says`). Communication actions stay
  //    equivalent here so existing sessions keep resolving.
  const wanted = action ?? DEFAULT_ACTIONS[refId] ?? "says";
  for (const step of trace) {
    if (step.actor !== refId) continue;
    const actionMatches =
      step.action === wanted ||
      (COMM_ACTIONS.includes(step.action) && COMM_ACTIONS.includes(wanted));
    if (actionMatches) return toText(step.content);
  }

  return ref;
}
