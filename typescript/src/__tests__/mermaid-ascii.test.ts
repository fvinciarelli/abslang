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
});
