/**
 * Step-level evaluations attached to `tool responds` behaviors must run.
 *
 * Regression: the tool branch used to build a StepResult with `evaluations: []`,
 * silently dropping schema/contains/exact_match/etc. on tool responses.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse } from "../parser";
import { run } from "../runner";
import { startServer, sendJson } from "./http-helpers";

function session(toolContent: string) {
  return parse(`
session: Tool responds evaluations
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content: ${toolContent}
    evaluations:
      - type: schema
        schema:
          type: object
          required: [status]
          properties:
            status: { type: string }

  - actor: assistant
    action: informs
    content: "ok"
`);
}

async function runWithToolResponse(toolContent: string) {
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
      sendJson(res, { choices: [{ message: { role: "assistant", content: "ok" } }] });
    }
  });

  try {
    return await run(session(toolContent), { url: srv.url });
  } finally {
    await srv.close();
  }
}

describe("tool responds evaluations", () => {
  it("runs a schema evaluation on the tool response", async () => {
    const result = await runWithToolResponse('{ status: "in_transit" }');

    assert.equal(result.passed, true);
    assert.equal(result.evaluationsTotal, 1);
    assert.equal(result.evaluationsPassed, 1);

    const toolStep = result.steps.find((step) => step.behavior.actor === "tool");
    assert.ok(toolStep, "tool step should exist");
    assert.equal(toolStep!.evaluations.length, 1);
    assert.equal(toolStep!.evaluations[0].type, "schema");
    assert.equal(toolStep!.evaluations[0].passed, true);
  });

  it("fails the run when the tool response violates the schema", async () => {
    const result = await runWithToolResponse('{ eta: "2026-01-01" }');

    assert.equal(result.passed, false);
    assert.equal(result.evaluationsTotal, 1);
    assert.equal(result.evaluationsPassed, 0);

    const toolStep = result.steps.find((step) => step.behavior.actor === "tool");
    assert.ok(toolStep, "tool step should exist");
    assert.equal(toolStep!.evaluations[0].type, "schema");
    assert.equal(toolStep!.evaluations[0].passed, false);
    assert.match(toolStep!.evaluations[0].reason, /Missing required field: "status"/);
  });
});
