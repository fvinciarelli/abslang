# Under the hood: the README example, step by step

This is the *Order lookup chatbot — complete* session from the README. First the
full YAML, then how the parser reads each part, how the runner applies it, and how
the two dataset branches play out.

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

The dataset has two rows: one where the user never gives an order ID, one where
they do.

```jsonl
{"userQuery": "I want to check my order", "orderId": "5678", "expectedAnswer": "On its way", "hasOrderId": false, "kbSnippet": "orders ship in 3 days"}
{"userQuery": "Where is order #8291?", "orderId": "8291", "expectedAnswer": "On its way", "hasOrderId": true, "kbSnippet": "orders ship today"}
```

## How the parser reads it

Pipeline: load the YAML → validate it against the JSON Schema → type it into a
session → expand `include:` fragments (none here) → resolve `{{...}}` with the
dataset row. A document that fails the schema never reaches the runner.

### Header

| Line | Parser | Runner |
|---|---|---|
| `session:` | session name | report label |
| `abs_version: "0.2"` | declared version | enables `optional`, `requires`, `matches_when`, `when` |
| `dataset:` → `id: cases` | dataset reference | every column is addressable as `cases.<column>` |
| `dataset:` → `path: cases.jsonl` | path | loaded by the CLI relative to the session file |
| `behaviors:` | ordered list | processed top to bottom |
| `evaluations:` (bottom) | chain rules | run after all behaviors |

### `user_asks`

```yaml
- id: user_asks
  actor: user
  action: says
  content: "{{cases.userQuery}}"
```

- **Parser**: stores `actor: user`, `action: says`, the id, and the content literal
  with its `{{cases.userQuery}}` placeholder.
- **Runner**: sends the resolved message to the agent and records the turn in the
  trace as `user says`. The id stays on that step, so references like
  `query: user_asks.says` resolve to it later.

### `ask_id`

```yaml
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
```

- **Parser**: `actor: assistant` and `action: asks` mark this as an expected agent
  step. `optional: true` means it may not happen. `matches_when` says how to decide.
  The schema still requires `action`, even though `matches_when` overrides matching:
  the action is what tags the reply as `asks` when it matches.
- **Runner**:
  1. Takes the agent's reply to the current user turn.
  2. Because `matches_when` is present, it ignores actor/action and calls the
     `llm_judge` adapter with the criterion: *"is the agent requesting the order ID?"*.
  3. If the judge passes: the step matches, the reply is tagged `asks`, and the
     step-level evaluation runs on that same reply.
  4. If the judge fails: the step is skipped — not a failure — and its evaluation
     does not run. The conversation does not advance, so the next behavior can
     still evaluate the same reply.

### `user_gives_id`

```yaml
- id: user_gives_id
  actor: user
  action: says
  content: "{{cases.orderId}}"
  requires: ask_id
```

- **Parser**: stores the user message and `requires: ask_id`. It also checks that a
  behavior with that id exists — a reference to a missing id is a parse error.
- **Runner**: only sends the order ID when `ask_id` matched. If `ask_id` was
  skipped, this behavior is skipped too, and so is anything that requires it later.

### `answer`

```yaml
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
```

- **Parser**: stores the expected content and the `Groundedness` evaluation as a
  rule dict. `threshold` must be between 0 and 1.
- **Runner**: matches the agent's next reply by actor and communication action.
  The declared `content` is **not** used to match — it is the expected answer for
  the reader. The actual reply is what the evaluation sees:
  - `query: user_asks.says` resolves to the user step from the trace;
  - `context: "{{cases.kbSnippet}}"` resolves to the dataset value;
  - `response: self` is the agent's observed reply;
  - `threshold: 0.8` is applied by the runner to the adapter's normalized score.

## Session evaluations

### `expected`

```yaml
- type: expected
  behavior: ask_id
  when: "{{cases.hasOrderId}} == false"
  reason: "Agent should ask for ID when user doesn't provide it"
```

- **Parser**: a chain rule that references a behavior id.
- **Runner**: evaluates `when` against the dataset row. If it is false, the
  evaluation passes as skipped. If it is true, `ask_id` must have matched; when it
  did not, the evaluation fails with `reason`.

### `never` + `when`

```yaml
- type: never
  match: { actor: assistant, action: asks }
  when: "{{cases.hasOrderId}} == true"
```

- **Parser**: a selector — `actor`, `action`, `target`, all optional.
- **Runner**: if `when` is false, it passes as skipped. If true, it scans the trace
  for a step matching `assistant asks`. That action only exists when a matched
  behavior tagged a reply with it — for example, when `ask_id` matched. So the
  correctness of `never` depends on `ask_id` classifying the reply correctly.

### `llm_judge`

```yaml
- type: llm_judge
  criteria: "Overall conversation is helpful, professional, and resolves the user's request"
```

- **Parser**: a chain rule with no `when`, so it always runs.
- **Runner**: sends the whole trace to the judge and applies the default threshold.

## How it plays out

Same session, two dataset rows. The agent asks for the ID when it is missing and
answers directly when the user already provided it.

**Row `hasOrderId: false`** — the agent asks:

```
step 1 user_asks     sent=True
step 2 ask_id        matched=True
    └─ llm_judge     passed=True
step 3 user_gives_id sent=True
step 4 answer        matched=True
    └─ Groundedness  passed=True score=0.92
chain expected   passed=True  "Behavior ask_id matched as expected"
chain never      passed=True  "when condition not met — skipped"
chain llm_judge  passed=True
```

**Row `hasOrderId: true`** — the user gave the ID upfront:

```
step 1 user_asks     sent=True
step 2 ask_id        skipped=True
step 3 user_gives_id skipped=True
step 4 answer        matched=True
    └─ Groundedness  passed=True score=0.92
chain expected   passed=True  "when condition not met — skipped"
chain never      passed=True  "Disallowed step never occurred"
chain llm_judge  passed=True
```

Two details make both branches work with one linear session:

- In the second row, the skipped optional does not advance the conversation, so
  `answer` checks the same reply that `ask_id` declined.
- When `ask_id` matches, it tags the reply as `asks` — the exact thing `never`
  inspects in the first row.

## What the run needs

| Requirement | Used by |
|---|---|
| Dataset columns `userQuery`, `orderId`, `expectedAnswer`, `hasOrderId`, `kbSnippet` | variable resolution and `when` |
| A judge (built-in judge with an API key, or an `llm_judge` adapter) | `matches_when` and every `llm_judge` |
| An adapter for `Groundedness` (Azure, AWS, Google, AI Evaluator) | the step-level evaluation |
| `hasOrderId` as a real boolean in the JSONL | `when` comparisons |
