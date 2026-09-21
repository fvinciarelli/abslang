"""Minimal ASCII renderer for the Mermaid ``sequenceDiagram`` subset that the
ABS assistant emits (participants, messages, notes, opt/alt/loop blocks).
No dependencies: parses the diagram and lays it out with box-drawing
characters.

Keep in sync with typescript/src/mermaid-ascii.ts (mirror module).

``render_sequence_diagram`` returns ``None`` when the input is not a supported
diagram — callers should fall back to showing the raw source.
"""

from __future__ import annotations

import re

_ID = r"[\w.\-/]+"
# The first participant id must not end with "-" when a dashed arrow follows
# ("tool-->>x" would otherwise greedily parse as id "tool-" + arrow "-->").
_ID1 = r"[\w./]+(?:-[\w./]+)*"

_ARROW_STYLE = {
    "->>": (False, "arrow"),
    "->": (False, "none"),
    "-->>": (True, "arrow"),
    "-->": (True, "none"),
    "-)": (False, "async"),
    "--)": (True, "async"),
    "-x": (False, "cross"),
    "--x": (True, "cross"),
    "-.->": (True, "arrow"),
    "--->": (False, "arrow"),
    "---": (False, "none"),
}

_MSG = re.compile(rf"^({_ID1})\s*(-->>|-->|->>|->|--x|-x|--\)|-\)|-\.->|--->|---)\s*({_ID})\s*:?\s*(.*)$")
_NOTE = re.compile(rf"^note\s+(over|right of|left of)\s+({_ID})(?:\s*,\s*({_ID}))?\s*:?\s*(.*)$", re.IGNORECASE)
_PARTICIPANT_ALIAS = re.compile(rf"^\s*(?:participant|actor)\s+({_ID})\s+as\s+(.+)$")
_PARTICIPANT = re.compile(rf"^\s*(?:participant|actor)\s+({_ID})$")
_TITLE = re.compile(r"^\s*title\s*:?\s*(.+)$")
_BLOCK_OPEN = re.compile(r"^(opt|alt|loop|par|rect|critical|box)\b\s*(.*)$", re.IGNORECASE)
_BLOCK_ELSE = re.compile(r"^(else|and)\b\s*(.*)$", re.IGNORECASE)


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _center(s: str, w: int) -> str:
    pad = max(0, w - len(s))
    return " " * (pad // 2) + s + " " * (pad - pad // 2)


def _head_char(head: str, rightward: bool) -> str:
    if head == "arrow":
        return "▶" if rightward else "◀"
    if head == "async":
        return ")" if rightward else "("
    if head == "cross":
        return "✗"
    return "│"


def _wrap(text: str, max_len: int) -> list[str]:
    """Word-wraps text into chunks of at most max_len characters."""
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        while len(w) > max_len:
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:max_len])
            w = w[max_len:]
        if cur and len(cur) + 1 + len(w) > max_len:
            lines.append(cur)
            cur = ""
        cur = cur + " " + w if cur else w
    if cur:
        lines.append(cur)
    return lines or [""]


def render_sequence_diagram(source: str, width: int = 100) -> str | None:
    """Renders a Mermaid sequenceDiagram as ASCII art, or None if unsupported."""
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    first = next((l for l in lines if l.strip() != "" and not l.strip().startswith("%%")), None)
    if first is None or not re.match(r"^\s*sequenceDiagram\s*$", first):
        return None

    participants: list[tuple[str, str]] = []  # (id, label)
    rows: list[dict] = []
    title = ""

    def idx(id_: str) -> int:
        for i, (pid, _) in enumerate(participants):
            if pid == id_:
                return i
        participants.append((id_, id_))
        return len(participants) - 1

    for raw in lines:
        line = raw.strip()
        if line == "" or line.startswith("%%"):
            continue

        m = _PARTICIPANT_ALIAS.match(line)
        if m:
            participants[idx(m.group(1))] = (m.group(1), m.group(2).strip().strip("\"'").strip())
            continue
        m = _PARTICIPANT.match(line)
        if m:
            idx(m.group(1))
            continue
        m = _TITLE.match(line)
        if m:
            title = m.group(1).strip()
            continue
        m = _MSG.match(line)
        if m:
            a, arrow, b, label = m.groups()
            style = _ARROW_STYLE.get(arrow)
            if style:
                dashed, head = style
                rows.append({
                    "kind": "message",
                    "a": idx(a),
                    "b": idx(b),
                    "label": (label or "").strip(),
                    "dashed": dashed,
                    "head": head,
                })
                continue
        m = _NOTE.match(line)
        if m:
            _, a, b, text = m.groups()
            ai = idx(a)
            rows.append({"kind": "note", "a": ai, "b": idx(b) if b else ai, "text": (text or "").strip()})
            continue
        if re.match(r"^end\s*$", line, re.IGNORECASE):
            rows.append({"kind": "block-end"})
            continue
        m = _BLOCK_ELSE.match(line)
        if m:
            kw, rest = m.groups()
            rows.append({"kind": "block-else", "label": f"{kw}: {rest.strip()}" if rest else kw})
            continue
        m = _BLOCK_OPEN.match(line)
        if m:
            kw, rest = m.groups()
            rows.append({"kind": "block-open", "label": f"{kw}: {rest.strip()}" if rest else kw})
            continue
        # Tolerated silently: activate/deactivate/autonumber/links/click/accTitle…

    if not participants:
        return None

    # ── Layout ──
    widths = [_clamp(len(label), 4, 24) for _, label in participants]
    total = sum(w + 3 for w in widths)
    while total > width and any(w > 4 for w in widths):
        best = max(range(len(widths)), key=lambda i: widths[i])
        widths[best] -= 1
        total = sum(w + 3 for w in widths)

    acc = 0
    pos: list[int] = []
    for w in widths:
        pos.append(acc + 1 + w // 2)
        acc += w + 3
    W = acc

    def lifelines() -> list[str]:
        ch = [" "] * W
        for p in pos:
            ch[p] = "│"
        return ch

    def line(ch: list[str]) -> str:
        return "".join(ch).rstrip()

    def put(ch: list[str], start: int, text: str) -> None:
        t = text
        if start + len(t) > width:
            t = t[: max(0, width - start)]
        while len(ch) < start + len(t):
            ch.append(" ")
        for i, c in enumerate(t):
            ch[max(0, start) + i] = c

    def box_row(left: int, inner_width: int, open_: str, close: str) -> list[str]:
        ch = lifelines()
        while len(ch) <= left + inner_width + 1:
            ch.append(" ")
        ch[left] = open_
        for x in range(left + 1, left + inner_width + 1):
            ch[x] = "─"
        ch[left + inner_width + 1] = close
        return ch

    out: list[str] = []
    if title:
        out.append(title[:width])

    # ── Participant header ──
    top = ["┌" + "─" * w + "┐" for w in widths]
    mid = ["│" + _center(participants[i][1][:w], w) + "│" for i, w in enumerate(widths)]
    bot = ["└" + "─" * (w // 2) + "┬" + "─" * (w - 1 - w // 2) + "┘" for w in widths]
    out.extend([" ".join(top), " ".join(mid), " ".join(bot)])

    # ── Rows ──
    for row in rows:
        kind = row["kind"]
        if kind == "message":
            pa, pb = pos[row["a"]], pos[row["b"]]
            arrow_line = lifelines()
            fill = "-" if row["dashed"] else "─"

            def emit_block(chunks: list[str]) -> None:
                # Label too long for the gap: wrapped block ABOVE the arrow,
                # centered between the two lifelines, never overlapping them.
                mid = (pa + pb) // 2
                for chunk in chunks:
                    l = [" "] * W
                    put(l, max(0, mid - len(chunk) // 2), chunk)
                    out.append(line(l))

            if row["a"] == row["b"]:
                for chunk in _wrap(row["label"], max(10, min(48, width - pa - 4))):
                    l = lifelines()
                    put(l, pa + 3, chunk)
                    out.append(line(l))
                arrow_line[pa] = "│"
                if pa + 2 < W:
                    arrow_line[pa + 1] = "─"
                    arrow_line[pa + 2] = "▶"
            elif pa < pb:
                gap = pb - pa - 2
                if len(row["label"]) <= gap:
                    l = lifelines()
                    put(l, pa + 2, row["label"])
                    out.append(line(l))
                else:
                    emit_block(_wrap(row["label"], max(12, min(48, width - 4))))
                for x in range(pa + 1, pb):
                    arrow_line[x] = fill
                arrow_line[pb] = _head_char(row["head"], True)
            else:
                gap = pa - pb - 2
                if len(row["label"]) <= gap:
                    l = lifelines()
                    put(l, pa - 1 - len(row["label"]), row["label"])
                    out.append(line(l))
                else:
                    emit_block(_wrap(row["label"], max(12, min(48, width - 4))))
                for x in range(pb + 1, pa):
                    arrow_line[x] = fill
                arrow_line[pb] = _head_char(row["head"], False)
            out.append(line(arrow_line))
            continue

        if kind == "note":
            pa, pb = pos[row["a"]], pos[row["b"]]
            low, high = min(pa, pb), max(pa, pb)
            inner = min(
                width - low - 2,
                max(4, high - low - 2, min(len(row["text"]) + 2, 48)),
            )
            out.append(line(box_row(low, inner, "┌", "┐")))
            for chunk in _wrap(row["text"], max(1, inner - 2)):
                mid_box = lifelines()
                while len(mid_box) <= low + inner + 1:
                    mid_box.append(" ")
                for x in range(low, low + inner + 2):
                    mid_box[x] = " "
                mid_box[low] = "│"
                mid_box[low + inner + 1] = "│"
                put(mid_box, low + 1, " " + chunk)
                out.append(line(mid_box))
            out.append(line(box_row(low, inner, "└", "┘")))
            continue

        first_pos, last_pos = pos[0], pos[-1]
        ch = lifelines()
        if kind == "block-open":
            ch[first_pos] = "┌"
            ch[last_pos] = "┐"
            avail = max(0, last_pos - first_pos - 2)
            t = row["label"]
            if len(t) > avail - 1:
                t = t[: max(0, avail - 1)] + "…"
            ch[first_pos + 1] = "─"
            put(ch, first_pos + 2, t)
            for x in range(first_pos + 2 + len(t), last_pos):
                ch[x] = "─"
        elif kind == "block-else":
            ch[first_pos] = "├"
            ch[last_pos] = "┤"
            avail = max(0, last_pos - first_pos - 2)
            t = row["label"]
            if len(t) > avail - 1:
                t = t[: max(0, avail - 1)] + "…"
            ch[first_pos + 1] = "─"
            put(ch, first_pos + 2, t)
            for x in range(first_pos + 2 + len(t), last_pos):
                ch[x] = "─"
        else:
            ch[first_pos] = "└"
            ch[last_pos] = "┘"
            for x in range(first_pos + 1, last_pos):
                ch[x] = "─"
        out.append(line(ch))

    return "\n".join(out)
