/**
 * Shared trace helpers for evaluator adapters.
 *
 * The runner annotates every observed step with the id of the behavior that
 * matched it, so adapters can resolve references like `user_asks.says` or
 * `kb_result.responds` against the trace.
 */

import type { ObservedStep } from "./builtin";

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

// ── OpenAI-style message mapping ──

/**
 * Convert an ABS trace into an OpenAI-style message array.
 *
 * Mapping:
 *   - `user` / `system` steps          → text messages
 *   - consecutive `assistant` `calls`  → one assistant message with tool_call items
 *   - `tool` `responds`                → a tool message with a tool_result item
 *   - other `assistant` steps          → text messages
 */
export function traceToMessages(trace: ObservedStep[], toolCallPrefix = "call_abs_"): any[] {
  const messages: any[] = [];
  const pendingIds: string[] = [];
  let seq = 0;
  const nextId = () => `${toolCallPrefix}${seq++}`;

  let i = 0;
  while (i < trace.length) {
    const step = trace[i];

    // Group consecutive tool calls into a single assistant message
    if (step.actor === "assistant" && step.action === "calls") {
      const contentItems: any[] = [];
      while (i < trace.length && trace[i].actor === "assistant" && trace[i].action === "calls") {
        const call = trace[i];
        const id = call.tool_call_id ?? nextId();
        contentItems.push({
          type: "tool_call",
          tool_call_id: id,
          name: call.target ?? "",
          arguments: call.with ?? {},
        });
        pendingIds.push(id);
        i++;
      }
      messages.push({ role: "assistant", content: contentItems });
      continue;
    }

    if (step.actor === "tool") {
      let id = step.tool_call_id;
      if (!id && pendingIds.length > 0) id = pendingIds.shift();
      if (!id) id = nextId();
      messages.push({
        role: "tool",
        tool_call_id: id,
        content: [{ type: "tool_result", tool_result: step.content ?? "" }],
      });
      i++;
      continue;
    }

    if (step.actor === "user" || step.actor === "system") {
      messages.push({ role: step.actor, content: toText(step.content) });
    } else if (step.actor === "assistant") {
      messages.push({ role: "assistant", content: toText(step.content) });
    }
    // other actors (human, external, error) are skipped

    i++;
  }

  return messages;
}

/** Split a trace into the `{query, response}` conversation shape. */
export function traceToConversation(
  trace: ObservedStep[],
  toolCallPrefix = "call_abs_"
): { query: any[]; response: any[] } {
  const query: any[] = [];
  const response: any[] = [];
  for (const msg of traceToMessages(trace, toolCallPrefix)) {
    if (msg.role === "system" || msg.role === "user") query.push(msg);
    else response.push(msg);
  }
  return { query, response };
}

/** Return the assistant `calls` steps in order. */
export function extractToolCalls(trace: ObservedStep[]): ObservedStep[] {
  return trace.filter((s) => s.actor === "assistant" && s.action === "calls");
}

/** Return the ordered list of tool names called by the assistant. */
export function extractToolTrajectory(trace: ObservedStep[]): string[] {
  return extractToolCalls(trace)
    .map((s) => s.target)
    .filter((target): target is string => Boolean(target));
}
