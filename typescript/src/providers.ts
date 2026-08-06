/**
 * Multi-provider BYOK support for abs chat.
 * Auto-detects OpenAI, Anthropic, or DeepSeek from environment.
 */

export type Provider = "openai" | "anthropic" | "deepseek";

export interface ProviderConfig {
  model: string;
  baseUrl: string;
}

export function detectProvider(env: Record<string, string | undefined> = process.env): Provider {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.DEEPSEEK_API_KEY) return "deepseek";
  return "openai";
}

export function getProviderKey(provider: Provider, env: Record<string, string | undefined> = process.env): string | undefined {
  const keys: Record<Provider, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  return env[keys[provider]];
}

export function getProviderKeyEnv(provider: Provider): string {
  const keys: Record<Provider, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  return keys[provider];
}

export function getProviderConfig(provider: Provider, env: Record<string, string | undefined> = process.env): ProviderConfig {
  switch (provider) {
    case "openai":
      return {
        model: env.ABS_CHAT_MODEL || "gpt-4o",
        baseUrl: env.ABS_CHAT_BASE_URL || "https://api.openai.com/v1",
      };
    case "anthropic":
      return {
        model: env.ABS_CHAT_MODEL || "claude-sonnet-4-20250514",
        baseUrl: env.ABS_CHAT_BASE_URL || "https://api.anthropic.com/v1",
      };
    case "deepseek":
      return {
        model: env.ABS_CHAT_MODEL || "deepseek-chat",
        baseUrl: env.ABS_CHAT_BASE_URL || "https://api.deepseek.com/v1",
      };
  }
}
