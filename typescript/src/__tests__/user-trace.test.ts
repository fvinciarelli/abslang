/**
 * User turns are part of the observed trace.
 *
 * Chain selectors documented in EVALUATIONS.md (e.g. `within` with
 * `after: { actor: user, action: says }`) need the user messages the runner sent.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

function scriptedAgent(texts: string[]) {
  return startServer((_req, res, index) => {
    const text = texts[Math.min(index, texts.length - 1)];
    sendJson(res, { choices: [{ message: { role: "assistant", content: text } }] });
  }, "/chat");
}

describe("user turns in the observed trace", () => {
  it("supports sequence, within and count over user actions", async () => {
    const srv = await scriptedAgent([
      "Please provide your order number",
      "Your order is on the way",
    ]);
    try {
      const session = parse(`
session: User turns in chain selectors
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
      - { actor: user, action: says }
      - { actor: assistant, action: asks }
      - { actor: user, action: says }
      - { actor: assistant, action: informs }
  - type: within
    after: { actor: user, action: says }
    match: { actor: assistant, action: asks }
    max_steps: 3
  - type: count
    match: { actor: user, action: says }
    min: 2
    max: 2
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.chainEvaluations.length, 3);
      for (const ev of result.chainEvaluations) {
        assert.equal(ev.passed, true, `${ev.type}: ${ev.reason}`);
      }
      assert.equal(result.passed, true);
    } finally {
      await srv.close();
    }
  });

  it("keeps behavior matching aligned after a user step joins the trace", async () => {
    const srv = await scriptedAgent(["Hello from the agent"]);
    try {
      const session = parse(`
session: Matching still aligned
behaviors:
  - actor: user
    action: says
    content: "hi"
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.steps[0].sent, true);
      assert.equal(result.steps[1].matched, true);
    } finally {
      await srv.close();
    }
  });
});
