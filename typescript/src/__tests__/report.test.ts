/// <reference types="node" />

/**
 * The JSON report shape must stay identical in TypeScript and Python
 * (python/src/abslang/report.py). These tests pin the Python-compatible keys.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { serializeEval, serializeObserved } from "../report";

describe("report serialization", () => {
  it("renames durationMs to duration_ms and keeps blocking flags", () => {
    const ev = serializeEval({
      type: "Groundedness",
      passed: false,
      score: 0.4,
      reason: "score below threshold",
      threshold: 0.8,
      adapter: "azure",
      code: "evaluator.threshold_not_met",
      durationMs: 412,
    });
    assert.deepEqual(ev, {
      type: "Groundedness",
      passed: false,
      score: 0.4,
      reason: "score below threshold",
      blocking: false,
      inconclusive: false,
      code: "evaluator.threshold_not_met",
      threshold: 0.8,
      adapter: "azure",
      duration_ms: 412,
    });
    assert.ok(!("durationMs" in ev), "camelCase duration must not leak into reports");
    assert.ok(!("details" in ev), "unset fields must be omitted");
  });

  it("keeps details and flags when present", () => {
    const ev = serializeEval({
      type: "llm_judge",
      passed: false,
      score: 0,
      reason: "unsafe",
      blocking: true,
      inconclusive: true,
      details: { raw: { verdict: "unsafe" } },
    });
    assert.equal(ev.blocking, true);
    assert.equal(ev.inconclusive, true);
    assert.deepEqual(ev.details, { raw: { verdict: "unsafe" } });
  });

  it("serializes observed steps, including tool-call arguments", () => {
    const obs = serializeObserved({
      actor: "assistant",
      action: "calls",
      target: "Order MCP",
      with: { orderId: "12345" },
      tool_call_id: "call_1",
      content: null,
      id: "internal-step-id",
    });
    assert.deepEqual(obs, {
      actor: "assistant",
      action: "calls",
      target: "Order MCP",
      with: { orderId: "12345" },
      tool_call_id: "call_1",
    });
    assert.equal(serializeObserved(null), null);
  });
});
