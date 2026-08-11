# **Agent Behavior Specification** Specification v0.2

This document is the normative entry point for the Agent Behavior Specification. It defines document format, required and optional fields, and conformance rules. Conceptual definitions and rationale live in [CORE_MODEL.md](./CORE_MODEL.md); this document is the formal reference for implementers.

The key words "MUST", "MUST NOT", "REQUIRED", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as in RFC 2119.

## 1. Document format

An **Agent Behavior Specification** document is valid YAML. (JSON is also valid, being a syntactic subset of YAML.) The recommended file extension is `.abs.yaml`; plain `.yaml` is also acceptable.

## 2. Top-level structure

```yaml
session: <string>            # REQUIRED — human-readable session name
description: <string>        # OPTIONAL
abs_version: "0.2"           # REQUIRED in v0.2
dataset:                     # OPTIONAL — dataset that feeds this session
  id: <string>               #   REQUIRED if dataset present — short name for column references
  path: <string>             #   REQUIRED if dataset present — path to .json or .jsonl file
fragments:                   # OPTIONAL — named reusable lists of Behaviors. See COMPOSITION.md.
  <fragment_name>:           #   Each key names a fragment, referenced by include: in behaviors
    - actor: <string>
      action: <string>
      # ... any Behavior fields
behaviors:                   # REQUIRED — ordered list of Behavior objects and/or fragment includes
  - id: <string>             #   OPTIONAL — unique id for this behavior, used by evaluations
    actor: <string>
    action: <string>
    target: <string>         # OPTIONAL
    content: <any>           # OPTIONAL
    capture: <map>           # OPTIONAL
    with: <map>              # OPTIONAL — parameters, partial match (default)
    with_only: <map>         # OPTIONAL — parameters, strict match (mutually exclusive with with)
    evaluations: <list>      # OPTIONAL — step-level, checks this Behavior only
    optional: <boolean>      # OPTIONAL — v0.2+. If true, the runner skips this behavior silently when the agent does not emit it.
    requires: <string>       # OPTIONAL — v0.2+. ID of a behavior that must have matched for this one to activate. Cascades.
    matches_when:            # OPTIONAL — v0.2+. Semantic criterion to decide if this behavior matched. Overrides action-based matching.
      type: llm_judge | contains | regex
      criteria: <string>     #   For llm_judge
      value: <string>        #   For contains
      pattern: <string>      #   For regex
  - include: <fragment_name> # OPTIONAL — inserts a fragment's Behaviors here
evaluations: <list>          # OPTIONAL — session-level (chain), checks the whole trace. See EVALUATIONS.md.
```

A document with no `evaluations` anywhere (step-level or session-level) is purely descriptive. Adding `evaluations` at either level makes the same document executable as a test — see EVALUATIONS.md, "Design decision."

**Note on the informal shorthand seen in early drafts.** Early discussion of **Agent Behavior Specification** used a compact notation where a bare list of Behaviors follows `session:` directly, with no `behaviors:` key:

```yaml
session: Order status
- actor: user
  action: says
  content: "Where is my order?"
```

This is **not valid YAML** — a block mapping (`session: ...`) cannot be directly followed by a block sequence at the same indentation level. It reads well as pseudocode but does not parse. All documents in this project use the explicit `behaviors:` form from §2, which is the only form v0.1 defines as conformant.

## 3. Field definitions

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | No | Unique identifier for this Behavior. Used by evaluations to reference steps via `id.action`. |
| `actor` | string | Yes | Who performs the Behavior. See CORE_MODEL.md §Actor. |
| `action` | string | Yes | What is performed. See VOCABULARY.md. |
| `target` | string | No | Object or destination of the action. Semantics are determined by the Action category — normative rule in §4. |
| `content` | any | No | Payload of the Behavior: text, structured data, or displayed information. |
| `capture` | map | No | Names runtime values observed in this Behavior for later reuse. See VARIABLES.md. |
| `with` | map | No | Parameters passed on an outbound Action (typically `calls`), MAY reference captured variables. Partial match by default — observed arguments must contain all declared keys but may include extras. |
| `with_only` | map | No | Parameters passed on an outbound Action. Strict match — observed arguments must contain exactly the declared keys and no others. Mutually exclusive with `with`. See TOOLS.md. |
| `evaluations` (on a Behavior) | list | No | Step-level verification rules for that Behavior only. See EVALUATIONS.md. |
| `optional` | boolean | No | v0.2+. If true, the runner attempts to match this behavior but skips it silently if the agent does not emit it. DOES NOT fail — use `type: expected` at session level to enforce that it SHOULD have matched. |
| `requires` | string | No | v0.2+. ID of a behavior that MUST have matched for this behavior to activate. If the referenced behavior is optional and did not match, this behavior is skipped. Cascades transitively. |
| `matches_when` | object | No | v0.2+. Semantic criterion that replaces `action`-based matching for this behavior. Contains `type` (llm_judge, contains, or regex) and the corresponding field (`criteria`, `value`, or `pattern`). If absent, matching falls back to `actor` + `action` as in v0.1. |
| `evaluations` (top-level, sibling of `behaviors`) | list | No | Session-level (chain) verification rules over the whole trace — ordering, variable consistency, things that must never/eventually happen. See EVALUATIONS.md. |

## 4. `target` semantics (normative)

The meaning of `target` is **determined by the Action category** of the same Behavior. This is not ambiguous at parse time: `action` is REQUIRED, and every action in VOCABULARY.md belongs to exactly one category, so an implementation can always resolve what `target` means without additional input from the author.

An implementation MUST interpret `target` as follows:

| Action category | What `target` means |
|---|---|
| Execution (`calls`, `submits`, `retrieves`, `stores`, `updates`) | The system, tool, or API being invoked — e.g. `Order MCP`, `Calendar API`. |
| Delegation (`hands_off`) | The recipient of the hand-off — e.g. `Human Agent`. |
| Interaction (`selects`, `uploads`, `approves`) | The UI element or object acted on — e.g. `Appointment Options`. |
| Communication (`says`, `asks`, `informs`, `shows`, ...) | A specific recipient or channel, if one needs to be named. Normally omitted — use `content` for what's being communicated. |

An action introduced via the extension mechanism in VOCABULARY.md ("Extending the vocabulary") MUST declare which of these four categories it belongs to, so that `target` remains unambiguous for custom actions too.

This rule was left as an open question in earlier drafts (see ROADMAP.md history); it is now normative rather than guidance. A separate proposal to replace the single `target` field with category-specific fields (`tool:`, `recipient:`, `ui_element:`) was considered and rejected for v0.1 in favor of keeping the five-field Behavior shape.

## 5. Ordering

Behaviors within a Session's list MUST be interpreted as an ordered sequence unless a future `parallel:` construct (see ROADMAP.md) states otherwise. Implementations MUST NOT reorder Behaviors for evaluation purposes.

## 6. Variable resolution

Any `content` or `with` value MAY contain a `{{variable}}` reference. A conforming implementation MUST resolve `{{variable}}` in this order of precedence:

1. **Captured value** — the nearest prior `capture:` of that name earlier in the same Session.
2. **Runtime binding** — a value provided at execution time via dataset row, CLI flag, or environment variable (see VARIABLES.md, "Runtime bindings").
3. If no resolution source exists, it is an error and MUST be reported as such.

This means a Session can be written once with `{{placeholders}}` and executed many times with different concrete values, without changing the Session file. See VARIABLES.md for the full rules.

## 7. Optional Behaviors (v0.2)

v0.2 introduces optional behaviors — steps the agent may or may not emit depending on the situation. The dataset controls the initial conditions; the agent decides whether to act; the runner validates the decision.

### 7.1 `optional: true`

A behavior marked `optional: true` is NOT required. The runner observes the agent's response and evaluates whether it matches. If the `matches_when` criterion is present, matching is semantic (via llm_judge, contains, or regex). If absent, matching falls back to `actor` + `action` as in v0.1. If the behavior does not match, it is skipped silently — this is not a failure.

### 7.2 `requires`

A behavior with `requires: <id>` only activates if the referenced behavior matched. If the referenced behavior is optional and was skipped, this behavior is also skipped. `requires` cascades transitively: if B requires A and C requires B, and A is skipped, B and C are all skipped.

`requires` on a non-optional behavior referencing another non-optional behavior is valid but redundant — both will always execute.

### 7.3 `matches_when`

The `action` field (`asks`, `informs`, `suggests`) is a decorator. A real agent expresses intent in many ways — a request for data could be phrased as a question, a statement, or a suggestion. `matches_when` replaces verb-based matching with semantic matching:

- `type: llm_judge` — uses an LLM adapter to evaluate the agent's response against a natural language `criteria`.
- `type: contains` — checks if the agent's response contains the given `value` substring.
- `type: regex` — matches the agent's response against the given `pattern`.

If `matches_when` is absent, the runner uses `actor` + `action` for matching (v0.1 behavior). A warning SHOULD be emitted if `matches_when: llm_judge` is used without a configured LLM adapter.

### 7.4 `type: expected` (new evaluator)

`expected` is a session-level evaluator that validates an optional behavior SHOULD have matched under certain conditions:

```yaml
evaluations:
  - type: expected
    behavior: ask_id                    # REQUIRED — ID of the optional behavior
    when: "{{cases.hasOrderId}} == false"  # OPTIONAL — dataset expression
    after: { actor: user, action: says }   # OPTIONAL — must match after this selector
    reason: "Should ask for ID"            # OPTIONAL — human-readable failure message
```

If `when` is present, the evaluation only runs when the expression evaluates to true. If `when` is absent, the evaluation always expects the behavior to have matched (equivalent to making it required).

If `after` is present, the behavior must have matched AND its match must occur after the step identified by the selector.

If `reason` is present, it is used as the failure message. If absent, the runner reports the behavior ID.

### 7.5 `when` in other evaluators

The `when` expression can also be used with `never` to conditionally forbid a behavior:

```yaml
- type: never
  match: { actor: assistant, action: asks }
  when: "{{cases.hasOrderId}} == true"
```

### 7.6 Interaction with `sequence`

`sequence` and `optional` are mutually exclusive. A behavior referenced in a `sequence` order MUST NOT be `optional`. `sequence` asserts "this MUST happen in this order"; `optional` asserts "this MAY not happen". They contradict. For ordering constraints on optional behaviors, use `expected` + `after`.

### 7.7 Multiple optionals on the same agent response

If the agent emits a single response that matches multiple optional behaviors (e.g., "I need your order ID and email"), all matching optionals activate. Their `requires`-linked behaviors execute in batch before waiting for the next agent response. This is a feature, not a bug — it reflects real agent behavior.

## 8. Conformance

An implementation is **Agent Behavior Specification** v0.2 conformant if it:

1. Parses a document per §2, resolving `target` per §4;
2. Resolves variables per §6;
3. Parses `optional`, `requires`, and `matches_when` on Behaviors per §7;
4. If it claims evaluation support, implements at minimum the `exact_match`, `contains`, and `expected` evaluators;
5. If it claims session-level evaluation support, implements at minimum `sequence`, `never`, and `expected`.

Conformance to other evaluator types, and to the not-yet-closed Tool Interaction Specification, is not required. A tool may be conformant while supporting only descriptive parsing (1–3) and no evaluation at all.

## 9. Versioning

### Version numbers

**Agent Behavior Specification** uses simple integer versions: `0.1`, `0.2`, `0.3`, …, `1.0`. No patch numbers. Every version is a breaking-change boundary until 1.0.

A change is **breaking** if a document that was valid under version N could be rejected or misinterpreted under version N+1. Examples:

- Renaming or removing a field
- Changing the semantics of an existing action or evaluator
- Adding a new REQUIRED field
- Changing the matching rules for `target` or `with`

A change is **non-breaking** (and does not require a version bump) if:

- Adding a new optional field to Behavior or Evaluation
- Adding a new action to the vocabulary (extensions are forward-compatible by design)
- Adding a new evaluator type
- Clarifying an ambiguity without changing behavior

### Declaring the version

Documents MUST declare `abs_version: "0.1"` or `abs_version: "0.2"`. Implementations MUST use the declared version to select the correct schema, parser behavior, and evaluation semantics.

### Schema versioning

The normative JSON Schema for each version is published at:

```
https://github.com/fvinciarelli/abslang/blob/main/schema/abs.schema.json
(versioned URI pattern TBD for v0.2+)
```

Implementations SHOULD validate documents against the schema matching their declared `abs_version`. If no `abs_version` is declared, implementations SHOULD assume the latest stable version they support, and SHOULD emit a warning.

### Implementation support

An implementation MAY support multiple versions simultaneously. When it does, it MUST apply the rules of the version declared in the document, not the latest version it knows about. A document written for v0.1 should still run correctly under a v0.2-capable implementation.

This is the same strategy used by OpenAPI (`openapi: 3.0.3`) and AsyncAPI (`asyncapi: 2.6.0`): the document declares its contract, and the tool adapts.

## 10. Non-goals

See MANIFESTO.md, "What **Agent Behavior Specification** is not."
