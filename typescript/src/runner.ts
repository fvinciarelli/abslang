import { Behavior, NormalizedSession } from "./parser";
import {
  ObservedStep,
  EvalResult,
  evaluateStep,
  evaluateWithAdapter,
  expected,
  evalWhen,
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
  format?: "openai" | "responses" | "response" | "claude" | "gemini" | "custom";
  auth?: "none" | "api_key" | "bearer" | "oauth2";
  token?: string;
  /** Model/deployment to send when the endpoint is a raw model (e.g. Azure OpenAI Responses API).
   * Omit it for agent endpoints that own their model. */
  model?: string;
  /** Forward the caller's `Authorization` header to the upstream agent. */
  forwardAuth?: boolean;
  /** Raw `Authorization` header value to forward (e.g. "Bearer eyJ..."). Implies forwardAuth. */
  authorization?: string;
  refreshUrl?: string;
  refreshToken?: string;
  clientId?: string;
  stream?: boolean;
  timeout?: number;
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
    ...buildAuthHeaders(config),
  };

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

  const resp = await absFetch(config.url, { method: "POST", headers, body: JSON.stringify(body) }, config.timeout);

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

// ── Auth headers (explicit token or forwarded Authorization) ──

/**
 * Resolve the raw `Authorization` value to forward upstream.
 *
 * Order: explicit config.authorization → ABS_AGENT_AUTHORIZATION →
 * HTTP_AUTHORIZATION → Authorization → Bearer(ABS_AGENT_TOKEN).
 * A bare token (no scheme) is normalized to `Bearer <token>`.
 */
export function resolveForwardedAuthorization(
  config: Pick<AgentConfig, "forwardAuth" | "authorization">,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  if (!config.forwardAuth && !config.authorization) return undefined;

  const raw =
    config.authorization ||
    env.ABS_AGENT_AUTHORIZATION ||
    env.HTTP_AUTHORIZATION ||
    env.Authorization;

  if (raw) {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    // Already carries a scheme (Bearer, Basic, ...): forward verbatim.
    if (trimmed.includes(" ")) return trimmed;
    return `Bearer ${trimmed}`;
  }

  if (env.ABS_AGENT_TOKEN) return `Bearer ${env.ABS_AGENT_TOKEN}`;

  throw new Error(
    "Authorization forwarding is enabled but no value was found. " +
      "Pass --agent-authorization, or set ABS_AGENT_AUTHORIZATION / HTTP_AUTHORIZATION / ABS_AGENT_TOKEN."
  );
}

/** Build the auth headers for an agent request. */
export function buildAuthHeaders(
  config: AgentConfig,
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  if (config.auth === "api_key" && config.token) {
    return { "X-API-Key": config.token };
  }

  if ((config.auth === "bearer" || config.auth === "oauth2") && config.token) {
    return { Authorization: `Bearer ${config.token}` };
  }

  const forwarded = resolveForwardedAuthorization(config, env);
  return forwarded ? { Authorization: forwarded } : {};
}

// ── OpenAI Responses API adapter ──

interface ResponsesFunctionCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ResponsesStreamState {
  text: string;
  calls: Map<string | number, ResponsesFunctionCall>;
  order: (string | number)[];
  completed: any | null;
}

/** Translate the runner's internal messages into a Responses API `input` array. */
export function toResponsesInput(
  messages: AgentMessage[]
): { instructions?: string; input: any[] } {
  const instructions: string[] = [];
  const input: any[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      if (m.content) instructions.push(m.content);
      continue;
    }

    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id ?? "",
        output: m.content ?? "",
      });
      continue;
    }

    if (m.role === "assistant" && m.tool_calls?.length) {
      if (m.content) input.push({ role: "assistant", content: m.content });
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }

    input.push({ role: m.role, content: m.content ?? "" });
  }

  const result: { instructions?: string; input: any[] } = { input };
  if (instructions.length > 0) result.instructions = instructions.join("\n\n");
  return result;
}

/** Extract text and tool calls from a Responses API `output` array. */
export function parseResponsesOutput(
  output: any[] | undefined
): { content: string; toolCalls: ToolCall[] } {
  const texts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const item of output ?? []) {
    if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && part.text) texts.push(part.text);
        if (part?.type === "refusal" && part.refusal) texts.push(part.refusal);
      }
    } else if (item?.type === "function_call") {
      toolCalls.push({
        id: item.call_id ?? item.id ?? "",
        type: "function",
        function: {
          name: item.name ?? "",
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}),
        },
      });
    }
  }

  return { content: texts.join(""), toolCalls };
}

/** Fold a single Responses SSE event into the accumulated state. */
export function applyResponsesEvent(state: ResponsesStreamState, event: any): void {
  switch (event?.type) {
    case "response.output_text.delta":
      if (typeof event.delta === "string") state.text += event.delta;
      break;

    case "response.output_item.added": {
      const item = event.item;
      if (item?.type === "function_call") {
        const key = item.id ?? event.output_index ?? state.order.length;
        if (!state.calls.has(key)) {
          state.calls.set(key, {
            id: item.call_id ?? item.id ?? "",
            name: item.name ?? "",
            arguments: item.arguments ?? "",
          });
          state.order.push(key);
        }
      }
      break;
    }

    case "response.function_call_arguments.delta": {
      const key = event.item_id ?? event.output_index;
      const call = state.calls.get(key);
      if (call && typeof event.delta === "string") call.arguments += event.delta;
      break;
    }

    case "response.function_call_arguments.done": {
      const key = event.item_id ?? event.output_index;
      const call = state.calls.get(key);
      if (call && typeof event.arguments === "string") call.arguments = event.arguments;
      break;
    }

    case "response.output_item.done": {
      const item = event.item;
      if (item?.type === "function_call") {
        const key = item.id ?? event.output_index;
        const existing = state.calls.get(key);
        const call: ResponsesFunctionCall = existing ?? { id: "", name: "", arguments: "" };
        call.id = item.call_id ?? existing?.id ?? item.id ?? "";
        call.name = item.name ?? existing?.name ?? "";
        call.arguments = item.arguments ?? existing?.arguments ?? "";
        if (!existing) {
          state.calls.set(key, call);
          state.order.push(key);
        }
      } else if (item?.type === "message" && !state.text) {
        const { content } = parseResponsesOutput([item]);
        if (content) state.text = content;
      }
      break;
    }

    case "response.completed":
      state.completed = event.response ?? null;
      break;

    case "error":
      throw new Error(`Responses API error: ${event.message ?? JSON.stringify(event)}`);

    default:
      break;
  }
}

function processResponsesSseLine(line: string, state: ResponsesStreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
  try {
    applyResponsesEvent(state, JSON.parse(data));
  } catch (err) {
    if (err instanceof SyntaxError) return; // partial chunk — ignore
    throw err;
  }
}

/** Build the final assistant message from the accumulated Responses state. */
export function responsesStateToMessage(state: ResponsesStreamState): AgentMessage {
  let content = state.text;
  let toolCalls: ToolCall[] = state.order
    .map((key) => state.calls.get(key))
    .filter((c): c is ResponsesFunctionCall => Boolean(c))
    .map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.arguments },
    }));

  // `response.completed` carries the authoritative output — prefer it.
  if (state.completed) {
    const parsed = parseResponsesOutput(state.completed.output);
    if (parsed.content || parsed.toolCalls.length > 0) {
      content = parsed.content;
      toolCalls = parsed.toolCalls;
    }
  }

  const message: AgentMessage = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}

/**
 * OpenAI Responses API adapter (`POST /v1/responses`).
 *
 * Streams by default (SSE events) and falls back to JSON when the server ignores
 * `stream`. Set `config.stream = false` to force the non-streaming path.
 */
export async function responsesAdapter(
  messages: AgentMessage[],
  config: AgentConfig
): Promise<AgentResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(config),
  };

  const { instructions, input } = toResponsesInput(messages);
  const stream = config.stream !== false;

  const body: any = {
    input,
    tools: [
      {
        type: "function",
        name: "any",
        description: "Tool",
        parameters: { type: "object", properties: {} },
      },
    ],
    tool_choice: "auto",
  };
  // Only send `model` when explicitly configured: agent endpoints own their model,
  // raw model endpoints (Azure OpenAI, OpenAI) require it.
  if (config.model) body.model = config.model;
  if (instructions) body.instructions = instructions;
  if (stream) body.stream = true;

  const resp = await absFetch(
    config.url,
    { method: "POST", headers, body: JSON.stringify(body) },
    config.timeout
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Agent returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  const isEventStream = stream && resp.body && !contentType.includes("application/json");

  if (isEventStream && resp.body) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponsesStreamState = { text: "", calls: new Map(), order: [], completed: null };
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processResponsesSseLine(line, state);
    }
    if (buffer) processResponsesSseLine(buffer, state);

    return {
      messages: [responsesStateToMessage(state)],
      raw: { streamed: true, response: state.completed },
    };
  }

  const data = (await resp.json()) as any;
  const { content, toolCalls } = parseResponsesOutput(data.output);
  const result: AgentMessage = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) result.tool_calls = toolCalls;
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
    ...buildAuthHeaders(config),
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

  const resp = await absFetch(config.url, { method: "POST", headers, body: JSON.stringify(body) }, config.timeout);

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
    ...buildAuthHeaders(config),
  };

  // Gemini expects contents array
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content ?? "" }],
    }));

  const url = `${config.url}${config.token ? `?key=${config.token}` : ""}`;

  const resp = await absFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: 1024 },
    }),
  }, config.timeout);

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
  responses: responsesAdapter,
  response: responsesAdapter, // alias
  claude: claudeAdapter,
  gemini: geminiAdapter,
  custom: openaiAdapter, // Default fallback
};

// ── Runner ──

export async function run(
  session: NormalizedSession,
  agentConfig: AgentConfig,
  rowVars?: Record<string, any>
): Promise<RunResult> {
  const adapter = agentAdapters[agentConfig.format ?? "openai"] ?? openaiAdapter;
  const trace: ObservedStep[] = [];
  const stepResults: StepResult[] = [];
  const messages: AgentMessage[] = [];
  const skippedIds = new Set<string>(); // v0.2: track skipped optional behaviors
  let stepNum = 0;

  for (const behavior of session.behaviors) {
    stepNum++;

    // ── v0.2: skip if dependency was not matched ──
    if (behavior.requires && skippedIds.has(behavior.requires)) {
      if (behavior.id) skippedIds.add(behavior.id);
      stepResults.push({
        step: stepNum,
        behavior,
        observed: null,
        matched: false,
        evaluations: [],
      });
      continue;
    }

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
      const commActions = ["says", "asks", "informs", "greets", "responds", "clarifies", "confirms", "rejects", "suggests", "shows", "hands_off"];
      const execActions = ["calls", "submits", "retrieves", "stores", "updates"];
      const isExecAction = execActions.includes(behavior.action);

      let matched: boolean;

      // ── v0.2: matches_when overrides default matching ──
      if (behavior.matches_when) {
        const mw = behavior.matches_when;
        if (mw.type === "contains" && mw.value && observed?.content) {
          matched = String(observed.content).includes(mw.value);
        } else if (mw.type === "regex" && mw.pattern && observed?.content) {
          try {
            matched = new RegExp(mw.pattern).test(String(observed.content));
          } catch {
            matched = false;
          }
        } else if (mw.type === "llm_judge") {
          // llm_judge: try adapter, fallback to contains on criteria
          const llmResult = await evaluateWithAdapter("llm_judge", trace, {
            type: "llm_judge",
            criteria: mw.criteria,
            query: String(observed?.content ?? ""),
          });
          matched = llmResult?.passed ?? false;
        } else {
          matched = false;
        }
      } else {
        // Default matching (v0.1)
        matched = observed
          ? observed.actor === behavior.actor &&
            (observed.action === behavior.action ||
             (commActions.includes(observed.action) && commActions.includes(behavior.action)) ||
             (execActions.includes(observed.action) && execActions.includes(behavior.action))) &&
            (commActions.includes(behavior.action) || !behavior.target || observed.target === behavior.target) &&
            matchWithParams(behavior, observed)
          : false;
      }

      // ── v0.2: optional — skip if no match ──
      if (behavior.optional && !matched) {
        if (behavior.id) skippedIds.add(behavior.id);
        stepResults.push({
          step: stepNum,
          behavior,
          observed,
          matched: false,
          evaluations: [],
        });
        continue;
      }

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
      // ── v0.2: expected evaluator (needs stepResults) ──
      if (evalRule.type === "expected") {
        chainEvaluations.push(expected(
          stepResults.filter(s => !s.sent),
          evalRule,
          rowVars || {}
        ));
        continue;
      }

      // ── v0.2: when on never ──
      if (evalRule.type === "never" && evalRule.when) {
        if (!evalWhen(evalRule.when, rowVars || {})) {
          chainEvaluations.push({ type: "never", passed: true, score: 1, reason: "when condition not met — skipped" });
          continue;
        }
      }
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

  // Propagate blocking failures → mark downstream evals as inconclusive
  propagateBlocking(stepResults);

  // Recompute allEvals after propagation (inconclusive counts as passed for stats)
  const allEvalsFinal = [
    ...stepResults.flatMap((s) => s.evaluations),
    ...chainEvaluations,
  ];

  return {
    session: session.session,
    agent: agentConfig.url,
    passed: allEvalsFinal.every((e) => e.passed || e.inconclusive),
    steps: stepResults,
    chainEvaluations,
    stepsTotal: stepResults.length,
    stepsMatched: stepResults.filter((s) => s.matched || s.sent).length,
    evaluationsTotal: allEvalsFinal.length,
    evaluationsPassed: allEvalsFinal.filter((e) => e.passed || e.inconclusive).length,
  };
}

function propagateBlocking(stepResults: StepResult[]): void {
  let downstreamBlocked = false;
  for (const sr of stepResults) {
    for (const ev of sr.evaluations) {
      if (downstreamBlocked) {
        ev.inconclusive = true;
        ev.reason = `Inconclusive: a blocking evaluation earlier in the session failed.`;
      } else if (ev.blocking && !ev.passed) {
        downstreamBlocked = true;
      }
    }
  }
}

function matchWithParams(behavior: Behavior, observed: ObservedStep): boolean {
  // If neither with nor with_only is declared, skip parameter check
  if (!behavior.with && !behavior.with_only) return true;

  const observedWith = observed.with ?? {};

  if (behavior.with_only) {
    // Strict: same keys, same values
    const expectedKeys = Object.keys(behavior.with_only).sort();
    const observedKeys = Object.keys(observedWith).sort();
    if (expectedKeys.length !== observedKeys.length) return false;
    if (expectedKeys.join(",") !== observedKeys.join(",")) return false;
    for (const key of expectedKeys) {
      if (JSON.stringify(observedWith[key]) !== JSON.stringify(behavior.with_only[key])) return false;
    }
    return true;
  }

  if (behavior.with) {
    // Partial: observed must contain all expected keys with matching values
    for (const [key, expected] of Object.entries(behavior.with)) {
      if (!(key in observedWith)) return false;
      if (JSON.stringify(observedWith[key]) !== JSON.stringify(expected)) return false;
    }
    return true;
  }

  return true;
}

function tryParseJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function absFetch(
  url: string,
  init: RequestInit,
  timeoutSec?: number
): Promise<Response> {
  if (!timeoutSec) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
