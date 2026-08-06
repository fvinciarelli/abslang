/**
 * AI Evaluator adapter — reference implementation.
 *
 * Registers a single adapter that handles ALL LLM-based evaluator types
 * (llm_judge, Groundedness, Relevance, Coherence, Fluency).
 *
 * The adapter receives (trace, evaluationRule) and returns EvalResult.
 * It resolves id-based references (query: user_asks.says) from the trace,
 * maps ABS evaluator types to AI Evaluator metrics, and returns the result.
 *
 * Other providers (Azure, LangSmith, Galileo, local Ollama) should follow
 * this same pattern: register one adapter for all types you support,
 * resolve references from the trace, dispatch by type internally.
 */

import { ObservedStep, EvalResult, registerAdapter } from "../builtin";

// ── Reference resolution ──

/**
 * Resolve a reference like "user_asks.says" or "kb_result.responds"
 * from the trace. "self" means the current behavior.
 *
 * Format: <behavior_id>.<action>  or  <behavior_id>
 * If action is omitted, defaults to:
 *   user      → says
 *   assistant → informs
 *   tool      → responds
 */
function resolveRef(
  ref: string,
  trace: ObservedStep[],
  behaviors: { id?: string; actor: string; action: string; content?: any }[]
): string {
  if (ref === "self") {
    // "self" is resolved by the caller using the current behavior
    return "";
  }

  const [id, action] = ref.includes(".") ? ref.split(".") : [ref, undefined];

  // Find the behavior by id
  const behavior = behaviors.find((b) => b.id === id);
  if (!behavior) {
    // Not an id reference — try finding in trace by actor/action
    for (const step of trace) {
      if (step.actor === id || step.action === id) {
        return typeof step.content === "string" ? step.content : JSON.stringify(step.content ?? "");
      }
    }
    return ref; // return as-is if we can't resolve
  }

  // Resolve the action — if unspecified, use the actor default
  const resolvedAction = action ?? defaultAction(behavior.actor);

  // Find the step in the trace matching this behavior's id
  // The trace preserves the order of behaviors, so we look for actor + action + matching content
  for (const step of trace) {
    if (
      step.actor === behavior.actor &&
      (step.action === resolvedAction ||
        // Communication actions are equivalent
        (["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"].includes(step.action) &&
         ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"].includes(resolvedAction)))
    ) {
      return typeof step.content === "string" ? step.content : JSON.stringify(step.content ?? "");
    }
  }

  return "";
}

function defaultAction(actor: string): string {
  switch (actor) {
    case "user": return "says";
    case "assistant": return "informs";
    case "tool": return "responds";
    default: return "says";
  }
}

// ── AI Evaluator client ──

let _client: any = null;

function getClient(): any {
  if (_client) return _client;
  try {
    const aievaluator = require("aievaluator");
    const APIClient = aievaluator.api?.APIClient || aievaluator.APIClient;
    if (!APIClient) return null;

    let apiKey: string | undefined = process.env.AIEVALUATOR_API_KEY;
    let engineUrl = process.env.AIEVALUATOR_ENGINE_URL || "https://api.aievaluator.dev";

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

// ── Metric mapping ──

const METRIC_MAP: Record<string, string> = {
  llm_judge: "g_eval",
  Groundedness: "groundedness",
  Relevance: "relevance",
  Coherence: "coherence",
  Fluency: "fluency",
};

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
      reason: "AI Evaluator not installed. Run: npm install -g aievaluator",
    };
  }

  const evalType = evaluation.type;
  const metric = METRIC_MAP[evalType] || "g_eval";

  // ── Build the evaluation payload based on type ──

  let query = "";
  let context = "";
  let response = "";

  // For llm_judge: the "query" is the trace + criteria as a prompt
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
    query = `Given this conversation:\n\n${traceText}\n\nEvaluate: ${criteria}`;
  }

  // For dimension types: resolve id-based references
  if (["Groundedness", "Relevance", "Coherence", "Fluency"].includes(evalType)) {
    // Resolve "self" to the current behavior's content (last assistant message in trace)
    const lastAssistant = [...trace].reverse().find((s) => s.actor === "assistant");
    const selfContent = lastAssistant?.content
      ? typeof lastAssistant.content === "string"
        ? lastAssistant.content
        : JSON.stringify(lastAssistant.content)
      : "";

    // Resolve references using the trace itself as the behavior list
    const resolveContent = (ref: string | undefined): string => {
      if (!ref) return "";
      if (ref === "self") return selfContent;
      // Parse id.action from ref
      const [id, action] = ref.includes(".") ? ref.split(".") : [ref, undefined];
      const resolvedAction = action ?? (id === "user" ? "says" : id === "assistant" ? "informs" : id === "tool" ? "responds" : "says");

      // Find in trace: match by actor having that id-like name, or by actor/action
      for (const step of trace) {
        // Try matching by actor matching the id (e.g., "user_asks" → actor "user")
        const stepMatchesId =
          step.actor === id ||
          (id.includes("_") && step.actor === id.split("_")[0]);

        const actionMatches =
          step.action === resolvedAction ||
          (["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"].includes(step.action) &&
           ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows"].includes(resolvedAction));

        if (stepMatchesId && actionMatches) {
          return typeof step.content === "string" ? step.content : JSON.stringify(step.content ?? "");
        }
      }
      return ref;
    };

    query = resolveContent(evaluation.query);
    context = resolveContent(evaluation.context);
    response = resolveContent(evaluation.response);
  }

  try {
    let result: any;

    if (client.apiKey) {
      // Authenticated: use evaluateSync with structured data
      const input: any = { query };
      if (context) input.context = context;
      if (response) input.response = response;

      result = await client.evaluateSync(
        [input],
        "http://localhost/chat",
        "openai",
        [metric]
      );
    } else {
      // Playground: 5 free evals/day
      const playgroundInput: any = { query };
      if (context) playgroundInput.context = context;
      if (response) playgroundInput.response = response;

      result = await client.playgroundEvaluate({
        queries: [query],
        contexts: context ? [context] : undefined,
        responses: response ? [response] : undefined,
        metrics: [metric],
      });
    }

    const results = result.results ?? [];
    if (results.length > 0) {
      const r = results[0];
      const score = r.scores?.[metric] ?? r.scores?.g_eval ?? 0.5;
      const threshold = evaluation.threshold ?? 0.7;
      return {
        type: evalType,
        passed: score >= threshold,
        score,
        reason: r.agent_response ?? `[${metric}] ${JSON.stringify(r.scores ?? {})}`,
      };
    }

    return {
      type: evalType,
      passed: false,
      score: 0,
      reason: `No result from AI Evaluator for metric: ${metric}`,
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

// Called via --adapter llm_judge=aievaluator
export function configureAIEvaluator(cfg: {
  apiKey?: string;
  engineUrl?: string;
  judgeModel?: string;
}): void {
  if (cfg.apiKey) process.env.AIEVALUATOR_API_KEY = cfg.apiKey;
  if (cfg.engineUrl) process.env.AIEVALUATOR_ENGINE_URL = cfg.engineUrl;
  _client = null;

  // Register the same adapter for all LLM-based evaluator types.
  // The adapter dispatches internally based on evaluation.type.
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
