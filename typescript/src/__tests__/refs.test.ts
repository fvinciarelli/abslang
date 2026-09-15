/**
 * Behavior ids on the observed trace + reference resolution.
 *
 * The runner annotates matched steps with the behavior's id, so adapters can
 * resolve `user_asks.says`, `kb_result.responds`, ... against a real trace.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ObservedStep, registerAdapter } from "../evaluators/builtin";
import { resolveRef } from "../evaluators/trace_utils";
import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

const ANNOTATED: ObservedStep[] = [
  { actor: "user", action: "says", id: "user_asks", content: "Where is order 123?" },
  { actor: "assistant", action: "calls", id: "lookup", target: "Order MCP", with: { orderId: "123" } },
  { actor: "tool", action: "responds", id: "kb_result", target: "Order MCP", content: { status: "shipped" } },
  { actor: "assistant", action: "informs", id: "answer", content: "It is on the way" },
];

describe("resolveRef", () => {
  it("resolves behavior-id references", () => {
    assert.equal(resolveRef(ANNOTATED, "user_asks.says"), "Where is order 123?");
    assert.equal(resolveRef(ANNOTATED, "kb_result.responds"), '{"status":"shipped"}');
    assert.equal(resolveRef(ANNOTATED, "answer.informs"), "It is on the way");
  });

  it("uses the actor default action for a bare behavior id", () => {
    assert.equal(resolveRef(ANNOTATED, "kb_result"), '{"status":"shipped"}');
  });

  it("keeps legacy actor references working", () => {
    assert.equal(resolveRef(ANNOTATED, "user.says"), "Where is order 123?");
    assert.equal(resolveRef(ANNOTATED, "assistant.says"), "It is on the way"); // comm equivalence
  });

  it("returns the raw ref when nothing matches", () => {
    assert.equal(resolveRef(ANNOTATED, "nope.says"), "nope.says");
    assert.equal(resolveRef(ANNOTATED, "answer.says"), "answer.says");
  });
});

const captured: { trace: ObservedStep[] } = { trace: [] };

registerAdapter("custom", async (trace) => {
  captured.trace = trace;
  return { type: "custom", passed: true, score: 1, reason: "captured" };
});

describe("behavior ids in a real run", () => {
  it("annotates the trace and resolves the documented refs", async () => {
    const srv = await startServer((_req, res, index) => {
      if (index === 0) {
        sendJson(res, {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "Order MCP", arguments: '{"orderId":"12345"}' },
                  },
                ],
              },
            },
          ],
        });
      } else {
        sendJson(res, {
          choices: [{ message: { role: "assistant", content: "Your order is on the way" } }],
        });
      }
    }, "/chat");

    try {
      const session = parse(`
session: Order status with ids
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "Where is order 12345?"
  - id: lookup
    actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"
  - id: kb_result
    actor: tool
    action: responds
    target: Order MCP
    content:
      status: "shipped"
  - id: answer
    actor: assistant
    action: informs
    content: "Your order is on the way"
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls }
      - { actor: tool, action: responds }
      - { actor: assistant, action: informs }
  - type: custom
`);
      const result = await run(session, { url: srv.url });

      assert.equal(result.passed, true);
      const seq = result.chainEvaluations.find((e) => e.type === "sequence");
      assert.equal(seq?.passed, true, seq?.reason);
      assert.deepEqual(
        captured.trace.map((s) => s.id),
        ["user_asks", "lookup", "kb_result", "answer"]
      );
      assert.deepEqual(
        captured.trace.map((s) => [s.actor, s.action]),
        [
          ["user", "says"],
          ["assistant", "calls"],
          ["tool", "responds"],
          ["assistant", "informs"],
        ]
      );
      assert.equal(resolveRef(captured.trace, "user_asks.says"), "Where is order 12345?");
      assert.equal(resolveRef(captured.trace, "kb_result.responds"), '{"status":"shipped"}');
      assert.equal(resolveRef(captured.trace, "kb_result"), '{"status":"shipped"}');
      assert.equal(resolveRef(captured.trace, "answer.informs"), "Your order is on the way");
    } finally {
      await srv.close();
    }
  });
});
