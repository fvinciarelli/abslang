/// <reference types="node" />

/**
 * chat() must send the generated system prompt to the provider, and the
 * extraction helpers must find the fenced blocks in assistant responses.
 * fetch is stubbed — no network, no API key.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { chat, extractMermaid, extractYaml } from "../assistant";
import { ABS_VERSION, MERMAID_GUIDE, selectExamples } from "../assistant-knowledge";

const originalFetch = globalThis.fetch;

function stubFetch(response: { ok: boolean; status?: number; body?: any; text?: string }) {
  return (async () => ({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.body,
    text: async () => response.text ?? "",
  })) as any;
}

describe("assistant chat", () => {
  it("sends the generated system prompt for the latest user message", async () => {
    const captured: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      captured.push({ url: String(url), init, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: "hello" } }] }) };
    }) as any;

    try {
      const out = await chat([{ role: "user", content: "I need a refund flow" }], {
        apiKey: "test-key",
        model: "test-model",
        baseUrl: "http://example.test/v1",
      });
      assert.equal(out, "hello");

      assert.equal(captured.length, 1);
      const { url, init, body } = captured[0];
      assert.equal(url, "http://example.test/v1/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer test-key");
      assert.equal(body.model, "test-model");
      assert.equal(body.temperature, 0.3);

      const system = body.messages.find((m: any) => m.role === "system");
      assert.ok(system, "no system message sent");
      assert.ok(system.content.includes(`ABS v${ABS_VERSION} quick reference`));
      const picked = selectExamples("I need a refund flow", 3);
      for (const ex of picked) assert.ok(system.content.includes(ex.content), `prompt missing ${ex.name}`);
      assert.ok(system.content.includes("Mermaid diagrams — input and output"), "missing the Mermaid output rules");
      assert.ok(!system.content.includes(MERMAID_GUIDE), "mapping rules should only appear for pasted diagrams");

      const user = body.messages.find((m: any) => m.role === "user");
      assert.equal(user.content, "I need a refund flow");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes the Mermaid mapping section when the user pastes a diagram", async () => {
    const captured: any[] = [];
    globalThis.fetch = (async (_url: any, init: any) => {
      captured.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    }) as any;

    try {
      await chat([{ role: "user", content: "```mermaid\nflowchart TD\n A-->B\n```" }], { apiKey: "k" });
      const system = captured[0].messages.find((m: any) => m.role === "system");
      assert.ok(system.content.includes("MERMAID INPUT"));
      assert.ok(system.content.includes(MERMAID_GUIDE));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws a readable error when the provider fails", async () => {
    globalThis.fetch = stubFetch({ ok: false, status: 401, text: "unauthorized" });
    try {
      await assert.rejects(() => chat([{ role: "user", content: "hi" }], { apiKey: "bad" }), /Chat provider returned 401/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("response extraction", () => {
  it("extracts fenced YAML", () => {
    const text = "Here you go:\n\n```yaml\nsession: X\nbehaviors:\n  - actor: user\n    action: says\n```\n\nDone.";
    assert.equal(extractYaml(text), "session: X\nbehaviors:\n  - actor: user\n    action: says");
    assert.equal(extractYaml("no code block here"), null);
  });

  it("extracts fenced Mermaid", () => {
    const text = "Diagram:\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n";
    assert.equal(extractMermaid(text), "sequenceDiagram\n  A->>B: hi");
    assert.equal(extractMermaid("no diagram"), null);
  });
});
