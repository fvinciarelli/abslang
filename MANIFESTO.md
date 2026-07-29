# ABS Manifesto

## The problem

AI agents are shipped today with almost no shared vocabulary for describing what they are actually supposed to do. Requirements get written as prose ("the bot should ask for the order number if it's missing"), QA teams turn that prose into ad-hoc scripts tied to one specific framework, and product owners have no artifact they can read, review, and sign off on that isn't either a wall of text or a pile of internal code.

API design solved an equivalent problem two decades ago. OpenAPI gave HTTP APIs a shared, tool-independent contract. AsyncAPI did the same for event-driven systems. Agent behavior has no equivalent. Every framework — LangChain, Rasa, a hand-rolled orchestration layer — describes behavior in its own internal, non-portable way, and that description usually lives nowhere except the code itself.

ABS is an attempt to close that gap: a shared, human-readable, tool-independent format to describe the **observable** behavior of an agent, so it can be written once and read by developers, QA, product owners, and machines (evaluators, CI pipelines, visual editors) alike.

## Why not just use OpenAPI / AsyncAPI?

OpenAPI describes the shape of requests and responses. AsyncAPI describes the shape of events. Neither describes a *sequence of behavior over time* involving a conversational actor, and neither makes room for the kind of evaluation agent QA actually needs — exact match, fuzzy match, LLM-as-judge, schema validation. ABS borrows their spirit — plain text, versionable, tool-independent, both human- and machine-readable — but solves a different shape of problem: closer to a behavioral trace than to a data contract.

## Why not just use Gherkin / BDD?

Gherkin (Given/When/Then) already solved "human-readable behavioral spec" for software in general, and ABS deliberately keeps a similar spirit. But agent interactions have actors and asymmetric obligations that a generic Given/When/Then doesn't model cleanly: *who* said or did something, *what tool* was invoked and with which parameters, and *how* a free-text or generative response should be evaluated — a fixed-string assertion is rarely enough for an LLM response. ABS's Behavior model (Actor + Action + Target + Content + Evaluations) is, in effect, a specialization of that same idea for conversational, tool-using agents.

## Principles

1. **Observable first.** ABS describes what can be observed from outside the agent — messages, tool calls, UI, outcomes. It intentionally excludes prompts, chains of thought, and model internals, so a specification survives a change of model, framework, or vendor.
2. **Human readable.** A product owner and a QA engineer should both be able to read an ABS session and agree on what it means, without reading code.
3. **Tool independent.** The same behavior can be implemented with MCP, REST, function calling, plugins, or a hand-rolled backend, and the ABS document that describes it doesn't change.
4. **Composable, not exhaustive.** ABS defines a small core vocabulary plus an extension mechanism, not an exhaustive catalog of every possible agent action.
5. **Testable.** Any Behavior can optionally carry Evaluations, so the same document that describes intended behavior can drive automated verification.

## What ABS is not

- Not a prompt format.
- Not an orchestration or agent framework.
- Not a replacement for OpenAPI/AsyncAPI — it complements them by describing behavior instead of payload shape.
- Not (yet) a ratified interoperability standard. v0.1 is a proposal, open for review and change.

## Status

v0.1 — the conceptual core is closed (Session, Behavior, Actor, Action, Target, Content, Variables, Evaluations). Formal sub-specifications are in progress. See [ROADMAP.md](./ROADMAP.md).
