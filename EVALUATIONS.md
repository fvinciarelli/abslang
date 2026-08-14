# Evaluations

## What can you evaluate? — start here

Tell ABS what you want to check, in plain words, and pick the evaluator:

| You want to check that… | Use |
|---|---|
| the response contains a word or phrase | `contains` |
| the response is exactly this | `exact_match` |
| the response matches a pattern | `regex` |
| the response is valid structured data | `schema` |
| the agent called the right tool, with the right parameters | `tool_call` |
| steps happened in the right order | `sequence` |
| a step happened at least once | `eventually` |
| a step **never** happened | `never` |
| a step happened between N and M times | `count` |
| a step followed another within N steps | `within` |
| a captured value stayed consistent throughout | `variable_consistency` |
| the agent asked for data it should have asked for | `optional` + `expected` |
| the response is grounded in the context | `Groundedness` |
| the response addresses the user's question | `Relevance` |
| the response is logically coherent | `Coherence` |
| the response is fluent and readable | `Fluency` |
| the response is free of hate / bias | `HateUnfairness` |
| the response is free of violence | `Violence` |
| the response is free of sexual content | `Sexual` |
| the response doesn't encourage self-harm | `SelfHarm` |
| anything else you can describe in one sentence | `llm_judge` |

Rows above the line run **locally and deterministically** — no model, no cost, no
flakiness. Rows below need an LLM as the judge; the safety dimensions
(`HateUnfairness`, `Violence`, `Sexual`, `SelfHarm`) ship with a curated rubric, so
you don't have to write criteria.

### Where does the judging happen?

LLM-based evaluators are engine-agnostic. Pick the engine per run with `--adapter`,
or per rule with `adapter:`:

```bash
abslang run session.abs.yaml --agent $URL --adapter azure   # Azure AI Foundry
abslang run session.abs.yaml --agent $URL --adapter aws     # AWS Bedrock
abslang run session.abs.yaml --agent $URL --adapter google  # Google Vertex AI
abslang run session.abs.yaml --agent $URL                   # built-in judge (OpenAI/Anthropic/Gemini)
```

```yaml
evaluations:
  - type: Violence
    adapter: azure          # or omit for the built-in judge
    threshold: 0.9
```

Your session file never changes. Only the engine.

---

## Design decision: **Agent Behavior Specification** is descriptive and testable, by the same document

**Resolved in v0.1.** **Agent Behavior Specification** does not have two modes with two syntaxes. A document with no `evaluations` anywhere is a pure behavioral description — useful as documentation, as a spec to review, as training material. The same document, with `evaluations` added at the Behavior and/or Session level, becomes executable as an automated test. Nothing about the document's shape changes; `evaluations` is simply optional annotation. A tool that only wants documentation can ignore `evaluations` entirely.

## Two levels of evaluation

**Step-level** evaluations attach to a single Behavior and check that one observed step is correct in isolation. This is the easy case — it's what you'd check by hand or with a single evaluator call, and was the whole of EVALUATIONS.md in the first draft of this spec.

**Session-level (chain) evaluations** attach to the Session as a whole and check properties of the entire observed trace: relative ordering between steps, values staying consistent across steps, things that must never happen anywhere, things that must eventually happen. This is the part that's hard to do by hand once a Session has more than a few steps, and it's the primary reason `evaluations` exists as a first-class citizen of the format rather than being left entirely to an external test framework.

## Common evaluation fields

Every evaluator type accepts these optional fields in addition to its type-specific ones:

| Field | Type | Description |
|---|---|---|
| `threshold` | number (0–1) | Minimum score for this evaluation to pass. Default: `0.5`. Applies to evaluators that produce a score: `llm_judge`, `custom`, and composition types (`all_of`, `any_of`, `none_of`). Non-scoring evaluators (`contains`, `exact_match`, `sequence`, etc.) ignore it. |
| `adapter` | string | Opaque identifier selecting which LLM judge implementation to use. The runner maps this string to a configured adapter at execution time (via CLI flag `--adapter`, config file, or environment variable). If omitted, the runner uses its default adapter. Examples of values a deployment might use: `aievaluator`, `azure`, `aws`, `google`, `builtin`. |
| `dataset` | string, array, or object | Reference data passed to the evaluator. Can be: a UUID string referencing an external dataset registry, an inline array of objects (`[{context: ..., response: ...}]`), or a JSONL string. The adapter decides how to use it. |
| `prompt` | string | Custom prompt template for evaluators that call an LLM. Variables like `{{criteria}}`, `{{context}}`, `{{response}}` are interpolated by the adapter before sending to the judge. |

### Adapter selection and score normalization

`adapter` is enforced at run time. Resolution order: a named adapter registered for `(type, adapter)` wins; otherwise the default adapter for that type is used. If `adapter: <name>` names an adapter that was never registered, the run reports a clear error instead of silently falling back. Register adapters with `--adapter <provider>`, `--adapter <type>=<provider>`, or `adapters:` in `abs.config.yaml`.

Adapters return scores normalized to 0–1. Provider scales (e.g. Azure's 1–5 Likert) are normalized by the adapter before `threshold` is applied, so a `threshold` of 0–1 is meaningful regardless of provider.

### Threshold on composition types

When `threshold` is set on `all_of`, `any_of`, or `none_of`, it applies to the **average score** of all sub-evaluations:

```yaml
evaluations:
  - type: all_of
    threshold: 0.8
    evaluations:
      - type: contains
        value: "R-5512"           # score: 1.0
      - type: llm_judge
        criteria: "Friendly tone"  # score: 0.72
      # Average: 0.86 → passes (0.86 >= 0.8)
```

Without a group threshold, `all_of` requires every sub-evaluation to pass individually. With a group threshold, individual failures can be compensated by strong scores elsewhere — useful when no single criterion is critical but the overall quality matters.

### Example with all common fields

```yaml
evaluations:
  - type: llm_judge
    criteria: "Response is clear and helpful"
    threshold: 0.75
    adapter: aievaluator
    prompt: |
      Rate the following response on clarity and helpfulness (1-10):
      Response: {{response}}
      Criteria: {{criteria}}
```

## LLM-based evaluators

Two categories: `llm_judge` for free-form criteria, and named dimension types (`Groundedness`, `Relevance`, `Coherence`, `Fluency`) for standard quality checks that every major platform supports.

### `llm_judge` — free-form criteria

When you can't use `contains` or `exact_match` and need an LLM to judge a response against natural-language expectations.

```yaml
evaluations:
  - type: llm_judge
    criteria: |
      1. States the refund amount (€47.50) and timeline (3-5 days)
      2. Provides the refund reference R-5512
      3. Uses the customer's name (Franco)
      4. Reassuring tone — no upsells, no deflections
    threshold: 0.7
```

The adapter receives the trace and the evaluation rule. It returns `{ passed, score, reason }`. How it produces that result is up to the adapter.

### Dimension types — `Groundedness`, `Relevance`, `Coherence`, `Fluency`

These are standard evaluation dimensions supported by Azure AI Foundry, Vertex AI, and other platforms. Unlike `llm_judge`, they don't take free-form `criteria` — the platform already knows how to evaluate them. You just point them at the right parts of the trace.

```yaml
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"

  - id: kb_result
    actor: tool
    action: responds
    target: Knowledge Base

  - id: answer
    actor: assistant
    action: informs
    evaluations:
      - type: Groundedness
        query: user_asks.says
        context: kb_result.responds
        response: self
        threshold: 0.8
      - type: Relevance
        query: user_asks.says
        response: self
      - type: Coherence
        response: self
```

Each type expects specific inputs from the trace:

| Type | Needs | What it checks |
|---|---|---|
| `Groundedness` | `query`, `context`, `response` | Every factual claim in the response is supported by the context |
| `Relevance` | `query`, `response` | The response addresses the query, no tangents |
| `Coherence` | `response` | Logical flow and internal consistency |
| `Fluency` | `response` | Natural language quality, grammar, readability |

Inputs are references to behavior ids, optionally qualified with `.action`:

- `query: user_asks.says` — the content of that behavior
- `context: kb_result.responds` — the content of that tool response
- `response: self` — the current behavior (the one carrying the evaluation)
- `response: answer.informs` — explicit reference (used in session-level evaluations)

If the action is omitted, the default for that actor is used: `user` → `.says`, `tool` → `.responds`, `assistant` → `.informs`. So `context: kb_result` is equivalent to `context: kb_result.responds`.

The adapter receives the evaluation type, the mapped inputs resolved from the trace, and any extra fields (`threshold`, `adapter`). It returns `{ passed, score, reason }`.

### Safety dimensions — `HateUnfairness`, `Violence`, `Sexual`, `SelfHarm`

Safety dimensions judge the *output* for harmful content. They work out of the box
with the built-in judge (any LLM: OpenAI, Anthropic, Gemini) — no criteria text
required — and can be routed to a specialized service (e.g. Azure AI Content Safety)
via an adapter.

```yaml
evaluations:
  - type: Violence
    response: self
    threshold: 0.9
```

| Type | What it checks |
|---|---|
| `HateUnfairness` | hate speech, slurs, unfair bias against protected groups |
| `Violence` | threats, descriptions or glorification of violence |
| `Sexual` | sexually explicit or harassing content |
| `SelfHarm` | encouragement or instructions for self-harm |

Score semantics: **1.0 = safe, 0.0 = harmful** (higher is safer, like every ABS
dimension). `threshold` is the minimum safety level.

Each type ships with a curated default rubric. Override it with `criteria` (or a
custom `prompt`) when you need a stricter or custom definition:

```yaml
evaluations:
  - type: HateUnfairness
    criteria: "The response must avoid any mention of religion or politics"
    threshold: 0.95
```

### `custom`

Escape hatch for evaluators that are not `llm_judge` but still need an external implementation. The `id` identifies the evaluator. The runner dispatches it by `id` to a registered adapter.

```yaml
evaluations:
  - type: custom
    id: my-org.sentiment-positive
    threshold: 0.5
```

## Step-level evaluator types

```yaml
- actor: assistant
  action: informs
  content: "Your order is on the way"
  evaluations:
    - type: contains
      value: "on the way"
```

### `exact_match`
The observed `content` must equal `value` exactly.
```yaml
evaluations:
  - type: exact_match
    value: "12345"
```

### `contains`
The observed `content` must contain `value` as a substring (case-insensitive by default).
```yaml
evaluations:
  - type: contains
    value: "on the way"
```

### `regex`
The observed `content` must match the given pattern.
```yaml
evaluations:
  - type: regex
    pattern: "^Order #\\d+ is (on the way|delivered)$"
```

### `schema`
The observed `content` must validate against a JSON Schema.
```yaml
evaluations:
  - type: schema
    schema:
      type: object
      required: [orderId]
      properties:
        orderId: { type: string }
```

### `tool_call`
Validates that one or more `calls` Behaviors were invoked correctly: target matches, parameters match (per `with`/`with_only` rules), and optionally that ordering is respected when multiple tools are called. See [TOOLS.md](./TOOLS.md) for the full rules.
```yaml
evaluations:
  - type: tool_call
    target: "Order MCP"
    with:
      orderId: "{{orderId}}"
    ordered: true
```

## Session-level (chain) evaluator types

All of these are declared in a top-level `evaluations:` block, a sibling of `behaviors:`, and operate over the whole observed trace rather than a single Behavior.

### Behavior selector

Every chain evaluator below identifies Behaviors using a **selector**: an object with any of `actor`, `action`, `target`. A field that's present must match exactly; a field that's omitted is a wildcard. Matching against `content` is not supported by the selector in v0.1 — use step-level evaluations for content assertions.

```yaml
match: { actor: assistant, action: calls, target: "Order MCP" }
```

### `sequence`
Every selector in `order` must match some Behavior in the observed trace, and the matches must occur in increasing position (not necessarily adjacent — other Behaviors may fall between them).
```yaml
- type: sequence
  order:
    - { actor: assistant, action: calls, target: "Order MCP" }
    - { actor: assistant, action: informs }
```

### `eventually`
The selector must match at least one Behavior somewhere in the trace.
```yaml
- type: eventually
  match: { actor: assistant, action: informs }
```

### `never`
The selector must match no Behavior anywhere in the trace.
```yaml
- type: never
  match: { actor: assistant, action: hands_off }
```

### `count`
Bounds how many Behaviors match the selector.
```yaml
- type: count
  match: { actor: assistant, action: calls }
  min: 1
  max: 2
```

### `within`
A `match` selector must occur within `max_steps` Behaviors after an `after` selector.
```yaml
- type: within
  after: { actor: user, action: says }
  match: { actor: assistant, action: responds }
  max_steps: 3
```

### `variable_consistency`
Every value that resolves a given `{{variable}}` reference anywhere in the Session — plus the value it was originally `capture`d with — must be equal. This is the chain-integrity check that's tedious to do by hand once a variable is reused several steps later: it catches an agent silently substituting a different order number, slot, or ID than the one the user actually gave.
```yaml
- type: variable_consistency
  variable: orderId
```

## Composition: `all_of` / `any_of` / `none_of`

Available at both the step level and the session level. Wraps a list of nested evaluations (of either kind).

```yaml
- type: any_of
  evaluations:
    - type: contains
      value: "on the way"
    - type: contains
      value: "in transit"
```

Note that listing multiple evaluations directly under a Behavior's `evaluations:` (without wrapping them) is already an implicit `all_of` — the wrapper types exist specifically to express `any_of`/`none_of`, which a flat list cannot express.

## Failure semantics

**Resolved default: non-blocking / best-effort.** A failing evaluation does not stop other evaluations — step-level or session-level — from being checked. An implementation MUST evaluate every `evaluations` entry it can and produce a full pass/fail report. The Session's overall result is `pass` if and only if every evaluation in that report passed.

**Escape hatch: `blocking: true`.** An evaluation MAY set `blocking: true` to mark it as a checkpoint. If a `blocking: true` evaluation fails, any other evaluation whose Behavior depends — directly or via a captured variable — on the step that failed SHOULD be reported as `inconclusive` rather than `failed`, since the input it needed may never have been produced correctly. This keeps a single early failure from generating a wall of misleading downstream failures.

```yaml
- actor: assistant
  action: calls
  target: Order MCP
  with:
    orderId: "{{orderId}}"
  evaluations:
    - type: tool_call
      target: "Order MCP"
      blocking: true
```

## Open questions

- Whether the Sression-level `evaluations` should be able to reference a specific Behavior by an explicit `id:` field (rather than only by selector) once real documents show selectors are ambiguous in practice.
