/// <reference types="node" />

/**
 * Azure AI Foundry adapter tests — fetch mocked, no network/credentials needed.
 *
 * Mirrors python/tests/test_azure_adapter.py: normalization (1-5 → 0-1),
 * dimension routing, agentic custom evaluators, and per-rule `adapter: azure`
 * selection through the runner.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  ObservedStep,
  applyThreshold,
  evaluateWithAdapter,
  registerAdapter,
} from "../evaluators/builtin";
import { azureAdapter, configureAzure } from "../evaluators/adapters/azure";
import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

const TRACE: ObservedStep[] = [
  { actor: "user", action: "says", content: "Where is order 123?" },
  { actor: "assistant", action: "calls", target: "Order MCP", with: { orderId: "123" }, tool_call_id: "c1" },
  { actor: "tool", action: "responds", target: "Order MCP", content: { status: "shipped" }, tool_call_id: "c1" },
  { actor: "assistant", action: "informs", content: "It is on the way" },
];

const ENV_KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_KEY",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_API_VERSION",
];

interface CapturedRequest {
  url: string;
  body: any;
  headers: Record<string, any>;
}

let captured: CapturedRequest[] = [];
let savedEnv: Record<string, string | undefined> = {};
let originalFetch: any;

function setAzureEnv() {
  process.env.AZURE_OPENAI_ENDPOINT = "https://x.services.ai.azure.com";
  process.env.AZURE_OPENAI_KEY = "k";
  process.env.AZURE_OPENAI_DEPLOYMENT = "dep";
}

/** Replace global fetch with a stub returning a chat completion with `content`.
 *
 * Non-Azure requests (e.g. calls to the agent under test) are delegated to the
 * real fetch, so integration tests can run the runner and the judge together.
 */
function installFetch(content: string | ((request: CapturedRequest) => string)) {
  captured = [];
  (global as any).fetch = async (url: any, init: any) => {
    const urlString = String(url);
    if (!urlString.includes("/openai/deployments/")) {
      return originalFetch(url, init);
    }
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const request: CapturedRequest = { url: urlString, body, headers: init?.headers ?? {} };
    captured.push(request);
    const value = typeof content === "function" ? content(request) : content;
    return new Response(
      JSON.stringify({ choices: [{ message: { role: "assistant", content: value } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
}

function jsonJudge(score: number, reason: string): string {
  return JSON.stringify({ score, reason });
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = (global as any).fetch;
  configureAzure({});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  (global as any).fetch = originalFetch;
  configureAzure({});
});

// ── Configuration ──

describe("azure adapter configuration", () => {
  it("fails clearly when not configured", async () => {
    const result = await azureAdapter([], { type: "llm_judge", criteria: "x" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "adapter.not_configured");
    assert.match(result.reason, /AZURE_OPENAI_ENDPOINT/);
  });

  it("reports unknown custom evaluator ids", async () => {
    const result = await azureAdapter([], { type: "custom", id: "azure.nope" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "adapter.unknown_evaluator");
    assert.match(result.reason, /azure\.tool_call_accuracy/);
  });

  it("reports unsupported evaluator types", async () => {
    const result = await azureAdapter([], { type: "sequence" });
    assert.equal(result.code, "adapter.unsupported_type");
  });
});

// ── llm_judge ──

describe("azure llm_judge", () => {
  it("calls the deployment and parses Score/Reason", async () => {
    setAzureEnv();
    installFetch("Score: 0.9\nReason: looks good");

    const result = await azureAdapter(TRACE, { type: "llm_judge", criteria: "helpful", threshold: 0.8 });

    assert.equal(result.type, "llm_judge");
    assert.ok(Math.abs(result.score - 0.9) < 1e-9);
    assert.equal(result.passed, true);
    assert.match(result.reason, /\[azure\]/);

    assert.match(captured[0].url, /openai\/deployments\/dep/);
    assert.match(captured[0].url, /api-version=2024-02-15-preview/);
    assert.equal(captured[0].headers["api-key"], "k");
    assert.ok(String(captured[0].body.messages[0].content).includes("expert evaluator"));
    assert.ok(String(captured[0].body.messages[1].content).includes("helpful"));
  });
});

// ── Dimension evaluators ──

describe("azure dimension evaluators", () => {
  it("normalizes 1-5 groundedness and resolves context refs", async () => {
    setAzureEnv();
    installFetch(jsonJudge(5, "grounded"));

    const result = await azureAdapter(TRACE, {
      type: "Groundedness",
      query: "user.says",
      context: "tool.responds",
      response: "self",
      threshold: 0.8,
    });

    assert.equal(result.type, "Groundedness");
    assert.equal(result.score, 1);
    assert.equal(result.passed, true);
    assert.match(result.reason, /\[groundedness\]/);

    const userPrompt = String(captured[0].body.messages[1].content);
    assert.ok(userPrompt.includes("Where is order 123?"));
    assert.ok(userPrompt.includes("shipped"));
    assert.ok(userPrompt.toLowerCase().includes("ground"));
    assert.equal(captured[0].body.response_format.type, "json_object");
  });

  it("applies the ABS threshold over the normalized score", async () => {
    setAzureEnv();
    installFetch(jsonJudge(4, "mostly relevant"));

    const rule = { type: "Relevance", query: "user.says", response: "self", threshold: 0.9 };
    const raw = await azureAdapter(TRACE, rule);
    assert.ok(Math.abs(raw.score - 0.8) < 1e-9);

    const result = applyThreshold(raw, rule);
    assert.equal(result.passed, false);
    assert.equal(result.code, "evaluator.threshold_not_met");
  });

  it("uses the without-query groundedness template when no query is given", async () => {
    setAzureEnv();
    installFetch(jsonJudge(5, "grounded"));

    await azureAdapter(TRACE, { type: "Groundedness", response: "self" });
    const userPrompt = String(captured[0].body.messages[1].content);
    assert.ok(!userPrompt.includes("USER_QUERY"));
  });
});

// ── Agentic custom evaluators ──

describe("azure custom evaluators", () => {
  it("runs task_adherence with the observed tool calls", async () => {
    setAzureEnv();
    installFetch(jsonJudge(5, "adherent"));

    const result = await azureAdapter(TRACE, { type: "custom", id: "azure.task_adherence" });

    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
    assert.match(result.reason, /\[azure\.task_adherence\]/);
    const userPrompt = String(captured[0].body.messages[1].content);
    assert.ok(userPrompt.includes("Order MCP"));
    assert.ok(userPrompt.includes("shipped"));
  });

  it("runs intent_resolution with the conversation", async () => {
    setAzureEnv();
    installFetch(jsonJudge(4, "intent resolved"));

    const result = await azureAdapter(TRACE, { type: "custom", id: "azure.intent_resolution" });

    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    const userPrompt = String(captured[0].body.messages[1].content);
    assert.ok(userPrompt.includes("Where is order 123?"));
    assert.ok(userPrompt.includes("It is on the way"));
  });

  it("derives tool definitions for tool_call_accuracy", async () => {
    setAzureEnv();
    installFetch(jsonJudge(3, "params ok"));

    const result = await azureAdapter(TRACE, { type: "custom", id: "azure.tool_call_accuracy" });

    assert.ok(Math.abs(result.score - 0.6) < 1e-9);
    assert.equal(result.passed, true); // default threshold 0.5

    const userPrompt = String(captured[0].body.messages[1].content);
    assert.ok(userPrompt.includes("orderId"));
    assert.ok(userPrompt.includes("Order MCP"));
  });

  it("reports an HTTP failure as adapter.error", async () => {
    setAzureEnv();
    (global as any).fetch = async () => new Response("boom", { status: 500 });

    const result = await azureAdapter(TRACE, { type: "Groundedness", response: "self" });
    assert.equal(result.code, "adapter.error");
    assert.match(result.reason, /500/);
  });
});

// ── Named registration + runner passthrough ──

describe("adapter: azure selection", () => {
  it("reports a clear error when the named adapter was never registered", async () => {
    const result = await evaluateWithAdapter("Groundedness", TRACE, { type: "Groundedness" }, "azure");
    assert.equal(result?.code, "adapter.not_configured");
    assert.match(result!.reason, /--adapter Groundedness=azure/);
  });

  it("runs azure per-rule from a real session", async () => {
    setAzureEnv();
    registerAdapter("Groundedness", azureAdapter, "azure");
    installFetch(jsonJudge(5, "grounded"));

    const srv = await startServer((_req, res, index) => {
      if (index === 0) {
        sendJson(res, {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "c1", type: "function", function: { name: "Knowledge Base", arguments: "{}" } },
                ],
              },
            },
          ],
        });
      } else {
        sendJson(res, {
          choices: [{ message: { role: "assistant", content: "Returns are accepted within 30 days." } }],
        });
      }
    }, "/chat");

    try {
      const session = parse(`
session: RAG with azure
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "What is the return policy?"
  - id: kb_call
    actor: assistant
    action: calls
    target: Knowledge Base
  - id: kb_result
    actor: tool
    action: responds
    target: Knowledge Base
    content:
      policy: "30 days"
  - id: answer
    actor: assistant
    action: informs
    evaluations:
      - type: Groundedness
        adapter: azure
        query: user_asks.says
        context: kb_result.responds
        response: self
        threshold: 0.8
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(captured.length, 1);
      assert.ok(String(captured[0].body.messages[1].content).includes("30 days"));
    } finally {
      await srv.close();
    }
  });
});
