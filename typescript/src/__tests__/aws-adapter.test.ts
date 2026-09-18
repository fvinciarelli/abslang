/// <reference types="node" />

/**
 * AWS Bedrock adapter tests — SDK mocked via Module._load, no boto3/AWS needed.
 *
 * Mirrors python/tests/test_aws_adapter.py: parsing, normalization, prompt
 * interpolation, llm_judge, custom metrics, and error handling.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ObservedStep } from "../evaluators/builtin";
import {
  awsAdapter,
  awsNormalize,
  awsScaleMax,
  configureAws,
  interpolateAwsPrompt,
  parseAwsJudgeResponse,
} from "../evaluators/adapters/aws";

const Module = require("module");

const TRACE: ObservedStep[] = [
  { actor: "user", action: "says", content: "Where is order 123?" },
  { actor: "assistant", action: "informs", content: "It is on the way" },
];

interface ConverseInput {
  modelId: string;
  system: { text: string }[];
  messages: { role: string; content: { text: string }[] }[];
}

let captured: ConverseInput[] = [];
let nextResponse = "Score: 0.8\nReason: good";
let sendError: Error | null = null;
let sdkMissing = false;
let originalLoad: any;

class FakeConverseCommand {
  input: ConverseInput;
  constructor(input: ConverseInput) {
    this.input = input;
  }
}

class FakeBedrockRuntimeClient {
  config: any;
  constructor(config: any = {}) {
    this.config = config;
  }
  async send(command: FakeConverseCommand) {
    captured.push(command.input);
    if (sendError) throw sendError;
    return { output: { message: { content: [{ text: nextResponse }] } } };
  }
}

beforeEach(() => {
  captured = [];
  nextResponse = "Score: 0.8\nReason: good";
  sendError = null;
  sdkMissing = false;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.AWS_PROFILE;
  delete process.env.BEDROCK_EVALUATOR_MODEL_ID;
  configureAws();

  originalLoad = (Module as any)._load;
  (Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request === "@aws-sdk/client-bedrock-runtime") {
      if (sdkMissing) {
        const error: any = new Error(`Cannot find module '${request}'`);
        error.code = "MODULE_NOT_FOUND";
        throw error;
      }
      return { BedrockRuntimeClient: FakeBedrockRuntimeClient, ConverseCommand: FakeConverseCommand };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
});

afterEach(() => {
  (Module as any)._load = originalLoad;
  configureAws();
});

// ── parsing / normalization ──

describe("aws adapter helpers", () => {
  it("parses Score and Reason", () => {
    const { score, reason } = parseAwsJudgeResponse("Score: 4\nReason: nice work");
    assert.equal(score, 4);
    assert.equal(reason, "nice work");
  });

  it("returns null for a missing score", () => {
    assert.equal(parseAwsJudgeResponse("no score here").score, null);
  });

  it("reads the rating scale max", () => {
    assert.equal(awsScaleMax("1-5"), 5);
    assert.equal(awsScaleMax("0-1"), 1);
    assert.equal(awsScaleMax(10), 10);
  });

  it("normalizes Likert and unit scales", () => {
    assert.ok(Math.abs(awsNormalize(4, 5) - 0.8) < 1e-9);
    assert.ok(Math.abs(awsNormalize(0.6, 1) - 0.6) < 1e-9);
  });

  it("interpolates response, query and criteria", () => {
    const out = interpolateAwsPrompt(
      "Response: {{response}} | q={{query}} | c={{criteria}}",
      { query: "user.says", criteria: "friendly" },
      TRACE,
      "It is on the way"
    );
    assert.ok(out.includes("It is on the way"));
    assert.ok(out.includes("Where is order 123?"));
    assert.ok(out.includes("friendly"));
  });
});

// ── llm_judge ──

describe("aws llm_judge", () => {
  it("passes at the threshold and calls the default model", async () => {
    nextResponse = "Score: 0.8\nReason: good";
    const result = await awsAdapter(TRACE, { type: "llm_judge", criteria: "x", threshold: 0.8 });

    assert.equal(result.passed, true);
    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    assert.match(result.reason, /^\[aws\]/);
    assert.equal(result.adapter, "aws");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].modelId, "anthropic.claude-3-5-haiku-20241022-v1:0");
    assert.ok(captured[0].system[0].text.includes("expert evaluator"));
    assert.ok(captured[0].messages[0].content[0].text.includes("x"));
  });

  it("fails below the threshold", async () => {
    nextResponse = "Score: 0.3\nReason: weak";
    const result = await awsAdapter(TRACE, { type: "llm_judge", criteria: "x", threshold: 0.8 });
    assert.equal(result.passed, false);
  });

  it("reports an unparseable score as adapter.error", async () => {
    nextResponse = "garbage";
    const result = await awsAdapter(TRACE, { type: "llm_judge", criteria: "x" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "adapter.error");
    assert.match(result.reason, /could not parse/i);
  });

  it("honors BEDROCK_EVALUATOR_MODEL_ID", async () => {
    process.env.BEDROCK_EVALUATOR_MODEL_ID = "meta.llama3-70b-instruct-v1:0";
    await awsAdapter(TRACE, { type: "llm_judge", criteria: "x" });
    assert.equal(captured[0].modelId, "meta.llama3-70b-instruct-v1:0");
  });
});

// ── custom ──

describe("aws custom", () => {
  it("normalizes a 1-5 custom metric", async () => {
    nextResponse = "Score: 4\nReason: good tone";
    const result = await awsAdapter(TRACE, {
      type: "custom",
      id: "aws.tone",
      prompt: "Rate tone ({{response}})",
      rating_scale: "1-5",
      threshold: 0.8,
    });
    assert.ok(Math.abs(result.score - 0.8) < 1e-9);
    assert.equal(result.passed, true);
    assert.match(result.reason, /^\[aws:aws\.tone\]/);
    assert.ok(captured[0].messages[0].content[0].text.includes("It is on the way"));
  });

  it("keeps a 0-1 scale unnormalized", async () => {
    nextResponse = "Score: 0.6\nReason: ok";
    const result = await awsAdapter(TRACE, {
      type: "custom",
      id: "aws.helpful",
      prompt: "Rate helpfulness",
      rating_scale: "0-1",
      threshold: 0.5,
    });
    assert.ok(Math.abs(result.score - 0.6) < 1e-9);
    assert.equal(result.passed, true);
  });

  it("requires a prompt or criteria", async () => {
    const result = await awsAdapter(TRACE, { type: "custom", id: "aws.x" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "evaluator.missing_input");
    assert.match(result.reason, /requires a 'prompt'/);
  });
});

// ── errors ──

describe("aws errors", () => {
  it("reports a clear not-configured error when the SDK is missing", async () => {
    sdkMissing = true;
    const result = await awsAdapter(TRACE, { type: "llm_judge", criteria: "x" });
    assert.equal(result.passed, false);
    assert.equal(result.code, "adapter.not_configured");
    assert.match(result.reason, /not configured/i);
  });

  it("reports Bedrock failures as adapter.error", async () => {
    sendError = new Error("ThrottlingException");
    const result = await awsAdapter(TRACE, { type: "llm_judge", criteria: "x" });
    assert.equal(result.code, "adapter.error");
    assert.match(result.reason, /ThrottlingException/);
  });

  it("rejects unsupported evaluator types", async () => {
    const result = await awsAdapter(TRACE, { type: "sequence", order: [] });
    assert.equal(result.code, "adapter.unsupported_type");
  });
});
