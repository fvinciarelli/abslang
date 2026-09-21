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
        "┌────┐ ┌─────────┐",
        "│user│ │assistant│",
        "└──┬─┘ └────┬────┘",
        "   │ hola   │",
        "   │────────▶",
        "   │ saludo │",
        "   ◀--------│",
      ].join("\n")
    );
  });

  it("supports participant aliases and notes between participants", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant C as Cliente
    participant S as Sistema
    Note over C,S: verificación
`,
      40
    );
    assert.ok(out);
    assert.ok(out.includes("│Cliente│"));
    assert.ok(out.includes("│Sistema│"));
    assert.ok(out.includes("verificación"));
    assert.ok(out.includes("┌") && out.includes("┐"));
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
    assert.ok(out.includes("│ A ") && out.includes("│ B "));
    assert.ok(out.includes("┌─opt:"));
    assert.ok(out.includes("└─"));
    assert.ok(out.includes("─▶"));
    assert.ok(out.includes("uno") && out.includes("dos") && out.includes("self"));
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
    assert.ok(out.includes("│ A "));
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

  it("renders long labels as a centered block above the arrow without lifeline overlap", () => {
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
    assert.ok(arrowIdx > 3);
    const block = lines.slice(3, arrowIdx);
    assert.ok(block.length >= 2);
    for (const l of block) assert.doesNotMatch(l, /│/);
    const joined = block.join(" ").replace(/\s+/g, " ");
    assert.ok(joined.includes("Entiendo que tu pedido"));
    assert.ok(joined.includes("llegó dañado"));
  });

  it("wraps long notes inside the box instead of truncating them", () => {
    const out = renderSequenceDiagram(
      `sequenceDiagram
    participant A
    participant B
    Note over A,B: un criterio de evaluacion bastante largo que ya no cabe en una sola linea de la nota
`,
      40
    );
    assert.ok(out);
    const lines = out.split("\n");
    const tops = lines.slice(3).filter((l) => l.includes("┌") && l.includes("┐"));
    assert.equal(tops.length, 1);
    const midRows = lines.filter((l) => /│[^│]*│/.test(l));
    assert.ok(midRows.length >= 3); // at least two wrapped text rows + header
    assert.ok(out.includes("linea de la nota"));
  });
});
