/**
 * renderSequenceDiagram must mirror python/tests/test_mermaid_ascii.py.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { renderSequenceDiagram } from "../mermaid-ascii";

const DIALOG = `sequenceDiagram
    participant user
    participant assistant
    user->>assistant: hola
    assistant-->>user: saludo
`;

describe("renderSequenceDiagram", () => {
  it("renders a two-participant dialogue as ASCII", () => {
    assert.equal(
      renderSequenceDiagram(DIALOG, 40),
      [
        " user   assistant",
        "   │        │",
        "   │ hola   │",
        "   │────────▶",
        "   │ saludo │",
        "   ◀--------│",
      ].join("\n")
    );
  });

  it("supports participant aliases and notes as dot lines", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant C as Cliente
    participant S as Sistema
    Note over C,S: verificación
`,
      40
    );
    assert.ok(out);
    assert.ok(out.includes("Cliente"));
    assert.ok(out.includes("Sistema"));
    assert.ok(out.includes("· verificación"));
    assert.ok(!out.includes("┌") && !out.includes("┐"));
  });

  it("creates implicit participants from arrows and renders blocks and self-messages", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    A->>B: uno
    B->>A: dos
    opt [opcional]
    B->>B: self
    end
`,
      40
    );
    assert.ok(out);
    assert.ok(out.includes("uno") && out.includes("dos"));
    assert.ok(out.includes("· opt: [opcional]"));
    assert.ok(out.includes("─▶"));
    assert.ok(out.includes("self"));
  });

  it("supports dashed, cross, async and headless arrows", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    A-->>B: dashed
    A--xB: cross
    A-)B: async
    A-->B: headless
    B-->>A: back
`,
      40
    );
    assert.ok(out);
    assert.ok(out.includes("▶") && out.includes("◀"));
    assert.ok(out.includes("✗"));
    assert.ok(out.includes(")"));
    assert.ok(out.includes("dashed") && out.includes("cross") && out.includes("async") && out.includes("headless"));
  });

  it("wraps long labels within the given width", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    A->>B: una etiqueta muy larga que deberia envolverse en varias lineas
`,
      30
    );
    assert.ok(out);
    const lengths = out.split("\n").map((l) => l.length);
    assert.ok(Math.max(...lengths) <= 30);
    assert.ok(out.includes("una etiqueta muy larga"));
    assert.ok(out.includes("varias lineas"));
  });

  it("returns null for unsupported input", () => {
    assert.equal(renderSequenceDiagram("flowchart TD\n  A-->B", 40), null);
    assert.equal(renderSequenceDiagram("", 40), null);
    assert.equal(renderSequenceDiagram("esto no es un diagrama", 40), null);
    assert.equal(renderSequenceDiagram("sequenceDiagram\n%% solo comentarios", 40), null);
  });

  it("renders a header-only diagram", () => {
    const out = renderSequenceDiagram("sequenceDiagram\n    participant A\n", 40);
    assert.ok(out);
    assert.ok(out.includes("A"));
    assert.ok(out.includes("│"));
  });

  it("strips HTML breaks the assistant sometimes emits", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant A
    participant B
    A->>B: pide el dato<br/>y espera
    Note over A,B: llm_judge — clasifica<br/>intención, cita #8291
`,
      40
    );
    assert.ok(out);
    assert.ok(!out.includes("<br"));
    assert.ok(out.includes("pide el dato y espera"));
    assert.ok(out.includes("clasifica intención,"));
    assert.ok(out.includes("cita #8291"));
  });

  it("renders long labels as a block above the arrow aligned to the source lifeline", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant user
    participant assistant
    assistant-->>user: "Entiendo que tu pedido #8291 llegó dañado"
`,
      40
    );
    assert.ok(out);
    const lines = out.split("\n");
    const arrowIdx = lines.findIndex((l) => l.includes("◀"));
    assert.ok(arrowIdx > 2);
    const block = lines.slice(2, arrowIdx);
    assert.ok(block.length >= 2);
    const joined = block.join(" ").replace(/│/g, " ").replace(/\s+/g, " ");
    assert.ok(joined.includes("Entiendo que tu pedido"));
    assert.ok(joined.includes("llegó dañado"));
  });

  it("renders long notes as wrapped dot lines without boxes", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant A
    participant B
    Note over A,B: un criterio de evaluacion bastante largo que ya no cabe en una sola linea de la nota
`,
      40
    );
    assert.ok(out);
    assert.ok(!out.includes("┌") && !out.includes("┐"));
    assert.ok(out.includes("· un criterio de evaluacion"));
    assert.ok(out.includes("linea de la nota"));
  });
});
