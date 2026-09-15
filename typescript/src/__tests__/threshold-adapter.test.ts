/**
 * Adapter results must honor the evaluation-level `threshold`.
 *
 * The adapter below always returns score 0.9 with passed=true and never looks
 * at the threshold, so the runner is the one that must apply it (step-level
 * and session-level).
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { registerAdapter } from "../evaluators/builtin";
import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

registerAdapter("custom", async () => ({
  type: "custom",
  passed: true,
  score: 0.9,
  reason: "adapter says pass",
}));

describe("threshold on adapter results", () => {
  it("applies the threshold at step and session level", async () => {
    const srv = await startServer(
      (_req, res) =>
        sendJson(res, { choices: [{ message: { role: "assistant", content: "Hello" } }] }),
      "/chat"
    );
    try {
      const session = parse(`
session: Threshold on adapter results
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    evaluations:
      - type: custom
        threshold: 0.95
      - type: custom
        threshold: 0.5
evaluations:
  - type: custom
    threshold: 0.95
  - type: custom
    threshold: 0.5
`);
      const result = await run(session, { url: srv.url });

      const stepEvals = result.steps[1].evaluations;
      assert.deepEqual(
        stepEvals.map((e) => e.passed),
        [false, true],
        `step eval results: ${JSON.stringify(stepEvals)}`
      );
      assert.match(stepEvals[0].reason, /threshold 0\.95/);

      assert.deepEqual(
        result.chainEvaluations.map((e) => e.passed),
        [false, true],
        `chain eval results: ${JSON.stringify(result.chainEvaluations)}`
      );

      assert.equal(result.passed, false);
    } finally {
      await srv.close();
    }
  });
});
