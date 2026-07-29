"""Output formatters: table (rich), JSON, JUnit XML."""

import json
import xml.sax.saxutils as saxutils

from rich.console import Console
from rich.table import Table
from rich.text import Text

from ..runner import RunResult


def _escape_xml(s: str) -> str:
    return saxutils.escape(s)


def format_table(result: RunResult) -> str:
    """Format a single RunResult as a rich table."""
    console = Console(force_terminal=True, width=100)
    table = Table(title="ABS — Results", show_header=True, header_style="bold")
    table.add_column("#", width=4)
    table.add_column("Step", width=36)
    table.add_column("Result", width=10)
    table.add_column("", width=9)

    for step in result.steps:
        desc = f"{step.behavior.actor} {step.behavior.action}"
        if step.behavior.target:
            desc += f" {step.behavior.target}"
        content = step.behavior.content
        if isinstance(content, str):
            desc += f' "{content[:20]}"'
        elif content:
            desc += f" {json.dumps(content)[:20]}"

        if step.sent:
            table.add_row(str(step.step), desc[:34], "→", "sent")
        elif step.matched:
            table.add_row(str(step.step), desc[:34], "✅", "match")
            for ev in step.evaluations:
                ev_desc = ev.type[:28]
                ev_result = "✅" if ev.passed else "❌"
                ev_label = "pass" if ev.passed else "FAIL"
                table.add_row("", f"  └─ {ev_desc}", ev_result, ev_label)
        else:
            table.add_row(str(step.step), desc[:34], "❌", "no match")

    for ev in result.chain_evaluations:
        ev_desc = f"chain: {ev.type}"[:34]
        ev_result = "✅" if ev.passed else "❌"
        ev_label = "pass" if ev.passed else "FAIL"
        table.add_row("C", ev_desc, ev_result, ev_label)

    # Capture table as string
    with console.capture() as capture:
        console.print(table)
        console.print(f"\nSession: {result.session}")
        console.print(f"Agent: {result.agent}")
        status = "✅ PASSED" if result.passed else "❌ FAILED"
        style = "green" if result.passed else "red"
        console.print(f"Result: [{style}]{status}[/{style}]")
        console.print(
            f"Steps: {result.steps_matched}/{result.steps_total} matched · "
            f"{result.evaluations_passed}/{result.evaluations_total} evaluations passed"
        )

        if not result.passed:
            console.print()
            console.print("[red]❌ Some evaluations failed:[/red]")
            for step in result.steps:
                for ev in step.evaluations:
                    if not ev.passed:
                        console.print(f"[red]  Step {step.step} — {ev.type}: {ev.reason}[/red]")
            for ev in result.chain_evaluations:
                if not ev.passed:
                    console.print(f"[red]  Chain — {ev.type}: {ev.reason}[/red]")

    return capture.get()


def format_json_output(result: RunResult) -> str:
    """Format a RunResult as JSON."""
    return json.dumps({
        "session": result.session,
        "agent": result.agent,
        "passed": result.passed,
        "steps_total": result.steps_total,
        "steps_matched": result.steps_matched,
        "evaluations_total": result.evaluations_total,
        "evaluations_passed": result.evaluations_passed,
        "trace": [
            {
                "step": s.step,
                "behavior": {
                    "actor": s.behavior.actor,
                    "action": s.behavior.action,
                    "target": s.behavior.target,
                    "content": s.behavior.content,
                },
                "matched": s.matched,
                "sent": s.sent,
                "observed": {
                    "actor": s.observed.actor,
                    "action": s.observed.action,
                    "target": s.observed.target,
                    "content": s.observed.content,
                } if s.observed else None,
                "evaluations": [
                    {
                        "type": e.type,
                        "passed": e.passed,
                        "score": e.score,
                        "reason": e.reason,
                    }
                    for e in s.evaluations
                ],
            }
            for s in result.steps
        ],
        "chain_evaluations": [
            {"type": e.type, "passed": e.passed, "score": e.score, "reason": e.reason}
            for e in result.chain_evaluations
        ],
    }, indent=2, default=str)


def format_junit(result: RunResult) -> str:
    """Format a RunResult as JUnit XML."""
    all_evals = []
    for s in result.steps:
        for e in s.evaluations:
            all_evals.append((s.step, e, False))
    for e in result.chain_evaluations:
        all_evals.append((None, e, True))

    failures = sum(1 for _, e, _ in all_evals if not e.passed)
    total = len(all_evals)

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += f'<testsuite name="ABS: {_escape_xml(result.session)}" tests="{total}" failures="{failures}" errors="0">\n'

    for step_num, ev, is_chain in all_evals:
        name = f'{"Chain" if is_chain else f"Step {step_num}"}: {ev.type}'
        xml += f'  <testcase classname="ABS" name="{_escape_xml(name)}" time="0">\n'
        if not ev.passed:
            xml += f'    <failure message="{_escape_xml(ev.reason)}">\n'
            xml += f'      Type: {_escape_xml(ev.type)}\n'
            xml += f'      Reason: {_escape_xml(ev.reason)}\n'
            xml += f'    </failure>\n'
        xml += f'  </testcase>\n'

    xml += '</testsuite>\n'
    return xml
