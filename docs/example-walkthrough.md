# Under the hood: how a session runs

This walkthrough takes the **Order lookup chatbot — complete** session from the
[README](../README.md) and follows it from text to result: what the parser reads in
each line, what the runner does with it, and how the two dataset branches end up
passing with the same linear session.

## The session

```yaml
session: Order lookup chatbot — complete
abs_version: "0.2"
dataset:
  id: cases
  path: cases.jsonl
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"

  - id: ask_id
    actor: assistant
    action: asks
    optional: true
    matches_when:
      type: llm_judge
      criteria: "The agent is requesting the order ID"
    evaluations:
      - type: llm_judge
        criteria: "Politely asks, explains why the ID is needed"

  - id: user_gives_id
    actor: user
    action: says
    content: "{{cases.orderId}}"
    requires: ask_id

  - id: answer
    actor: assistant
    action: informs
    content: "{{cases.expectedAnswer}}"
    evaluations:
      - type: Groundedness
        query: user_asks.says
        context: "{{cases.kbSnippet}}"
        response: self
        threshold: 0.8

evaluations:
  - type: expected
    behavior: ask_id
    when: "{{cases.hasOrderId}} == false"
    reason: "Agent should ask for ID when user doesn't provide it"

  - type: never
    match: { actor: assistant, action: asks }
    when: "{{cases.hasOrderId}} == true"

  - type: llm_judge
    criteria: "Overall conversation is helpful, professional, and resolves the user's request"
```

The dataset has two rows — one where the user never gives an order ID, one where
they do:

```jsonl
{"userQuery": "I want to check my order", "orderId": "5678", "expectedAnswer": "On its way", "hasOrderId": false, "kbSnippet": "orders ship in 3 days"}
{"userQuery": "Where is order #8291?", "orderId": "8291", "expectedAnswer": "On its way", "hasOrderId": true, "kbSnippet": "orders ship today"}
```

## Stage 1 — What the parser reads

The parser does five things, in order:

1. **Loads** the YAML.
2. **Validates** it against the [JSON Schema](../schema/abs.schema.json). Every
   behavior requires `actor` and `action` — that is why `ask_id` declares
   `action: asks` even though `matches_when` decides how it actually matches.
3. **Types** it into a session: a name, a dataset reference, an ordered list of
   behaviors, and session-level evaluations.
4. **Expands** `include:` fragments (none here).
5. **Resolves** `{{...}}` variable references per dataset row. This is the step that
   turns `{{cases.userQuery}}` into the row's value.

### Top level

| Line | What it becomes | What it means at run time |
|---|---|---|
| `session:` | the session name | label used in the report |
| `abs_version: "0.2"` | the declared version | enables the v0.2 features used here: `optional`, `requires`, `matches_when`, `when` |
| `dataset: {id: cases, path: cases.jsonl}` | a dataset reference | the CLI loads the file and prefixes every column with `cases.` |
| `behaviors:` | an ordered list | the runner processes it top to bottom |
| `evaluations:` | session-level checks | run after all behaviors |

### Behaviors

**`user_asks` — the user opens the conversation.**
The parser keeps `actor: user`, `action: says`, the generated id, and the content
template. At run time the runner sends that text to the agent and records the turn
in the trace.

**`ask_id` — an optional agent step.**
The parser keeps `actor: assistant`, `action: asks`, `optional: true`, the
`matches_when` criterion, and the step-level evaluation. At run time:

- the runner looks at the agent's reply to the current user turn;
- because `matches_when` is present, it ignores actor/action matching and asks the
  LLM judge the declared criterion: *"is the agent requesting the order ID?"*;
- **if it matches**: the reply is tagged as `asks` and the step-level `llm_judge`
  evaluation runs against it;
- **if it does not match**: the behavior is skipped — not a failure — and its
  evaluation does not run.

**`user_gives_id` — conditional on the agent asking.**
The parser keeps `actor: user`, the content template, and `requires: ask_id`; it
also checks that a behavior with that id exists. At run time this step only sends
the order ID when `ask_id` matched. If `ask_id` was skipped, this behavior is
skipped too, and so is anything else that requires it.

**`answer` — the final answer, with a groundedness check.**
The parser keeps `actor: assistant`, `action: informs`, the expected content, and
the `Groundedness` evaluation. At run time the runner matches the agent's next
reply and runs the evaluation against it. The declared `content` is the expected
answer; the evaluation checks the actual reply (`response: self`), resolving
`query` from the `user_asks` step and `context` from the dataset.

### Session-level evaluations

- **`expected`** — when `hasOrderId` is false, `ask_id` must have matched; otherwise
  the evaluation passes as skipped.
- **`never`** — when `hasOrderId` is true, no assistant reply may be tagged `asks`.
- **`llm_judge`** — always runs, judging the whole conversation.

## Stage 2 — The two dataset branches

The same session handles both rows. Here is what the runner does in each case.

### Branch A — `hasOrderId: false` (the user does not give an ID)

| Step | What happens | Result |
|---|---|---|
| `user_asks` | runner sends *"I want to check my order"* | sent |
| `ask_id` | judge sees *"Sure, could you provide your order number?"* → asks | **matched**, evaluation runs |
| `user_gives_id` | `requires` is satisfied, so the runner sends *"5678"* | sent |
| `answer` | agent replies *"Order 5678 is on its way."* | matched, Groundedness 0.92 |
| `expected` | `ask_id` matched, as required | passed |
| `never` | `when` is false → skipped | passed |
| `llm_judge` | whole conversation reviewed | passed |

### Branch B — `hasOrderId: true` (the user provides the ID upfront)

| Step | What happens | Result |
|---|---|---|
| `user_asks` | runner sends *"Where is order #8291?"* | sent |
| `ask_id` | judge sees *"Order 8291 is on its way."* → not asking | **skipped** |
| `user_gives_id` | requires `ask_id`, which was skipped | skipped |
| `answer` | runner checks the same first reply | matched, Groundedness 0.92 |
| `expected` | `when` is false → skipped | passed |
| `never` | no reply was tagged `asks` | passed |
| `llm_judge` | whole conversation reviewed | passed |

The key detail is in branch B: a skipped optional step does **not** advance the
conversation, so `answer` still checks the reply that `ask_id` declined. That is
what lets one linear session describe both behaviors.

The other detail is the tag: when `ask_id` matches, the runner records the reply as
`asks`. That is the exact thing the `never` evaluation inspects when
`hasOrderId` is true.

## What the run needs

| Requirement | Used by |
|---|---|
| Dataset columns: `userQuery`, `orderId`, `expectedAnswer`, `hasOrderId`, `kbSnippet` | variable resolution and `when` expressions |
| An LLM judge (built-in judge with an API key, or any `llm_judge` adapter) | `matches_when` and every `llm_judge` evaluation |
| An adapter for `Groundedness` (Azure, AWS, Google, AI Evaluator) | the step-level `Groundedness` evaluation — or switch it to `llm_judge` |
| `hasOrderId` as a real boolean in the JSONL | `when: "{{cases.hasOrderId}} == ..."` |

## Where to go next

- [RUNNER.md](../RUNNER.md) — the execution model in full: matching rules, tool
  calls, annotations, failure semantics.
- [EVALUATIONS.md](../EVALUATIONS.md) — every evaluator type and the adapter
  contract.
- [VARIABLES.md](../VARIABLES.md) — capture, dataset binding, and `when`
  expressions.
