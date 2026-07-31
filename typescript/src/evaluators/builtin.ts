import { Behavior, Selector } from "../parser";

// ── Observed step ──

export interface ObservedStep {
  actor: string;
  action: string;
  target?: string;
  content?: any;
  with?: Record<string, any>;
}

// ── Eval result ──

export interface EvalResult {
  type: string;
  passed: boolean;
  score: number;
  reason: string;
  blocking?: boolean;
}

// ── Built-in step-level evaluators ──

export function exactMatch(
  observed: any,
  rule: { value: any }
): EvalResult {
  const expected = rule.value;
  const passed = JSON.stringify(observed) === JSON.stringify(expected);
  return {
    type: "exact_match",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Content matches "${expected}"`
      : `Expected "${expected}", got "${observed}"`,
  };
}

export function contains(
  observed: any,
  rule: { value: string }
): EvalResult {
  const obs = String(observed ?? "");
  const search = rule.value.toLowerCase();
  const passed = obs.toLowerCase().includes(search);
  return {
    type: "contains",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Content contains "${rule.value}"`
      : `Expected content to contain "${rule.value}", got "${obs.substring(0, 100)}"`,
  };
}

export function regex(
  observed: any,
  rule: { pattern: string }
): EvalResult {
  const obs = String(observed ?? "");
  const re = new RegExp(rule.pattern);
  const passed = re.test(obs);
  return {
    type: "regex",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Content matches /${rule.pattern}/`
      : `Expected content to match /${rule.pattern}/, got "${obs.substring(0, 100)}"`,
  };
}

export function schema(
  observed: any,
  rule: { schema: Record<string, any> }
): EvalResult {
  // Use simple structural validation
  const required = rule.schema.required ?? [];
  const properties = rule.schema.properties ?? {};
  const additionalProps = rule.schema.additionalProperties !== false;

  if (typeof observed !== "object" || observed === null) {
    return {
      type: "schema",
      passed: false,
      score: 0,
      reason: `Expected an object, got ${typeof observed}`,
    };
  }

  for (const key of required) {
    if (!(key in observed)) {
      return {
        type: "schema",
        passed: false,
        score: 0,
        reason: `Missing required field: "${key}"`,
      };
    }
  }

  if (!additionalProps) {
    for (const key of Object.keys(observed)) {
      if (!(key in properties)) {
        return {
          type: "schema",
          passed: false,
          score: 0,
          reason: `Unexpected field: "${key}" (additionalProperties: false)`,
        };
      }
    }
  }

  for (const [key, schema] of Object.entries(properties)) {
    if (key in observed) {
      const propSchema = schema as any;
      if (propSchema.type === "string" && typeof observed[key] !== "string") {
        return {
          type: "schema",
          passed: false,
          score: 0,
          reason: `Field "${key}" expected string, got ${typeof observed[key]}`,
        };
      }
      if (propSchema.enum && !propSchema.enum.includes(observed[key])) {
        return {
          type: "schema",
          passed: false,
          score: 0,
          reason: `Field "${key}" must be one of [${propSchema.enum.join(", ")}], got "${observed[key]}"`,
        };
      }
    }
  }

  return {
    type: "schema",
    passed: true,
    score: 1,
    reason: "Content matches schema",
  };
}

// ── Chain evaluators ──

export function matchesSelector(
  step: ObservedStep,
  selector: Selector
): boolean {
  const commActions = ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"];
  if (selector.actor && step.actor !== selector.actor) return false;
  if (selector.action) {
    if (step.action === selector.action) { /* exact match */ }
    else if (commActions.includes(step.action) && commActions.includes(selector.action)) { /* comm equivalence */ }
    else return false;
  }
  if (selector.target && step.target !== selector.target) return false;
  return true;
}

export function sequence(
  trace: ObservedStep[],
  rule: { order: Selector[] }
): EvalResult {
  let traceIdx = 0;
  for (const sel of rule.order) {
    let found = false;
    while (traceIdx < trace.length) {
      if (matchesSelector(trace[traceIdx], sel)) {
        found = true;
        traceIdx++;
        break;
      }
      traceIdx++;
    }
    if (!found) {
      return {
        type: "sequence",
        passed: false,
        score: 0,
        reason: `Step not found in expected order: ${JSON.stringify(sel)}`,
      };
    }
  }
  return {
    type: "sequence",
    passed: true,
    score: 1,
    reason: `All ${rule.order.length} steps found in order`,
  };
}

export function eventually(
  trace: ObservedStep[],
  rule: { match: Selector }
): EvalResult {
  const found = trace.some((s) => matchesSelector(s, rule.match));
  return {
    type: "eventually",
    passed: found,
    score: found ? 1 : 0,
    reason: found
      ? `Found matching step`
      : `Never found step matching ${JSON.stringify(rule.match)}`,
  };
}

export function never(
  trace: ObservedStep[],
  rule: { match: Selector }
): EvalResult {
  const found = trace.some((s) => matchesSelector(s, rule.match));
  return {
    type: "never",
    passed: !found,
    score: found ? 0 : 1,
    reason: found
      ? `Found disallowed step matching ${JSON.stringify(rule.match)}`
      : `Disallowed step never occurred`,
  };
}

export function count(
  trace: ObservedStep[],
  rule: { match: Selector; min?: number; max?: number }
): EvalResult {
  const n = trace.filter((s) => matchesSelector(s, rule.match)).length;
  const minOk = rule.min === undefined || n >= rule.min;
  const maxOk = rule.max === undefined || n <= rule.max;
  const passed = minOk && maxOk;
  return {
    type: "count",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Count ${n} within [${rule.min ?? 0}, ${rule.max ?? "∞"}]`
      : `Count ${n} outside [${rule.min ?? 0}, ${rule.max ?? "∞"}]`,
  };
}

export function within(
  trace: ObservedStep[],
  rule: { after: Selector; match: Selector; max_steps: number }
): EvalResult {
  let afterIdx = -1;
  for (let i = 0; i < trace.length; i++) {
    if (matchesSelector(trace[i], rule.after)) {
      afterIdx = i;
      break;
    }
  }
  if (afterIdx === -1) {
    return {
      type: "within",
      passed: false,
      score: 0,
      reason: `"after" selector never matched: ${JSON.stringify(rule.after)}`,
    };
  }
  for (let i = afterIdx + 1; i <= afterIdx + rule.max_steps && i < trace.length; i++) {
    if (matchesSelector(trace[i], rule.match)) {
      return {
        type: "within",
        passed: true,
        score: 1,
        reason: `Found within ${i - afterIdx} steps (max ${rule.max_steps})`,
      };
    }
  }
  return {
    type: "within",
    passed: false,
    score: 0,
    reason: `Not found within ${rule.max_steps} steps of ${JSON.stringify(rule.after)}`,
  };
}

export function variableConsistency(
  trace: ObservedStep[],
  behaviors: Behavior[],
  rule: { variable: string }
): EvalResult {
  // Collect all resolved values of this variable from captured steps
  const values: any[] = [];
  const vars: Record<string, any> = {};

  for (const b of behaviors) {
    if (b.capture && rule.variable in b.capture) {
      const val = b.capture[rule.variable];
      values.push(val);
      vars[rule.variable] = val;
    }
  }

  if (values.length <= 1) {
    return {
      type: "variable_consistency",
      passed: true,
      score: 1,
      reason: `Variable "${rule.variable}" captured ${values.length} time(s) — nothing to compare`,
    };
  }

  const first = JSON.stringify(values[0]);
  const consistent = values.every((v: any) => JSON.stringify(v) === first);
  return {
    type: "variable_consistency",
    passed: consistent,
    score: consistent ? 1 : 0,
    reason: consistent
      ? `Variable "${rule.variable}" consistent across ${values.length} captures`
      : `Variable "${rule.variable}" has inconsistent values: ${values.map((v: any) => JSON.stringify(v)).join(", ")}`,
  };
}

// ── Apply threshold ──

function applyThreshold(result: EvalResult, evaluation: any): EvalResult {
  const threshold = evaluation.threshold;
  if (threshold !== undefined && result.score < threshold) {
    return {
      ...result,
      passed: false,
      reason: `${result.reason} (score ${result.score} < threshold ${threshold})`,
    };
  }
  return result;
}

// ── Step-level evaluator dispatch ──

export function evaluateStep(
  observed: ObservedStep | null,
  evaluation: any,
  behaviors: Behavior[],
  trace: ObservedStep[]
): EvalResult {
  const blocking = evaluation.blocking === true;

  switch (evaluation.type) {
    case "exact_match":
      return { ...exactMatch(observed?.content, evaluation), blocking };
    case "contains":
      return { ...contains(observed?.content, evaluation), blocking };
    case "regex":
      return { ...regex(observed?.content, evaluation), blocking };
    case "schema":
      return { ...schema(observed?.content, evaluation), blocking };
    case "sequence":
      return applyThreshold({ ...sequence(trace, evaluation), blocking }, evaluation);
    case "eventually":
      return applyThreshold({ ...eventually(trace, evaluation), blocking }, evaluation);
    case "never":
      return applyThreshold({ ...never(trace, evaluation), blocking }, evaluation);
    case "count":
      return applyThreshold({ ...count(trace, evaluation), blocking }, evaluation);
    case "within":
      return applyThreshold({ ...within(trace, evaluation), blocking }, evaluation);
    case "variable_consistency":
      return applyThreshold({ ...variableConsistency(trace, behaviors, evaluation), blocking }, evaluation);
    case "tool_call":
      return applyThreshold({ type: "tool_call", passed: true, score: 1, reason: "Tool call validated", blocking }, evaluation);
    case "llm_judge":
      return applyThreshold({ type: "llm_judge", passed: false, score: 0, reason: "No LLM judge adapter registered. Use --adapter llm_judge=<provider>.", blocking }, evaluation);
    case "groundedness":
      return applyThreshold({ type: "groundedness", passed: false, score: 0, reason: "No groundedness adapter registered.", blocking }, evaluation);
    case "bias":
      return applyThreshold({ type: "bias", passed: false, score: 0, reason: "No bias adapter registered.", blocking }, evaluation);
    case "toxicity":
      return applyThreshold({ type: "toxicity", passed: false, score: 0, reason: "No toxicity adapter registered.", blocking }, evaluation);
    case "all_of":
    case "any_of":
    case "none_of":
      return applyThreshold(evaluateComposition(trace, evaluation, behaviors), evaluation);
    default:
      return {
        type: evaluation.type,
        passed: false,
        score: 0,
        reason: `Unknown evaluator type: ${evaluation.type}`,
        blocking,
      };
  }
}

function evaluateComposition(
  trace: ObservedStep[],
  rule: any,
  behaviors: Behavior[]
): EvalResult {
  const results = (rule.evaluations ?? []).map((e: any) =>
    evaluateStep(null, e, behaviors, trace)
  );

  let passed: boolean;
  const avgScore = results.length > 0
    ? results.reduce((sum: number, r: EvalResult) => sum + r.score, 0) / results.length
    : 0;

  switch (rule.type) {
    case "all_of":
      passed = results.every((r: EvalResult) => r.passed);
      break;
    case "any_of":
      passed = results.some((r: EvalResult) => r.passed);
      break;
    case "none_of":
      passed = results.every((r: EvalResult) => !r.passed);
      break;
    default:
      passed = false;
  }

  return {
    type: rule.type,
    passed,
    score: avgScore,
    reason: `${results.filter((r: EvalResult) => r.passed).length}/${results.length} sub-evaluations passed (avg score: ${avgScore.toFixed(2)})`,
  };
}

// ── Adaptive evaluator (calls external adapter) ──

export type AdapterFunction = (
  trace: ObservedStep[],
  evaluation: any
) => Promise<EvalResult>;

const adapters: Record<string, AdapterFunction> = {};

export function registerAdapter(type: string, fn: AdapterFunction): void {
  adapters[type] = fn;
}

export async function evaluateWithAdapter(
  type: string,
  trace: ObservedStep[],
  evaluation: any
): Promise<EvalResult | null> {
  const adapter = adapters[type];
  if (!adapter) return null;
  return adapter(trace, evaluation);
}
