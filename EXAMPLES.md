# Examples

Runnable versions of every example below live under [examples/](./examples/) and have been validated to parse as YAML.

## 1. Order status (happy path)

The simplest possible Session: user asks, assistant calls a tool, assistant informs. Note that the tool's response is its own Behavior — this is what makes the payload assertable independently of what the assistant later says about it.

```yaml
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
    capture:
      userQuery: "Where is my order?"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "in_transit"
      eta: "2026-07-30"
    evaluations:
      - type: schema
        schema:
          type: object
          required: [status]
          properties:
            status: { type: string }

  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
```
See [examples/order-status.yaml](./examples/order-status.yaml).

## 2. Missing information flow

Same scenario, but the order number isn't known yet — the assistant asks for it first. This is a **separate Session** from #1, per the v0.1 rule that alternate paths don't branch within one Session.

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

The `evaluations` block here is **session-level** — it checks the trace as a whole, not any single Behavior: the three key steps must occur in that relative order, `orderId` must resolve to the same value everywhere it's used (catching a case where the assistant silently used a different order number than the one the user gave), and no hand-off to a human should have happened anywhere in this flow. See EVALUATIONS.md, "Session-level (chain) evaluator types."

See [examples/order-status-missing-info.yaml](./examples/order-status-missing-info.yaml).

## 3. Appointment booking (multi-step, with hand-off)

Shows `shows`/`selects` for a UI-driven choice, and `hands_off` for delegation to a human when no slot fits. The example file contains two related Sessions (happy path and fallback) as separate YAML documents in one file, separated by `---`.

```yaml
session: Appointment booking with fallback to human
behaviors:
  - actor: user
    action: says
    content: "I need to book a dentist appointment"

  - actor: assistant
    action: calls
    target: Calendar API
    with:
      service: "dentist"

  - actor: tool
    action: responds
    target: Calendar API
    content:
      slots: ["2026-08-03T09:00", "2026-08-03T14:00"]

  - actor: assistant
    action: shows
    target: Appointment Options
    content:
      slots: ["2026-08-03T09:00", "2026-08-03T14:00"]

  - actor: user
    action: selects
    target: Appointment Options
    content: "2026-08-03T09:00"
    capture:
      selectedSlot: "2026-08-03T09:00"

  - actor: assistant
    action: submits
    target: Calendar API
    with:
      slot: "{{selectedSlot}}"

  - actor: assistant
    action: confirms
    content: "You're booked for August 3rd at 9:00 AM"
```
See [examples/appointment-booking.yaml](./examples/appointment-booking.yaml).

## 4. Chatbot greeting (minimal Session)

The smallest valid Session — useful as a smoke test for a new ABS-conformant tool.

```yaml
session: Chatbot greeting
behaviors:
  - actor: user
    action: says
    content: "Hi"

  - actor: assistant
    action: greets
    content: "Hello! How can I help you today?"
    evaluations:
      - type: llm_judge
        criteria: "Friendly greeting that invites the user to state their need, without assuming what they want."
```
See [examples/chatbot-greeting.yaml](./examples/chatbot-greeting.yaml).
