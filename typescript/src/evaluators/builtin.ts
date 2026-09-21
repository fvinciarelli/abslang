import { Behavior, Selector } from "../parser";
import { resolveRef } from "./trace_utils";

// ── Observed step ──

export interface ObservedStep {
  actor: string;
  action: string;
  id?: string;
  target?: string;
  content?: any;
  with?: Record<string, any>;
  tool_call_id?: string;
}

// ── Eval result ──

export interface EvalResult {
  type: string;
  passed: boolean;
  score: number;
  reason: string;
  blocking?: boolean;
  inconclusive?: boolean;
  /** Machine-readable failure classification (stable across runs). */
  code?: string;
  /** Raw provider payload / metric breakdown. */
  details?: Record<string, any>;
  /** Set by applyThreshold from the evaluation rule. */
  threshold?: number;
  adapter?: string;
  durationMs?: number;
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
  // EVALUATIONS.md: "A field that's present must match exactly".
  // Communication actions are annotated on the observed step by the runner with
  // the action of the behavior that matched it, so exact comparison stays useful.
  if (selector.actor && step.actor !== selector.actor) return false;
  if (selector.action && step.action !== selector.action) return false;
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

// ── Reference-based text metrics (deterministic) ──
//
// These compare the observed response against a declared `ground_truth` using
// pure algorithms: no model, no network, no adapter. Tokenization and metric
// variants are part of the contract so every implementation agrees on the
// score (see EVALUATIONS.md). The test vectors are shared with the Python
// implementation (python/tests/test_text_metrics.py).

const TOKEN_RE = /[\p{L}\p{N}_]+/gu;
export const BLEU_MAX_N = 4;
export const ROUGE_VARIANTS: string[] = ["rouge1", "rouge2", "rougeL"];
export const ROUGE_METRICS: string[] = ["precision", "recall", "f1"];

function tokenize(text: unknown): string[] {
  const value = text === null || text === undefined ? "" : String(text).toLowerCase();
  return value.match(TOKEN_RE) ?? [];
}

function ngramCounts(tokens: string[], n: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= tokens.length; i++) {
    const key = tokens.slice(i, i + n).join("\u0001");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function overlapCount(a: Map<string, number>, b: Map<string, number>): number {
  let total = 0;
  for (const [key, count] of a) {
    const other = b.get(key);
    if (other) total += Math.min(count, other);
  }
  return total;
}

function prf(overlap: number, totalObserved: number, totalReference: number) {
  const precision = totalObserved ? overlap / totalObserved : 0;
  const recall = totalReference ? overlap / totalReference : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/** Token-level (unigram) F1 between response and reference. */
export function f1ScoreMetric(
  response: string,
  groundTruth: string
): [number, { precision: number; recall: number; f1: number }] {
  const observed = tokenize(response);
  const reference = tokenize(groundTruth);
  if (observed.length === 0 || reference.length === 0) {
    return [0, prf(0, observed.length, reference.length)];
  }
  const overlap = overlapCount(ngramCounts(observed, 1), ngramCounts(reference, 1));
  const scores = prf(overlap, observed.length, reference.length);
  return [scores.f1, scores];
}

/** BLEU-4 with add-1 smoothing, effective order, and brevity penalty. */
export function bleuMetric(
  response: string,
  groundTruth: string
): [number, { precisions: number[]; brevity_penalty: number }] {
  const observed = tokenize(response);
  const reference = tokenize(groundTruth);
  if (observed.length === 0 || reference.length === 0) {
    return [0, { precisions: [], brevity_penalty: 0 }];
  }
  const precisions: number[] = [];
  for (let n = 1; n <= BLEU_MAX_N; n++) {
    const total = observed.length - n + 1;
    if (total <= 0) continue;
    const matches = overlapCount(ngramCounts(observed, n), ngramCounts(reference, n));
    precisions.push((matches + 1) / (total + 1));
  }
  if (precisions.length === 0) {
    return [0, { precisions: [], brevity_penalty: 0 }];
  }
  const logMean = precisions.reduce((sum, p) => sum + Math.log(p), 0) / precisions.length;
  const brevityPenalty = Math.min(1, Math.exp(1 - reference.length / observed.length));
  return [brevityPenalty * Math.exp(logMean), { precisions, brevity_penalty: brevityPenalty }];
}

function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    const current = [0];
    for (let j = 1; j <= b.length; j++) {
      current.push(x === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]));
    }
    previous = current;
  }
  return previous[b.length];
}

/** ROUGE-N (n=1,2) or ROUGE-L F1 between response and reference. */
export function rougeMetric(
  response: string,
  groundTruth: string,
  variant: string = "rougeL"
): [number, { precision: number; recall: number; f1: number; variant: string }] {
  const observed = tokenize(response);
  const reference = tokenize(groundTruth);
  let scores: { precision: number; recall: number; f1: number };
  if (variant === "rougeL") {
    const lcs = lcsLength(observed, reference);
    scores = prf(lcs, observed.length, reference.length);
  } else {
    const n = variant === "rouge1" ? 1 : 2;
    const observedNgrams = ngramCounts(observed, n);
    const referenceNgrams = ngramCounts(reference, n);
    const overlap = overlapCount(observedNgrams, referenceNgrams);
    const totalObserved = [...observedNgrams.values()].reduce((sum, v) => sum + v, 0);
    const totalReference = [...referenceNgrams.values()].reduce((sum, v) => sum + v, 0);
    scores = prf(overlap, totalObserved, totalReference);
  }
  return [scores.f1, { ...scores, variant }];
}

function valueToText(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function lastAssistantText(trace: ObservedStep[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const step = trace[i];
    if (step.actor === "assistant" && step.content !== undefined && step.content !== null) {
      return valueToText(step.content);
    }
  }
  return "";
}

function resolveMetricInputs(
  observed: ObservedStep | null,
  rule: any,
  trace: ObservedStep[],
  behavior?: Behavior
): { response: string; groundTruth: string } {
  const declared = behavior ? valueToText(behavior.content) : "";
  const observedText = observed ? valueToText(observed.content) : lastAssistantText(trace);

  const gtRef = rule.ground_truth;
  if (gtRef === undefined || gtRef === null) {
    throw new Error('requires a "ground_truth" field');
  }
  const groundTruth =
    gtRef === "self" ? declared || observedText : resolveRef(trace, String(gtRef), declared) || declared;

  const responseRef = rule.response;
  const response =
    !responseRef || responseRef === "self"
      ? observedText
      : resolveRef(trace, String(responseRef), observedText) || observedText;

  return { response, groundTruth };
}

function referenceMetric(
  type: string,
  compute: (response: string, groundTruth: string) => [number, Record<string, any>],
  observed: ObservedStep | null,
  rule: any,
  trace: ObservedStep[],
  behavior?: Behavior
): EvalResult {
  let response: string;
  let groundTruth: string;
  try {
    ({ response, groundTruth } = resolveMetricInputs(observed, rule, trace, behavior));
  } catch (err: any) {
    return { type, passed: false, score: 0, reason: `${type}: ${err.message}`, code: "evaluator.missing_input" };
  }

  let score: number;
  let details: Record<string, any>;
  try {
    [score, details] = compute(response, groundTruth);
  } catch (err: any) {
    return { type, passed: false, score: 0, reason: `${type}: ${err.message}`, code: "evaluator.invalid_option" };
  }

  return { type, passed: score >= 0.5, score, reason: `${type}: score ${score.toFixed(2)}`, details };
}

export function f1Eval(
  observed: ObservedStep | null,
  rule: any,
  trace: ObservedStep[],
  behavior?: Behavior
): EvalResult {
  return referenceMetric("f1", f1ScoreMetric, observed, rule, trace, behavior);
}

export function bleuEval(
  observed: ObservedStep | null,
  rule: any,
  trace: ObservedStep[],
  behavior?: Behavior
): EvalResult {
  return referenceMetric("bleu", bleuMetric, observed, rule, trace, behavior);
}

export function rougeEval(
  observed: ObservedStep | null,
  rule: any,
  trace: ObservedStep[],
  behavior?: Behavior
): EvalResult {
  const variant = String(rule.variant ?? "rougeL");
  const metric = String(rule.metric ?? "f1");
  if (!ROUGE_VARIANTS.includes(variant)) {
    return {
      type: "rouge",
      passed: false,
      score: 0,
      reason: `rouge: unknown variant "${variant}" (use rouge1, rouge2, rougeL)`,
      code: "evaluator.invalid_option",
    };
  }
  if (!ROUGE_METRICS.includes(metric)) {
    return {
      type: "rouge",
      passed: false,
      score: 0,
      reason: `rouge: unknown metric "${metric}" (use precision, recall, f1)`,
      code: "evaluator.invalid_option",
    };
  }

  const compute = (response: string, groundTruth: string): [number, Record<string, any>] => {
    const [, details] = rougeMetric(response, groundTruth, variant);
    return [(details as Record<string, any>)[metric], { ...details, metric }];
  };
  return referenceMetric("rouge", compute, observed, rule, trace, behavior);
}

// ── Apply threshold ──

export function applyThreshold(result: EvalResult, evaluation: any): EvalResult {
  const updated: EvalResult = {
    ...result,
    adapter: result.adapter ?? evaluation.adapter,
  };
  const threshold = evaluation.threshold;
  if (threshold !== undefined && threshold !== null) {
    updated.threshold = threshold;
    if (updated.score < threshold) {
      updated.passed = false;
      updated.reason = `${updated.reason} (score ${updated.score} < threshold ${threshold})`;
      updated.code = updated.code ?? "evaluator.threshold_not_met";
    }
  }
  return updated;
}

// ── Step-level evaluator dispatch ──

export function evaluateStep(
  observed: ObservedStep | null,
  evaluation: any,
  behaviors: Behavior[],
  trace: ObservedStep[],
  behavior?: Behavior
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
    case "f1":
      return applyThreshold({ ...f1Eval(observed, evaluation, trace, behavior), blocking }, evaluation);
    case "bleu":
      return applyThreshold({ ...bleuEval(observed, evaluation, trace, behavior), blocking }, evaluation);
    case "rouge":
      return applyThreshold({ ...rougeEval(observed, evaluation, trace, behavior), blocking }, evaluation);
    case "llm_judge":
      return applyThreshold({ type: "llm_judge", passed: false, score: 0, reason: "No LLM judge adapter registered. Use --adapter llm_judge=<provider>.", blocking, code: "adapter.not_configured" }, evaluation);
    case "Groundedness":
    case "Relevance":
    case "Coherence":
    case "Fluency":
      return applyThreshold({
        type: evaluation.type,
        passed: false,
        score: 0,
        reason: `No adapter registered for ${evaluation.type}. Use --adapter ${evaluation.type}=<provider>.`,
        blocking,
        code: "adapter.not_configured"
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
        code: "evaluator.unknown_type",
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

/**
 * Translate word synonyms (and/or/not, any case) and boolean literals in any
 * case to JS-native syntax. Quoted string literals are left untouched.
 * Mirrors `_normalize_when` in python/src/abslang/evaluators/__init__.py.
 */
function normalizeWhenExpression(expression: string): string {
  let out = "";
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    // String literals: copy verbatim — never touch their contents.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < expression.length && expression[j] !== quote) {
        if (expression[j] === "\\" && j + 1 < expression.length) j++; // skip escapes
        j++;
      }
      if (j < expression.length) j++; // closing quote
      out += expression.slice(i, j);
      i = j;
      continue;
    }
    // Words: and/or/not synonyms and boolean literals (case-insensitive).
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expression.length && /[A-Za-z0-9_]/.test(expression[j])) j++;
      const word = expression.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === "and") out += "&&";
      else if (lower === "or") out += "||";
      else if (lower === "not") out += "!";
      else if (lower === "true") out += "true";
      else if (lower === "false") out += "false";
      else out += word;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

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

  // Normalize operator synonyms to canonical JS syntax (SPECIFICATION.md §7.4)
  resolved = normalizeWhenExpression(resolved);

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

// ── Adapter registry (default + named) ──

export type AdapterFunction = (
  trace: ObservedStep[],
  evaluation: any
) => Promise<EvalResult>;

const adapters: Record<string, AdapterFunction> = {};
const namedAdapters: Record<string, AdapterFunction> = {};

/**
 * Register an external evaluator adapter.
 *
 * Without `name` the adapter becomes the default for `type`. With `name` it is
 * registered under `(type, name)` so a rule can select it via `adapter:`.
 */
export function registerAdapter(type: string, fn: AdapterFunction, name?: string): void {
  if (name) namedAdapters[`${type}\u0000${name}`] = fn;
  else adapters[type] = fn;
}

/**
 * Try to evaluate using a registered adapter. Returns null when no adapter is
 * registered for the type and no name was requested.
 */
export async function evaluateWithAdapter(
  type: string,
  trace: ObservedStep[],
  evaluation: any,
  adapterName?: string
): Promise<EvalResult | null> {
  if (adapterName) {
    const named = namedAdapters[`${type}\u0000${adapterName}`];
    if (named) return named(trace, evaluation);
    return {
      type,
      passed: false,
      score: 0,
      reason: `Adapter '${adapterName}' is not registered for '${type}'. Run with --adapter ${type}=${adapterName} (or --adapter ${adapterName}).`,
      code: "adapter.not_configured",
    };
  }
  const adapter = adapters[type];
  if (!adapter) return null;
  return adapter(trace, evaluation);
}
