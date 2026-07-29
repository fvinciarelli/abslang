# Evaluations

## Design decision: ABS is descriptive and testable, by the same document

**Resolved in v0.1.** ABS does not have two modes with two syntaxes. A document with no `evaluations` anywhere is a pure behavioral description — useful as documentation, as a spec to review, as training material. The same document, with `evaluations` added at the Behavior and/or Session level, becomes executable as an automated test. Nothing about the document's shape changes; `evaluations` is simply optional annotation. A tool that only wants documentation can ignore `evaluations` entirely.

## Two levels of evaluation

**Step-level** evaluations attach to a single Behavior and check that one observed step is correct in isolation. This is the easy case — it's what you'd check by hand or with a single evaluator call, and was the whole of EVALUATIONS.md in the first draft of this spec.

**Session-level (chain) evaluations** attach to the Session as a whole and check properties of the entire observed trace: relative ordering between steps, values staying consistent across steps, things that must never happen anywhere, things that must eventually happen. This is the part that's hard to do by hand once a Session has more than a few steps, and it's the primary reason `evaluations` exists as a first-class citizen of the format rather than being left entirely to an external test framework.

```yaml
session: Order status requires order number
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - actor: assistant
    action: asks
    content: "Please provide your order number"
  - actor: user
    action: says
    content: "12345"
    capture:
      orderId: "12345"
  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"
  - actor: assistant
    action: informs
    content: "Your order is on the way"

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Order MCP" }
      - { actor: assistant, action: informs }
  - type: variable_consistency
    variable: orderId
  - type: never
    match: { actor: assistant, action: hands_off }
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

### `llm_judge`
Delegates the judgment to an LLM against a natural-language rubric. Intentionally coarse in v0.1 — no standardized scoring scale or calibration method is defined yet.
```yaml
evaluations:
  - type: llm_judge
    criteria: "Response clearly states the order is in transit, in a friendly tone, without inventing a delivery date."
```

### `custom`
Escape hatch for evaluators not covered above. Implementations define their own `id` namespace.
```yaml
evaluations:
  - type: custom
    id: my-org.sentiment-positive
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

## Open questions (deferred to the formal Evaluation Specification)

- How are `llm_judge` results calibrated or made reproducible across model versions?
- Should the selector used by chain evaluators support partial/regex matching on `target`, or only exact equality as in v0.1?
- Precise algorithm for propagating `inconclusive` status through a chain of variable dependencies — v0.1 states the intent, not a formal algorithm.
- Whether Session-level `evaluations` should be able to reference a specific Behavior by an explicit `id:` field (rather than only by selector) once real documents show selectors are ambiguous in practice.
