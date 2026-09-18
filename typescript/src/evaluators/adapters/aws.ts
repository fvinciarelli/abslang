/**
 * AWS Bedrock adapter (LLM-as-judge) — local, npm-native.
 *
 * Routes `llm_judge` and `custom` evaluations through an Amazon Bedrock model
 * using the Converse API. No spans, no AgentCore, no agent instrumentation: the
 * adapter builds a judge prompt from the ABS trace and calls Bedrock directly.
 *
 * Requires the optional `@aws-sdk/client-bedrock-runtime` package:
 *
 *   npm install @aws-sdk/client-bedrock-runtime
 *
 * Credentials use the standard AWS chain (env vars, ~/.aws/credentials, IAM
 * role). Environment:
 *   AWS_REGION / AWS_DEFAULT_REGION   region
 *   AWS_PROFILE                       optional named profile
 *   BEDROCK_EVALUATOR_MODEL_ID        optional judge model id
 *
 * Scores are normalized to 0–1 before returning; the runner applies `threshold`.
 * Mirrors python/src/abslang/evaluators/adapters/aws.py.
 */

import { EvalResult, ObservedStep } from "../builtin";
import { JUDGE_SYSTEM } from "../builtin_judge";
import { resolveRef, toText, traceToText } from "../trace_utils";

export const DEFAULT_MODEL_ID = "anthropic.claude-3-5-haiku-20241022-v1:0";

// ── Config ──

export interface AwsAdapterConfig {
  region?: string;
  profile?: string;
  evaluatorModel?: string;
}

let bedrockClient: any = null;

/** Prepare the AWS adapter. All values default to environment variables. */
export function configureAws(config: AwsAdapterConfig = {}): void {
  if (config.region) process.env.AWS_REGION = config.region;
  if (config.profile) process.env.AWS_PROFILE = config.profile;
  if (config.evaluatorModel) process.env.BEDROCK_EVALUATOR_MODEL_ID = config.evaluatorModel;
  bedrockClient = null;
}

function loadSdk(): any | null {
  try {
    return require("@aws-sdk/client-bedrock-runtime");
  } catch {
    return null;
  }
}

function getClient(): any | null {
  if (bedrockClient) return bedrockClient;
  const sdk = loadSdk();
  if (!sdk?.BedrockRuntimeClient) return null;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  // The default credential provider chain honors AWS_PROFILE for the profile.
  bedrockClient = new sdk.BedrockRuntimeClient(region ? { region } : {});
  return bedrockClient;
}

function modelId(): string {
  return process.env.BEDROCK_EVALUATOR_MODEL_ID || DEFAULT_MODEL_ID;
}

// ── Converse call ──

/** Call a Bedrock model via the Converse API and return the text reply. */
async function converse(system: string, prompt: string): Promise<string> {
  const client = getClient();
  if (!client) {
    throw new Error("AWS SDK is not installed or AWS credentials are not configured");
  }
  const { ConverseCommand } = loadSdk();
  const response = await client.send(
    new ConverseCommand({
      modelId: modelId(),
      system: [{ text: system }],
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: 0, maxTokens: 512 },
    })
  );
  const content = response?.output?.message?.content ?? [];
  return content
    .map((block: any) => (block && typeof block.text === "string" ? block.text : ""))
    .join("");
}

// ── Response parsing ──

export function parseAwsJudgeResponse(content: string): { score: number | null; reason: string } {
  let score: number | null = null;
  let reason = String(content ?? "").slice(0, 200);
  const scoreMatch = String(content ?? "").match(/Score:\s*(\d+(?:\.\d+)?)/);
  if (scoreMatch) {
    const value = Number(scoreMatch[1]);
    score = Number.isNaN(value) ? null : value;
  }
  const reasonMatch = String(content ?? "").match(/Reason:\s*(.+?)(?:\n|$)/i);
  if (reasonMatch) reason = reasonMatch[1].trim().slice(0, 200);
  return { score, reason };
}

/** Return the max of a rating scale like '1-5', '0-1', or a bare number. */
export function awsScaleMax(ratingScale: any): number {
  const match = String(ratingScale).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 5;
}

export function awsNormalize(value: number, scaleMax: number): number {
  const scaled = scaleMax > 1 ? value / scaleMax : value;
  return Math.max(0, Math.min(1, scaled));
}

// ── Prompt interpolation ──

export function interpolateAwsPrompt(
  template: string,
  evaluation: any,
  trace: ObservedStep[],
  selfContent: string
): string {
  const values: Record<string, string> = {
    criteria: evaluation.criteria ?? "",
    response: resolveRef(trace, evaluation.response, selfContent) || selfContent,
    context: resolveRef(trace, evaluation.context, selfContent),
    query: resolveRef(trace, evaluation.query, selfContent),
    trace: traceToText(trace),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => values[key] ?? "");
}

// ── Helpers ──

function lastAssistantContent(trace: ObservedStep[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const step = trace[i];
    if (step.actor === "assistant" && step.content !== undefined && step.content !== null) {
      return toText(step.content);
    }
  }
  return "";
}

function notConfigured(type: string): EvalResult {
  return {
    type,
    passed: false,
    score: 0,
    code: "adapter.not_configured",
    reason:
      "AWS Bedrock is not configured. Set it up:\n" +
      "  npm install @aws-sdk/client-bedrock-runtime\n" +
      "  export AWS_REGION=us-east-1\n" +
      "  export BEDROCK_EVALUATOR_MODEL_ID=anthropic.claude-3-5-haiku-20241022-v1:0\n" +
      "Ensure the AWS credentials (env vars, ~/.aws/credentials, or IAM role) " +
      "have bedrock:InvokeModel permission.\n" +
      `Then: abslang run session.abs.yaml --agent $URL --adapter ${type}=aws`,
  };
}

function isNotConfiguredError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error).toLowerCase();
  return message.includes("not installed") || message.includes("not configured");
}

// ── Evaluators ──

async function evaluateLlmJudge(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const criteria = evaluation.criteria || "Is the response helpful and accurate?";
  const prompt = `Given this conversation:\n\n${traceToText(trace)}\n\nEvaluate: ${criteria}`;
  const threshold = typeof evaluation.threshold === "number" ? evaluation.threshold : 0.5;

  try {
    const content = await converse(JUDGE_SYSTEM, prompt);
    const { score, reason } = parseAwsJudgeResponse(content);
    if (score === null) {
      return {
        type: "llm_judge",
        passed: false,
        score: 0,
        code: "adapter.error",
        reason: `[aws] Could not parse score from: ${content.slice(0, 200)}`,
      };
    }
    const normalized = Math.max(0, Math.min(1, score)); // JUDGE_SYSTEM is 0-1
    return {
      type: "llm_judge",
      passed: normalized >= threshold,
      score: normalized,
      reason: `[aws] ${reason}`,
    };
  } catch (error: any) {
    if (isNotConfiguredError(error)) return notConfigured("llm_judge");
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      code: "adapter.error",
      reason: `AWS Bedrock error: ${error.message}`,
    };
  }
}

async function evaluateCustom(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const eid = evaluation.id ?? "custom";
  const template = evaluation.prompt || evaluation.criteria;
  if (!template) {
    return {
      type: "custom",
      passed: false,
      score: 0,
      code: "evaluator.missing_input",
      reason: `AWS custom evaluator '${eid}' requires a 'prompt' (or 'criteria') field.`,
    };
  }

  const selfContent = lastAssistantContent(trace);
  const prompt = interpolateAwsPrompt(template, evaluation, trace, selfContent);
  const scaleMaxValue = awsScaleMax(evaluation.rating_scale ?? "1-5");
  const system =
    `You are an expert evaluator. Score the response on a scale of 1 to ${scaleMaxValue} ` +
    `based on the given criteria. Be strict but fair. Respond in this format:\n\n` +
    `Score: <number between 1 and ${scaleMaxValue}>\nReason: <one sentence explaining the score>`;
  const threshold = typeof evaluation.threshold === "number" ? evaluation.threshold : 0.5;

  try {
    const content = await converse(system, prompt);
    const { score: rawScore, reason } = parseAwsJudgeResponse(content);
    if (rawScore === null) {
      return {
        type: "custom",
        passed: false,
        score: 0,
        code: "adapter.error",
        reason: `[aws:${eid}] Could not parse score from: ${content.slice(0, 200)}`,
      };
    }
    const score = awsNormalize(rawScore, scaleMaxValue);
    return {
      type: "custom",
      passed: score >= threshold,
      score,
      reason: `[aws:${eid}] ${reason}`,
    };
  } catch (error: any) {
    if (isNotConfiguredError(error)) return notConfigured("custom");
    return {
      type: "custom",
      passed: false,
      score: 0,
      code: "adapter.error",
      reason: `AWS Bedrock error: ${error.message}`,
    };
  }
}

// ── Main adapter ──

async function routeAws(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const evalType = evaluation.type;
  if (evalType === "llm_judge") return evaluateLlmJudge(trace, evaluation);
  if (evalType === "custom") return evaluateCustom(trace, evaluation);
  return {
    type: evalType,
    passed: false,
    score: 0,
    code: "adapter.unsupported_type",
    reason:
      `AWS adapter does not support '${evalType}' yet. The Bedrock backend handles ` +
      "llm_judge and custom; sequence/tool_call evaluation via AgentCore is a later phase.",
  };
}

export async function awsAdapter(trace: ObservedStep[], evaluation: any): Promise<EvalResult> {
  const result = await routeAws(trace, evaluation);
  return { ...result, adapter: result.adapter ?? "aws" };
}
