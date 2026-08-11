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
  inconclusive?: boolean;
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
  const execActions = ["calls", "submits", "retrieves", "stores", "updates"];
  if (selector.actor && step.actor !== selector.actor) return false;
  if (selector.action) {
    if (step.action === selector.action) { /* exact match */ }
    else if (commActions.includes(step.action) && commActions.includes(selector.action)) { /* comm equivalence */ }
    else if (execActions.includes(step.action) && execActions.includes(selector.action)) { /* exec equivalence */ }
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
  const varName = rule.variable;
  // Simulate resolution: track every value bound to this variable
  const values: { value: any; source: string }[] = [];
  const vars: Record<string, any> = {};

  for (const b of behaviors) {
    // Resolve {{var}} references in with and content before using captures
    const resolvedWith = resolveVarRefs(b.with, vars);
    const resolvedContent = resolveVarRefs(b.content, vars);

    // If this behavior references {{varName}} in with or content, record the resolved value
    if (b.with && hasVarRef(b.with, varName)) {
      const val = deepGet(resolvedWith, varName);
      if (val !== undefined) values.push({ value: val, source: `with in step ${b.actor}/${b.action}` });
    }
    if (typeof b.content === "string" && hasVarRefStr(b.content, varName)) {
      values.push({ value: resolvedContent, source: `content in step ${b.actor}/${b.action}` });
    }

    // Apply captures
    if (b.capture && varName in b.capture) {
      const val = resolveVarRefs(b.capture[varName], vars);
      vars[varName] = val;
      values.push({ value: val, source: `capture in step ${b.actor}/${b.action}` });
    }
  }

  if (values.length <= 1) {
    return {
      type: "variable_consistency",
      passed: true,
      score: 1,
      reason: `Variable "${varName}" used ${values.length} time(s) — nothing to compare`,
    };
  }

  const first = JSON.stringify(values[0].value);
  const consistent = values.every((v) => JSON.stringify(v.value) === first);
  if (!consistent) {
    const details = values.map((v) => `${v.source}: ${JSON.stringify(v.value)}`).join(", ");
    return {
      type: "variable_consistency",
      passed: false,
      score: 0,
      reason: `Variable "${varName}" has inconsistent values: ${details}`,
    };
  }
  return {
    type: "variable_consistency",
    passed: true,
    score: 1,
    reason: `Variable "${varName}" consistent across ${values.length} uses`,
  };
}

function hasVarRef(obj: any, varName: string): boolean {
  if (typeof obj === "string") return hasVarRefStr(obj, varName);
  if (Array.isArray(obj)) return obj.some((v) => hasVarRef(v, varName));
  if (typeof obj === "object" && obj !== null) return Object.values(obj).some((v) => hasVarRef(v, varName));
  return false;
}

function hasVarRefStr(s: string, varName: string): boolean {
  return s.includes(`{{${varName}}}`);
}

function resolveVarRefs(value: any, vars: Record<string, any>): any {
  if (typeof value === "string") {
    return value.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
      return name in vars ? String(vars[name]) : `{{${name}}}`;
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveVarRefs(v, vars));
  if (typeof value === "object" && value !== null) {
    const resolved: any = {};
    for (const [k, v] of Object.entries(value)) {
      resolved[k] = resolveVarRefs(v, vars);
    }
    return resolved;
  }
  return value;
}

function deepGet(obj: any, key: string): any {
  if (typeof obj === "object" && obj !== null && key in obj) return obj[key];
  if (typeof obj === "object" && obj !== null) {
    for (const v of Object.values(obj)) {
      const found = deepGet(v, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function toolCall(
  trace: ObservedStep[],
  rule: { target?: string; with?: Record<string, any>; ordered?: boolean }
): EvalResult {
  // Find all matching tool calls in the trace
  const calls = trace.filter((s) => s.actor === "assistant" && s.action === "calls");

  if (rule.target) {
    const matching = calls.filter((c) => c.target === rule.target);
    if (matching.length === 0) {
      return {
        type: "tool_call",
        passed: false,
        score: 0,
        reason: `Tool "${rule.target}" was never called. Observed calls: ${calls.map((c) => c.target).join(", ") || "none"}`,
      };
    }

    // Check with params on the matching calls
    if (rule.with) {
      for (const call of matching) {
        const observedWith = call.with ?? {};
        for (const [key, expected] of Object.entries(rule.with)) {
          if (!(key in observedWith)) {
            return {
              type: "tool_call",
              passed: false,
              score: 0,
              reason: `Tool "${rule.target}" missing parameter "${key}". Observed: ${JSON.stringify(observedWith)}`,
            };
          }
          if (JSON.stringify(observedWith[key]) !== JSON.stringify(expected)) {
            return {
              type: "tool_call",
              passed: false,
              score: 0,
              reason: `Tool "${rule.target}" parameter "${key}" expected ${JSON.stringify(expected)}, got ${JSON.stringify(observedWith[key])}`,
            };
          }
        }
      }
    }

    return {
      type: "tool_call",
      passed: true,
      score: 1,
      reason: `Tool "${rule.target}" called correctly`,
    };
  }

  // No target specified — just check that at least one tool was called
  if (calls.length === 0) {
    return {
      type: "tool_call",
      passed: false,
      score: 0,
      reason: "No tool calls observed in the trace",
    };
  }

  return {
    type: "tool_call",
    passed: true,
    score: 1,
    reason: `${calls.length} tool call(s) observed`,
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
    case "tool_call": {
      const result = toolCall(trace, evaluation);
      return applyThreshold({ ...result, blocking }, evaluation);
    }
    case "llm_judge":
      return applyThreshold({ type: "llm_judge", passed: false, score: 0, reason: "No LLM judge adapter registered. Use --adapter llm_judge=<provider>.", blocking }, evaluation);
    case "Groundedness":
    case "Relevance":
    case "Coherence":
    case "Fluency":
      return applyThreshold({
        type: evaluation.type,
        passed: false,
        score: 0,
        reason: `No adapter registered for ${evaluation.type}. Use --adapter ${evaluation.type}=<provider>.`,
        blocking
      }, evaluation);
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

// ── v0.2 — when expression evaluator ──

export function evalWhen(expression: string | undefined, rowVars: Record<string, any>): boolean {
  if (!expression) return true; // no when = always applies

  // Replace {{var}} references with their values
  let resolved = expression.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
    if (name in rowVars) {
      const val = rowVars[name];
      if (typeof val === "string") return JSON.stringify(val);
      return String(val);
    }
    return "undefined";
  });

  // Simple boolean eval — supports ==, !=, true, false, quoted strings
  try {
    // Note: == and != work fine in JS for dataset comparisons (booleans, strings, numbers)
    // biome-ignore security/detect-eval-with-expression: resolved contains only literal values from dataset
    return eval(resolved);
  } catch {
    return false;
  }
}

// ── v0.2 — expected evaluator ──

export function expected(
  stepResults: { step: number; behavior: Behavior; matched: boolean }[],
  evaluation: any,
  rowVars: Record<string, any>
): EvalResult {
  // Check when condition
  if (!evalWhen(evaluation.when, rowVars)) {
    return { type: "expected", passed: true, score: 1, reason: "when condition not met — skipped" };
  }

  // Find the referenced behavior
  const refStep = stepResults.find(s => s.behavior.id === evaluation.behavior);
  if (!refStep) {
    return { type: "expected", passed: false, score: 0, reason: `Behavior "${evaluation.behavior}" not found in trace` };
  }

  if (!refStep.matched) {
    const msg = evaluation.reason || `Expected behavior "${evaluation.behavior}" to match, but it did not`;
    return { type: "expected", passed: false, score: 0, reason: msg };
  }

  // Check after constraint
  if (evaluation.after) {
    const afterIdx = stepResults.findIndex(s =>
      (!evaluation.after!.actor || s.behavior.actor === evaluation.after!.actor) &&
      (!evaluation.after!.action || s.behavior.action === evaluation.after!.action) &&
      (!evaluation.after!.target || s.behavior.target === evaluation.after!.target)
    );
    const refIdx = stepResults.indexOf(refStep);
    if (afterIdx === -1 || refIdx <= afterIdx) {
      const msg = evaluation.reason || `Expected "${evaluation.behavior}" to match after ${JSON.stringify(evaluation.after)}, but it did not`;
      return { type: "expected", passed: false, score: 0, reason: msg };
    }
  }

  return { type: "expected", passed: true, score: 1, reason: `Behavior "${evaluation.behavior}" matched as expected` };
}

// ── v0.2 — matches_when matcher ──

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
