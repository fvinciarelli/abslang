"""Live pretty trace (spike) — colored conversation boxes rendered with rich.Live.

Consumes ``RunLogger`` events (``trace.step``, ``behavior.match``,
``evaluation.result``, ...) and renders the conversation as one box per step,
colored by actor, with verdict/evaluation badges. The CLI wraps this in a
``rich.Live`` region on stderr so the view updates as the run progresses.

Spike prototype — API is not final (see .plans/spike-pretty-trace.md).
"""

from __future__ import annotations

import json
from typing import Any

from rich.align import Align
from rich.console import Group
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

ACTOR_META: dict[str, tuple[str, str]] = {
    "user": ("User", "cyan"),
    "assistant": ("Assistant", "green"),
    "tool": ("Tool", "magenta"),
    "error": ("Error", "red"),
}

_VERDICTS = {
    "matched": ("✅", "green"),
    "failed": ("❌", "red"),
    "skipped": ("⏭", "dim"),
    "sent": ("→", "cyan"),
}


def _clip(text: Any, max_lines: int = 6, width: int = 80) -> str:
    lines = str(text).splitlines() or [""]
    out: list[str] = []
    for line in lines[:max_lines]:
        out.append(line[:width] + ("…" if len(line) > width else ""))
    if len(lines) > max_lines:
        out.append(f"… (+{len(lines) - max_lines} more lines)")
    return "\n".join(out)


class LiveTraceRenderer:
    """Collects run events into conversation boxes and renders them."""

    def __init__(self, use_color: bool = True) -> None:
        self.use_color = use_color
        self.session: str | None = None
        self.agent: str | None = None
        self.row: int | None = None
        self.boxes: list[dict[str, Any]] = []
        self.verdicts: dict[int, str] = {}
        self.step_evals: dict[int, list[dict[str, Any]]] = {}
        self.chain_evals: list[dict[str, Any]] = []
        self.pending_agent = False
        self.done = False
        self.final_passed: bool | None = None

    # ── event handling ──

    def handle(self, record: dict[str, Any]) -> None:
        event = record.get("event")

        if event == "session.start":
            self.session = self.session or record.get("session")
            self.agent = self.agent or record.get("agent")
            self.row = record.get("row") if record.get("row") is not None else self.row
            return

        if event == "trace.step":
            step = record.get("step")
            if step is None and self.boxes:
                step = self.boxes[-1].get("step")
            self.boxes.append({
                "actor": record.get("actor"),
                "action": record.get("action"),
                "content": record.get("content"),
                "target": record.get("target"),
                "with_": record.get("with_"),
                "step": step,
            })
            return

        if event == "agent.request":
            self.pending_agent = True
            return

        if event in ("agent.response", "agent.error"):
            self.pending_agent = False
            return

        if event == "behavior.match":
            step = record.get("step")
            if step is not None:
                if record.get("actor") == "user":
                    self.verdicts[step] = "sent"
                else:
                    self.verdicts[step] = "matched" if record.get("matched") else "failed"
            return

        if event == "behavior.skipped":
            step = record.get("step")
            if step is not None:
                self.verdicts[step] = "skipped"
            self.boxes.append({
                "actor": record.get("actor"),
                "action": record.get("action"),
                "content": f"⏭ skipped ({record.get('reason')})",
                "target": None,
                "with_": None,
                "step": step,
            })
            return

        if event == "evaluation.result":
            ev = {
                "type": record.get("evaluation_type"),
                "passed": record.get("passed"),
                "reason": record.get("reason"),
            }
            step = record.get("step")
            if step is None:
                self.chain_evals.append(ev)
            else:
                self.step_evals.setdefault(step, []).append(ev)
            return

        if event == "session.end":
            self.done = True
            self.final_passed = record.get("passed")
            return

    # ── rendering ──

    def _style(self, color: str) -> str:
        return color if self.use_color else "white"

    def render(self) -> Group:
        parts: list[Any] = []

        header = Text()
        header.append("● ", style="bold")
        header.append(self.session or "session", style="bold")
        if self.agent:
            header.append(f"  ·  {self.agent}", style="dim")
        if self.row is not None:
            header.append(f"  ·  row {self.row}", style="dim")
        if self.chain_evals or self.step_evals or self.verdicts:
            parts.append(header)
        else:
            parts.append(header)

        for idx, box in enumerate(self.boxes):
            parts.append(self._render_box(idx, box))

        if self.pending_agent:
            parts.append(Panel(
                Align.left(Text("agent pensando…", style="italic dim")),
                border_style=self._style("yellow"),
                title="⌛",
            ))

        if self.done:
            ok = self.final_passed
            label = "✅ PASSED" if ok else "❌ FAILED"
            color = "green" if ok else "red"
            parts.append(Rule(Text(label, style=self._style(color)), style=self._style(color)))
            if self.chain_evals:
                parts.append(self._render_chain_evals())

        return Group(*parts)

    def _render_box(self, idx: int, box: dict[str, Any]) -> Panel:
        actor = box.get("actor") or "?"
        label, color = ACTOR_META.get(actor, (str(actor), "white"))

        title_parts = [f"[{box['step']}] " if box.get("step") is not None else ""]
        title_parts.append(f"{label} {box.get('action') or ''}")
        if box.get("target"):
            title_parts.append(f" · {box['target']}")
        title = "".join(title_parts)

        body: list[str] = []
        content = box.get("content")
        if content is not None:
            if isinstance(content, (dict, list)):
                content = json.dumps(content, ensure_ascii=False, indent=2)
            body.append(_clip(content))
        if box.get("with_") is not None:
            body.append("with " + _clip(
                json.dumps(box["with_"], ensure_ascii=False, indent=2), max_lines=4,
            ))
        text = Text("\n\n".join(body)) if body else Text()

        footer = self._footer(box.get("step"))

        return Panel(
            text,
            title=title,
            title_align="left",
            border_style=self._style(color),
            subtitle=footer or None,
        )

    def _footer(self, step: Any) -> Text:
        footer = Text()
        if step is not None and step in self.verdicts:
            icon, color = _VERDICTS[self.verdicts[step]]
            footer.append(f"{icon} ", style=self._style(color))
        for ev in self.step_evals.get(step, []):
            ok = ev.get("passed")
            icon = "✅" if ok else "❌"
            color = "green" if ok else "red"
            footer.append(f"{icon} {ev.get('type')}", style=self._style(color))
            if ev.get("reason") and not ok:
                footer.append(f" — {_clip(ev['reason'], max_lines=1, width=50)}", style=self._style(color))
            footer.append("   ", style="dim")
        return footer

    def _render_chain_evals(self) -> Text:
        out = Text("chain evaluations: ", style="bold")
        for ev in self.chain_evals:
            ok = ev.get("passed")
            icon = "✅" if ok else "❌"
            color = "green" if ok else "red"
            out.append(f"{icon} {ev.get('type')}", style=self._style(color))
            if ev.get("reason") and not ok:
                out.append(f" — {_clip(ev['reason'], max_lines=1, width=50)}", style=self._style(color))
            out.append("   ", style="dim")
        return out
