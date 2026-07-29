import { Behavior, NormalizedSession } from "./parser";
import {
  ObservedStep,
  EvalResult,
  evaluateStep,
  evaluateWithAdapter,
} from "./evaluators";

// ── Agent adapter interface ──

export interface AgentMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentResponse {
  messages: AgentMessage[];
  raw?: any;
}

export type AgentAdapterFn = (
  messages: AgentMessage[],
  config: AgentConfig
) => Promise<AgentResponse>;

export interface AgentConfig {
  url: string;
  format?: "openai" | "claude" | "gemini" | "custom";
  auth?: "none" | "api_key" | "bearer" | "oauth2";
  token?: string;
  refreshUrl?: string;
  refreshToken?: string;
  clientId?: string;
  stream?: boolean;
}

// ── Run result ──

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

// ── Default agent adapter (OpenAI-compatible) ──

export async function openaiAdapter(
  messages: AgentMessage[],
  config: AgentConfig
): Promise<AgentResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.auth === "api_key" && config.token) {
    headers["X-API-Key"] = config.token;
  } else if ((config.auth === "bearer" || config.auth === "oauth2") && config.token) {
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
  };

  // Add tool support by default
  body.tools = [{ type: "function", function: { name: "any", description: "Tool", parameters: {} } }];
  body.tool_choice = "auto";
  if (config.stream) body.stream = true;

  const resp = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  // Handle streaming response
  if (config.stream && resp.body) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let toolCalls: any[] = [];
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) fullContent += delta.content;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
                if (tc.id) toolCalls[idx].id = tc.id;
                if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          } catch {}
        }
      }
    }
    const result: AgentMessage = { role: "assistant", content: fullContent || null };
    if (toolCalls.length > 0) result.tool_calls = toolCalls;
    return { messages: [result], raw: { streamed: true } };
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0]?.message;

  if (!choice) {
    return { messages: [], raw: data };
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

// ── Claude adapter ──

async function claudeAdapter(
  messages: AgentMessage[],
  config: AgentConfig
): Promise<AgentResponse> {
  // Claude uses a different format — translate from OpenAI format
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": config.token ?? "",
    "anthropic-version": "2023-06-01",
  };

  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");

  const body: any = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: chatMessages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content ?? "",
    })),
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

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
  const content = data.content?.[0];

  return {
    messages: [
      {
        role: "assistant",
        content: content?.text ?? JSON.stringify(data.content),
      },
    ],
    raw: data,
  };
}

// ── Gemini adapter ──

async function geminiAdapter(
  messages: AgentMessage[],
  config: AgentConfig
): Promise<AgentResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Gemini expects contents array
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content ?? "" }],
    }));

  const url = `${config.url}${config.token ? `?key=${config.token}` : ""}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const data = await resp.json() as any;
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? "";

  return {
    messages: [{ role: "assistant", content: text }],
    raw: data,
  };
}

// ── Adapter registry ──

const agentAdapters: Record<string, AgentAdapterFn> = {
  openai: openaiAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
  custom: openaiAdapter, // Default fallback
};

// ── Runner ──

export async function run(
  session: NormalizedSession,
  agentConfig: AgentConfig
): Promise<RunResult> {
  const adapter = agentAdapters[agentConfig.format ?? "openai"] ?? openaiAdapter;
  const trace: ObservedStep[] = [];
  const stepResults: StepResult[] = [];
  const messages: AgentMessage[] = [];
  let stepNum = 0;

  for (const behavior of session.behaviors) {
    stepNum++;

    if (behavior.actor === "user") {
      // Send to agent
      messages.push({
        role: "user",
        content: typeof behavior.content === "string" ? behavior.content : JSON.stringify(behavior.content),
      });

      let response: AgentResponse;
      try {
        response = await adapter([...messages], agentConfig);
      } catch (err: any) {
        stepResults.push({
          step: stepNum,
          behavior,
          observed: null,
          matched: false,
          evaluations: [],
          sent: true,
        });
        // Add error to trace so subsequent steps don't break
        trace.push({
          actor: "error",
          action: "responds",
          content: `Agent error: ${err.message}`,
        });
        continue;
      }

      for (const msg of response.messages) {
        messages.push(msg);

        // Convert to observed step
        let observed: ObservedStep | null = null;

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            const step: ObservedStep = {
              actor: "assistant",
              action: "calls",
              target: tc.function.name,
              with: tryParseJson(tc.function.arguments),
            };
            trace.push(step);
          }
          continue;
        }

        if (msg.role === "tool") {
          observed = {
            actor: "tool",
            action: "responds",
            target: msg.name,
            content: tryParseJson(msg.content ?? ""),
          };
        } else if (msg.role === "assistant") {
          observed = {
            actor: "assistant",
            action: "responds",
            content: msg.content,
          };
        }

        if (observed) {
          trace.push(observed);
        }
      }

      stepResults.push({
        step: stepNum,
        behavior,
        observed: null,
        matched: false,
        evaluations: [],
        sent: true,
      });
    } else if (behavior.actor === "tool" && behavior.action === "responds") {
      // Tool response — check if agent is waiting for tool result
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

      // Let agent continue with tool results
      let response: AgentResponse;
      try {
        response = await adapter([...messages], agentConfig);
      } catch (err: any) {
        stepResults.push({
          step: stepNum,
          behavior,
          observed: null,
          matched: false,
          evaluations: [],
        });
        continue;
      }

      for (const msg of response.messages) {
        messages.push(msg);
        if (msg.role === "assistant" && msg.content) {
          trace.push({
            actor: "assistant",
            action: "responds",
            content: msg.content,
          });
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
      // Match against trace — skip tool/responds steps in the index
      // because they bridge the conversation but don't consume trace entries
      const matchedIdx = stepResults.filter(s => !s.sent && !(s.behavior.actor === "tool" && s.behavior.action === "responds")).length;
      const observed = trace[matchedIdx] ?? null;

      // Communication actions are equivalent for matching purposes
      const commActions = ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests"];
      const matched = observed
        ? observed.actor === behavior.actor &&
          (observed.action === behavior.action ||
           (commActions.includes(observed.action) && commActions.includes(behavior.action))) &&
          (!behavior.target || observed.target === behavior.target)
        : false;

      const matchObserved: ObservedStep | null = matched ? observed : null;

      // Run step-level evaluations
      const evalResults: EvalResult[] = [];
      if (behavior.evaluations) {
        for (const evalRule of behavior.evaluations) {
          // Try adapter first (llm_judge, etc.)
          const adapterResult = await evaluateWithAdapter(
            evalRule.type,
            trace,
            evalRule
          );
          if (adapterResult) {
            evalResults.push(adapterResult);
          } else {
            evalResults.push(
              evaluateStep(matchObserved, evalRule, session.behaviors, trace)
            );
          }
        }
      }

      stepResults.push({
        step: stepNum,
        behavior,
        observed: matchObserved,
        matched,
        evaluations: evalResults,
      });
    }
  }

  // Run chain evaluations
  const chainEvaluations: EvalResult[] = [];
  if (session.evaluations) {
    for (const evalRule of session.evaluations) {
      const adapterResult = await evaluateWithAdapter(
        evalRule.type,
        trace,
        evalRule
      );
      if (adapterResult) {
        chainEvaluations.push(adapterResult);
      } else {
        chainEvaluations.push(
          evaluateStep(null, evalRule, session.behaviors, trace)
        );
      }
    }
  }

  const allEvals = [
    ...stepResults.flatMap((s) => s.evaluations),
    ...chainEvaluations,
  ];

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
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
