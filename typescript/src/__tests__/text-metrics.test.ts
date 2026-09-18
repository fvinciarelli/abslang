/// <reference types="node" />

/**
 * Reference-based text metrics (f1, bleu, rouge) and ground_truth resolution.
 *
 * The vectors are shared with the Python implementation
 * (python/tests/test_text_metrics.py): both implementations must produce the
 * same scores for the same inputs.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  ObservedStep,
  applyThreshold,
  bleuMetric,
  evaluateStep,
  f1ScoreMetric,
  rougeMetric,
} from "../evaluators/builtin";
import { parseYaml, expandFragments, resolveVariables } from "../parser";

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-5, `expected ${expected}, got ${actual}`);
}

// [response, ground_truth, f1, bleu, rougeL]
const VECTORS: [string, string, number, number, number][] = [
  ["The cat sat on the mat", "The cat sat on the mat", 1.0, 1.0, 1.0],
  ["The cat sat on the mat", "The cat is on the mat", 0.833333, 0.488923, 0.833333],
  ["The cat sat on the mat", "A dog runs in the park", 0.166667, 0.220896, 0.166667],
  ["paris is the capital of france", "the capital of france is paris", 1.0, 0.66874, 0.666667],
  ["short answer", "a much longer reference answer with many extra words", 0.181818, 0.017434, 0.181818],
  ["", "something", 0.0, 0.0, 0.0],
];

describe("reference-based text metrics", () => {
  for (const [response, groundTruth, f1, bleu, rougeL] of VECTORS) {
    it(`f1  ${JSON.stringify(response).slice(0, 40)}`, () => {
      const [score, details] = f1ScoreMetric(response, groundTruth);
      close(score, f1);
      close(details.f1, f1);
    });

    it(`bleu ${JSON.stringify(response).slice(0, 40)}`, () => {
      const [score] = bleuMetric(response, groundTruth);
      close(score, bleu);
    });

    it(`rougeL ${JSON.stringify(response).slice(0, 40)}`, () => {
      const [score, details] = rougeMetric(response, groundTruth, "rougeL");
      close(score, rougeL);
      assert.equal(details.variant, "rougeL");
    });
  }
});

describe("evaluateStep with ground_truth", () => {
  const observed = (content: unknown): ObservedStep => ({ actor: "assistant", action: "informs", content });

  it("uses the declared behavior content for ground_truth: self", () => {
    const behavior: any = {
      actor: "assistant",
      action: "informs",
      content: "The cat sat on the mat",
      evaluations: [{ type: "f1", ground_truth: "self", threshold: 0.9 }],
    };
    const result = applyThreshold(
      evaluateStep(observed("The cat sat on the mat"), behavior.evaluations[0], [behavior], [observed("x")], behavior),
      behavior.evaluations[0]
    );
    assert.equal(result.passed, true);
    close(result.score, 1);
    assert.equal(result.threshold, 0.9);
  });

  it("resolves a behavior-id reference from the trace", () => {
    const trace: ObservedStep[] = [
      { actor: "user", action: "says", content: "where is my order" },
      { actor: "tool", action: "responds", id: "kb", content: "The order shipped today" },
      { actor: "assistant", action: "informs", content: "Your order shipped today" },
    ];
    const rule = { type: "f1", ground_truth: "kb.responds", response: "self" };
    const result = evaluateStep(trace[2], rule, [], trace);
    assert.ok(result.score > 0.7, `score ${result.score}`);
  });

  it("fails clearly when ground_truth is missing", () => {
    const result = evaluateStep(observed("x"), { type: "bleu" }, [], []);
    assert.equal(result.passed, false);
    assert.equal(result.code, "evaluator.missing_input");
  });

  it("rejects unknown rouge variants", () => {
    const result = evaluateStep(observed("x"), { type: "rouge", ground_truth: "x", variant: "rouge9" }, [], []);
    assert.equal(result.code, "evaluator.invalid_option");
  });

  it("supports the rouge metric selector", () => {
    const result = evaluateStep(
      observed("the cat"),
      { type: "rouge", ground_truth: "the cat sat", variant: "rouge1", metric: "recall" },
      [],
      []
    );
    close(result.score, 2 / 3);
    assert.equal(result.details!.metric, "recall");
    close(result.details!.f1, 0.8);
  });

  it("sets a stable code when the threshold is not met", () => {
    const rule = { type: "f1", ground_truth: "a b c d", threshold: 0.99 };
    const result = applyThreshold(evaluateStep(observed("a b"), rule, [], []), rule);
    assert.equal(result.passed, false);
    assert.equal(result.code, "evaluator.threshold_not_met");
    assert.equal(result.threshold, 0.99);
  });
});

describe("variable resolution inside evaluations", () => {
  it("resolves {{dataset.column}} in evaluation fields", () => {
    const docs = parseYaml(
      [
        "session: t",
        "behaviors:",
        "  - actor: assistant",
        "    action: informs",
        "    content: '{{cases.answer}}'",
        "    evaluations:",
        "      - type: f1",
        "        ground_truth: '{{cases.expected}}'",
      ].join("\n")
    );
    const resolved = resolveVariables(expandFragments(docs[0]).behaviors, {
      "cases.answer": "refund approved",
      "cases.expected": "refund approved",
    });
    assert.equal((resolved[0].evaluations![0] as any).ground_truth, "refund approved");

    const obs: ObservedStep = { actor: "assistant", action: "informs", content: "refund approved" };
    const result = evaluateStep(obs, resolved[0].evaluations![0], resolved, [obs], resolved[0]);
    close(result.score, 1);
  });
});
