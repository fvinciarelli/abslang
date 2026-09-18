/**
 * ABS Assistant — chat with QA/PO/PM to build spec files.
 *
 * The system prompt is assembled at runtime from ./assistant-knowledge, which is
 * generated from the ABS schema, vocabulary, examples, and the base prompt.
 * Regenerate with: npm run gen:knowledge
 *
 * Providers: OpenAI-compatible endpoints (OpenAI, Azure OpenAI, DeepSeek,
 * Ollama, vLLM) and the Anthropic Messages API.
 *
 * Parameter names differ per model (e.g. gpt-5 expects max_completion_tokens and
 * rejects temperature). Nothing is guessed from the model name: the caller
 * passes maxTokensParam / temperature / omitTemperature / extraParams explicitly.
 * Used by: CLI (abs chat), Web UI, VSCode extension.
 */

import { buildSystemPrompt } from "./assistant-knowledge";

// ── Types ──

export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssistantConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  provider?: "openai" | "anthropic" | "deepseek" | string;
  /** Output token limit. Default: 4096. */
  maxTokens?: number;
  /** Sampling temperature. Default: 0.3. Ignored when omitTemperature is true. */
  temperature?: number;
  /** Do not send temperature at all (some models reject it). */
  omitTemperature?: boolean;
  /** Name of the token-limit field. Default: max_tokens. Use max_completion_tokens for gpt-5/o-series. */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  /** Extra request body fields, merged last (e.g. { reasoning_effort: "low" }). */
  extraParams?: Record<string, unknown>;
}

// ── Chat completion ──

export async function chat(
  messages: AssistantMessage[],
  config: AssistantConfig
): Promise<string> {
  // The latest user message selects which examples to inject into the prompt.
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const system = buildSystemPrompt(lastUser);

  if (config.provider === "anthropic") {
    return chatAnthropic(messages, config, system);
  }
  return chatOpenAICompatible(messages, config, system);
}

// ── OpenAI-compatible: OpenAI, Azure OpenAI, DeepSeek, Ollama, vLLM ──

function buildOpenAIBody(
  model: string,
  messages: AssistantMessage[],
  system: string,
  config: AssistantConfig
): Record<string, any> {
  const body: Record<string, any> = {
    model,
    messages: [{ role: "system", content: system }, ...messages],
    [config.maxTokensParam ?? "max_tokens"]: config.maxTokens ?? 4096,
  };
  if (!config.omitTemperature) body.temperature = config.temperature ?? 0.3;
  if (config.extraParams) Object.assign(body, config.extraParams);
  return body;
}

async function chatOpenAICompatible(
  messages: AssistantMessage[],
  config: AssistantConfig,
  system: string
): Promise<string> {
  const model = config.model || "deepseek-chat";
  const baseUrl = config.baseUrl || "https://api.deepseek.com/v1";

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildOpenAIBody(model, messages, system, config)),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let hint = "";
    if (text.includes("max_completion_tokens")) {
      hint += "\nHint: this model expects max_completion_tokens. Retry with --max-tokens-param max_completion_tokens";
    }
    if (/temperature/.test(text)) {
      hint += "\nHint: this model rejects temperature. Retry with --omit-temperature";
    }
    throw new Error(`Chat provider returned ${resp.status}: ${text.substring(0, 300)}${hint}`);
  }

  const data = await resp.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Anthropic Messages API ──

async function chatAnthropic(
  messages: AssistantMessage[],
  config: AssistantConfig,
  system: string
): Promise<string> {
  const model = config.model || "claude-sonnet-4-20250514";
  const baseUrl = config.baseUrl || "https://api.anthropic.com/v1";

  const resp = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens ?? 4096,
      ...(config.omitTemperature ? {} : { temperature: config.temperature ?? 0.3 }),
      system, // top-level field, not a message with role "system"
      messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ...(config.extraParams ?? {}),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic returned ${resp.status}: ${text.substring(0, 300)}`);
  }

  const data = await resp.json() as any;
  const parts = Array.isArray(data.content) ? data.content : [];
  return parts
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text ?? "")
    .join("");
}

// ── Convenience: start a new conversation ──

export function newConversation(): AssistantMessage[] {
  return [];
}

// ── Convenience: extract YAML from assistant response ──

export function extractYaml(text: string): string | null {
  const match = text.match(/```yaml\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

// ── Convenience: extract Mermaid from assistant response ──

export function extractMermaid(text: string): string | null {
  const match = text.match(/```mermaid\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
