# Tool Interaction

> How **Agent Behavior Specification** describes, matches, and verifies tool calls — the invisible half of agent behavior.

A user sees a conversation. A tester sees the full round-trip: the assistant deciding to call a tool, what parameters it passes, what comes back, and what the assistant says about it afterward. **Agent Behavior Specification** makes every step of that round-trip assertable.

---

## The tool round-trip in **Agent Behavior Specification**

A tool call is two Behaviors, not one:

```yaml
# The assistant calls a tool
- actor: assistant
  action: calls
  target: Order MCP
  with:
    orderId: "12345"

# The tool responds
- actor: tool
  action: responds
  target: Order MCP
  content:
    status: "shipped"
    eta: "2026-07-30"
```

Two Behaviors, back to back. The first says what was called and with what parameters. The second says what came back. The assistant's follow-up (`informs`, `shows`, etc.) comes after.

This separation is deliberate: the tool response payload is assertable on its own (schema validation, exact values), independently of how the assistant later paraphrases it.

---

## Matching `with`: partial (default) vs. strict

### `with` — partial match (default)

The observed tool arguments must contain every key in `with`, but may contain additional keys:

```yaml
# ABS says:
with:
  orderId: "12345"

# Agent actually called:
{ "orderId": "12345", "currency": "USD", "priority": "high" }

# → MATCH. orderId matches. Extra keys are fine.
```

This is the default because it makes sessions resilient: the agent can pass contextual parameters (locale, tracing IDs, internal flags) without breaking the spec.

### `with_only` — strict match

The observed tool arguments must match exactly — no extra keys allowed:

```yaml
# ABS says:
with_only:
  orderId: "12345"

# Agent actually called:
{ "orderId": "12345", "currency": "USD" }

# → NO MATCH. currency is present but not declared.
```

Use `with_only` when the exact set of parameters matters — security-critical calls, compliance boundaries, or when an extra parameter would change behavior.

`with` and `with_only` are mutually exclusive on the same Behavior. If neither is present, the Behavior only checks that the tool was called (`target` match) without inspecting parameters.

---

## Multiple tool calls in one turn

An agent can call several tools before saying anything to the user. **Agent Behavior Specification** represents this as consecutive `calls` Behaviors:

```yaml
- actor: assistant
  action: calls
  target: Order MCP
  with:
    orderId: "12345"

- actor: assistant
  action: calls
  target: Inventory MCP
  with:
    sku: "SKU-001"
```

### Ordering

By default, multiple `calls` must match in the order they appear in the session.

If order doesn't matter — the agent can call them in any sequence — use the `tool_call` evaluator with `ordered: false`:

```yaml
- actor: assistant
  action: calls
  target: Order MCP

- actor: assistant
  action: calls
  target: Inventory MCP
  evaluations:
    - type: tool_call
      ordered: false
```

With `ordered: false`, both calls must occur, but in either order. This is useful for independent calls that happen to be batched together.

---

## Tool response matching

When the session declares a `tool` `responds` Behavior, the Runner matches it against the tool result the agent received:

```yaml
- actor: tool
  action: responds
  target: Order MCP
  content:
    status: "shipped"
```

This checks that:
1. A tool response for `Order MCP` was received
2. Its payload is structurally compatible with the declared `content`

Structural compatibility means: if `content` is an object, the observed payload must have at least those keys with those types. Extra keys are fine (same philosophy as `with` partial matching).

For strict payload matching, use the `schema` evaluator:

```yaml
- actor: tool
  action: responds
  target: Order MCP
  content:
    status: "shipped"
  evaluations:
    - type: schema
      schema:
        type: object
        required: [status, eta]
        properties:
          status: { type: string, enum: [shipped, pending, cancelled] }
          eta: { type: string, format: date }
        additionalProperties: false
```

---

## The `tool_call` evaluator

The `tool_call` evaluator checks one or more `calls` Behaviors against what the agent actually invoked. It can be placed on an individual `calls` Behavior or on the last `calls` in a group.

```yaml
evaluations:
  - type: tool_call
    target: "Order MCP"        # Optional — already on the Behavior, but can be explicit
    with:                       # Optional — same
      orderId: "{{orderId}}"
    ordered: true               # Optional — default true
```

| Field | Default | Description |
|-------|---------|-------------|
| `target` | (from Behavior) | Which tool should have been called |
| `with` | (from Behavior) | Parameters that must be present |
| `ordered` | `true` | If multiple `calls` in a row, must they be in this order? |

When there's nothing to validate beyond what the Behavior already declares (target + with), the `tool_call` evaluator is optional — the Runner already matches `target` and `with`/`with_only` as part of step matching. Use the evaluator when you want to assert additional properties:

```yaml
# Multiple tools, order doesn't matter
- actor: assistant
  action: calls
  target: Order MCP
- actor: assistant
  action: calls
  target: Inventory MCP
  evaluations:
    - type: tool_call
      ordered: false
```

---

## Summary: the decisions made

| Question | Answer |
|----------|--------|
| Default parameter matching | `with` = partial (observed must contain all keys; extra keys OK) |
| Strict parameter matching | `with_only` = exact (no extra keys allowed) |
| Multiple tools, ordering | Default `ordered: true`. Set `ordered: false` in `tool_call` evaluator for independent calls |
| Tool response matching | Structural compatibility by default. Use `schema` evaluator for strict validation |
| Tool response payload assertion | Use the `tool` Behavior's own `evaluations` block |

---

## Relation to other documents

- **VOCABULARY.md** — defines `calls`, `responds`, `submits`, `retrieves`, `stores`, `updates` as Execution actions
- **CORE_MODEL.md** — explains why `tool` is a separate actor and `responds` is its own Behavior
- **RUNNER.md** — shows the wire format (OpenAI `tool_calls` block) and how the Runner captures it
- **EVALUATIONS.md** — defines `schema`, `tool_call`, and all common evaluator types
