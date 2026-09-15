/**
 * Spike — OpenAI Responses API adapter + Authorization forwarding.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse } from "../parser";
import {
  AgentConfig,
  responsesAdapter,
  openaiAdapter,
  run,
  buildAuthHeaders,
  resolveForwardedAuthorization,
  parseResponsesOutput,
  applyResponsesEvent,
  toResponsesInput,
  responsesStateToMessage,
  ResponsesStreamState,
} from "../runner";
import { startServer, sendSse } from "./http-helpers";

const emptyState = (): ResponsesStreamState => ({
  text: "",
  calls: new Map(),
  order: [],
  completed: null,
});

// ── auth headers ──

describe("buildAuthHeaders", () => {
  it("sends bearer token from explicit auth", () => {
    const headers = buildAuthHeaders({ url: "x", auth: "bearer", token: "tok" }, {});
    assert.deepEqual(headers, { Authorization: "Bearer tok" });
  });

  it("sends X-API-Key for api_key auth", () => {
    const headers = buildAuthHeaders({ url: "x", auth: "api_key", token: "k" }, {});
    assert.deepEqual(headers, { "X-API-Key": "k" });
  });

  it("forwards a raw Authorization value from config", () => {
    const headers = buildAuthHeaders({ url: "x", authorization: "Bearer incoming" }, {});
    assert.deepEqual(headers, { Authorization: "Bearer incoming" });
  });

  it("normalizes a bare forwarded token to Bearer", () => {
    const headers = buildAuthHeaders({ url: "x", forwardAuth: true, authorization: "eyJ.crud" }, {});
    assert.deepEqual(headers, { Authorization: "Bearer eyJ.crud" });
  });

  it("forwards from ABS_AGENT_AUTHORIZATION env", () => {
    const headers = buildAuthHeaders({ url: "x", forwardAuth: true }, {
      ABS_AGENT_AUTHORIZATION: "Bearer from-env",
    });
    assert.deepEqual(headers, { Authorization: "Bearer from-env" });
  });

  it("forwards from HTTP_AUTHORIZATION env", () => {
    const headers = buildAuthHeaders({ url: "x", forwardAuth: true }, {
      HTTP_AUTHORIZATION: "Bearer http-env",
    });
    assert.deepEqual(headers, { Authorization: "Bearer http-env" });
  });

  it("falls back to ABS_AGENT_TOKEN", () => {
    const headers = buildAuthHeaders({ url: "x", forwardAuth: true }, {
      ABS_AGENT_TOKEN: "token-env",
    });
    assert.deepEqual(headers, { Authorization: "Bearer token-env" });
  });

  it("explicit token wins over forwarding", () => {
    const headers = buildAuthHeaders(
      { url: "x", auth: "bearer", token: "explicit", forwardAuth: true },
      { HTTP_AUTHORIZATION: "Bearer inbound" }
    );
    assert.deepEqual(headers, { Authorization: "Bearer explicit" });
  });

  it("throws when forwarding is enabled but no value exists", () => {
    assert.throws(
      () => resolveForwardedAuthorization({ forwardAuth: true }, {}),
      /forwarding is enabled but no value/
    );
  });
});

// ── request translation ──

describe("toResponsesInput", () => {
  it("moves system messages to instructions", () => {
    const { instructions, input } = toResponsesInput([
      { role: "system", content: "Be nice" },
      { role: "user", content: "Hi" },
    ]);
    assert.equal(instructions, "Be nice");
    assert.deepEqual(input, [{ role: "user", content: "Hi" }]);
  });

  it("translates assistant tool calls and tool outputs", () => {
    const { input } = toResponsesInput([
      { role: "user", content: "Where is my order?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "Order MCP", arguments: '{"orderId":"1"}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", name: "Order MCP", content: '{"status":"shipped"}' },
    ]);
    assert.deepEqual(input[1], {
      type: "function_call",
      call_id: "call_1",
      name: "Order MCP",
      arguments: '{"orderId":"1"}',
    });
    assert.deepEqual(input[2], {
      type: "function_call_output",
      call_id: "call_1",
      output: '{"status":"shipped"}',
    });
  });
});

// ── response parsing ──

describe("parseResponsesOutput", () => {
  it("extracts text and function calls", () => {
    const { content, toolCalls } = parseResponsesOutput([
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }] },
      { type: "function_call", id: "fc_1", call_id: "call_1", name: "F", arguments: '{"a":1}' },
    ]);
    assert.equal(content, "Hello");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].id, "call_1");
    assert.equal(toolCalls[0].function.name, "F");
  });

  it("accepts object arguments", () => {
    const { toolCalls } = parseResponsesOutput([
      { type: "function_call", id: "fc_1", name: "F", arguments: { a: 1 } },
    ]);
    assert.equal(toolCalls[0].function.arguments, '{"a":1}');
  });
});

describe("applyResponsesEvent", () => {
  it("accumulates text deltas", () => {
    const state = emptyState();
    applyResponsesEvent(state, { type: "response.output_text.delta", delta: "Hel" });
    applyResponsesEvent(state, { type: "response.output_text.delta", delta: "lo" });
    assert.equal(responsesStateToMessage(state).content, "Hello");
  });

  it("accumulates function call argument deltas", () => {
    const state = emptyState();
    applyResponsesEvent(state, {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "F", arguments: "" },
    });
    applyResponsesEvent(state, {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      delta: '{"a":',
    });
    applyResponsesEvent(state, {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      delta: "1}",
    });
    const msg = responsesStateToMessage(state);
    assert.equal(msg.tool_calls?.[0].id, "call_1");
    assert.equal(msg.tool_calls?.[0].function.arguments, '{"a":1}');
  });

  it("uses response.completed output as authoritative", () => {
    const state = emptyState();
    applyResponsesEvent(state, { type: "response.output_text.delta", delta: "partial" });
    applyResponsesEvent(state, {
      type: "response.completed",
      response: {
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "final" }] }],
      },
    });
    assert.equal(responsesStateToMessage(state).content, "final");
  });

  it("raises on error events", () => {
    const state = emptyState();
    assert.throws(
      () => applyResponsesEvent(state, { type: "error", message: "boom" }),
      /Responses API error: boom/
    );
  });
});

// ── adapter integration ──

describe("responsesAdapter", () => {
  it("streams SSE, parses tool calls, and forwards Authorization", async () => {
    const srv = await startServer((_req, res) => {
      sendSse(res, [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "Order MCP", arguments: "" },
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 0,
          delta: '{"orderId":',
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 0,
          delta: '"12345"}',
        },
        {
          type: "response.completed",
          response: {
            output: [
              {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "Order MCP",
                arguments: '{"orderId":"12345"}',
              },
            ],
          },
        },
      ]);
    }, "/v1/responses");

    try {
      const config: AgentConfig = {
        url: srv.url,
        format: "responses",
        auth: "none",
        model: "gpt-4o-mini",
        forwardAuth: true,
        authorization: "Bearer incoming-token",
      };

      const response = await responsesAdapter([{ role: "user", content: "Where is my order?" }], config);

      assert.equal(srv.requests[0].headers.authorization, "Bearer incoming-token");
      assert.equal(srv.requests[0].headers["content-type"], "application/json");
      assert.equal(srv.requests[0].body.stream, true);
      assert.equal(srv.requests[0].body.model, "gpt-4o-mini");
      assert.deepEqual(srv.requests[0].body.input, [{ role: "user", content: "Where is my order?" }]);
      assert.deepEqual(response.messages[0].tool_calls, [
        {
          id: "call_1",
          type: "function",
          function: { name: "Order MCP", arguments: '{"orderId":"12345"}' },
        },
      ]);
    } finally {
      await srv.close();
    }
  });

  it("accumulates text deltas when the stream has no response.completed", async () => {
    const srv = await startServer((_req, res) => {
      sendSse(res, [
        { type: "response.output_text.delta", delta: "Your order " },
        { type: "response.output_text.delta", delta: "is on the way" },
      ]);
    }, "/v1/responses");

    try {
      const response = await responsesAdapter([{ role: "user", content: "status?" }], { url: srv.url });
      assert.equal(response.messages[0].content, "Your order is on the way");
    } finally {
      await srv.close();
    }
  });

  it("omits model when not configured (agent endpoints own their model)", async () => {
    const srv = await startServer((_req, res) => {
      sendSse(res, [{ type: "response.output_text.delta", delta: "ok" }]);
    }, "/v1/responses");

    try {
      await responsesAdapter([{ role: "user", content: "hi" }], { url: srv.url });
      assert.ok(!("model" in srv.requests[0].body));
    } finally {
      await srv.close();
    }
  });

  it("parses a non-streaming JSON response", async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "Shipped" }] },
            { type: "function_call", id: "fc_1", call_id: "call_1", name: "F", arguments: "{}" },
          ],
        })
      );
    }, "/v1/responses");

    try {
      const response = await responsesAdapter([{ role: "user", content: "status?" }], {
        url: srv.url,
        stream: false,
      });
      assert.equal(response.messages[0].content, "Shipped");
      assert.equal(response.messages[0].tool_calls?.[0].function.name, "F");
    } finally {
      await srv.close();
    }
  });
});

describe("openaiAdapter", () => {
  it("forwards the Authorization header too", async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
    }, "/v1/responses");

    try {
      await openaiAdapter([{ role: "user", content: "hi" }], {
        url: srv.url,
        forwardAuth: true,
        authorization: "Bearer pass-through",
      });
      assert.equal(srv.requests[0].headers.authorization, "Bearer pass-through");
    } finally {
      await srv.close();
    }
  });
});

// ── runner end-to-end ──

describe("run() with responses format", () => {
  it("runs a full tool round-trip and forwards auth", async () => {
    const srv = await startServer((_req, res, index) => {
      if (index === 0) {
        sendSse(res, [
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "Order MCP", arguments: "" },
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc_1",
              call_id: "call_1",
              name: "Order MCP",
              arguments: '{"orderId":"12345"}',
            },
          },
        ]);
      } else {
        sendSse(res, [
          { type: "response.output_text.delta", delta: "Your order is on the way" },
          {
            type: "response.completed",
            response: {
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "Your order is on the way" }],
                },
              ],
            },
          },
        ]);
      }
    }, "/v1/responses");

    const session = parse(`
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is order 12345?"
  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"
  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "shipped"
  - actor: assistant
    action: informs
    content: "Your order is on the way"
`);

    try {
      const result = await run(session, {
        url: srv.url,
        format: "responses",
        forwardAuth: true,
        authorization: "Bearer e2e",
      });

      assert.equal(result.stepsMatched, result.stepsTotal);
      assert.equal(srv.requests[0].headers.authorization, "Bearer e2e");
      assert.equal(srv.requests[1].headers.authorization, "Bearer e2e");
      // Second request must carry the tool output back to the agent
      assert.deepEqual(srv.requests[1].body.input.at(-1), {
        type: "function_call_output",
        call_id: "call_1",
        output: '{"status":"shipped"}',
      });
    } finally {
      await srv.close();
    }
  });
});
