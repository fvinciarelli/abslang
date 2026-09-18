/**
 * Azure AI Foundry Evaluation adapter — local, npm-native implementation.
 *
 * The Python `azure-ai-evaluation` SDK does not exist for JavaScript, so this
 * adapter reimplements modality A locally: it renders the same MIT-licensed
 * prompt templates (see azure_prompts.ts) and calls your Azure OpenAI
 * deployment's chat completions endpoint. No Foundry project, no Entra ID, no
 * eval runs — just endpoint + api-key + deployment.
 *
 * The adapter never re-runs the agent: it evaluates the ABS trace it receives.
 * Scores are normalized to 0–1 before returning; the runner applies `threshold`.
 *
 * Supported evaluator types:
 *   - `llm_judge`                              → Azure OpenAI judge (Score/Reason)
 *   - `Groundedness`, `Relevance`,
 *     `Coherence`, `Fluency`                   → Azure-compatible rubrics (1–5 → 0–1)
 *   - `custom` id `azure.task_adherence`,
 *     `azure.intent_resolution`,
 *     `azure.tool_call_accuracy`               → agentic rubrics (1–5 → 0–1)
 *
 * Agentic evaluators reuse the official prompt templates with a simplified
 * conversation rendering built from the ABS trace. See docs/adapters/azure.md
 * for the fidelity notes versus the Python SDK.
 */

import { EvalResult, ObservedStep } from "../builtin";
import { extractToolCalls, resolveRef, toText, traceToConversation, traceToText } from "../trace_utils";
import { JUDGE_SYSTEM, parseJudgeResponse } from "../builtin_judge";
import { AZURE_PROMPTS, AzurePrompt } from "./azure_prompts";

const DEFAULT_API_VERSION = "2024-02-15-preview";

// ── Config ──

export interface AzureAdapterConfig {
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
}

let azureConfig: AzureAdapterConfig = {};

/**
 * Prepare the Azure adapter. All values default to environment variables:
 * AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT,
 * AZURE_OPENAI_API_VERSION.
 */
export function configureAzure(config: AzureAdapterConfig = {}): void {
  azureConfig = { ...config };
}

function resolveConfig(): Required<AzureAdapterConfig> | null {
  const endpoint = azureConfig.endpoint || process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = azureConfig.apiKey || process.env.AZURE_OPENAI_KEY;
  const deployment = azureConfig.deployment || process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion =
    azureConfig.apiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
  if (!endpoint || !apiKey || !deployment) return null;
  return { endpoint, apiKey, deployment, apiVersion };
}

function notConfigured(type: string): EvalResult {
  return {
    type,
    passed: false,
    score: 0,
    code: "adapter.not_configured",
    reason:
      "Azure AI Evaluation is not configured. Set it up:\n" +
      "  export AZURE_OPENAI_ENDPOINT=https://<account>.services.ai.azure.com\n" +
      "  export AZURE_OPENAI_KEY=...\n" +
      "  export AZURE_OPENAI_DEPLOYMENT=<judge-model-deployment>\n" +
      `Then: abslang run session.abs.yaml --agent $URL --adapter ${type}=azure`,
  };
}

// ── Chat completions ──

async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: { maxTokens?: number; json?: boolean } = {}
): Promise<string> {
  const cfg = resolveConfig();
  if (!cfg) throw new Error("not configured");

  const base = cfg.endpoint.replace(/\/+$/, "");
  const url =
    `${base}/openai/deployments/${encodeURIComponent(cfg.deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`;

  const body: Record<string, any> = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: options.maxTokens ?? 800,
  };
  if (options.json) body.response_format = { type: "json_object" };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Azure judge returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Prompt rendering and score parsing ──

function renderPrompt(prompt: AzurePrompt, values: Record<string, string>): string {
  return prompt.user.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => values[key] ?? "");
}

interface ParsedJudge {
  score: number | null;
  reason: string;
  status?: string;
  properties?: any;
}

function parseJsonJudge(content: string): ParsedJudge {
  const text = String(content ?? "");
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        /* fall through to the text parser */
      }
    }
  }

  if (data && typeof data === "object") {
    const raw = data.score ?? data.result ?? null;
    const score =
      typeof raw === "number" ? raw : raw !== null && !Number.isNaN(Number(raw)) ? Number(raw) : null;
    return {
      score,
      reason: typeof data.reason === "string" ? data.reason : "",
      status: typeof data.status === "string" ? data.status : undefined,
      properties: data.properties,
    };
  }

  const scoreMatch = text.match(/Score:\s*(\d+(?:\.\d+)?)/i);
  const reasonMatch = text.match(/Reason:\s*(.+?)(?:\n|$)/i);
  return {
    score: scoreMatch ? Number(scoreMatch[1]) : null,
    reason: reasonMatch ? reasonMatch[1].trim() : text.slice(0, 200),
  };
}

/** Azure returns 1–5 Likert scores for rubric evaluators; everything becomes 0–1. */
function normalizeScore(value: number | null): number {
  if (value === null || Number.isNaN(value)) return 0;
  const scaled = value > 1 ? value / 5 : value;
  return Math.max(0, Math.min(1, scaled));
}

function lastAssistantContent(trace: ObservedStep[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const step = trace[i];
    if (step.actor === "assistant" && step.content !== undefined && step.content !== null) {
      return toText(step.content);
    }
  }
  return "";
}

// ── Dimension evaluators (Groundedness, Relevance, Coherence, Fluency) ──

interface DimensionMeta {
  promptKey: string;
  metricKey: string;
  inputs: string[];
}

const DIMENSIONS: Record<string, DimensionMeta> = {
  Groundedness: { promptKey: "GroundednessWithQuery", metricKey: "groundedness", inputs: ["query", "context", "response"] },
  Relevance: { promptKey: "Relevance", metricKey: "relevance", inputs: ["query", "response"] },
  Coherence: { promptKey: "Coherence", metricKey: "coherence", inputs: ["query", "response"] },
  Fluency: { promptKey: "Fluency", metricKey: "fluency", inputs: ["response"] },
};

async function evaluateDimension(
  trace: ObservedStep[],
  evaluation: any,
  evalType: string
): Promise<EvalResult> {
  if (!resolveConfig()) return notConfigured(evalType);

  const meta = DIMENSIONS[evalType];
  const selfContent = lastAssistantContent(trace);
  const values: Record<string, string> = {};
  for (const key of meta.inputs) {
    if (key === "response") {
      values[key] = resolveRef(trace, evaluation.response, selfContent) || selfContent;
    } else {
      values[key] = resolveRef(trace, evaluation[key], selfContent);
    }
  }

  // Groundedness has two templates: with and without an explicit query.
  const promptKey =
    evalType === "Groundedness"
      ? values.query
        ? "GroundednessWithQuery"
        : "GroundednessWithoutQuery"
      : meta.promptKey;

  try {
    const content = await chatCompletion(
      AZURE_PROMPTS[promptKey].system,
      renderPrompt(AZURE_PROMPTS[promptKey], values),
      { json: true }
    );
    const parsed = parseJsonJudge(content);
    const score = normalizeScore(parsed.score);
    const threshold = typeof evaluation.threshold === "number" ? evaluation.threshold : 0.5;
    const reason = parsed.reason || `score ${score.toFixed(2)}`;
    return {
      type: evalType,
      passed: score >= threshold,
      score,
      reason: `[${meta.metricKey}] ${reason}`,
      details: parsed.properties,
    };
  } catch (err: any) {
    return {
      type: evalType,
      passed: false,
      score: 0,
      code: "adapter.error",
      reason: `Azure ${evalType} error: ${err.message}`,
    };
  }
}

// ── llm_judge (Azure OpenAI judge, Score/Reason format) ──

async function evaluateLlmJudge(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  if (!resolveConfig()) return notConfigured("llm_judge");

  const criteria = evaluation.criteria || "Is the response helpful and accurate?";
  const userPrompt = `Given this conversation:\n\n${traceToText(trace)}\n\nEvaluate: ${criteria}`;
  const threshold = typeof evaluation.threshold === "number" ? evaluation.threshold : 0.5;

  try {
    const content = await chatCompletion(JUDGE_SYSTEM, userPrompt, { maxTokens: 512 });
    return parseJudgeResponse(content, "azure", threshold);
  } catch (err: any) {
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      code: "adapter.error",
      reason: `Azure judge error: ${err.message}`,
    };
  }
}

// ── Agentic custom evaluators ──

const CUSTOM_EVALUATORS: Record<string, { promptKey: string; metricKey: string }> = {
  "azure.task_adherence": { promptKey: "TaskAdherence", metricKey: "task_adherence" },
  "azure.intent_resolution": { promptKey: "IntentResolution", metricKey: "intent_resolution" },
  "azure.tool_call_accuracy": { promptKey: "ToolCallAccuracy", metricKey: "tool_call_accuracy" },
};

function prettyMessages(messages: any[]): string {
  return messages
    .map((m) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${text}`;
    })
    .join("\n");
}

/** Observed tool calls paired positionally with their `tool responds` results. */
function toolCallsWithResults(trace: ObservedStep[]): any[] {
  const results: any[] = [];
  const pending: any[] = [];
  for (const step of trace) {
    if (step.actor === "assistant" && step.action === "calls") {
      const entry = { name: step.target ?? "", arguments: step.with ?? {}, result: null as any };
      pending.push(entry);
      results.push(entry);
    } else if (step.actor === "tool" && pending.length > 0) {
      pending.shift()!.result = step.content ?? null;
    }
  }
  return results;
}

/** Derive OpenAI-function tool definitions from observed tool calls. */
function deriveToolDefinitions(trace: ObservedStep[]): any[] {
  const defs = new Map<string, any>();
  for (const call of extractToolCalls(trace)) {
    if (!call.target || defs.has(call.target)) continue;
    const properties: Record<string, any> = {};
    if (call.with && typeof call.with === "object") {
      for (const [key, value] of Object.entries(call.with)) {
        let type = "string";
        if (typeof value === "boolean") type = "boolean";
        else if (Number.isInteger(value)) type = "integer";
        else if (typeof value === "number") type = "number";
        else if (value !== null && typeof value === "object") type = "object";
        properties[key] = { type };
      }
    }
    defs.set(call.target, {
      type: "function",
      function: { name: call.target, description: "", parameters: { type: "object", properties } },
    });
  }
  return [...defs.values()];
}

async function evaluateCustom(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const eid = evaluation.id ?? "custom";
  const meta = CUSTOM_EVALUATORS[eid];
  if (!meta) {
    return {
      type: "custom",
      passed: false,
      score: 0,
      code: "adapter.unknown_evaluator",
      reason: `Unknown Azure custom evaluator: ${eid} (available: ${Object.keys(CUSTOM_EVALUATORS).join(", ")})`,
    };
  }
  if (!resolveConfig()) return notConfigured("custom");

  const conversation = traceToConversation(trace);
  const values: Record<string, string> = {};

  if (eid === "azure.tool_call_accuracy") {
    const toolDefinitions = evaluation.tool_definitions ?? deriveToolDefinitions(trace);
    if (!Array.isArray(toolDefinitions) || toolDefinitions.length === 0) {
      return {
        type: "custom",
        passed: false,
        score: 0,
        code: "evaluator.missing_input",
        reason:
          "azure.tool_call_accuracy requires tool_definitions (declare tool calls in the trace or pass tool_definitions inline)",
      };
    }
    values.query = prettyMessages(conversation.query);
    values.tool_calls = JSON.stringify(toolCallsWithResults(trace));
    values.tool_definitions = JSON.stringify(toolDefinitions);
  } else if (eid === "azure.intent_resolution") {
    values.query = prettyMessages(conversation.query);
    values.response = prettyMessages(conversation.response);
  } else {
    // azure.task_adherence
    const systemMessages = conversation.query
      .filter((m) => m.role === "system")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const userMessages = conversation.query
      .filter((m) => m.role === "user")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const assistantMessages = conversation.response
      .filter((m) => m.role === "assistant")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    values.system_message = systemMessages.join("\n");
    values.query = userMessages.join("\n");
    values.response = assistantMessages.join("\n");
    values.tool_calls = JSON.stringify(toolCallsWithResults(trace));
  }

  const prompt = AZURE_PROMPTS[meta.promptKey];
  try {
    const content = await chatCompletion(prompt.system, renderPrompt(prompt, values), { json: true });
    const parsed = parseJsonJudge(content);
    const score = normalizeScore(parsed.score);
    const threshold = typeof evaluation.threshold === "number" ? evaluation.threshold : 0.5;
    const reason = parsed.reason || `score ${score.toFixed(2)}`;
    const details =
      parsed.properties || parsed.status
        ? { ...(parsed.status ? { status: parsed.status } : {}), ...(parsed.properties ?? {}) }
        : undefined;
    return {
      type: "custom",
      passed: score >= threshold,
      score,
      reason: `[${eid}] ${reason}`,
      details,
    };
  } catch (err: any) {
    return {
      type: "custom",
      passed: false,
      score: 0,
      code: "adapter.error",
      reason: `Azure ${eid} error: ${err.message}`,
    };
  }
}

// ── Main adapter ──

async function routeAzure(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const evalType = evaluation.type;

  if (evalType === "llm_judge") return evaluateLlmJudge(trace, evaluation);
  if (evalType === "custom") return evaluateCustom(trace, evaluation);
  if (DIMENSIONS[evalType]) return evaluateDimension(trace, evaluation, evalType);

  return {
    type: evalType,
    passed: false,
    score: 0,
    code: "adapter.unsupported_type",
    reason: `Azure adapter does not support evaluator type: ${evalType}`,
  };
}

export async function azureAdapter(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const result = await routeAzure(trace, evaluation);
  return { ...result, adapter: result.adapter ?? "azure" };
}
