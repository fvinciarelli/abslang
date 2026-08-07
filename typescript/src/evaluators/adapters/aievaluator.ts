/**
 * AI Evaluator adapter — reference implementation.
 *
 * Registers a single adapter that handles ALL LLM-based evaluator types
 * (llm_judge, Groundedness, Relevance, Coherence, Fluency).
 *
 * Calls POST /api/v1/evaluations/direct via the aievaluator npm package.
 * No agent call, no double execution. The adapter receives (trace, evaluationRule),
 * resolves id-based references from the trace, and returns EvalResult.
 *
 * Other providers (Azure, LangSmith, Galileo, local Ollama) should follow
 * this same pattern.
 */

import { ObservedStep, EvalResult, registerAdapter } from "../builtin";

// ── Metric mapping ──

const METRIC_MAP: Record<string, string> = {
  llm_judge: "g_eval",
  Groundedness: "hallucination",
  Relevance: "answer_relevancy",
  Coherence: "g_eval",
  Fluency: "g_eval",
  faithfulness: "faithfulness",
};

// ── Client ──

let _client: any = null;

function getClient(): any {
  if (_client) return _client;
  try {
    let APIClient: any = null;
    try {
      const api = require("aievaluator/dist/api/client");
      APIClient = api.APIClient;
    } catch {
      try {
        const mod = require("aievaluator");
        APIClient = mod.api?.APIClient || mod.APIClient;
      } catch {
        return null;
      }
    }
    if (!APIClient) return null;

    let apiKey: string | undefined = process.env.AIEVALUATOR_API_KEY;
    let engineUrl = process.env.AIEVALUATOR_ENGINE_URL || "https://api.aievaluator.dev";

    try {
      const config = require("aievaluator/dist/config");
      if (config.resolveApiKey) apiKey = config.resolveApiKey(undefined) || apiKey;
      if (config.resolveEngineUrl) engineUrl = config.resolveEngineUrl(undefined) || engineUrl;
    } catch {}

    _client = new APIClient(engineUrl, apiKey, 60);
    return _client;
  } catch {
    return null;
  }
}

// ── Main adapter ──

async function aievaluatorAdapter(
  trace: ObservedStep[],
  evaluation: any
): Promise<EvalResult> {
  const client = getClient();
  if (!client) {
    return {
      type: evaluation.type,
      passed: false,
      score: 0,
      reason:
        "AI Evaluator is not installed. Install it and try again:\n" +
        "  npm install -g aievaluator\n" +
        "Or if you use Python:\n" +
        "  pip install aievaluator\n" +
        "Then: abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator\n" +
        "Free tier: 5 evals/day without API key, 100/month with API key.\n" +
        "Get a key at: https://aievaluator.dev",
    };
  }

  const evalType = evaluation.type;
  const metric = METRIC_MAP[evalType] || "g_eval";

  // ── Build payload ──

  let input = "";
  let context = "";
  let response = "";

  if (evalType === "llm_judge") {
    const criteria = evaluation.criteria || "Is the response helpful and accurate?";
    const traceText = trace
      .map(
        (s) =>
          `[${s.actor}] ${s.action}${s.target ? " → " + s.target : ""}: ${
            typeof s.content === "string" ? s.content : JSON.stringify(s.content)
          }`
      )
      .join("\n");
    input = `Given this conversation:\n\n${traceText}\n\nEvaluate: ${criteria}`;

    const lastAssistant = [...trace].reverse().find((s) => s.actor === "assistant");
    response = lastAssistant?.content
      ? typeof lastAssistant.content === "string" ? lastAssistant.content : JSON.stringify(lastAssistant.content)
      : "";
  }

  if (["Groundedness", "Relevance", "Coherence", "Fluency"].includes(evalType)) {
    const lastAssistant = [...trace].reverse().find((s) => s.actor === "assistant");
    const selfContent = lastAssistant?.content
      ? typeof lastAssistant.content === "string" ? lastAssistant.content : JSON.stringify(lastAssistant.content)
      : "";

    const resolveContent = (ref: string | undefined): string => {
      if (!ref) return "";
      if (ref === "self") return selfContent;
      const [id, action] = ref.includes(".") ? ref.split(".") : [ref, undefined];
      const resolvedAction = action ?? (id === "user" ? "says" : id === "assistant" ? "informs" : id === "tool" ? "responds" : "says");
      for (const step of trace) {
        const stepMatchesId = step.actor === id || (id.includes("_") && step.actor === id.split("_")[0]);
        const commActions = ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"];
        const actionMatches = step.action === resolvedAction ||
          (commActions.includes(step.action) && commActions.includes(resolvedAction));
        if (stepMatchesId && actionMatches) {
          return typeof step.content === "string" ? step.content : JSON.stringify(step.content ?? "");
        }
      }
      return ref;
    };

    input = resolveContent(evaluation.query);
    context = resolveContent(evaluation.context);
    response = resolveContent(evaluation.response);
  }

  // ── Call aievaluator.evaluateDirect (package-native) ──

  try {
    const threshold = evaluation.threshold;
    const thresholds = threshold !== undefined ? { [metric]: threshold } : undefined;

    const rowPayload: any = { input, response };
    if (context) rowPayload.context = context;

    const result = await client.evaluateDirect([rowPayload], [metric], undefined, thresholds);
    const row = result.results?.[0];
    if (!row) {
      return { type: evalType, passed: false, score: 0, reason: "No result from AI Evaluator" };
    }

    const score = row.scores?.[metric] ?? row.scores?.[Object.keys(row.scores)[0]] ?? 0.5;
    const detail = row.details?.[metric] || row.details?.[Object.keys(row.details)[0]] || {};
    const reason = detail.reason || JSON.stringify(row.scores || {});
    const thresholdValue = evaluation.threshold ?? 0.7;

    return {
      type: evalType,
      passed: score >= thresholdValue,
      score,
      reason: `[${metric}] ${reason}`,
    };
  } catch (err: any) {
    return {
      type: evalType,
      passed: false,
      score: 0,
      reason: `AI Evaluator error: ${err.message}`,
    };
  }
}

// ── Registration ──

export function configureAIEvaluator(cfg: {
  apiKey?: string;
  engineUrl?: string;
  judgeModel?: string;
}): void {
  if (cfg.apiKey) process.env.AIEVALUATOR_API_KEY = cfg.apiKey;
  if (cfg.engineUrl) process.env.AIEVALUATOR_ENGINE_URL = cfg.engineUrl;

  const types = ["llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency"];
  for (const t of types) {
    registerAdapter(t, aievaluatorAdapter);
  }
}

export function getAIEvaluatorConfig(): {
  apiKey?: string;
  engineUrl?: string;
  judgeModel?: string;
} {
  return {
    apiKey: process.env.AIEVALUATOR_API_KEY,
    engineUrl: process.env.AIEVALUATOR_ENGINE_URL ?? "https://api.aievaluator.dev",
    judgeModel: "deepseek",
  };
}
