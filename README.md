# ABS — Agent Behavior Specification

> A vendor-neutral, human-readable format for describing the observable behavior of AI agents: what users say, what agents do, and how it should be evaluated.

**Status:** v0.1 — draft, open for review.

## What is ABS?

ABS is a plain-text (YAML) specification format for describing agent behavior as an ordered sequence of observable actions — messages, tool calls, UI interactions, hand-offs — independent of the LLM provider, agent framework, orchestration engine, or tool protocol used to implement it.

It plays a role for agent behavior similar to what OpenAPI plays for HTTP APIs: a shared contract that developers, QA, product owners, and tooling can all read and act on.

## Quick example

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

This single file describes the full interaction and verifies it automatically.

- **Step-level evaluations** check each assistant response (LLM judge with multi-criteria rubrics, exact content checks)
- **Chain evaluations** verify the full trace: the 4-step sequence must happen in order, the `refundId` must stay consistent, and the agent must never hand off
- **Variables** capture `customerName` and `refundId` from the conversation for reuse and consistency checks
- **Tool round-trips** (`calls` → `responds`) make every API interaction assertable

## Documents

| Document | Purpose |
|---|---|
| [TUTORIAL.md](./TUTORIAL.md) | Step-by-step guide for QA — learn ABS in 20 minutes |
| [MANIFESTO.md](./MANIFESTO.md) | Why ABS exists, principles, what it is and isn't |
| [SPECIFICATION.md](./SPECIFICATION.md) | Formal v0.1 spec — document format, conformance |
| [CORE_MODEL.md](./CORE_MODEL.md) | Session, Behavior, Actor, Action, Target, Content, Variables, Evaluations |
| [VOCABULARY.md](./VOCABULARY.md) | Standard action vocabulary and semantics |
| [EVALUATIONS.md](./EVALUATIONS.md) | How Behaviors are verified |
| [VARIABLES.md](./VARIABLES.md) | Capture, reuse, and runtime binding of values |
| [COMPOSITION.md](./COMPOSITION.md) | Fragments and reusable Behaviors |
| [TOOLS.md](./TOOLS.md) | Tool interaction — `calls`, `responds`, matching rules |
| [RUNNER.md](./RUNNER.md) | How ABS sessions get executed against a real agent |
| [CLI.md](./CLI.md) | `abs init`, `abs run`, `abs report` — the command-line interface |
| [PATTERNS.md](./PATTERNS.md) | How to model real agent behaviors — recipes, not reference |
| [EXAMPLES.md](./EXAMPLES.md) | Worked, narrated examples |
| [ROADMAP.md](./ROADMAP.md) | What's next, and open design questions |
| [schema/abs.schema.json](./schema/abs.schema.json) | Normative JSON Schema for v0.1 document validation |
| [examples/](./examples/) | Runnable example sessions in `.yaml` |

## Status of the standard

Closed in v0.1:
Scope · Session · Behavior · Actor · Action · Target · Content · Variables · Evaluations (step-level + chain-level) · Vocabulary · Sequencing · Fragments · Tool Interaction · JSON Schema · alternate flows as separate Sessions.

Implementations: TypeScript · Python · UI authoring tool (React) · Website (Next.js). See ROADMAP.md for open design questions deferred to v0.2+.

## Contributing

This is a draft standard. Issues and proposals should reference which document and section they affect. See ROADMAP.md for the list of open questions actively being worked.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
