/**
 * traceToText — the transcript rendering used by judges/adapters.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ObservedStep } from "../evaluators/builtin";
import { traceToText } from "../evaluators/trace_utils";

describe("traceToText", () => {
  it("renders tool-call arguments instead of an empty content", () => {
    const trace: ObservedStep[] = [
      { actor: "user", action: "says", content: "Where is order 123?" },
      { actor: "assistant", action: "calls", target: "Order MCP", with: { orderId: "123" } },
      { actor: "tool", action: "responds", target: "Order MCP", content: { status: "shipped" } },
      { actor: "assistant", action: "informs", content: "It is on the way" },
    ];

    assert.equal(
      traceToText(trace),
      [
        "[user] says: Where is order 123?",
        '[assistant] calls → Order MCP: {"orderId":"123"}',
        '[tool] responds → Order MCP: {"status":"shipped"}',
        "[assistant] informs: It is on the way",
      ].join("\n")
    );
    assert.doesNotMatch(traceToText(trace), /undefined/);
  });

  it("omits the payload for steps without content or arguments", () => {
    assert.equal(traceToText([{ actor: "assistant", action: "responds" }]), "[assistant] responds");
  });
});
