"""Smoke tests for the live pretty-trace renderer (spike)."""

from rich.console import Console

from abslang.live_trace import LiveTraceRenderer, _clip


def test_clip_truncates_long_content():
    assert _clip("a" * 200, max_lines=2, width=10) == "aaaaaaaaaa…"
    assert _clip("a\nb\nc\nd", max_lines=2) == "a\nb\n… (+2 more lines)"


def test_renderer_collects_events_and_renders():
    r = LiveTraceRenderer(use_color=False)

    r.handle({"event": "session.start", "session": "Order status", "agent": "http://x"})
    r.handle({"event": "trace.step", "step": 1, "actor": "user", "action": "says", "content": "Where is my order?"})
    r.handle({"event": "agent.request", "step": 1})
    assert r.pending_agent is True
    r.handle({"event": "agent.response", "step": 1})
    assert r.pending_agent is False
    r.handle({"event": "trace.step", "actor": "assistant", "action": "responds", "content": "Please provide your order number."})
    r.handle({"event": "behavior.match", "step": 1, "actor": "user", "action": "says", "matched": True})
    r.handle({"event": "evaluation.result", "step": 1, "evaluation_type": "contains", "passed": False, "reason": "nope"})
    r.handle({"event": "session.end", "passed": False})

    console = Console(width=100, force_terminal=False, color_system=None)
    from rich.console import Group
    assert isinstance(r.render(), Group)
    # render without crashing
    with console.capture() as cap:
        console.print(r.render())
    text = cap.get()
    assert "User says" in text
    assert "Where is my order?" in text
    assert "Assistant responds" in text
    assert "❌ FAILED" in text
    assert "contains" in text


def test_verdict_and_evals_badges():
    r = LiveTraceRenderer(use_color=False)
    r.handle({"event": "trace.step", "step": 2, "actor": "assistant", "action": "informs", "content": "ok"})
    r.handle({"event": "behavior.match", "step": 2, "actor": "assistant", "action": "informs", "matched": True})
    r.handle({"event": "evaluation.result", "step": 2, "evaluation_type": "contains", "passed": True})
    r.handle({"event": "evaluation.result", "step": None, "evaluation_type": "chain_rule", "passed": False, "reason": "bad"})
    r.handle({"event": "session.end", "passed": False})

    console = Console(width=100, force_terminal=False, color_system=None)
    with console.capture() as cap:
        console.print(r.render())
    text = cap.get()
    assert "✅" in text
    assert "chain_rule" in text


def test_skipped_behavior_adds_box():
    r = LiveTraceRenderer(use_color=False)
    r.handle({"event": "behavior.skipped", "step": 3, "actor": "assistant", "action": "asks", "reason": "optional"})
    assert len(r.boxes) == 1
    assert r.verdicts == {3: "skipped"}
