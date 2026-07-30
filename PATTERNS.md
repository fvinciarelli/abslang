# Patterns

> How to model real agent behaviors with ABS v0.1 — recipes, not reference.

The spec tells you what's valid. This document tells you how to combine those pieces
to model the things you actually need: routing, round-trips, multi-step verification,
escalation guards.

---

## 1. Intent routing + hand-off

**The problem:** one entry point (a triage agent) routes to multiple specialist agents
depending on what the user says. A refund goes to Refunds, an order question goes to
Orders, a security issue goes to a human.

**The v0.1 solution:** one Session per branch. v0.1 does not model branching inside a
Session — a Session describes exactly one trace from start to finish. If your system
has 3 destinations, you write 3 Sessions.

### Step by step

#### 1. Pick one branch and write it fully

Start with the happy path for one destination. Don't think about fragments yet — just
get the full trace right:

```yaml
session: Intent routing — damaged item → refund
behaviors:
  - actor: user
    action: says
    content: "I received a damaged item. Order #8291."

  - actor: assistant          # ← triage clarifies intent
    action: clarifies
    content: "I understand — you want to return #8291. Connecting you to refunds."

  - actor: assistant          # ← hands off to specialist
    action: hands_off
    target: Refunds Agent
    content: "Refund request: #8291, reason: damaged"

  - actor: assistant          # ← specialist takes over
    action: greets
    content: "Hi, I'm the refunds specialist. Processing your return now."

  - actor: assistant
    action: calls
    target: Refunds API
    # ...

  - actor: assistant
    action: informs
    content: "Refund approved. €47.50 in 3-5 days. Reference: R-5512."
```

#### 2. Add the chain evaluation

The `sequence` evaluator checks the full trace, including across the hand-off boundary.
`never` acts as a routing guard — this branch must not have gone to the wrong agent:

```yaml
evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: clarifies }
      - { actor: assistant, action: hands_off, target: "Refunds Agent" }
      - { actor: assistant, action: greets }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }

  - type: never
    match: { actor: assistant, action: hands_off, target: "Human Agent" }
```

The `sequence` doesn't care that the `greets` step comes from a different agent
instance than the `clarifies` step — ABS tracks `actor` and `action`, not agent
identity. As long as both are `actor: assistant`, the chain is unbroken.

#### 3. Add step-level evaluations on the key decision points

The two highest-risk steps are the triage (`clarifies`) and the hand-off:

```yaml
- actor: assistant
  action: clarifies
  evaluations:
    - type: llm_judge
      criteria: |
        1. Identifies the request as a refund, not a general inquiry
        2. References the order number
        3. States they are routing to refunds specifically

- actor: assistant
  action: hands_off
  target: Refunds Agent
  evaluations:
    - type: llm_judge
      criteria: |
        1. Hands off to Refunds Agent — not Orders, not Human
        2. Passes both order number and reason in the hand-off context
```

#### 4. Write the other branches as separate Sessions

Each branch follows the same structure. The `sequence` and `never` guards change
per branch — a refund session has `never hands_off to Human`, an escalation session
has `never calls` plus `never hands_off to Refunds`.

See [examples/intent-routing.yaml](examples/intent-routing.yaml) for a complete
worked example.

### Anti-pattern: trying to branch inside a Session

```yaml
# ❌ Don't do this — v0.1 has no branching syntax
behaviors:
  - actor: user
    action: says
    content: "..."
  - actor: assistant
    action: hands_off
    target: Refunds Agent    # or Orders Agent? or Human?
```

A Session is one trace. If the agent could go to 3 places, you need 3 Sessions.
This is explicit in SPECIFICATION.md §7.

---

## 2. Tool round-trips

**The problem:** the assistant calls a tool, gets a response, and then says something
about it. You want to check what parameters were passed AND what the tool returned
AND what the assistant said about it — all independently.

**The solution:** three Behaviors, each evaluated on its own terms.

```yaml
# 1. The assistant calls the tool — check the parameters
- actor: assistant
  action: calls
  target: Orders API
  with:
    orderId: "8291"

# 2. The tool responds — check the payload
- actor: tool
  action: responds
  target: Orders API
  content:
    orderId: "8291"
    status: "in_transit"
  evaluations:
    - type: schema
      schema:
        type: object
        required: [orderId, status]

# 3. The assistant tells the user — check the communication
- actor: assistant
  action: informs
  content: "Your order is on its way"
  evaluations:
    - type: contains
      value: "on its way"
```

### Why three Behaviors instead of one

If you merged the tool response into the `informs` step, you couldn't validate the
raw payload independently from the assistant's paraphrasing. The assistant might say
"your order shipped" when the API actually returned `status: "pending"`. The three-Behavior
split makes both the data and the communication separately assertable.

### Matching tool parameters: `with` vs `with_only`

- **`with`** — partial match (default). The observed call must contain all these keys
  but may have extras. Use this when the agent might pass contextual parameters
  (locale, tracing IDs) that you don't want to hardcode.

- **`with_only`** — strict match. The observed call must contain exactly these keys
  and no others. Use this for security-critical or compliance-sensitive calls.

```yaml
# Partial: agent can add extra params like locale=toulouse
with:
  orderId: "8291"

# Strict: no extra params allowed — catches parameter injection
with_only:
  orderId: "8291"
```

See [TOOLS.md](TOOLS.md) for the full rules.

---

## 3. Multi-step verification

**The problem:** a value captured early (a name, an ID) must stay correct through
multiple steps, and the final response must satisfy several criteria at once —
both hard facts (the ID must appear) and soft qualities (tone, completeness).

**The solution:** capture early, verify late. Use `contains` for hard facts,
`llm_judge` for soft qualities, and `variable_consistency` as a safety net.

```yaml
behaviors:
  - actor: user
    action: says
    content: "Franco Vinciarelli, order #8291"
    capture:
      customerName: "Franco Vinciarelli"
      orderId: "8291"

  # ... several steps of the agent doing its job ...

  - actor: assistant
    action: informs
    content: "Refund of €47.50 processed, Franco. Reference: R-5512."
    capture:
      refundId: "R-5512"
    evaluations:
      # Hard fact: the reference must appear verbatim
      - type: contains
        value: "R-5512"

      # Soft qualities: tone, completeness, no deflections
      - type: llm_judge
        criteria: |
          1. States the amount and timeline
          2. Provides the refund reference
          3. Uses the customer's name (Franco)
          4. Reassuring tone, no upsells

evaluations:
  # Safety net: the ID must be the same everywhere it appears
  - type: variable_consistency
    variable: refundId
```

### Why this works

- `contains` catches factual errors (wrong ID, missing reference).
- `llm_judge` catches communication failures (wrong tone, upsell, forgot the name).
- `variable_consistency` catches a subtle class of bug: the agent silently swapping
  one ID for another midway through. `refundId` is captured as `R-5512` from the
  final message, but if it appeared earlier with a different value, the chain
  evaluator catches the inconsistency.

### The pattern in one sentence

**Capture what matters, check hard facts with exact evaluators, check soft qualities
with `llm_judge`, and let `variable_consistency` watch for drift.**

---

## 4. Missing information flow

**The problem:** the user asks for something but doesn't provide a required piece of
information. The agent must ask for it before proceeding.

**The solution:** model the ask-capture-reuse cycle explicitly. This is a separate
Session from the "user provided everything upfront" happy path.

```yaml
session: Order status — missing order number
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"

  - actor: user
    action: says
    content: "8291"
    capture:
      orderId: "8291"

  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "{{orderId}}"

  - actor: assistant
    action: informs
    content: "Your order is on its way"

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls }
      - { actor: assistant, action: informs }
```

The `sequence` evaluator tests what matters: the agent asked before calling.
Without this, a lazy agent could skip asking and hallucinate the order number.

---

## 5. Escalation guard

**The problem:** some flows must resolve automatically — escalating to a human is a
failure. Other flows must escalate immediately and must NOT attempt automation.

**The solution:** use `never` for the guard. What you forbid depends on which side
you're on.

```yaml
# Auto-resolution flow: must NOT escalate
evaluations:
  - type: never
    match: { actor: assistant, action: hands_off, target: "Human Agent" }

# Human-only flow: must NOT call tools
evaluations:
  - type: never
    match: { actor: assistant, action: calls }
```

This is a two-line safety net that catches an entire category of routing failures.
See [examples/intent-routing.yaml](examples/intent-routing.yaml) for both guards
used in the same file.

---

## What's not covered here

- **Parallel tool calls.** v0.1 is strictly linear. Multiple `calls` in a row are
  executed and matched sequentially. True parallelism is on the ROADMAP for v0.2+.
- **Parameterized fragments.** You can use `{{variables}}` inside fragments today,
  but the same fragment can't easily adapt its content for different sessions
  without dataset bindings. Native parameterized fragments are deferred to v0.2+.
- **Cross-session variables.** Variables are scoped to one Session. You can't
  capture a value in Session A and use it in Session B without copying it into the
  dataset row manually.
