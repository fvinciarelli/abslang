import { ObservedStep, EvalResult, registerAdapter } from "../builtin";

// ── AI Evaluator adapter ──
//
// Uses the official aievaluator npm package when available.
// Falls back gracefully if not installed.
// Install: npm install -g aievaluator

let _client: any = null;

function getClient(): any {
  if (_client) return _client;
  try {
    // Dynamic require — works at runtime even if not installed at build time
    const aievaluator = require("aievaluator");
    const APIClient = aievaluator.api?.APIClient || aievaluator.APIClient;

    if (!APIClient) {
      return null;
    }

    let apiKey: string | undefined = process.env.AIEVALUATOR_API_KEY;
    let engineUrl = process.env.AIEVALUATOR_ENGINE_URL || "https://api.aievaluator.dev";

    // Try to use aievaluator's config resolver
    try {
      const config = require("aievaluator/config");
      if (config.resolveApiKey) apiKey = config.resolveApiKey(undefined) || apiKey;
      if (config.resolveEngineUrl) engineUrl = config.resolveEngineUrl(undefined) || engineUrl;
    } catch {}

    _client = new APIClient(engineUrl, apiKey, 60);
    return _client;
  } catch {
    return null;
  }
}

async function callAIEvaluator(
  trace: ObservedStep[],
  criteria: string
): Promise<EvalResult> {
  const client = getClient();
  if (!client) {
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      reason: "AI Evaluator not installed. Run: npm install -g aievaluator",
    };
  }

  const traceText = trace
    .map(
      (s) =>
        `[${s.actor}] ${s.action}${s.target ? " → " + s.target : ""}: ${
          typeof s.content === "string" ? s.content : JSON.stringify(s.content)
        }`
    )
    .join("\n");

  const query = `Given this conversation:\n\n${traceText}\n\nEvaluate: ${criteria}`;

  try {
    let result: any;
    if (client.apiKey) {
      result = await client.evaluateSync(
        [{ input: query }],
        "http://localhost/chat",
        "openai",
        ["g_eval"]
      );
    } else {
      result = await client.playgroundEvaluate({
        queries: [query],
        metrics: ["g_eval"],
      });
    }

    const results = result.results ?? [];
    if (results.length > 0) {
      const r = results[0];
      const score = r.scores?.g_eval ?? 0.5;
      return {
        type: "llm_judge",
        passed: score >= 0.7,
        score,
        reason: r.agent_response ?? JSON.stringify(r.scores ?? {}),
      };
    }

    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      reason: "No result from AI Evaluator",
    };
  } catch (err: any) {
    return {
      type: "llm_judge",
      passed: false,
      score: 0,
      reason: `AI Evaluator error: ${err.message}`,
    };
  }
}

// LLM Judge adapter
export async function llmJudgeAdapter(
  trace: ObservedStep[],
  evaluation: any
): Promise<EvalResult> {
  return callAIEvaluator(trace, evaluation.criteria);
}

// Only register when user opts in via configureAIEvaluator()
// (called by abs login or --adapter llm_judge=aievaluator)
export function configureAIEvaluator(cfg: {
  apiKey?: string;
  engineUrl?: string;
  judgeModel?: string;
}): void {
  if (cfg.apiKey) process.env.AIEVALUATOR_API_KEY = cfg.apiKey;
  if (cfg.engineUrl) process.env.AIEVALUATOR_ENGINE_URL = cfg.engineUrl;
  _client = null;
  // Register adapter now that user opted in
  registerAdapter("llm_judge", llmJudgeAdapter);
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
