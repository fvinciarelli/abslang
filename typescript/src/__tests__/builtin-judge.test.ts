/**
 * Spike — built-in LLM judge with a custom (OpenAI-compatible) endpoint.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { configureBuiltinJudge, builtinLlmJudge } from "../evaluators/builtin_judge";
import { ObservedStep } from "../evaluators";
import { startServer, sendJson } from "./http-helpers";

const TRACE: ObservedStep[] = [
  { actor: "assistant", action: "responds", content: "Your order is on its way" },
];

const JUDGE_ENV_VARS = [
  "ABS_JUDGE_BASE_URL",
  "ABS_JUDGE_API_KEY",
  "ABS_JUDGE_API_KEY_HEADER",
  "ABS_JUDGE_MODEL",
  "ABS_JUDGE_PROVIDER",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
];

/** Run `fn` with a clean judge environment and a clean judge configuration. */
async function withCleanJudgeEnv(fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of JUDGE_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  configureBuiltinJudge({});
  try {
    await fn();
  } finally {
    for (const key of JUDGE_ENV_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    configureBuiltinJudge({});
  }
}

const JUDGE_RESPONSE = {
  choices: [{ message: { role: "assistant", content: "Score: 0.9\nReason: looks good" } }],
};

describe("builtin judge — custom endpoint", () => {
  it("calls the configured base URL with the api-key header and model", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        configureBuiltinJudge({
          baseUrl: srv.url,
          apiKey: "secret",
          apiKeyHeader: "api-key",
          model: "gpt-4o-mini",
        });

        const result = await builtinLlmJudge(TRACE, { criteria: "Is it helpful?" });

        assert.equal(result.passed, true);
        assert.equal(result.score, 0.9);
        assert.equal(srv.requests[0].url, "/v1/chat/completions");
        assert.equal(srv.requests[0].headers["api-key"], "secret");
        assert.equal(srv.requests[0].headers.authorization, undefined);
        assert.equal(srv.requests[0].body.model, "gpt-4o-mini");
      } finally {
        await srv.close();
      }
    });
  });

  it("defaults to Authorization: Bearer for OpenAI-compatible endpoints", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        configureBuiltinJudge({ baseUrl: srv.url, apiKey: "secret" });

        await builtinLlmJudge(TRACE, { criteria: "Is it helpful?" });

        assert.equal(srv.requests[0].headers.authorization, "Bearer secret");
      } finally {
        await srv.close();
      }
    });
  });

  it("sends no auth header when no key exists (local judge like Ollama)", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        configureBuiltinJudge({ baseUrl: srv.url });

        await builtinLlmJudge(TRACE, { criteria: "Is it helpful?" });

        assert.equal(srv.requests[0].headers.authorization, undefined);
        assert.equal(srv.requests[0].headers["api-key"], undefined);
      } finally {
        await srv.close();
      }
    });
  });

  it("CLI configuration overrides exported env vars", async () => {
    await withCleanJudgeEnv(async () => {
      process.env.ABS_JUDGE_BASE_URL = "http://127.0.0.1:9/v1";
      process.env.ABS_JUDGE_API_KEY = "from-env";
      process.env.ABS_JUDGE_API_KEY_HEADER = "api-key";

      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        configureBuiltinJudge({
          baseUrl: srv.url,
          apiKey: "from-cli",
          apiKeyHeader: "Authorization",
          model: "cli-model",
        });

        await builtinLlmJudge(TRACE, { criteria: "Is it helpful?" });

        // Flags win: the request reaches the mock server, not the env URL
        assert.equal(srv.requests.length, 1);
        assert.equal(srv.requests[0].headers.authorization, "Bearer from-cli");
        assert.equal(srv.requests[0].headers["api-key"], undefined);
        assert.equal(srv.requests[0].body.model, "cli-model");
      } finally {
        await srv.close();
      }
    });
  });

  it("falls back to env vars when no CLI flags are given", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        process.env.ABS_JUDGE_BASE_URL = srv.url;
        process.env.ABS_JUDGE_API_KEY = "env-key";
        process.env.ABS_JUDGE_API_KEY_HEADER = "api-key";
        process.env.ABS_JUDGE_MODEL = "env-model";

        configureBuiltinJudge({});

        await builtinLlmJudge(TRACE, { criteria: "Is it helpful?" });

        assert.equal(srv.requests[0].headers["api-key"], "env-key");
        assert.equal(srv.requests[0].body.model, "env-model");
      } finally {
        await srv.close();
      }
    });
  });

  it("respects the evaluation threshold (default 0.5)", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer(
        (_req, res) =>
          sendJson(res, {
            choices: [
              { message: { role: "assistant", content: "Score: 0.6\nReason: borderline" } },
            ],
          }),
        "/v1"
      );
      try {
        configureBuiltinJudge({ baseUrl: srv.url, model: "judge" });

        const defaulted = await builtinLlmJudge(TRACE, { type: "llm_judge", criteria: "x" });
        assert.equal(defaulted.score, 0.6);
        assert.equal(defaulted.passed, true, "default threshold is 0.5 (EVALUATIONS.md)");

        const strict = await builtinLlmJudge(TRACE, {
          type: "llm_judge",
          criteria: "x",
          threshold: 0.7,
        });
        assert.equal(strict.passed, false);

        const lenient = await builtinLlmJudge(TRACE, {
          type: "llm_judge",
          criteria: "x",
          threshold: 0.5,
        });
        assert.equal(lenient.passed, true);
      } finally {
        await srv.close();
      }
    });
  });

  it("renders tool-call arguments in the judge prompt", async () => {
    await withCleanJudgeEnv(async () => {
      const srv = await startServer((_req, res) => sendJson(res, JUDGE_RESPONSE), "/v1");
      try {
        configureBuiltinJudge({ baseUrl: srv.url, model: "judge" });
        const trace: ObservedStep[] = [
          { actor: "assistant", action: "calls", target: "Order MCP", with: { orderId: "8291" } },
          { actor: "tool", action: "responds", target: "Order MCP", content: { status: "shipped" } },
        ];

        await builtinLlmJudge(trace, { type: "llm_judge", criteria: "x" });

        const prompt = srv.requests[0].body.messages[1].content as string;
        assert.match(prompt, /\[assistant\] calls → Order MCP: \{"orderId":"8291"\}/);
        assert.match(prompt, /\[tool\] responds → Order MCP: \{"status":"shipped"\}/);
        assert.doesNotMatch(prompt, /undefined/);
      } finally {
        await srv.close();
      }
    });
  });
});
