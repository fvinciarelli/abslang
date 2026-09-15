/**
 * v0.2 optional matching — §7.7: optionals never consume an observed step.
 *
 * A skipped optional must not shift the cursor: the next required behavior still
 * matches the same agent response. A matched optional must not consume either, so
 * several optionals can activate from one response.
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

describe("optional behaviors and the observed trace cursor", () => {
  it("lets the next required behavior match after a skipped optional", async () => {
    const srv = await scriptedAgent(["Hello from the agent"]);
    try {
      const session = parse(`
session: Skipped optional
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
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.steps[1].skipped, true);
      assert.equal(result.steps[2].matched, true);
      assert.equal(srv.requests.length, 1);
    } finally {
      await srv.close();
    }
  });

  it("matches the reply to a user turn activated by a matched optional", async () => {
    const srv = await scriptedAgent([
      "Please provide your order number",
      "Your order is on the way",
    ]);
    try {
      const session = parse(`
session: Matched optional
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order number"
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.steps[1].matched, true);
      assert.equal(result.steps[2].sent, true); // user send consumed
      assert.equal(result.steps[3].matched, true);
      assert.equal(srv.requests.length, 2);
    } finally {
      await srv.close();
    }
  });

  it("activates several optionals from a single agent response (§7.7)", async () => {
    const srv = await scriptedAgent([
      "I need your order ID and your email",
      "Got it",
      "Your order is on the way",
    ]);
    try {
      const session = parse(`
session: Multiple optionals
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "order ID"
  - id: ask_email
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: contains
      value: "email"
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - id: user_gives_email
    actor: user
    action: says
    content: "franco@mail.com"
    requires: ask_email
  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.steps[1].matched, true); // ask_id
      assert.equal(result.steps[2].matched, true); // ask_email — same response
      assert.equal(result.steps[5].matched, true); // final answer
      assert.equal(srv.requests.length, 3);
    } finally {
      await srv.close();
    }
  });

  it("keeps the cursor after a requires-gated user turn is skipped", async () => {
    const srv = await scriptedAgent(["Hello from the agent"]);
    try {
      const session = parse(`
session: Gated user turn
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
  - id: user_gives_id
    actor: user
    action: says
    content: "8291"
    requires: ask_id
  - actor: assistant
    action: informs
    content: "Hello from the agent"
    evaluations:
      - type: contains
        value: "Hello"
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      assert.equal(result.steps[1].skipped, true);
      assert.equal(result.steps[2].skipped, true); // gated user turn, never sent
      assert.equal(result.steps[3].matched, true);
      assert.equal(srv.requests.length, 1);
    } finally {
      await srv.close();
    }
  });
});
