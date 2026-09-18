# Explaining an abslang run result (QA/PM language)

If the user pastes any of these, explain what happened without jargon:
- JSON report: `{"run_id": ..., "results": [...]}` (from `--format json` or `--output`)
- JSONL event log: one JSON per line with `"event": "evaluation.result"` etc.
- A trace excerpt: `trace`, `observed`, `evaluations`.

Structure the answer:
1. One-line verdict: N of M rows passed, and what failed.
2. What ran: session, agent URL, dataset rows.
3. A short table of failures: Row | Step | Evaluation | Code | Meaning | What to change.
4. If everything passed: one line, plus the strongest checks (strict thresholds, adapters used).
5. The next command to inspect a failure: `abslang report <file> --detail <row>`.

## Report shape (stable in both languages)

- Top level: `run_id`, `passed`, `rows_total`, `rows_passed`, `results[]`.
- Per row (`results[i]`): `session`, `row_index`, `row_vars`, `passed`, `steps_total`, `steps_matched`, `evaluations_total`, `evaluations_passed`, `trace[]`, `chain_evaluations[]`.
- Per step (`trace[i]`): `step`, `behavior {id, actor, action, target, optional}`, `matched`, `sent`, `skipped`, `observed`, `evaluations[]`.
  - `sent: true` = a user/tool step was sent to the agent
  - `matched: true` = an agent step matched the expectation
  - `skipped: true` = an optional behavior the agent correctly did not do
  - `observed` = what the agent actually did: `actor`, `action`, `target`, `content`, `with` (tool-call arguments), `tool_call_id`
- Per evaluation: `type`, `passed`, `score`, `reason`, `blocking`, `inconclusive`, plus when set: `code`, `details`, `threshold`, `adapter`, `duration_ms`.
  - `inconclusive: true` = a blocking evaluation failed earlier, so this one could not be judged (not a failure by itself)
  - `score` below `threshold` = failed
- `chain_evaluations` = session-level checks (sequence, never, expected, llm_judge over the whole trace).

## Failure codes (`code`)

- `evaluator.threshold_not_met` — score below the evaluation's threshold.
- `evaluator.missing_input` — a reference (query/context/response) resolved to nothing.
- `evaluator.invalid_option` — the rule is malformed (bad regex, missing value...).
- `evaluator.unknown_type` — evaluator type not implemented.
- `adapter.not_configured` — llm_judge/quality dimensions without an adapter or judge.
- `adapter.unsupported_type` — the adapter does not implement that evaluator.
- `adapter.unknown_evaluator` — unknown evaluator name for the adapter.
- `adapter.error` — the provider call failed (the payload is in `details`).
- No `code` = a deterministic built-in check failed; read `reason`.

## Event log (JSONL)

Envelope: `v`, `ts`, `level`, `event`, `run_id` plus context (`session`, `row`, `row_vars`).
Events: `run.start`/`run.end`, `session.start`/`session.end`, `agent.request`/`agent.response`/`agent.error`, `behavior.match`/`behavior.skipped`, `evaluation.result`, `report.written`.
Use it for timing (`duration_ms`), the exact messages sent (`agent.request`), and adapter failures (`agent.error`). `--no-log-content` removes content for privacy.

## What to recommend

- A failure code repeated across rows → fix the session (threshold, reference, or adapter).
- `adapter.not_configured` → show the `--adapter` / `--judge-*` command that fixes it.
- A single failing row → point at that row's `row_vars` and the `observed` content.
- Always end with the next command, e.g. `abslang report <file> --detail <row>`.
