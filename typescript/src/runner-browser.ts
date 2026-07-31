/**
 * Browser-compatible ABS runner — for use in the web designer.
 * No Node.js dependencies. Uses fetch() for agent communication.
 */

import { parseYaml, expandFragments, resolveVariables, Behavior, NormalizedSession, ABSDocument } from "./parser";
import { ObservedStep, EvalResult, evaluateStep, evaluateWithAdapter, registerAdapter } from "./evaluators";

// ── Agent adapter (browser-compatible — uses fetch) ──

export interface AgentConfig {
  url: string;
  format?: "openai" | "claude" | "custom";
  auth?: "none" | "api_key" | "bearer";
  token?: string;
}

interface AgentMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StepResult {
  step: number;
  behavior: Behavior;
  observed: ObservedStep | null;
  matched: boolean;
  evaluations: EvalResult[];
  sent?: boolean;
}

export interface RunResult {
  session: string;
  agent: string;
  passed: boolean;
  steps: StepResult[];
  chainEvaluations: EvalResult[];
  stepsTotal: number;
  stepsMatched: number;
  evaluationsTotal: number;
  evaluationsPassed: number;
}

async function openaiAdapter(
  messages: AgentMessage[],
  config: AgentConfig
): Promise<{ messages: AgentMessage[]; raw?: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (config.auth === "api_key" && config.token) {
    headers["X-API-Key"] = config.token;
  } else if (config.auth === "bearer" && config.token) {
    headers["Authorization"] = `Bearer ${config.token}`;
  }

  const body: any = {
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      ...(m.name ? { name: m.name } : {}),
    })),
    tools: [{ type: "function", function: { name: "any", description: "Tool", parameters: {} } }],
    tool_choice: "auto",
  };

  const resp = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0]?.message;

  if (!choice) {
    return { messages: [] };
  }

  const result: AgentMessage = {
    role: choice.role ?? "assistant",
    content: choice.content ?? null,
  };

  if (choice.tool_calls) {
    result.tool_calls = choice.tool_calls;
  }

  return { messages: [result], raw: data };
}

// ── Browser runner ──

export async function runBrowser(
  yamlText: string,
  agentConfig: AgentConfig
): Promise<RunResult> {
  // Parse
  const docs = parseYaml(yamlText);
  if (docs.length === 0) throw new Error("No ABS document found");
  const doc = docs[0];

  const session = expandFragments(doc);
  session.behaviors = resolveVariables(session.behaviors);

  // Run
  const trace: ObservedStep[] = [];
  const stepResults: StepResult[] = [];
  const messages: AgentMessage[] = [];
  let stepNum = 0;

  for (const behavior of session.behaviors) {
    stepNum++;

    if (behavior.actor === "user") {
      messages.push({
        role: "user",
        content: typeof behavior.content === "string" ? behavior.content : JSON.stringify(behavior.content),
      });

      let response;
      try {
        response = await openaiAdapter([...messages], agentConfig);
      } catch (err: any) {
        stepResults.push({ step: stepNum, behavior, observed: null, matched: false, evaluations: [], sent: true });
        trace.push({ actor: "error", action: "responds", content: `Agent error: ${err.message}` });
        continue;
      }

      for (const msg of response.messages) {
        messages.push(msg);

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            trace.push({
              actor: "assistant",
              action: "calls",
              target: tc.function.name,
              with: tryParseJson(tc.function.arguments),
            });
          }
          continue;
        }

        if (msg.role === "tool") {
          trace.push({
            actor: "tool",
            action: "responds",
            target: msg.name,
            content: tryParseJson(msg.content ?? ""),
          });
        } else if (msg.role === "assistant") {
          trace.push({ actor: "assistant", action: "responds", content: msg.content });
        }
      }

      stepResults.push({ step: stepNum, behavior, observed: null, matched: false, evaluations: [], sent: true });
    } else if (behavior.actor === "tool" && behavior.action === "responds") {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.tool_calls);
      if (lastAssistant?.tool_calls) {
        for (const tc of lastAssistant.tool_calls) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: tc.function.name,
            content: typeof behavior.content === "string" ? behavior.content : JSON.stringify(behavior.content),
          });
        }
      }

      let response;
      try {
        response = await openaiAdapter([...messages], agentConfig);
      } catch (err: any) {
        stepResults.push({ step: stepNum, behavior, observed: null, matched: false, evaluations: [] });
        continue;
      }

      for (const msg of response.messages) {
        messages.push(msg);
        if (msg.role === "assistant" && msg.content) {
          trace.push({ actor: "assistant", action: "responds", content: msg.content });
        }
      }

      stepResults.push({
        step: stepNum,
        behavior,
        observed: { actor: "tool", action: "responds", target: behavior.target, content: behavior.content },
        matched: true,
        evaluations: [],
      });
    } else {
      const matchedIdx = stepResults.filter(
        (s) => !s.sent && !(s.behavior.actor === "tool" && s.behavior.action === "responds")
      ).length;
      const observed = trace[matchedIdx] ?? null;

      const commActions = ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows", "hands_off"];
      const execActions = ["calls", "submits", "retrieves", "stores", "updates"];
      const matched = observed
        ? observed.actor === behavior.actor &&
          (observed.action === behavior.action ||
            (commActions.includes(observed.action) && commActions.includes(behavior.action)) ||
            (execActions.includes(observed.action) && execActions.includes(behavior.action))) &&
          (commActions.includes(behavior.action) || !behavior.target || observed.target === behavior.target)
        : false;

      const matchObserved: ObservedStep | null = matched ? observed : null;

      const evalResults: EvalResult[] = [];
      if (behavior.evaluations) {
        for (const evalRule of behavior.evaluations) {
          const adapterResult = await evaluateWithAdapter(evalRule.type, trace, evalRule);
          if (adapterResult) {
            evalResults.push(adapterResult);
          } else {
            evalResults.push(evaluateStep(matchObserved, evalRule, session.behaviors, trace));
          }
        }
      }

      stepResults.push({ step: stepNum, behavior, observed: matchObserved, matched, evaluations: evalResults });
    }
  }

  // Chain evaluations
  const chainEvaluations: EvalResult[] = [];
  if (session.evaluations) {
    for (const evalRule of session.evaluations) {
      const adapterResult = await evaluateWithAdapter(evalRule.type, trace, evalRule);
      if (adapterResult) {
        chainEvaluations.push(adapterResult);
      } else {
        chainEvaluations.push(evaluateStep(null, evalRule, session.behaviors, trace));
      }
    }
  }

  const allEvals = [...stepResults.flatMap((s) => s.evaluations), ...chainEvaluations];

  return {
    session: session.session,
    agent: agentConfig.url,
    passed: allEvals.every((e) => e.passed),
    steps: stepResults,
    chainEvaluations,
    stepsTotal: stepResults.length,
    stepsMatched: stepResults.filter((s) => s.matched || s.sent).length,
    evaluationsTotal: allEvals.length,
    evaluationsPassed: allEvals.filter((e) => e.passed).length,
  };
}

function tryParseJson(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
