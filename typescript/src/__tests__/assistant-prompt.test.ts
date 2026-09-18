/// <reference types="node" />

/**
 * The assistant prompt is assembled from generated knowledge. These tests keep
 * it honest: the reference covers everything the schema defines, every catalogued
 * example is valid ABS, and example selection is relevant and bounded.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ABS_VERSION, CORE, EXAMPLES, MERMAID_EXAMPLES, MERMAID_GUIDE, buildSystemPrompt, looksLikeMermaid, selectExamples } from "../assistant-knowledge";
import { parseMulti } from "../parser";

const schema = JSON.parse(readFileSync(resolve(__dirname, "../../../schema/abs.schema.json"), "utf-8"));

describe("assistant prompt", () => {
  it("ABS_VERSION matches the schema title", () => {
    const version = schema.title.match(/v(\d+\.\d+)/)![1];
    assert.equal(ABS_VERSION, version);
  });

  it("the core covers every evaluator type in the schema", () => {
    const types: string[] = schema.definitions.evaluation.properties.type.enum;
    assert.ok(types.length > 20, "schema enum looks wrong");
    for (const type of types) {
      assert.ok(CORE.includes(type), `core is missing evaluator: ${type}`);
    }
  });

  it("the core covers every matches_when type in the schema", () => {
    const types: string[] = schema.definitions.behavior.properties.matches_when.properties.type.enum;
    for (const type of types) {
      assert.ok(CORE.includes(type), `core is missing matches_when type: ${type}`);
    }
  });

  it("the core states the current version", () => {
    assert.ok(CORE.includes(`ABS v${ABS_VERSION}`));
  });

  it("every catalogued example is valid ABS", () => {
    assert.ok(EXAMPLES.length >= 10, `only ${EXAMPLES.length} examples catalogued`);
    for (const ex of EXAMPLES) {
      assert.doesNotThrow(() => parseMulti(ex.content), `example ${ex.name} does not parse`);
    }
  });

  it("the prompt includes rules, reference, catalog, and full examples", () => {
    const prompt = buildSystemPrompt("I want to test a refund flow");
    assert.ok(prompt.includes("BLACK-BOX"), "missing black-box rules");
    assert.ok(prompt.includes("Above every behavior"), "missing the per-behavior comment rule");
    assert.ok(prompt.includes(`ABS v${ABS_VERSION} quick reference`), "missing generated core");
    assert.ok(prompt.includes("EXAMPLE CATALOG"), "missing example catalog");
    assert.ok(prompt.includes("```yaml"), "missing a full example");
  });

  it("selectExamples picks by relevance and respects the limit", () => {
    const refund = selectExamples("user wants a refund and the agent calls the Orders API", 1);
    assert.equal(refund.length, 1);
    assert.ok(/refund|order/.test(refund[0].name), `unexpected pick: ${refund[0].name}`);

    const rag = selectExamples("check groundedness against a knowledge base snippet", 2);
    assert.ok(
      rag.some((ex) => ex.tags.includes("groundedness")),
      `unexpected picks: ${rag.map((e) => e.name).join(", ")}`
    );

    assert.equal(selectExamples("anything at all", 0).length, 0);
    assert.ok(selectExamples("anything at all", 99).length <= EXAMPLES.length);
  });

  it("the prompt embeds the full YAML of the picked examples", () => {
    const prompt = buildSystemPrompt("refund");
    for (const ex of selectExamples("refund", 3)) {
      assert.ok(prompt.includes(ex.content), `prompt is missing the full content of ${ex.name}`);
    }
  });

  it("detects pasted Mermaid and only then injects the mapping guide", () => {
    for (const mmd of ["```mermaid\nflowchart TD\n A-->B", "sequenceDiagram\n A->>B: hi", "graph LR\n A-->B", "classDiagram"] ) {
      assert.ok(looksLikeMermaid(mmd), `not detected: ${mmd}`);
      const prompt = buildSystemPrompt(mmd);
      assert.ok(prompt.includes("MERMAID INPUT"), "mermaid prompt is missing the mapping section");
      assert.ok(prompt.includes(MERMAID_GUIDE), "mermaid prompt is missing the mapping rules");
      for (const m of MERMAID_EXAMPLES) assert.ok(prompt.includes(m.diagram), `missing diagram ${m.name}`);
    }
    for (const text of ["quiero un test de refunds", "how do I use mlm_judge?", ""]) {
      assert.equal(looksLikeMermaid(text), false, `false positive: ${text}`);
      assert.ok(!buildSystemPrompt(text).includes(MERMAID_GUIDE), "non-mermaid prompt contains the mapping rules");
    }
  });

  it("every Mermaid fixture maps to valid ABS", () => {
    assert.ok(MERMAID_EXAMPLES.length >= 2);
    for (const m of MERMAID_EXAMPLES) {
      assert.ok(m.diagram.length > 0 && m.yaml.length > 0, `${m.name} fixture is empty`);
      assert.doesNotThrow(() => parseMulti(m.yaml), `mapping ${m.name}.abs.yaml does not parse`);
    }
  });
});
