/**
 * Tests for multi-provider BYOK support.
 */
import {
  detectProvider,
  getProviderKey,
  getProviderKeyEnv,
  getProviderConfig,
} from "../providers";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg?: string) {
  if (!condition) throw new Error(msg || "assertion failed");
}

function assertEquals(a: any, b: any, msg?: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── detectProvider ──

console.log("\n📦 Providers — detectProvider");

test("detects openai from OPENAI_API_KEY", () => {
  assertEquals(detectProvider({ OPENAI_API_KEY: "sk-abc" }), "openai");
});

test("detects anthropic from ANTHROPIC_API_KEY", () => {
  assertEquals(detectProvider({ ANTHROPIC_API_KEY: "sk-ant-abc" }), "anthropic");
});

test("detects deepseek from DEEPSEEK_API_KEY", () => {
  assertEquals(detectProvider({ DEEPSEEK_API_KEY: "sk-ds-abc" }), "deepseek");
});

test("openai wins when multiple keys are set", () => {
  assertEquals(
    detectProvider({ OPENAI_API_KEY: "sk-o", ANTHROPIC_API_KEY: "sk-a", DEEPSEEK_API_KEY: "sk-d" }),
    "openai"
  );
});

test("anthropic wins when openai is not set", () => {
  assertEquals(
    detectProvider({ ANTHROPIC_API_KEY: "sk-a", DEEPSEEK_API_KEY: "sk-d" }),
    "anthropic"
  );
});

test("deepseek wins when only deepseek is set", () => {
  assertEquals(
    detectProvider({ DEEPSEEK_API_KEY: "sk-d" }),
    "deepseek"
  );
});

test("defaults to openai when no keys are set", () => {
  assertEquals(detectProvider({}), "openai");
});

// ── getProviderKey ──

console.log("\n📦 Providers — getProviderKey");

test("returns openai key", () => {
  assertEquals(getProviderKey("openai", { OPENAI_API_KEY: "sk-123" }), "sk-123");
});

test("returns anthropic key", () => {
  assertEquals(getProviderKey("anthropic", { ANTHROPIC_API_KEY: "sk-ant-456" }), "sk-ant-456");
});

test("returns deepseek key", () => {
  assertEquals(getProviderKey("deepseek", { DEEPSEEK_API_KEY: "sk-ds-789" }), "sk-ds-789");
});

test("returns undefined when key not set", () => {
  assertEquals(getProviderKey("openai", {}), undefined);
});

// ── getProviderKeyEnv ──

console.log("\n📦 Providers — getProviderKeyEnv");

test("returns OPENAI_API_KEY for openai", () => {
  assertEquals(getProviderKeyEnv("openai"), "OPENAI_API_KEY");
});

test("returns ANTHROPIC_API_KEY for anthropic", () => {
  assertEquals(getProviderKeyEnv("anthropic"), "ANTHROPIC_API_KEY");
});

test("returns DEEPSEEK_API_KEY for deepseek", () => {
  assertEquals(getProviderKeyEnv("deepseek"), "DEEPSEEK_API_KEY");
});

// ── getProviderConfig ──

console.log("\n📦 Providers — getProviderConfig");

test("openai defaults", () => {
  const c = getProviderConfig("openai");
  assertEquals(c.model, "gpt-4o");
  assert(c.baseUrl.includes("api.openai.com"));
});

test("anthropic defaults", () => {
  const c = getProviderConfig("anthropic");
  assertEquals(c.model, "claude-sonnet-4-20250514");
  assert(c.baseUrl.includes("api.anthropic.com"));
});

test("deepseek defaults", () => {
  const c = getProviderConfig("deepseek");
  assertEquals(c.model, "deepseek-chat");
  assert(c.baseUrl.includes("api.deepseek.com"));
});

test("ABS_CHAT_MODEL overrides model", () => {
  const c = getProviderConfig("openai", { ABS_CHAT_MODEL: "gpt-4o-mini" });
  assertEquals(c.model, "gpt-4o-mini");
});

test("ABS_CHAT_BASE_URL overrides base url", () => {
  const c = getProviderConfig("openai", { ABS_CHAT_BASE_URL: "https://custom.llm/v1" });
  assertEquals(c.baseUrl, "https://custom.llm/v1");
});

test("ABS_CHAT_MODEL and ABS_CHAT_BASE_URL work together", () => {
  const c = getProviderConfig("anthropic", {
    ABS_CHAT_MODEL: "claude-opus-4-20250514",
    ABS_CHAT_BASE_URL: "https://proxy.example.com/v1",
  });
  assertEquals(c.model, "claude-opus-4-20250514");
  assertEquals(c.baseUrl, "https://proxy.example.com/v1");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
