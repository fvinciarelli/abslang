# Examples

Runnable versions of every example below live under [examples/](./examples/) and have been validated to parse as YAML.

## 1. Refund request — full workflow with evaluations

A customer returns a damaged item. The agent verifies eligibility across two API calls, processes the refund, and confirms. This is the showcase example: step-level LLM judge with multi-criteria rubrics, chain sequence verification, variable capture and consistency, and two complete tool round-trips — all in one file.

```yaml
session: Refund request — approved
description: |
  Customer returns a damaged item. Agent verifies eligibility,
  processes the refund, and confirms — with evaluations at every step.
behaviors:
  - actor: user
    action: says
    content: "I want to return order #8291, it arrived damaged"

  - actor: assistant
    action: asks
    content: "I'm sorry about that. Can you confirm your name and order date?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Shows empathy for the damaged item
          2. References the order number #8291
          3. Asks for verification info before taking action

  - actor: user
    action: says
    content: "Franco Vinciarelli, ordered last Tuesday"
    capture:
      customerName: "Franco Vinciarelli"

  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "8291"

  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "8291"
      status: "delivered"
      eligibleForRefund: true

  - actor: assistant
    action: calls
    target: Refunds API
    with:
      orderId: "8291"
      reason: "damaged"

  - actor: tool
    action: responds
    target: Refunds API
    content:
      refundId: "R-5512"
      amount: 47.50
      status: "processed"

  - actor: assistant
    action: informs
    content: "Refund of €47.50 processed, Franco. You'll receive it in 3-5 days. Your refund ID is R-5512."
    capture:
      refundId: "R-5512"
    evaluations:
      - type: contains
        value: "R-5512"
      - type: llm_judge
        criteria: |
          1. States the refund amount (€47.50) and timeline (3-5 days)
          2. Provides the refund reference R-5512
          3. Uses the customer's name (Franco)
          4. Reassuring tone — no upsells, no deflections

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Orders API" }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }
  - type: variable_consistency
    variable: refundId
  - type: never
    match: { actor: assistant, action: hands_off }
```

### What this example shows

| Feature | Where |
|---|---|
| Step-level evaluations | `llm_judge` with 3–4 criteria on the `asks` and `informs` steps |
| Chain evaluation | `sequence` verifies the 4 assistant actions happen in exact order |
| Variable capture + consistency | `customerName` and `refundId` captured; `variable_consistency` ensures `refundId` never drifts |
| Tool round-trips | Two `calls` → `responds` pairs, each independently assertable |
| Invariant guard | `never hands_off` — the agent must resolve, not escalate |
| Multi-criteria LLM judge | Empathy, accuracy, tone, and omissions checked in one rubric |

See [examples/refund-request.yaml](./examples/refund-request.yaml).

## 2. Order status (minimal intro)

The simplest possible Session: user asks, assistant calls a tool, assistant informs. Good for understanding the basic format, but real sessions use evaluations, variables, and chain checks like the refund example above.

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
