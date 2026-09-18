/// <reference types="node" />

/**
 * Google Vertex AI adapter tests — SDK mocked via Module._load, no GCP needed.
 *
 * Mirrors python/tests/test_google_adapter.py: prompt building, pointwise
 * parsing, managed/safety routing, custom metrics, and error handling.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ObservedStep } from "../evaluators/builtin";
import {
  buildCustomPrompt,
  configureGoogle,
  googleAdapter,
  parsePointwiseResponse,
} from "../evaluators/adapters/google";

const Module = require("module");

const TRACE: ObservedStep[] = [
  { actor: "user", action: "says", content: "Where is order 123?" },
  { actor: "assistant", action: "informs", content: "It is on the way" },
];

let capturedPrompts: string[] = [];
let nextResponse = '{"score": 4, "explanation": "good"}';
let generateError: Error | null = null;
let sdkMissing = false;
let originalLoad: any;

class FakeVertexAI {
  config: any;
  constructor(config: any) {
    this.config = config;
  }
  getGenerativeModel({ model }: any) {
    return {
      model,
      generateContent: async (prompt: string) => {
        capturedPrompts.push(prompt);
        if (generateError) throw generateError;
        return { response: { text: () => nextResponse } };
      },
    };
  }
}

beforeEach(() => {
  capturedPrompts = [];
  nextResponse = '{"score": 4, "explanation": "good"}';
  generateError = null;
  sdkMissing = false;
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.GOOGLE_EVALUATOR_MODEL;
  configureGoogle();

  originalLoad = (Module as any)._load;
  (Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request === "@google-cloud/vertexai") {
      if (sdkMissing) {
        const error: any = new Error(`Cannot find module '${request}'`);
        error.code = "MODULE_NOT_FOUND";
        throw error;
      }
      return { VertexAI: FakeVertexAI };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
});

afterEach(() => {
  (Module as any)._load = originalLoad;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  configureGoogle();
});

// ── helpers ──

describe("google adapter helpers", () => {
  it("parses a JSON pointwise response", () => {
    const parsed = parsePointwiseResponse('{"score": 4, "explanation": "solid"}');
    assert.equal(parsed.score, 4);
    assert.equal(parsed.reason, "solid");
  });

  it("parses JSON embedded in prose", () => {
    const parsed = parsePointwiseResponse('Here it is: {"score": "3", "explanation": "partial"} thanks');
    assert.equal(parsed.score, 3);
    assert.equal(parsed.reason, "partial");
  });

  it("falls back to Score/Explanation text", () => {
    const parsed = parsePointwiseResponse("Score: 2\nExplanation: weak");
    assert.equal(parsed.score, 2);
    assert.equal(parsed.reason, "weak");
  });

  it("builds a custom pointwise prompt with criteria and rubric", () => {
    const prompt = buildCustomPrompt("Be friendly", "hi", "hello", 5);
    assert.ok(prompt.includes("criteria: Be friendly"));
    assert.ok(prompt.includes("5: Excellent"));
    assert.ok(prompt.includes("1: Poor"));
    assert.ok(prompt.includes("### Prompt\nhi"));
    assert.ok(prompt.includes("hello"));
    assert.ok(prompt.includes("# Output Format"));
    assert.ok(prompt.includes("between 1 and 5"));
  });
});

// ── llm_judge ──

describe("google llm_judge", () => {
  it("normalizes a Likert score and passes", async () => {
    const result = await googleAdapter(TRACE, {
      type: "llm_judge",
      criteria: "x",
      rating_scale: "1-5",
      threshold: 0.8,
    });
    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    assert.equal(result.passed, true);
    assert.match(result.reason, /^\[llm_judge\]/);
    assert.equal(result.adapter, "google");
    assert.ok(capturedPrompts[0].includes("criteria: x"));
  });

  it("fails below the threshold", async () => {
    nextResponse = '{"score": 2, "explanation": "weak"}';
    const result = await googleAdapter(TRACE, { type: "llm_judge", criteria: "x", threshold: 0.8 });
    assert.equal(result.passed, false);
    assert.ok(Math.abs(result.score - 0.4) < 1e-9);
  });
});

// ── managed + safety ──

describe("google managed evaluators", () => {
  it("runs groundedness with the official template", async () => {
    nextResponse = '{"score": 5, "explanation": "grounded"}';
    const result = await googleAdapter(TRACE, {
      type: "Groundedness",
      query: "user.says",
      context: "self",
      response: "self",
      threshold: 0.8,
    });
    assert.equal(result.type, "Groundedness");
    assert.equal(result.score, 1);
    assert.equal(result.passed, true);
    assert.match(result.reason, /^\[groundedness\]/);
    assert.ok(capturedPrompts[0].toLowerCase().includes("groundedness"));
    assert.ok(capturedPrompts[0].includes("Where is order 123?"));
    assert.ok(capturedPrompts[0].includes("It is on the way"));
  });

  it("normalizes a 1-5 fluency score", async () => {
    nextResponse = '{"score": 4, "explanation": "fluent"}';
    const result = await googleAdapter(TRACE, { type: "Fluency", response: "self", threshold: 0.7 });
    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    assert.equal(result.passed, true);
    assert.match(result.reason, /^\[fluency\]/);
    assert.ok(capturedPrompts[0].toLowerCase().includes("fluency"));
  });

  it("treats safety as a binary 0/1 metric", async () => {
    nextResponse = '{"score": 0, "explanation": "unsafe"}';
    const failed = await googleAdapter(TRACE, { type: "Violence", response: "self", threshold: 0.9 });
    assert.equal(failed.score, 0);
    assert.equal(failed.passed, false);

    nextResponse = '{"score": 1, "explanation": "safe"}';
    const passed = await googleAdapter(TRACE, { type: "Violence", response: "self", threshold: 0.9 });
    assert.equal(passed.score, 1);
    assert.equal(passed.passed, true);
    assert.ok(capturedPrompts[1].toLowerCase().includes("safety"));
  });
});

// ── custom ──

describe("google custom", () => {
  it("runs a custom metric with its own criteria", async () => {
    nextResponse = '{"score": 4, "explanation": "polite"}';
    const result = await googleAdapter(TRACE, {
      type: "custom",
      id: "my-org.tone",
      criteria: "The tone is polite",
      threshold: 0.8,
    });
    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    assert.equal(result.passed, true);
    assert.match(result.reason, /^\[my-org\.tone\]/);
    assert.ok(capturedPrompts[0].includes("criteria: The tone is polite"));
  });

  it("requires criteria or prompt", async () => {
    const result = await googleAdapter(TRACE, { type: "custom", id: "my-org.x" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "evaluator.missing_input");
    assert.match(result.reason, /requires a 'criteria'/);
  });
});

// ── errors ──

describe("google errors", () => {
  it("reports a clear not-configured error without a project", async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    configureGoogle();
    const result = await googleAdapter(TRACE, { type: "Groundedness", response: "self" });
    assert.equal(result.code, "adapter.not_configured");
    assert.match(result.reason, /GOOGLE_CLOUD_PROJECT/);
  });

  it("reports a clear not-configured error when the SDK is missing", async () => {
    sdkMissing = true;
    const result = await googleAdapter(TRACE, { type: "llm_judge", criteria: "x" });
    assert.equal(result.code, "adapter.not_configured");
  });

  it("reports generation failures as adapter.error", async () => {
    generateError = new Error("PERMISSION_DENIED");
    const result = await googleAdapter(TRACE, { type: "Fluency", response: "self" });
    assert.equal(result.code, "adapter.error");
    assert.match(result.reason, /PERMISSION_DENIED/);
  });

  it("rejects unsupported evaluator types", async () => {
    const result = await googleAdapter(TRACE, { type: "sequence", order: [] });
    assert.equal(result.code, "adapter.unsupported_type");
  });
});
