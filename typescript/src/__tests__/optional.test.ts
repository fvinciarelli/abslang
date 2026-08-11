/**
 * v0.2 Optional Behaviors — tests
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parse, parseYaml, expandFragments } from "../parser";
import { expected, evalWhen } from "../evaluators";

// ── evalWhen ──

describe("evalWhen", () => {
  it("returns true for undefined expression (always applies)", () => {
    assert.equal(evalWhen(undefined, {}), true);
    assert.equal(evalWhen("", {}), true);
  });

  it("evaluates boolean comparisons", () => {
    assert.equal(evalWhen("{{x}} == true", { x: true }), true);
    assert.equal(evalWhen("{{x}} == true", { x: false }), false);
    assert.equal(evalWhen("{{x}} == false", { x: false }), true);
  });

  it("evaluates string comparisons", () => {
    assert.equal(evalWhen('{{x}} === "hello"', { x: "hello" }), true);
    assert.equal(evalWhen('{{x}} === "hello"', { x: "world" }), false);
  });

  it("evaluates number comparisons", () => {
    assert.equal(evalWhen("{{x}} > 5", { x: 10 }), true);
    assert.equal(evalWhen("{{x}} < 3", { x: 10 }), false);
  });

  it("evaluates not-equal", () => {
    assert.equal(evalWhen("{{x}} != true", { x: false }), true);
    assert.equal(evalWhen('{{x}} !== "hello"', { x: "world" }), true);
  });
});

// ── expected evaluator ──

describe("expected", () => {
  it("skips when 'when' condition is not met", () => {
    const result = expected(
      [{ step: 1, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: false }],
      { behavior: "ask", when: "{{shouldAsk}} == true" },
      { shouldAsk: false }
    );
    assert.equal(result.passed, true);
    assert.match(result.reason, /when condition not met/);
  });

  it("fails when expected behavior did not match", () => {
    const result = expected(
      [{ step: 1, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: false }],
      { behavior: "ask", when: "{{shouldAsk}} == true" },
      { shouldAsk: true }
    );
    assert.equal(result.passed, false);
  });

  it("fails with custom reason", () => {
    const result = expected(
      [{ step: 1, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: false }],
      { behavior: "ask", when: "{{shouldAsk}} == true", reason: "Should have asked!" },
      { shouldAsk: true }
    );
    assert.equal(result.passed, false);
    assert.equal(result.reason, "Should have asked!");
  });

  it("passes when behavior matched", () => {
    const result = expected(
      [{ step: 1, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: true }],
      { behavior: "ask", when: "{{shouldAsk}} == true" },
      { shouldAsk: true }
    );
    assert.equal(result.passed, true);
  });

  it("validates after constraint", () => {
    const steps = [
      { step: 1, behavior: { id: "user_asks", actor: "user", action: "says" }, matched: true },
      { step: 2, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: true },
    ];
    // ask after user_asks
    const result = expected(steps, {
      behavior: "ask",
      after: { actor: "user", action: "says" },
    }, {});
    assert.equal(result.passed, true);
  });

  it("fails after constraint when order is wrong", () => {
    const steps = [
      { step: 1, behavior: { id: "ask", actor: "assistant", action: "asks" }, matched: true },
      { step: 2, behavior: { id: "user_asks", actor: "user", action: "says" }, matched: true },
    ];
    const result = expected(steps, {
      behavior: "ask",
      after: { actor: "user", action: "says" },
      reason: "Should ask after user speaks",
    }, {});
    assert.equal(result.passed, false);
  });

  it("fails when referenced behavior not found", () => {
    const result = expected(
      [],
      { behavior: "nonexistent" },
      {}
    );
    assert.equal(result.passed, false);
    assert.match(result.reason, /not found/);
  });
});

// ── Parser: optional and requires ──

describe("parser v0.2", () => {
  it("parses optional and requires", () => {
    const yaml = `
session: Test
abs_version: "0.2"
behaviors:
  - id: ask_id
    actor: assistant
    action: asks
    optional: true
  - id: give_id
    actor: user
    action: says
    content: "{{cases.orderId}}"
    requires: ask_id
`;
    const session = parse(yaml);
    assert.equal(session.behaviors.length, 2);
    assert.equal(session.behaviors[0].optional, true);
    assert.equal(session.behaviors[1].requires, "ask_id");
  });

  it("parses matches_when", () => {
    const yaml = `
session: Test
abs_version: "0.2"
behaviors:
  - id: ask
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: llm_judge
      criteria: "The agent is requesting the order ID"
`;
    const session = parse(yaml);
    assert.equal(session.behaviors[0].matches_when?.type, "llm_judge");
    assert.equal(session.behaviors[0].matches_when?.criteria, "The agent is requesting the order ID");
  });

  it("rejects invalid requires reference", () => {
    const yaml = `
session: Test
behaviors:
  - actor: user
    action: says
  - actor: assistant
    action: informs
    requires: nonexistent
`;
    assert.throws(() => parse(yaml), /requires "nonexistent"/);
  });

  it("rejects sequence referencing optional behavior", () => {
    const yaml = `
session: Test
behaviors:
  - id: ask
    actor: assistant
    action: asks
    optional: true
  - actor: assistant
    action: informs
evaluations:
  - type: sequence
    order:
      - {actor: assistant, action: asks}
      - {actor: assistant, action: informs}
`;
    assert.throws(() => parse(yaml), /sequence.*optional/);
  });

  it("v0.1 document parses without optional fields", () => {
    const yaml = `
session: Test
behaviors:
  - actor: user
    action: says
    content: hi
evaluations:
  - type: sequence
    order:
      - {actor: user, action: says}
`;
    const session = parse(yaml);
    assert.equal(session.behaviors.length, 1);
    assert.equal(session.behaviors[0].optional, undefined);
  });

  it("parses expected evaluation", () => {
    const yaml = `
session: Test
abs_version: "0.2"
behaviors:
  - actor: user
    action: says
    content: hi
evaluations:
  - type: expected
    behavior: ask_id
    when: "{{cases.hasOrderId}} == false"
    reason: "Should ask for ID"
`;
    const session = parse(yaml);
    const ev = session.evaluations?.[0];
    assert.equal(ev?.type, "expected");
    assert.equal(ev?.behavior, "ask_id");
    assert.equal(ev?.when, "{{cases.hasOrderId}} == false");
    assert.equal(ev?.reason, "Should ask for ID");
  });
});
