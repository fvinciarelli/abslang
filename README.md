# ABS — Agent Behavior Specification

> A vendor-neutral, human-readable format for describing the observable behavior of AI agents: what users say, what agents do, and how it should be evaluated.

**Status:** v0.1 — draft, open for review.

## What is ABS?

ABS is a plain-text (YAML) specification format for describing agent behavior as an ordered sequence of observable actions — messages, tool calls, UI interactions, hand-offs — independent of the LLM provider, agent framework, orchestration engine, or tool protocol used to implement it.

It plays a role for agent behavior similar to what OpenAPI plays for HTTP APIs: a shared contract that developers, QA, product owners, and tooling can all read and act on.

## Quick example

```yaml
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
  - actor: assistant
    action: calls
    target: Order MCP
  - actor: assistant
    action: informs
    content: "Your order is on the way"
```

## Documents

| Document | Purpose |
|---|---|
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
| [EXAMPLES.md](./EXAMPLES.md) | Worked, narrated examples |
| [ROADMAP.md](./ROADMAP.md) | What's next, and open design questions |
| [schema/abs.schema.json](./schema/abs.schema.json) | Normative JSON Schema for v0.1 document validation |
| [examples/](./examples/) | Runnable example sessions in `.yaml` |

## Status of the standard

Closed in v0.1 (conceptual core):
Scope · Session · Behavior · Actor · Action · Target · Content · Variables · Evaluations · initial Vocabulary · Sequencing · alternate flows as separate Sessions.

Not yet closed (formal specs, see ROADMAP.md):
Evaluation Specification · Tool Interaction Specification · Variable/Context Specification · official JSON Schema · UI Authoring Model.

## Contributing

This is a draft standard. Issues and proposals should reference which document and section they affect. See ROADMAP.md for the list of open questions actively being worked.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).
