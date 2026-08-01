# CLI

> `abs init`, `abs run`, `abs report`. Three commands that take ABS from a file on disk to a quality gate in CI.

The CLI is the first thing anyone touches. It has to make two people happy at the same time:

- **QA**: "Quiero correr esto contra staging y ver si pasó o no, ya."
- **Data**: "Tengo 200 casos en un JSONL. Dame un reporte agregado."

Both should succeed on their first try.

---

## The three commands

```
abs init                    # Scaffold a project
abs run                     # Execute sessions against an agent
abs report                  # View results from a previous run
```

That's the surface. Everything else is flags.

---

## abs init

Creates a project skeleton in the current directory:

```bash
abs init
```

```
✅ Created abs.config.yaml
✅ Created sessions/order-status.abs.yaml (example session)
✅ Created datasets/order-status.jsonl (example dataset, 3 rows)
✅ Added abs.config.yaml to .gitignore
```

What gets created:

```
.
├── abs.config.yaml              # Project-level config (gitignored)
├── sessions/
│   └── order-status.abs.yaml    # Example session with {{placeholders}}
└── datasets/
    └── order-status.jsonl       # 3 rows that bind those placeholders
```

The example session and dataset are deliberately small but real. Someone can run `abs run` immediately after `abs init` and see a result.

### The example session

```yaml
# sessions/order-status.abs.yaml
session: Order status
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
```

### The example dataset

```jsonl
{"orderId": "12345", "expectedResponse": "Your order is on the way", "expectedKeyword": "on the way"}
{"orderId": "67890", "expectedResponse": "Your order is being prepared", "expectedKeyword": "prepared"}
{"orderId": "99999", "expectedResponse": "Your order has been delivered", "expectedKeyword": "delivered"}
```

---

## abs run

Executes one or more Sessions against an agent.

### Simplest invocation

```bash
abs run sessions/order-status.abs.yaml --agent http://localhost:8080/chat
```

Runs the session once. The `{{orderId}}` placeholder resolves to nothing (empty string) — useful for a smoke test where the session is fully self-contained.

### With a single variable override

```bash
abs run sessions/order-status.abs.yaml --agent $URL --var orderId=12345
```

Runs once with `orderId` bound to `12345`. Quick one-off, no dataset file needed.

### With a dataset — the big one

```bash
abs run sessions/order-status.abs.yaml --agent $URL --dataset datasets/order-status.jsonl
```

Runs the session once per row in the dataset. Three rows, three runs. The report aggregates everything.

### With a dataset and a filter

```bash
abs run sessions/order-status.abs.yaml --agent $URL --dataset datasets/order-status.jsonl --filter "orderId:12345"
```

Runs only rows where `orderId` equals `12345`. Useful during development.

### Multiple sessions at once

```bash
abs run sessions/ --agent $URL --dataset datasets/
```

Runs every `.abs.yaml` in the directory against every `.jsonl` whose filename starts with the same prefix. `order-status.abs.yaml` pairs with `order-status.jsonl`, `booking.abs.yaml` pairs with `booking.jsonl`.

### All flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `[session]` | Yes | — | Path to a `.abs.yaml` file or a directory of sessions |
| `--agent` | Yes | — | Agent endpoint URL |
| `--dataset` | No | — | Path to a `.json` or `.jsonl` dataset file or directory |
| `--var` | No | — | Single variable binding (repeatable: `--var key=value`) |
| `--filter` | No | — | Filter rows by key:value |
| `--agent-format` | No | `openai` | `openai`, `claude`, `gemini`, or `custom` |
| `--agent-auth` | No | `none` | `none`, `api_key`, `bearer`, `oauth2` |
| `--agent-token` | No | — | Token or API key value |
| `--agent-refresh-url` | No | — | OAuth2 token refresh URL |
| `--agent-refresh-token` | No | — | OAuth2 refresh token |
| `--adapter` | No | — | Evaluator adapter binding (repeatable: `--adapter llm_judge=azure`) |
| `--format` | No | `table` | `table`, `json`, `junit` |
| `--ci` | No | `false` | CI mode (no colors, no prompts) |
| `--timeout` | No | `300` | Timeout per session run in seconds |
| `--output` | No | — | Write report to file instead of stdout |
| `--parallel` | No | `1` | Number of dataset rows to run in parallel |

### Environment variables

Every flag can also be set via environment variable:

| Variable | Equivalent flag |
|----------|----------------|
| `ABS_AGENT_URL` | `--agent` |
| `ABS_AGENT_FORMAT` | `--agent-format` |
| `ABS_AGENT_AUTH` | `--agent-auth` |
| `ABS_AGENT_TOKEN` | `--agent-token` |
| `ABS_ADAPTER_LLM_JUDGE` | `--adapter llm_judge=...` |
| `ABS_VAR_orderId` | `--var orderId=...` |

---

## abs report

Reads a JSON report from a previous `abs run --output` and displays it.

```bash
abs run session.abs.yaml --agent $URL --output report.json
abs report report.json
```

```bash
abs report report.json --format table   # Default, human-readable
abs report report.json --format json    # Machine-readable, same as the input
abs report report.json --format junit   # CI integration
abs report report.json --failed         # Show only failed cases
abs report report.json --detail 3       # Show full trace for case #3
```

---

## The report: one or many runs

When a dataset has multiple rows, `abs run` produces an aggregated report.

### One row, passed

```bash
abs run session.abs.yaml --agent $URL --var orderId=12345
```

```
┌──────────────────────────────────────────────────────────────┐
│  ABS — Results                                               │
├──────────────────────────────────────────────────────────────┤
│  Session:  order-status                                      │
│  Agent:    http://localhost:8080/chat                         │
│  Dataset:  (none — single run)                               │
│  Result:   ✅ PASSED                                         │
│  Steps:    5/5 matched · 3/3 evaluations passed              │
├────┬────────────────────────────────────┬──────────┬─────────┤
│  # │ Step                               │ Result   │         │
├────┼────────────────────────────────────┼──────────┼─────────┤
│  1 │ user says "Where is my order 12..." │    →     │   sent  │
│  2 │ assistant asks "order number"      │    ✅    │  match  │
│  3 │ user says "12345"                  │    →     │   sent  │
│  4 │ assistant calls Order MCP          │    ✅    │  match  │
│  5 │ assistant informs "on the way"     │    ✅    │  match  │
│    │   └─ contains "on the way"         │    ✅    │   pass  │
│  C │ sequence: asks → calls → informs   │    ✅    │   pass  │
│  C │ variable_consistency: orderId      │    ✅    │   pass  │
└────┴────────────────────────────────────┴──────────┴─────────┘
```

### Multiple rows (dataset), aggregated

```bash
abs run session.abs.yaml --agent $URL --dataset cases.jsonl
```

```
┌──────────────────────────────────────────────────────────────┐
│  ABS — Results                                               │
├──────────────────────────────────────────────────────────────┤
│  Session:  order-status                                      │
│  Agent:    http://localhost:8080/chat                         │
│  Dataset:  cases.jsonl (200 rows)                            │
│  Result:   ❌ FAILED                                         │
│  Rows:     197/200 passed · 3 failed                         │
│  Steps:    995/1000 matched · 597/600 evaluations passed     │
├──────┬──────────────────────────────┬──────────┬─────────────┤
│  Row │ Variables                    │ Steps    │ Evaluations │
├──────┼──────────────────────────────┼──────────┼─────────────┤
│    1 │ orderId=12345                │  5/5 ✅  │  3/3  ✅    │
│    2 │ orderId=67890                │  5/5 ✅  │  3/3  ✅    │
│    3 │ orderId=99999                │  5/5 ✅  │  2/3  ❌    │
│  ... │                              │          │             │
│  200 │ orderId=55555                │  4/5 ❌  │  2/3  ❌    │
└──────┴──────────────────────────────┴──────────┴─────────────┘

❌ 3 rows failed.

  Row 3 (orderId=99999):
    Step 5 — assistant informs:
      Expected keyword: "delivered"
      Observed: "Your order has been cancelled"
      ❌ contains "delivered" → FAILED

  Row 198 (orderId=44444):
    Step 4 — assistant calls Order MCP:
      Expected target: Order MCP
      Observed: (agent said "I don't understand" instead)
      ❌ Step not matched

  Row 200 (orderId=55555):
    Step 4 — assistant calls Order MCP:
      ❌ Step not matched
    Step 5 — assistant informs:
      ❌ contains "on the way" → FAILED

Run `abs report --detail 3` to see the full trace for row 3.
```

### JSON output (`--format json`)

```json
{
  "session": "order-status",
  "agent": "http://localhost:8080/chat",
  "passed": false,
  "rows_total": 200,
  "rows_passed": 197,
  "rows_failed": 3,
  "rows": [
    {
      "row": 1,
      "variables": { "orderId": "12345" },
      "passed": true,
      "steps_matched": 5,
      "steps_total": 5,
      "evaluations_passed": 3,
      "evaluations_total": 3,
      "trace": [
        { "step": 1, "actor": "user", "action": "says", "sent": true },
        { "step": 2, "actor": "assistant", "action": "asks", "matched": true },
        { "step": 3, "actor": "user", "action": "says", "sent": true },
        {
          "step": 4,
          "actor": "assistant", "action": "calls",
          "matched": true,
          "observed": { "target": "Order MCP", "with": { "orderId": "12345" } }
        },
        {
          "step": 5,
          "actor": "assistant", "action": "informs",
          "matched": true,
          "observed_content": "Your order is on the way",
          "evaluations": [
            { "type": "contains", "value": "on the way", "passed": true, "score": 1.0 }
          ]
        }
      ]
    }
    // ... 199 more rows
  ]
}
```

---

## Config file

`abs.config.yaml` stores project-level settings so you don't retype them every time:

```yaml
# abs.config.yaml
agent:
  url: http://localhost:8080/chat
  format: openai
  auth: none

adapters:
  llm_judge: aievaluator

defaults:
  dataset: datasets/
  timeout: 120
```

Everything in the config can be overridden by CLI flags. Everything in CLI flags can be overridden by environment variables. The rule is:

```
CLI flag  >  environment variable  >  config file  >  built-in default
```

---

## CI/CD integration

### Generate a workflow

```bash
abs generate-ci --platform github
abs generate-ci --platform gitlab
```

Produces a workflow file that runs `abs run` on every PR. Same pattern as the AI Evaluator CLI's `generate-ci` command.

### Direct use in any pipeline

```bash
abs run sessions/ --agent $STAGING_AGENT --dataset datasets/ --format junit --ci > report.xml
```

Exit code 0 if all sessions passed. Exit code 1 if any failed. Standard Unix semantics — drops straight into any CI system.

---

## What the CLI is not

- Not a dashboard. `abs report` gives you a terminal view; for dashboards, use the JSON output and pipe it anywhere.
- Not an agent builder. It tests agents, it doesn't create them.
- Not a replacement for the AI Evaluator CLI. AI Evaluator evaluates prompt/response pairs with LLM-as-judge metrics. ABS evaluates full conversational sequences with behavioral assertions. They complement each other — and ABS can use AI Evaluator as its LLM-judge adapter.

---

## The four personas the CLI serves

| Persona | What they type | What they get |
|---------|---------------|---------------|
| **QA engineer** | `abs run session.abs.yaml --agent $STAGING --dataset regression.jsonl --format junit --ci` | A JUnit report that blocks the deploy if it fails |
| **Data scientist** | `abs run session.abs.yaml --agent $URL --dataset 200-cases.jsonl --output report.json` | A JSON artifact to analyze offline |
| **Product owner** | `abs report report.json` | A table that says 197/200 passed, with the 3 failures explained in plain English |
| **Developer** | `abs run session.abs.yaml --agent localhost:8080 --var orderId=12345` | Instant feedback during development, no dataset needed |

One file. Four use cases. That's the goal.
