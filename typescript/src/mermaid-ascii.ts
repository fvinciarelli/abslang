/**
 * Minimal ASCII renderer for the Mermaid `sequenceDiagram` subset that the
 * ABS assistant emits (participants, messages, notes, opt/alt/loop blocks).
 * No dependencies: parses the diagram and lays it out with box-drawing
 * characters.
 *
 * Keep in sync with python/src/abslang/mermaid_ascii.py (mirror module).
 *
 * `renderSequenceDiagram` returns `null` when the input is not a supported
 * diagram — callers should fall back to showing the raw source.
 */

export interface SequenceParticipant {
  id: string;
  label: string;
}

type MessageHead = "arrow" | "none" | "async" | "cross";

type Row =
  | { kind: "message"; a: number; b: number; label: string; dashed: boolean; head: MessageHead }
  | { kind: "note"; a: number; b: number; text: string }
  | { kind: "block-open"; label: string }
  | { kind: "block-else"; label: string }
  | { kind: "block-end" };

const ID = String.raw`[\w.\-/]+`;
// The first participant id must not end with "-" when a dashed arrow follows
// ("tool-->>x" would otherwise greedily parse as id "tool-" + arrow "-->").
const ID1 = String.raw`[\w./]+(?:-[\w./]+)*`;

const ARROW_STYLE: Record<string, { dashed: boolean; head: MessageHead }> = {
  "->>": { dashed: false, head: "arrow" },
  "->": { dashed: false, head: "none" },
  "-->>": { dashed: true, head: "arrow" },
  "-->": { dashed: true, head: "none" },
  "-)": { dashed: false, head: "async" },
  "--)": { dashed: true, head: "async" },
  "-x": { dashed: false, head: "cross" },
  "--x": { dashed: true, head: "cross" },
  "-.->": { dashed: true, head: "arrow" },
  "--->": { dashed: false, head: "arrow" },
  "---": { dashed: false, head: "none" },
};

const MSG = new RegExp(
  `^(${ID1})\\s*(-->>|-->|->>|->|--x|-x|--\\)|-\\)|-\\.->|--->|---)\\s*(${ID})\\s*:?\\s*(.*)$`
);
const NOTE = new RegExp(`^note\\s+(over|right of|left of)\\s+(${ID})(?:\\s*,\\s*(${ID}))?\\s*:?\\s*(.*)$`, "i");
const PARTICIPANT_ALIAS = /^\s*(?:participant|actor)\s+([\w.\-/]+)\s+as\s+(.+)$/;
const PARTICIPANT = /^\s*(?:participant|actor)\s+([\w.\-/]+)$/;
const TITLE = /^\s*title\s*:?\s*(.+)$/;
const BLOCK_OPEN = /^(opt|alt|loop|par|rect|critical|box)\b\s*(.*)$/i;
const BLOCK_ELSE = /^(else|and)\b\s*(.*)$/i;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const center = (s: string, w: number) => {
  const pad = Math.max(0, w - s.length);
  return " ".repeat(Math.floor(pad / 2)) + s + " ".repeat(Math.ceil(pad / 2));
};

function headChar(head: MessageHead, rightward: boolean): string {
  switch (head) {
    case "arrow":
      return rightward ? "▶" : "◀";
    case "async":
      return rightward ? ")" : "(";
    case "cross":
      return "✗";
    default:
      return "│";
  }
}

export function renderSequenceDiagram(source: string, width = 100): string | null {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.find((l) => l.trim() !== "" && !l.trim().startsWith("%%"));
  if (!first || !/^\s*sequenceDiagram\s*$/.test(first)) return null;

  const participants: SequenceParticipant[] = [];
  const rows: Row[] = [];
  let title = "";

  const idx = (id: string): number => {
    const found = participants.findIndex((p) => p.id === id);
    if (found >= 0) return found;
    participants.push({ id, label: id });
    return participants.length - 1;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line.startsWith("%%")) continue;

    let m = line.match(PARTICIPANT_ALIAS);
    if (m) {
      participants[idx(m[1])].label = m[2].replace(/^["']|["']$/g, "").trim();
      continue;
    }
    m = line.match(PARTICIPANT);
    if (m) {
      idx(m[1]);
      continue;
    }
    m = line.match(TITLE);
    if (m) {
      title = m[1].trim().replace(/<br\s*\/?>/gi, " ");
      continue;
    }
    m = line.match(MSG);
    if (m) {
      const [, a, arrow, b, label] = m;
      const style = ARROW_STYLE[arrow];
      if (style) {
        rows.push({
          kind: "message",
          a: idx(a),
          b: idx(b),
          label: (label || "").trim().replace(/<br\s*\/?>/gi, " "),
          dashed: style.dashed,
          head: style.head,
        });
        continue;
      }
    }
    m = line.match(NOTE);
    if (m) {
      const [, , a, b, text] = m;
      const ai = idx(a);
      rows.push({ kind: "note", a: ai, b: b ? idx(b) : ai, text: (text || "").trim().replace(/<br\s*\/?>/gi, " ") });
      continue;
    }
    if (/^end\s*$/i.test(line)) {
      rows.push({ kind: "block-end" });
      continue;
    }
    m = line.match(BLOCK_ELSE);
    if (m) {
      const label = m[2] ? `${m[1]}: ${m[2].trim()}` : m[1];
      rows.push({ kind: "block-else", label });
      continue;
    }
    m = line.match(BLOCK_OPEN);
    if (m) {
      const label = m[2] ? `${m[1]}: ${m[2].trim()}` : m[1];
      rows.push({ kind: "block-open", label });
      continue;
    }
    // Tolerated silently: activate/deactivate/autonumber/links/click/accTitle…
  }

  if (participants.length === 0) return null;

  // ── Layout ──
  const widths = participants.map((p) => clamp(p.label.length, 4, 24));
  const total = () => widths.reduce((s, w) => s + w + 3, 0);
  while (total() > width && widths.some((w) => w > 4)) {
    let best = 0;
    for (let i = 1; i < widths.length; i++) if (widths[i] > widths[best]) best = i;
    widths[best]--;
  }

  let acc = 0;
  const pos = widths.map((w) => {
    const p = acc + 1 + Math.floor(w / 2);
    acc += w + 3;
    return p;
  });
  const W = acc;

  const lifelines = (): string[] => {
    const ch = new Array(W).fill(" ");
    pos.forEach((p) => (ch[p] = "│"));
    return ch;
  };
  const line = (ch: string[]) => ch.join("").replace(/\s+$/, "");
  const put = (ch: string[], start: number, text: string) => {
    let t = text;
    if (start + t.length > width) t = t.slice(0, Math.max(0, width - start));
    while (ch.length < start + t.length) ch.push(" ");
    for (let i = 0; i < t.length; i++) ch[Math.max(0, start) + i] = t[i];
  };

  const wrap = (text: string, maxLen: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    const flush = () => {
      if (cur) lines.push(cur);
      cur = "";
    };
    for (let w of words) {
      while (w.length > maxLen) {
        if (cur) flush();
        lines.push(w.slice(0, maxLen));
        w = w.slice(maxLen);
      }
      if (cur && cur.length + 1 + w.length > maxLen) flush();
      cur = cur ? cur + " " + w : w;
    }
    flush();
    return lines.length ? lines : [""];
  };

  const out: string[] = [];
  if (title) out.push(title.slice(0, width));

  // ── Participant header — clean: names over lifelines, no boxes ──
  const names = lifelines();
  participants.forEach((p, i) => {
    put(names, pos[i] - Math.floor(p.label.length / 2), p.label.slice(0, widths[i]));
  });
  out.push(line(names));
  out.push(line(lifelines()));

  // ── Rows ──
  for (const row of rows) {
    if (row.kind === "message") {
      const pa = pos[row.a];
      const pb = pos[row.b];
      const arrowLine = lifelines();
      const fill = row.dashed ? "-" : "─";
      const emitBlock = (chunks: string[]) => {
        // Label too long for the gap: wrapped block ABOVE the arrow,
        // aligned to the source lifeline, never overlapping lifelines.
        for (const chunk of chunks) {
          const l = lifelines();
          const start = pa < pb ? pa + 2 : Math.max(0, pa - 1 - chunk.length);
          for (let x = start; x < start + chunk.length && x < W; x++) l[x] = " ";
          put(l, start, chunk);
          out.push(line(l));
        }
      };
      if (row.a === row.b) {
        for (const chunk of wrap(row.label, Math.max(10, Math.min(48, width - pa - 4)))) {
          const l = lifelines();
          put(l, pa + 3, chunk);
          out.push(line(l));
        }
        arrowLine[pa] = "│";
        if (pa + 2 < W) {
          arrowLine[pa + 1] = "─";
          arrowLine[pa + 2] = "▶";
        }
      } else if (pa < pb) {
        const gap = pb - pa - 2;
        if (row.label.length <= gap) {
          const l = lifelines();
          put(l, pa + 2, row.label);
          out.push(line(l));
        } else {
          emitBlock(wrap(row.label, Math.max(12, Math.min(48, width - 4))));
        }
        for (let x = pa + 1; x < pb; x++) arrowLine[x] = fill;
        arrowLine[pb] = headChar(row.head, true);
      } else {
        const gap = pa - pb - 2;
        if (row.label.length <= gap) {
          const l = lifelines();
          put(l, pa - 1 - row.label.length, row.label);
          out.push(line(l));
        } else {
          emitBlock(wrap(row.label, Math.max(12, Math.min(48, width - 4))));
        }
        for (let x = pb + 1; x < pa; x++) arrowLine[x] = fill;
        arrowLine[pb] = headChar(row.head, false);
      }
      out.push(line(arrowLine));
      continue;
    }

    if (row.kind === "note") {
      // No boxes: a dim dot-line between the lifelines, wrapped.
      const pa = pos[row.a];
      const pb = pos[row.b];
      const low = Math.min(pa, pb);
      const start = low + 2;
      const maxLen = Math.max(10, Math.min(48, width - start - 1));
      const chunks = wrap(row.text, maxLen);
      chunks.forEach((chunk, ci) => {
        const l = lifelines();
        const text = (ci === 0 ? "· " : "  ") + chunk;
        for (let x = start; x < start + text.length && x < W; x++) l[x] = " ";
        put(l, start, text);
        out.push(line(l));
      });
      continue;
    }

    if (row.kind === "block-end") continue;
    const firstPos = pos[0];
    const ch = lifelines();
    put(ch, firstPos + 2, "· " + row.label);
    out.push(line(ch));
  }

  return out.join("\n");
}
