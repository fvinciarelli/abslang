# **Agent Behavior Specification** (ABS)

> A vendor-neutral, human-readable format for describing the observable behavior of AI agents: what users say, what agents do, and how it should be evaluated.

**Status:** v0.1 — draft, open for review.

## What is **Agent Behavior Specification**?

**Agent Behavior Specification** (ABS) is a plain-text (YAML) format for describing agent behavior as an ordered sequence of observable actions — messages, tool calls, UI interactions, hand-offs — independent of the LLM provider, agent framework, orchestration engine, or tool protocol used to implement it.

It plays a role for agent behavior similar to what OpenAPI plays for HTTP APIs: a shared contract that developers, QA, product owners, and tooling can all read and act on.

## Quick example

```yaml
session: Customer checks order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order #8291?"

  - actor: assistant
    action: calls
    target: Orders API

  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
```

Three behaviors, one evaluation. Anyone can read it — PO, dev, QA.

👉 **New to ABS?** Start with the [20-minute tutorial](./TUTORIAL.md). It walks you from this simple example all the way to multi-step flows with tool calls, variables, and LLM-as-judge evaluations.

💬 **Don't want to write YAML?** Use [`abslang chat`](./CLI.md#abslang-chat) — describe the behavior in plain language and it generates the file for you, with evaluations, datasets, and chain checks included.

## Documents

| Document | Purpose |
|---|---|
| [TUTORIAL.md](./TUTORIAL.md) | Step-by-step guide for QA — learn **Agent Behavior Specification** in 20 minutes |
| [PO-GUIDE.md](./PO-GUIDE.md) | Guide for Product Owners — specify behavior without code |
| [DEV-GUIDE.md](./DEV-GUIDE.md) | Guide for Developers — tool calls, API contracts, runner |
| [MANIFESTO.md](./MANIFESTO.md) | Why **Agent Behavior Specification** exists, principles, what it is and isn't |
| [SPECIFICATION.md](./SPECIFICATION.md) | Formal v0.1 spec — document format, conformance |
| [CORE_MODEL.md](./CORE_MODEL.md) | Session, Behavior, Actor, Action, Target, Content, Variables, Evaluations |
| [VOCABULARY.md](./VOCABULARY.md) | Standard action vocabulary and semantics |
| [EVALUATIONS.md](./EVALUATIONS.md) | How Behaviors are verified |
| [VARIABLES.md](./VARIABLES.md) | Capture, reuse, and runtime binding of values |
| [COMPOSITION.md](./COMPOSITION.md) | Fragments and reusable Behaviors |
| [TOOLS.md](./TOOLS.md) | Tool interaction — `calls`, `responds`, matching rules |
| [RUNNER.md](./RUNNER.md) | How **Agent Behavior Specification** sessions get executed against a real agent |
| [CLI.md](./CLI.md) | `abslang init`, `abslang run`, `abslang report` — the command-line interface |
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
