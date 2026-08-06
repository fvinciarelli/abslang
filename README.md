# **Agent Behavior Specification** (ABS)

> A vendor-neutral, human-readable format for describing the observable behavior of AI agents: what users say, what agents do, and how it should be evaluated.

**Status:** v0.1 — draft, open for review.

[![npm version](https://img.shields.io/npm/v/abslang)](https://www.npmjs.com/package/abslang)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

## What is **Agent Behavior Specification**?

**[Agent Behavior Specification](./SPECIFICATION.md)** (ABS) is a plain-text (YAML) format for describing agent behavior as an ordered sequence of observable actions — messages, tool calls, UI interactions, hand-offs — independent of the LLM provider, agent framework, orchestration engine, or tool protocol used to implement it.

It plays a role for agent behavior similar to what OpenAPI plays for HTTP APIs: a shared contract that developers, QA, product owners, and tooling can all read and act on.

### Quick example

A RAG agent answers a question using a knowledge base. The spec verifies every claim is grounded in the retrieved context — **no hallucinations** — and the response is relevant and coherent.

```yaml
session: Return policy RAG
dataset:
  id: cases
  path: cases.jsonl
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"           # e.g. "Can I return sale items?"

  - id: kb_call
    actor: assistant
    action: calls
    target: Knowledge Base

  - id: kb_result
    actor: tool
    action: responds
    target: Knowledge Base
    content: "{{cases.kbContent}}"           # e.g. "Returns accepted within 14 days with receipt"

  - id: answer
    actor: assistant
    action: informs
    content: "{{cases.expectedAnswer}}"
    evaluations:
      # Did the agent hallucinate? Every fact must be in kb_result
      - type: Groundedness
        query: user_asks.says
        context: kb_result.responds
        response: self
        threshold: 0.8

      # Did it answer what was asked?
      - type: Relevance
        query: user_asks.says
        response: self

      # Is the response logically coherent?
      - type: Coherence
        response: self

evaluations:
  - type: Groundedness
    query: user_asks.says
    context: kb_result.responds
    response: answer.informs
    threshold: 0.8
```

Four behaviors, four evaluations across three dimension types. The `query`, `context`, and `response` fields reference behaviors by their `id` — `user_asks.says`, `kb_result.responds`, `answer.informs` — so the adapter knows exactly which parts of the trace to evaluate.

## Get started in 30 seconds

```bash
npm install -g abslang
abslang init
abslang run sessions/order-status.abs.yaml --agent http://localhost:8080/chat
```

Don't want to write YAML? Just describe the behavior in plain language:

```bash
abslang chat
# Uses OPENAI_API_KEY, ANTHROPIC_API_KEY, or DEEPSEEK_API_KEY — whichever is set
# You: A customer asks for a refund. The agent should verify the order, process it, and confirm.
# → generates a complete .abs.yaml with evaluations, datasets, and chain checks
```

### How to run it

```bash
# Built-in judge — uses your existing OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY
abslang run session.abs.yaml --agent $URL

# Dimension types (Groundedness, Relevance, Coherence, Fluency) route through an adapter
abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator

# Private LLM — no data leaves your network
abslang run session.abs.yaml --agent $URL --adapter llm_judge=local --adapter-url http://localhost:11434/v1
```

👉 **New to ABS?** Start with the [20-minute tutorial](./TUTORIAL.md). More examples: [refund flow with `llm_judge` + chain checks](./EXAMPLES.md), [order status](./EXAMPLES.md), [appointment booking](./EXAMPLES.md).

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
