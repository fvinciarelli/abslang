/// <reference types="node" />

import { parseYaml, expandFragments, resolveVariables, loadDataset } from "../parser";
import {
  exactMatch, contains, regex, schema as schemaEval,
  sequence, eventually, never, count, within,
  matchesSelector, evaluateStep, ObservedStep,
} from "../evaluators/builtin";

// ── Simple test runner ──

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(
        () => { passed++; console.log(`  ✅ ${name}`); },
        (err) => { failed++; console.log(`  ❌ ${name}: ${err.message}`); }
      );
    } else {
      passed++;
      console.log(`  ✅ ${name}`);
    }
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg?: string) {
  if (!condition) throw new Error(msg || "assertion failed");
}

function assertEquals(a: any, b: any, msg?: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// ── Parser tests ──

console.log("\n📦 Parser");

test("parse single session", () => {
  const yaml = `
session: Test
behaviors:
  - actor: user
    action: says
    content: "Hi"
  - actor: assistant
    action: greets
    content: "Hello"
`;
  const docs = parseYaml(yaml);
  assert(docs.length === 1);
  assert(docs[0].session === "Test");
  assert(docs[0].behaviors.length === 2);
});

test("parse multi-document (---)", () => {
  const yaml = `
session: First
behaviors:
  - actor: user
    action: says
    content: "A"
---
session: Second
behaviors:
  - actor: user
    action: says
    content: "B"
`;
  const docs = parseYaml(yaml);
  assert(docs.length === 2);
  assert(docs[0].session === "First");
  assert(docs[1].session === "Second");
});

test("fragment expansion", () => {
  const doc = parseYaml(`
session: Test
fragments:
  greeting:
    - actor: user
      action: says
      content: "Hi"
behaviors:
  - include: greeting
  - actor: assistant
    action: greets
    content: "Hello"
`);
  const expanded = expandFragments(doc[0]);
  assert(expanded.behaviors.length === 2);
  assert(expanded.behaviors[0].actor === "user");
  assert(expanded.behaviors[1].actor === "assistant");
});

test("variable resolution", () => {
  const behaviors = [
    { actor: "user", action: "says", content: "12345", capture: { orderId: "12345" } },
    { actor: "assistant", action: "calls", target: "MCP", with: { orderId: "{{orderId}}" } },
  ];
  const resolved = resolveVariables(behaviors);
  assert(resolved[0].content === "12345");
  assertEquals(resolved[1].with, { orderId: "12345" });
});

test("variable from runtime binding", () => {
  const behaviors = [
    { actor: "user", action: "says", content: "Order {{orderId}}" },
  ];
  const resolved = resolveVariables(behaviors, { orderId: "99999" });
  assert(resolved[0].content === "Order 99999");
});

test("variable not found throws", () => {
  const behaviors = [
    { actor: "user", action: "says", content: "Order {{missing}}" },
  ];
  let threw = false;
  try {
    resolveVariables(behaviors);
  } catch { threw = true; }
  assert(threw);
});

// ── Evaluator tests ──

console.log("\n📦 Evaluators");

test("exact_match — pass", () => {
  const r = exactMatch("hello", { value: "hello" });
  assert(r.passed);
});

test("exact_match — fail", () => {
  const r = exactMatch("hello", { value: "world" });
  assert(!r.passed);
});

test("contains — pass", () => {
  const r = contains("Your order is on the way", { value: "on the way" });
  assert(r.passed);
});

test("contains — fail", () => {
  const r = contains("Your order is delayed", { value: "on the way" });
  assert(!r.passed);
});

test("contains — case insensitive", () => {
  const r = contains("Your Order Is ON THE WAY", { value: "on the way" });
  assert(r.passed);
});

test("regex — pass", () => {
  const r = regex("Order #12345 is shipped", { pattern: "^Order #\\d+" });
  assert(r.passed);
});

test("regex — fail", () => {
  const r = regex("Your order", { pattern: "^Order #\\d+" });
  assert(!r.passed);
});

test("schema — pass", () => {
  const r = schemaEval({ status: "shipped", eta: "2026-07-30" }, {
    schema: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } },
    },
  });
  assert(r.passed);
});

test("schema — missing required", () => {
  const r = schemaEval({ eta: "2026-07-30" }, {
    schema: {
      type: "object",
      required: ["status"],
    },
  });
  assert(!r.passed);
});

test("schema — additionalProperties false", () => {
  const r = schemaEval({ status: "ok", extra: "nope" }, {
    schema: {
      type: "object",
      required: ["status"],
      properties: { status: { type: "string" } },
      additionalProperties: false,
    },
  });
  assert(!r.passed);
});

test("schema — enum validation", () => {
  const r = schemaEval({ status: "unknown" }, {
    schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["shipped", "pending"] } },
    },
  });
  assert(!r.passed);
});

// ── Chain evaluator tests ──

console.log("\n📦 Chain evaluators");

const trace: ObservedStep[] = [
  { actor: "assistant", action: "asks", content: "Order number?" },
  { actor: "user", action: "says", content: "12345" },
  { actor: "assistant", action: "calls", target: "Order MCP" },
  { actor: "assistant", action: "informs", content: "On the way" },
];

test("sequence — pass", () => {
  const r = sequence(trace, {
    order: [
      { actor: "assistant", action: "asks" },
      { actor: "assistant", action: "calls" },
      { actor: "assistant", action: "informs" },
    ],
  });
  assert(r.passed, r.reason);
});

test("sequence — fail (wrong order)", () => {
  const r = sequence(trace, {
    order: [
      { actor: "assistant", action: "calls" },
      { actor: "user", action: "says" },  // user speaks AFTER assistant calls — wrong
    ],
  });
  assert(!r.passed, r.reason);
});

test("eventually — pass", () => {
  const r = eventually(trace, { match: { action: "calls" } });
  assert(r.passed);
});

test("eventually — fail", () => {
  const r = eventually(trace, { match: { action: "uploads" } });
  assert(!r.passed);
});

test("never — pass", () => {
  const r = never(trace, { match: { action: "uploads" } });
  assert(r.passed);
});

test("never — fail", () => {
  const r = never(trace, { match: { action: "calls" } });
  assert(!r.passed);
});

test("count — pass", () => {
  const r = count(trace, { match: { actor: "assistant" }, min: 2, max: 5 });
  assert(r.passed, r.reason);
});

test("count — fail (too few)", () => {
  const r = count(trace, { match: { action: "uploads" }, min: 1 });
  assert(!r.passed);
});

test("within — pass", () => {
  const r = within(trace, {
    after: { action: "asks" },
    match: { action: "calls" },
    max_steps: 2,
  });
  assert(r.passed, r.reason);
});

test("within — fail (wrong target)", () => {
  const r = within(trace, {
    after: { action: "asks" },
    match: { action: "calls", target: "Other" },  // wrong target
    max_steps: 3,
  });
  assert(!r.passed, r.reason);
});

test("selector with target", () => {
  assert(matchesSelector(trace[2], { actor: "assistant", action: "calls", target: "Order MCP" }));
  assert(!matchesSelector(trace[2], { actor: "assistant", action: "calls", target: "Other" }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
