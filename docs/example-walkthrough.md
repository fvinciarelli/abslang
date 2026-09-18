# Under the hood: the README example, line by line

The session from the README:

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

## Top level

| Line | Parser | Runner |
|---|---|---|
| `session: Order lookup chatbot — complete` | session name | report label |
| `abs_version: "0.2"` | declared version | enables `optional`, `requires`, `matches_when`, `when` |
| `dataset:` → `id: cases` | dataset reference | every dataset column is addressable as `cases.<column>` |
| `dataset:` → `path: cases.jsonl` | path string | CLI loads it relative to the session file |
| `behaviors:` | ordered list of behaviors | processed top to bottom |
| `evaluations:` (bottom) | list of chain rules | run after all behaviors |

## `user_asks`

```yaml
- id: user_asks
  actor: user
  action: says
  content: "{{cases.userQuery}}"
```

| Line | Parser | Runner |
|---|---|---|
| `id: user_asks` | keeps the step id | later refs like `query: user_asks.says` resolve through it |
| `actor: user` | actor | this behavior sends a message to the agent |
| `action: says` | action | the sent turn is recorded in the trace as `user says` |
| `content: "{{cases.userQuery}}"` | placeholder kept as-is | dataset resolution replaces it with the row value |

## `ask_id`

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

| Line | Parser | Runner |
|---|---|---|
| `id: ask_id` | keeps the step id | used by `requires`, `expected`, and the report |
| `actor: assistant` | expectation about the agent | the step is matched against the agent's reply |
| `action: asks` | action | required by the schema; tags the reply as `asks` when it matches |
| `optional: true` | flag | if it does not match: skipped, not failed; its evaluations do not run |
| `matches_when:` | overrides actor/action matching | the judge decides the match |
| `matches_when.type: llm_judge` | matcher type | calls the `llm_judge` adapter with the criteria |
| `matches_when.criteria` | text | the question asked about the reply: *"is the agent requesting the order ID?"* |
| `evaluations:` → `type: llm_judge` | step evaluation | runs only if the step matched |
| `evaluations:` → `criteria` | text | second judge call over the same reply: *"politely asks, explains why?"* |

## `user_gives_id`

```yaml
- id: user_gives_id
  actor: user
  action: says
  content: "{{cases.orderId}}"
  requires: ask_id
```

| Line | Parser | Runner |
|---|---|---|
| `id: user_gives_id` | keeps the step id | step label in the report |
| `actor: user` + `action: says` | user message | sent to the agent only when the step runs |
| `content: "{{cases.orderId}}"` | placeholder kept | sends the row's `orderId` |
| `requires: ask_id` | dependency (checked: `ask_id` must exist) | if `ask_id` was skipped, this step is skipped too |

## `answer`

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

| Line | Parser | Runner |
|---|---|---|
| `id: answer` | keeps the step id | report label |
| `actor: assistant` | assistant expectation | matched against the agent's next reply |
| `action: informs` | communication action | matches a reply recorded as `responds` |
| `content: "{{cases.expectedAnswer}}"` | expected value | **not used to match**; it is the declared expected answer |
| `evaluations:` → `type: Groundedness` | evaluation rule | routed to the `Groundedness` adapter |
| `query: user_asks.says` | reference | resolved from the trace by behavior id |
| `context: "{{cases.kbSnippet}}"` | placeholder | resolved to the row's `kbSnippet` |
| `response: self` | reference | the agent's observed reply |
| `threshold: 0.8` | number | applied by the runner to the normalized score |

## Session evaluations

### `expected`

```yaml
- type: expected
  behavior: ask_id
  when: "{{cases.hasOrderId}} == false"
  reason: "Agent should ask for ID when user doesn't provide it"
```

| Line | Parser | Runner |
|---|---|---|
| `type: expected` | chain evaluator | checks that an optional step *should* have matched |
| `behavior: ask_id` | id reference | looks up the result of that step |
| `when: "..."` | expression kept | evaluated per row: false → passes as skipped; true → fails if `ask_id` did not match |
| `reason:` | message | shown when it fails |

### `never`

```yaml
- type: never
  match: { actor: assistant, action: asks }
  when: "{{cases.hasOrderId}} == true"
```

| Line | Parser | Runner |
|---|---|---|
| `type: never` | chain evaluator | scans the whole trace |
| `match: { actor, action }` | selector | fails if any step matches `assistant asks` |
| `when: "..."` | expression kept | false → passes as skipped; true → the selector check runs |

`action: asks` only exists in the trace when a matched behavior tagged a reply with
it — for example, when `ask_id` matched. That tag is what `never` inspects.

### `llm_judge`

```yaml
- type: llm_judge
  criteria: "Overall conversation is helpful, professional, and resolves the user's request"
```

| Line | Parser | Runner |
|---|---|---|
| `type: llm_judge` | chain evaluator | sends the full trace to the judge |
| `criteria:` | text | the question asked about the whole conversation |

## How it plays out

| Step | `hasOrderId: false` | `hasOrderId: true` |
|---|---|---|
| `user_asks` | sent | sent |
| `ask_id` | matched (judge: asking), evaluation runs | skipped |
| `user_gives_id` | sent (`requires` met) | skipped (requires a skipped step) |
| `answer` | matched, Groundedness 0.92 | matched, Groundedness 0.92 |
| `expected` | passed | skipped (`when` false) |
| `never` | skipped (`when` false) | passed |
| `llm_judge` | passed | passed |

- Branch B works because a skipped optional step does not advance the conversation:
  `answer` checks the same reply that `ask_id` declined.
- `never` works because a matched `ask_id` tags the reply as `asks`.

## What the run needs

| Requirement | Used by |
|---|---|
| Dataset columns `userQuery`, `orderId`, `expectedAnswer`, `hasOrderId`, `kbSnippet` | variable resolution and `when` |
| A judge (built-in judge with an API key, or an `llm_judge` adapter) | `matches_when` and every `llm_judge` |
| An adapter for `Groundedness` (Azure, AWS, Google, AI Evaluator) | the step-level evaluation |
| `hasOrderId` as a real boolean in the JSONL | `when` comparisons |
