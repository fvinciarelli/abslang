/**
 * ABS Assistant — chat with QA/PO/PM to build spec files.
 *
 * The system prompt is assembled at runtime from ./assistant-knowledge, which is
 * generated from the ABS schema, vocabulary, examples, and the base prompt.
 * Regenerate with: npm run gen:knowledge
 *
 * Providers: OpenAI-compatible endpoints (OpenAI, DeepSeek, Ollama, vLLM) and
 * the Anthropic Messages API.
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

// ── OpenAI-compatible: OpenAI, DeepSeek, Ollama, vLLM ──

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
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Chat provider returned ${resp.status}: ${text.substring(0, 300)}`);
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
      max_tokens: 4096,
      temperature: 0.3,
      system, // top-level field, not a message with role "system"
      messages: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
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
