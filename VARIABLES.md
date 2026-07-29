# Variables

Variables let a value observed during a Session be captured once and reused later in the same Session.

## Capturing

Any Behavior may declare a `capture` map. Each key becomes a variable name, available to every subsequent Behavior in the same Session.

```yaml
- actor: user
  action: says
  content: "12345"
  capture:
    orderId: "12345"
```

`capture` is typically used alongside `content`, but is independent of it — a Behavior can capture a value derived from its content (e.g. an extracted field) without the raw `content` matching the captured value verbatim.

## Reusing

A captured variable is referenced with `{{variable_name}}` syntax, inside `content` or `with`.

```yaml
- actor: assistant
  action: calls
  target: Order MCP
  with:
    orderId: "{{orderId}}"
```

## Scope

In v0.1, variables are **Session-scoped**: a variable captured in one Session is not visible in another, even if the other Session shares a common prefix. This follows directly from Sessions being independent, self-contained scenarios (CORE_MODEL.md). Cross-Session variable sharing is not defined in v0.1.

## Runtime bindings

A `{{variable}}` that has no prior `capture:` in the Session is not an error — it is a **parameter**. The value is bound at execution time from one of these sources, checked in order:

| Source | Example | Typical use |
|--------|---------|-------------|
| Dataset row | `abs run session.abs.yaml --dataset cases.jsonl` | Run the same Session against many inputs |
| CLI flag | `abs run session.abs.yaml --var orderId=12345` | Quick one-off with a single value |
| Environment variable | `ABS_VAR_orderId=12345 abs run session.abs.yaml` | CI pipelines, secrets |

A Session becomes a template, and a dataset is what turns it into many test cases.

### Datasets

A dataset is a JSON or JSONL file where each row is a set of variable bindings:

```jsonl
{"orderId": "12345", "expectedStatus": "shipped"}
{"orderId": "67890", "expectedStatus": "pending"}
{"orderId": "99999", "expectedStatus": "cancelled"}
```

Or as a JSON array:

```json
[
  { "orderId": "12345", "expectedStatus": "shipped" },
  { "orderId": "67890", "expectedStatus": "pending" },
  { "orderId": "99999", "expectedStatus": "cancelled" }
]
```

When the Runner executes with `--dataset`, it runs the Session once per row, binding the row's keys as `{{variables}}`. The report aggregates all runs together — see CLI.md.

### Session as template

A Session that uses runtime bindings is a template. The same Session file works for:

- **Documentation** — a PO reads it and sees the shape of the interaction
- **A single smoke test** — `abs run --var orderId=12345`
- **A full regression suite** — `abs run --dataset 200-cases.jsonl`

The Session doesn't change. The data does.

### Precedence

If a variable name appears in both a dataset row and a `capture:` within the Session, the captured value wins — capture represents something the agent or user actually said during the conversation, and that runtime observation always takes priority over a dataset binding.

## Resolution rules

1. A `{{variable}}` reference MUST resolve against the nearest prior `capture:` of that name earlier in the same Session (SPECIFICATION.md §5).
2. Referencing a variable with no prior `capture:` is an error.
3. Re-capturing the same variable name later in the Session overwrites it for all subsequent references — capture does not create versioned history.

## What's intentionally out of scope for v0.1

- Typed variables (all captured values are treated as opaque scalars or structures, not validated against a declared type).
- Computed/derived variables (e.g. templating expressions beyond simple substitution).
- Cross-Session or global variables.

These are candidates for the Variable/Context Specification — see ROADMAP.md.
