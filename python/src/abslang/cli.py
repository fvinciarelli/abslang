#!/usr/bin/env python3
"""ABS CLI — Agent Behavior Specification command-line interface.

Commands:
    abs init         Scaffold a new ABS project
    abs run          Execute sessions against an agent
    abs report       View results from a previous run
    abs login        Log in to AI Evaluator for LLM-as-judge
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

import click

from . import __version__
from .parser import parse, parse_multi, load_dataset, resolve_variables, NormalizedSession
from .runner import run, AgentConfig, RunResult
from .formatters.table import format_table, format_json_output, format_junit
from .config import merge_config

SMOKE_SESSION = """session: Order status
description: User asks about an order. Happy path.
behaviors:
  - actor: user
    action: says
    content: "Where is my order {{orderId}}?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"

  - actor: user
    action: says
    content: "{{orderId}}"
    capture:
      orderId: "{{orderId}}"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"

  - actor: assistant
    action: informs
    content: "{{expectedResponse}}"
    evaluations:
      - type: contains
        value: "{{expectedKeyword}}"
"""

SMOKE_DATASET = [
    {"orderId": "12345", "expectedResponse": "Your order is on the way", "expectedKeyword": "on the way"},
    {"orderId": "67890", "expectedResponse": "Your order is being prepared", "expectedKeyword": "prepared"},
    {"orderId": "99999", "expectedResponse": "Your order has been delivered", "expectedKeyword": "delivered"},
]


def _run_async(coro):
    """Helper to run async coroutines from Click commands."""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def _parse_var_bindings(var_list: tuple[str, ...]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in var_list:
        if "=" in item:
            k, v = item.split("=", 1)
            result[k.strip()] = v.strip()
    return result


# ═══════════════════════════════════════════════════════════════════
#  CLI Group
# ═══════════════════════════════════════════════════════════════════

@click.group()
@click.version_option(version=__version__, prog_name="ABS CLI")
def main():
    """ABS — Agent Behavior Specification CLI.

    Describe, run, and evaluate AI agent interactions from the command line.

    \b
    Quick start:
        abs init
        abs run sessions/ --agent $AGENT_URL
        abs report report.json
    """
    pass


# ═══════════════════════════════════════════════════════════════════
#  init
# ═══════════════════════════════════════════════════════════════════

@main.command()
def init():
    """Initialize a new ABS project in the current directory."""
    cwd = Path.cwd()

    # 1. abs.config.yaml
    config_path = cwd / "abs.config.yaml"
    if not config_path.exists():
        config_path.write_text(
            "# ABS project configuration\n"
            "agent:\n"
            "  url: http://localhost:8080/chat\n"
            "  format: openai\n"
            "  auth: none\n"
            "\n"
            "adapters:\n"
            "  llm_judge: aievaluator\n"
            "\n"
            "defaults:\n"
            "  timeout: 300\n"
        )
        click.echo("✅ Created abs.config.yaml")
    else:
        click.echo("⏭️  abs.config.yaml already exists, skipping")

    # 2. sessions/
    sessions_dir = cwd / "sessions"
    sessions_dir.mkdir(exist_ok=True)
    session_path = sessions_dir / "order-status.abs.yaml"
    if not session_path.exists():
        session_path.write_text(SMOKE_SESSION)
        click.echo("✅ Created sessions/order-status.abs.yaml")
    else:
        click.echo("⏭️  sessions/order-status.abs.yaml already exists, skipping")

    # 3. datasets/
    datasets_dir = cwd / "datasets"
    datasets_dir.mkdir(exist_ok=True)
    dataset_path = datasets_dir / "order-status.jsonl"
    if not dataset_path.exists():
        dataset_path.write_text(
            "\n".join(json.dumps(r) for r in SMOKE_DATASET) + "\n"
        )
        click.echo("✅ Created datasets/order-status.jsonl (3 rows)")
    else:
        click.echo("⏭️  datasets/order-status.jsonl already exists, skipping")

    # 4. .gitignore
    gitignore_path = cwd / ".gitignore"
    entry = "abs.config.yaml"
    lines = gitignore_path.read_text().split("\n") if gitignore_path.exists() else []
    if entry not in lines:
        with open(gitignore_path, "a") as f:
            if lines and lines[-1].strip() != "":
                f.write("\n")
            f.write(f"{entry}\n")
        click.echo(f"✅ Added {entry} to .gitignore")

    click.echo()
    click.echo("Next steps:")
    click.echo("  abs run sessions/order-status.abs.yaml --agent $AGENT_URL")
    click.echo("  abs run sessions/order-status.abs.yaml --agent $AGENT_URL --dataset datasets/order-status.jsonl")


# ═══════════════════════════════════════════════════════════════════
#  run
# ═══════════════════════════════════════════════════════════════════

@main.command(name="run")
@click.argument("session", required=True)
@click.option("--agent", help="Agent endpoint URL", default=None)
@click.option("--dataset", "dataset_path", help="Dataset file (.json or .jsonl)", default=None)
@click.option("--var", "variables", multiple=True, help="Single variable binding (repeatable: --var key=value)")
@click.option("--filter", "filter_kv", help="Filter dataset rows by key:value")
@click.option("--agent-format", help="openai, claude, or gemini", default="openai")
@click.option("--agent-auth", help="none, api_key, bearer, or oauth2", default="none")
@click.option("--agent-token", help="Token or API key", default=None)
@click.option("--adapter", "adapters", multiple=True, help="Evaluator adapter binding (--adapter llm_judge=aievaluator)")
@click.option("--format", "output_format", help="table, json, or junit", default="table")
@click.option("--ci", is_flag=True, help="CI mode (no colors, no prompts)")
@click.option("--output", "output_file", help="Write report to file")
@click.option("--parallel", type=int, default=1, help="Run N dataset rows in parallel")
def run_cmd(
    session: str,
    agent: Optional[str],
    dataset_path: Optional[str],
    variables: tuple[str, ...],
    filter_kv: Optional[str],
    agent_format: str,
    agent_auth: str,
    agent_token: Optional[str],
    adapters: tuple[str, ...],
    output_format: str,
    ci: bool,
    output_file: Optional[str],
    parallel: int,
):
    """Execute ABS sessions against an agent.

    \b
    Examples:
        abs run sessions/order-status.abs.yaml --agent http://localhost:8080/chat
        abs run sessions/order-status.abs.yaml --agent $URL --dataset datasets/cases.jsonl
        abs run sessions/order-status.abs.yaml --agent $URL --var orderId=12345
        abs run sessions/ --agent $URL --dataset datasets/
    """
    agent_url = agent or os.environ.get("ABS_AGENT_URL")
    
    # Load config file and merge with CLI options (CLI wins)
    cfg = merge_config({
        "agent_url": agent_url,
        "agent_format": agent_format,
        "agent_auth": agent_auth,
        "agent_token": agent_token,
    })
    agent_url = cfg["agent_url"]
    agent_format = cfg["agent_format"]
    agent_auth = cfg["agent_auth"]
    agent_token = cfg["agent_token"]
    
    if not agent_url:
        click.echo("❌ Provide --agent or set ABS_AGENT_URL.", err=True)
        sys.exit(2)

    # Configure AI Evaluator
    for adapter_spec in adapters:
        if "=" in adapter_spec:
            etype, provider = adapter_spec.split("=", 1)
            if provider.strip() == "aievaluator":
                __import__('abslang.evaluators.adapters.aievaluator', fromlist=['configure']).configure(
                    api_key=os.environ.get("AIEVALUATOR_API_KEY"),
                    engine_url=os.environ.get("AIEVALUATOR_ENGINE_URL"),
                )

    agent_config = AgentConfig(
        url=agent_url,
        format=agent_format,
        auth=agent_auth,
        token=agent_token or os.environ.get("ABS_AGENT_TOKEN"),
    )

    # Parse runtime vars
    runtime_vars = _parse_var_bindings(variables)
    for key, value in os.environ.items():
        if key.startswith("ABS_VAR_") and value:
            runtime_vars[key.replace("ABS_VAR_", "")] = value

    # Parse session(s)
    try:
        sessions = parse_multi(session)
    except Exception as e:
        click.echo(f"❌ {e}", err=True)
        sys.exit(2)

    # Load dataset
    dataset: list[dict[str, Any]] | None = None
    if dataset_path:
        try:
            dataset = load_dataset(dataset_path)
        except Exception as e:
            click.echo(f"❌ Cannot load dataset: {e}", err=True)
            sys.exit(2)
        if filter_kv and ":" in filter_kv:
            fk, fv = filter_kv.split(":", 1)
            dataset = [row for row in dataset if str(row.get(fk, "")) == fv]

    # Run
    all_results: list[dict[str, Any]] = []

    async def _run_all():
        nonlocal all_results

        async def run_one(sess: NormalizedSession, vars_dict: dict[str, Any]):
            import copy
            sess_copy = copy.deepcopy(sess)
            sess_copy.behaviors = resolve_variables(sess_copy.behaviors, vars_dict)
            result = await run(sess_copy, agent_config)
            return {"result": result, "row_vars": vars_dict}

        if dataset:
            # Parallel execution with semaphore
            sem = asyncio.Semaphore(parallel)
            async def run_with_semaphore(row: dict[str, Any]):
                async with sem:
                    vars_combined = {**runtime_vars, **row}
                    tasks = []
                    for sess in sessions:
                        tasks.append(run_one(sess, vars_combined))
                    return await asyncio.gather(*tasks)
            
            all_batches = await asyncio.gather(*[run_with_semaphore(row) for row in dataset])
            for batch in all_batches:
                all_results.extend(batch)
        elif runtime_vars:
            for sess in sessions:
                all_results.append(await run_one(sess, runtime_vars))
        else:
            for sess in sessions:
                all_results.append(await run_one(sess, {}))

    _run_async(_run_all())

    # Aggregate
    rows_total = len(all_results)
    rows_passed = sum(1 for r in all_results if r["result"].passed)
    overall_passed = all(r["result"].passed for r in all_results)

    # Format output
    if output_format == "json":
        output = json.dumps({
            "passed": overall_passed,
            "rows_total": rows_total,
            "rows_passed": rows_passed,
            "results": [
                {
                    "session": r["result"].session,
                    "row_vars": r["row_vars"],
                    "passed": r["result"].passed,
                    "steps_total": r["result"].steps_total,
                    "steps_matched": r["result"].steps_matched,
                    "evaluations_total": r["result"].evaluations_total,
                    "evaluations_passed": r["result"].evaluations_passed,
                    "trace": [
                        {
                            "step": s.step,
                            "behavior": {
                                "actor": s.behavior.actor,
                                "action": s.behavior.action,
                                "target": s.behavior.target,
                            },
                            "matched": s.matched,
                            "sent": s.sent,
                            "observed": {
                                "actor": s.observed.actor if s.observed else None,
                                "action": s.observed.action if s.observed else None,
                                "target": s.observed.target if s.observed else None,
                                "content": str(s.observed.content) if s.observed else None,
                            } if s.observed else None,
                            "evaluations": [
                                {"type": e.type, "passed": e.passed, "score": e.score, "reason": e.reason}
                                for e in s.evaluations
                            ],
                        }
                        for s in r["result"].steps
                    ],
                    "chain_evaluations": [
                        {"type": e.type, "passed": e.passed, "score": e.score, "reason": e.reason}
                        for e in r["result"].chain_evaluations
                    ],
                }
                for r in all_results
            ],
        }, indent=2, default=str)
    elif output_format == "junit":
        all_evals = []
        for r in all_results:
            rr = r["result"]
            for s in rr.steps:
                for e in s.evaluations:
                    all_evals.append((rr.session, s.step, e, False))
            for e in rr.chain_evaluations:
                all_evals.append((rr.session, None, e, True))

        failures = sum(1 for _, _, e, _ in all_evals if not e.passed)
        import xml.sax.saxutils as saxutils
        output = '<?xml version="1.0" encoding="UTF-8"?>\n'
        output += f'<testsuite name="ABS" tests="{len(all_evals)}" failures="{failures}" errors="0">\n'
        for sess_name, step_num, ev, is_chain in all_evals:
            name = f"[{sess_name}] {'Chain' if is_chain else f'Step {step_num}'}: {ev.type}"
            output += f'  <testcase classname="ABS" name="{saxutils.escape(name)}" time="0">\n'
            if not ev.passed:
                output += f'    <failure message="{saxutils.escape(ev.reason)}">{saxutils.escape(ev.reason)}</failure>\n'
            output += '  </testcase>\n'
        output += '</testsuite>\n'
    else:
        # Table — single result or aggregated
        if len(all_results) == 1:
            output = format_table(all_results[0]["result"])
        else:
            lines = [
                "┌──────────────────────────────────────────────────────────────┐",
                "│  ABS — Results                                               │",
                "├──────────────────────────────────────────────────────────────┤",
                f"│  Session:  {all_results[0]['result'].session:<52}│",
                f"│  Agent:    {agent_url:<52}│",
                f"│  Dataset:  {rows_total:<52} rows│",
            ]
            status = "✅ PASSED" if overall_passed else "❌ FAILED"
            lines.append(f"│  Result:   {status:<62}│")
            lines.append(f"│  Rows:     {rows_passed}/{rows_total} passed · {rows_total - rows_passed} failed".ljust(64) + "│")
            lines.append("├──────┬──────────────────────────────┬──────────┬─────────────┤")
            lines.append("│  Row │ Variables                    │ Steps    │ Evaluations │")
            lines.append("├──────┼──────────────────────────────┼──────────┼─────────────┤")

            for i, r in enumerate(all_results):
                rr = r["result"]
                vars_str = " ".join(f"{k}={v}" for k, v in r["row_vars"].items()) if r["row_vars"] else "(none)"
                vars_str = vars_str[:28].ljust(28)
                steps_str = f'{rr.steps_matched}/{rr.steps_total} {"✅" if rr.steps_matched == rr.steps_total else "❌"}'
                steps_str = steps_str.ljust(8)
                evals_str = f'{rr.evaluations_passed}/{rr.evaluations_total} {"✅" if rr.evaluations_passed == rr.evaluations_total else "❌"}'
                evals_str = evals_str.ljust(11)
                lines.append(f"│ {str(i+1).rjust(4)} │ {vars_str} │ {steps_str} │ {evals_str} │")

            lines.append("└──────┴──────────────────────────────┴──────────┴─────────────┘")

            if not overall_passed:
                lines.append("")
                lines.append(f"❌ {rows_total - rows_passed} rows failed.")
                for r in all_results:
                    rr = r["result"]
                    if not rr.passed:
                        vars_str = ", ".join(f"{k}={v}" for k, v in r["row_vars"].items()) if r["row_vars"] else ""
                        lines.append(f"\n  Row ({vars_str}):")
                        for s in rr.steps:
                            for e in s.evaluations:
                                if not e.passed:
                                    lines.append(f"    Step {s.step} — {e.type}: {e.reason}")
                        for e in rr.chain_evaluations:
                            if not e.passed:
                                lines.append(f"    Chain — {e.type}: {e.reason}")

            output = "\n".join(lines)

    if output_file:
        Path(output_file).write_text(output)
        click.echo(f"Report written to {output_file}")
    else:
        click.echo(output)

    sys.exit(0 if overall_passed else 1)


# ═══════════════════════════════════════════════════════════════════
#  report
# ═══════════════════════════════════════════════════════════════════

@main.command()
@click.argument("file", required=True)
@click.option("--format", "output_format", help="table, json, or junit", default="table")
@click.option("--failed", is_flag=True, help="Show only failed cases")
@click.option("--detail", type=int, help="Show full trace for a specific row")
def report(file: str, output_format: str, failed: bool, detail: Optional[int]):
    """View results from a previous run."""
    try:
        data = json.loads(Path(file).read_text())
    except Exception as e:
        click.echo(f"❌ Cannot read report: {e}", err=True)
        sys.exit(2)

    if output_format == "json":
        click.echo(json.dumps(data, indent=2))
    else:
        # Reconstruct RunResult
        results = data.get("results", [data])
        for r in results:
            if "trace" in r:
                click.echo(f"Session: {r.get('session', '')}")
                click.echo(f"Passed: {'✅' if r.get('passed') else '❌'}")
                if r.get("row_vars"):
                    click.echo(f"Variables: {r['row_vars']}")


# ═══════════════════════════════════════════════════════════════════
#  login
# ═══════════════════════════════════════════════════════════════════

@main.command()
@click.option("--api-key", help="AI Evaluator API key", default=None)
def login(api_key: Optional[str]):
    """Log in to AI Evaluator for LLM-as-judge evaluations."""
    key = api_key or os.environ.get("AIEVALUATOR_API_KEY")
    if not key:
        click.echo("Enter your AI Evaluator API key:")
        click.echo("(Get one at https://aievaluator.dev/settings)")
        key = click.prompt("API key", hide_input=False).strip()

    if not key:
        click.echo("❌ API key cannot be empty.", err=True)
        sys.exit(2)

    __import__('abslang.evaluators.adapters.aievaluator', fromlist=['configure']).configure(api_key=key)
    click.echo("✅ Logged in to AI Evaluator")


# ═══════════════════════════════════════════════════════════════════
#  generate-ci
# ═══════════════════════════════════════════════════════════════════

@main.command("generate-ci")
@click.option("--platform", type=click.Choice(["github", "gitlab"]), default="github", help="CI/CD platform")
@click.option("--session", default="./sessions/", help="Session path")
@click.option("--dataset", default="./datasets/", help="Dataset path")
@click.option("--agent", default=None, help="Agent URL (uses ABS_AGENT_URL env var if not set)")
@click.option("--output", "output_file", default=None, help="Output file (default: stdout)")
def generate_ci(platform: str, session: str, dataset: str, agent: str | None, output_file: str | None):
    """Generate a CI/CD workflow for GitHub Actions or GitLab CI."""
    agent_url = agent or "${{ vars.STAGING_AGENT_URL }}"

    if platform == "gitlab":
        snippet = f"""# GitLab CI — ABS Agent Quality Gate
# Generated by abs generate-ci
# Place in .gitlab-ci.yml or include in your existing pipeline

abs-quality-gate:
  stage: test
  image: python:3.12
  before_script:
    - pip install abs-lang
  script:
    - |
      abs run {session} \\
        --agent $AGENT_URL \\
        --dataset {dataset} \\
        --format junit \\
        --ci > report.xml
  artifacts:
    reports:
      junit: report.xml
    when: always
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  variables:
    AGENT_URL: "{agent_url}"
"""
    else:
        snippet = f"""# GitHub Actions — ABS Agent Quality Gate
# Generated by abs generate-ci
# Place in .github/workflows/abs-quality-gate.yml

name: ABS Agent Quality Gate

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install ABS
        run: pip install abs-lang

      - name: Run ABS evaluations
        env:
          ABS_AGENT_URL: ${{{{ vars.STAGING_AGENT_URL }}}}
        run: |
          abs run {session} \\
            --agent $ABS_AGENT_URL \\
            --dataset {dataset} \\
            --format junit \\
            --ci > report.xml

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: abs-report
          path: report.xml

      - name: Publish test results
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: ABS Results
          path: report.xml
          reporter: java-junit
"""

    if output_file:
        Path(output_file).write_text(snippet)
        click.echo(f"✅ Workflow written to {output_file}")
    else:
        click.echo(snippet)


# ═══════════════════════════════════════════════════════════════════
#  Entry point
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    main()
