/**
 * ABS Assistant — chat with QA/PO/PM to build spec files.
 *
 * The system prompt is assembled at runtime from ./assistant-knowledge, which is
 * generated from the ABS schema, vocabulary, examples, and the base prompt.
 * Regenerate with: npm run gen:knowledge
 *
 * Supports BYOK via any OpenAI-compatible endpoint: OpenAI, DeepSeek, Ollama, vLLM.
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
}

// ── Chat completion (OpenAI-compatible) ──

export async function chat(
  messages: AssistantMessage[],
  config: AssistantConfig
): Promise<string> {
  const model = config.model || "deepseek-chat";
  const baseUrl = config.baseUrl || "https://api.deepseek.com/v1";

  // The latest user message selects which examples to inject into the prompt.
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const system = buildSystemPrompt(lastUser);

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

// ── Convenience: start a new conversation ──

export function newConversation(): AssistantMessage[] {
  return [];
}

// ── Convenience: extract YAML from assistant response ──

export function extractYaml(text: string): string | null {
  const match = text.match(/```yaml\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
