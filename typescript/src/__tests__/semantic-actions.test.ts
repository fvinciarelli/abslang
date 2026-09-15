/**
 * Semantic action annotation — chain selectors match exact actions.
 *
 * The runner records text responses as `responds` and annotates the step with the
 * action of the first communication behavior that matched it. `matchesSelector`
 * then compares exactly (EVALUATIONS.md), so `never asks` no longer matches any
 * assistant message.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

/** Mock agent that answers with `texts[requestIndex]` (last one repeats). */
function scriptedAgent(texts: string[]) {
  return startServer((_req, res, index) => {
    const text = texts[Math.min(index, texts.length - 1)];
    sendJson(res, { choices: [{ message: { role: "assistant", content: text } }] });
  }, "/chat");
}

describe("semantic action annotation", () => {
  it("does not fire `never asks` when the agent informs", async () => {
    const srv = await scriptedAgent(["Hello from the agent"]);
    try {
      const session = parse(`
session: Inform is not an ask
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "Hello from the agent"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.chainEvaluations[0].type, "never");
      assert.equal(result.chainEvaluations[0].passed, true);
    } finally {
      await srv.close();
    }
  });

  it("fires `never asks` when the agent asks and a behavior classifies it", async () => {
    const srv = await scriptedAgent(["Please provide your order number"]);
    try {
      const session = parse(`
session: Ask is an ask
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "hi"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, false);
      assert.equal(result.chainEvaluations[0].passed, false);
    } finally {
      await srv.close();
    }
  });

  it("supports `sequence` over semantic communication actions", async () => {
    const srv = await scriptedAgent([
      "Please provide your order number",
      "Your order is on the way",
    ]);
    try {
      const session = parse(`
session: Sequence over asks then informs
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - actor: assistant
    action: asks
    content: "Please provide your order number"
  - actor: user
    action: says
    content: "8291"
  - actor: assistant
    action: informs
    content: "Your order is on the way"
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: informs }
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.chainEvaluations[0].passed, true);
    } finally {
      await srv.close();
    }
  });
});
