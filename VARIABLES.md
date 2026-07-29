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

## Resolution rules

1. A `{{variable}}` reference MUST resolve against the nearest prior `capture:` of that name earlier in the same Session (SPECIFICATION.md §5).
2. Referencing a variable with no prior `capture:` is an error.
3. Re-capturing the same variable name later in the Session overwrites it for all subsequent references — capture does not create versioned history.

## What's intentionally out of scope for v0.1

- Typed variables (all captured values are treated as opaque scalars or structures, not validated against a declared type).
- Computed/derived variables (e.g. templating expressions beyond simple substitution).
- Cross-Session or global variables.

These are candidates for the Variable/Context Specification — see ROADMAP.md.
