"""render_sequence_diagram must mirror typescript/src/__tests__/mermaid-ascii.test.ts."""

from abslang.mermaid_ascii import render_sequence_diagram

DIALOG = """sequenceDiagram
    participant user
    participant assistant
    user->>assistant: hola
    assistant-->>user: saludo
"""


def test_renders_two_participant_dialogue():
    assert render_sequence_diagram(DIALOG, 40) == "\n".join(
        [
            "┌────┐ ┌─────────┐",
            "│user│ │assistant│",
            "└──┬─┘ └────┬────┘",
            "   │ hola   │",
            "   │────────▶",
            "   │ saludo │",
            "   ◀--------│",
        ]
    )


def test_aliases_and_notes_between_participants():
    out = render_sequence_diagram(
        """sequenceDiagram
    participant C as Cliente
    participant S as Sistema
    Note over C,S: verificación
""",
        40,
    )
    assert out is not None
    assert "│Cliente│" in out
    assert "│Sistema│" in out
    assert "verificación" in out
    assert "┌" in out and "┐" in out


def test_implicit_participants_blocks_and_self_messages():
    out = render_sequence_diagram(
        """sequenceDiagram
    A->>B: uno
    B->>A: dos
    opt [opcional]
    B->>B: self
    end
""",
        40,
    )
    assert out is not None
    assert "│ A " in out and "│ B " in out
    assert "┌─opt:" in out
    assert "└─" in out
    assert "─▶" in out
    assert "uno" in out and "dos" in out and "self" in out


def test_dashed_cross_async_and_headless_arrows():
    out = render_sequence_diagram(
        """sequenceDiagram
    A-->>B: dashed
    A--xB: cross
    A-)B: async
    A-->B: headless
    B-->>A: back
""",
        40,
    )
    assert out is not None
    assert "▶" in out and "◀" in out
    assert "✗" in out
    assert ")" in out
    assert "dashed" in out and "cross" in out and "async" in out and "headless" in out


def test_wraps_long_labels_within_width():
    out = render_sequence_diagram(
        """sequenceDiagram
    A->>B: una etiqueta muy larga que deberia envolverse en varias lineas
""",
        30,
    )
    assert out is not None
    lengths = [len(l) for l in out.split("\n")]
    assert max(lengths) <= 30
    assert "una etiqueta muy larga" in out
    assert "varias lineas" in out


def test_returns_none_for_unsupported_input():
    assert render_sequence_diagram("flowchart TD\n  A-->B", 40) is None
    assert render_sequence_diagram("", 40) is None
    assert render_sequence_diagram("esto no es un diagrama", 40) is None
    assert render_sequence_diagram("sequenceDiagram\n%% solo comentarios", 40) is None


def test_renders_header_only_diagram():
    out = render_sequence_diagram("sequenceDiagram\n    participant A\n", 40)
    assert out is not None
    assert "│ A " in out


def test_strips_html_breaks():
    out = render_sequence_diagram(
        """sequenceDiagram
    participant A
    participant B
    A->>B: pide el dato<br/>y espera
    Note over A,B: llm_judge — clasifica<br/>intención, cita #8291
""",
        40,
    )
    assert out is not None
    assert "<br" not in out
    assert "pide el dato y espera" in out
    assert "clasifica intención," in out
    assert "cita #8291" in out


def test_long_labels_render_as_centered_block_above_arrow():
    out = render_sequence_diagram(
        """sequenceDiagram
    participant user
    participant assistant
    assistant-->>user: "Entiendo que tu pedido #8291 llegó dañado"
""",
        40,
    )
    assert out is not None
    lines = out.split("\n")
    arrow_idx = next(i for i, l in enumerate(lines) if "◀" in l)
    assert arrow_idx > 3
    block = lines[3:arrow_idx]
    assert len(block) >= 2
    for l in block:
        assert "│" not in l
    joined = " ".join(block)
    import re as _re
    joined = _re.sub(r"\s+", " ", joined)
    assert "Entiendo que tu pedido" in joined
    assert "llegó dañado" in joined


def test_long_notes_wrap_inside_box_instead_of_truncating():
    out = render_sequence_diagram(
        """sequenceDiagram
    participant A
    participant B
    Note over A,B: un criterio de evaluacion bastante largo que ya no cabe en una sola linea de la nota
""",
        40,
    )
    assert out is not None
    lines = out.split("\n")
    tops = [l for l in lines[3:] if "┌" in l and "┐" in l]
    assert len(tops) == 1
    mid_rows = [l for l in lines if "│" in l]
    # cabecera de participantes (2 líneas con │) + filas de la nota (≥2)
    assert len(mid_rows) >= 4
    assert "linea de la nota" in out
