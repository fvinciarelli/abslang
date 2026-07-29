import { ObservedStep, EvalResult, registerAdapter } from "../builtin";

// ── AI Evaluator adapter ──
//
// Calls the AI Evaluator API for llm_judge and other LLM-based evaluations.
// Uses the playground endpoint (no API key) by default, or the sync endpoint
// when an API key is configured.

export interface AIEvaluatorConfig {
  apiKey?: string;
  engineUrl?: string;
  judgeModel?: string;
}

let config: AIEvaluatorConfig = {
  engineUrl: "https://api.aievaluator.dev",
};

export function configureAIEvaluator(cfg: AIEvaluatorConfig): void {
  config = { ...config, ...cfg };
}

export function getAIEvaluatorConfig(): AIEvaluatorConfig {
  return { ...config };
}

async function callAIEvaluator(
  trace: ObservedStep[],
  criteria: string
): Promise<EvalResult> {
  const engineUrl = config.engineUrl ?? "https://api.aievaluator.dev";

  // Build a natural-language prompt from the trace + criteria
  const traceText = trace
    .map(
      (s) =>
        `[${s.actor}] ${s.action}${s.target ? " → " + s.target : ""}: ${typeof s.content === "string" ? s.content : JSON.stringify(s.content)}`
    )
    .join("\n");

  const body: any = {
    queries: [
      `Given this conversation:\n\n${traceText}\n\nEvaluate: ${criteria}`,
    ],
    metrics: ["g_eval"],
    judge: config.judgeModel ?? "deepseek",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["X-API-Key"] = config.apiKey;
  }

  const endpoint = config.apiKey
    ? `${engineUrl}/api/v1/evaluations/sync`
    : `${engineUrl}/api/v1/playground/evaluate`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await resp.json() as any;

    const results = data.results ?? [];
    if (results.length > 0) {
      const r = results[0];
      const score = r.scores?.g_eval ?? 0.5;
      return {
        type: "llm_judge",
        passed: score >= 0.7,
        score,
        reason: r.agent_response ?? "No reason provided by judge",
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
      reason: `AI Evaluator request failed: ${err.message}`,
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

// Register adapters on import
registerAdapter("llm_judge", llmJudgeAdapter);

// Also register as adapter for common metric names
registerAdapter("g_eval", llmJudgeAdapter);
registerAdapter("faithfulness", llmJudgeAdapter);
