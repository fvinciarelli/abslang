# Core Model

ABS has three core concepts:

```
Session
  |
  +-- Behavior
          |
          +-- Actor
          +-- Action
          +-- Target
          +-- Content
          +-- Variables
          +-- Evaluations
```

## Session

A Session represents a complete interaction scenario: an ordered sequence of Behaviors. The order is significant (see SPECIFICATION.md §4).

A Session MAY represent:
- a one-shot interaction,
- a multi-turn conversation,
- a complete user journey.

Examples: checking order status, booking an appointment, requesting a refund, a full customer support conversation.

**On branching.** A Session is intentionally linear. A scenario with a decision point ("if the user provides an order number vs. if they don't") is represented as two separate Sessions that share a common prefix, not as one Session with a branch. This keeps every Session unambiguous and independently runnable, at the cost of some duplication — see ROADMAP.md for the planned composition mechanism that will let Sessions share prefixes without copy-pasting them.

## Behavior

A Behavior is the smallest unit of observable behavior described by ABS: something performed by an Actor.

### Actor (required)

The entity performing the Behavior.

Examples: `user`, `assistant`, `tool`, `system`, `human`, `external`.

`tool` and `external` matter specifically for round-trips: when the assistant issues a `calls` Behavior, the response it receives back SHOULD be represented as its own Behavior with `actor: tool` (or `actor: external`) and `action: responds`, carrying the returned payload in `content`. This keeps the return value of a call assertable on its own terms, separately from what the assistant later says about it. See EXAMPLES.md for a worked case.

### Action (required)

The operation performed by the Actor. See VOCABULARY.md for the full standard list and per-action semantics.

### Target (optional)

The object or destination involved in the Action. **Its meaning is determined by the Action category** — this is now a normative rule (SPECIFICATION.md §4), not just guidance:

| Action category | What `target` means |
|---|---|
| Execution (`calls`, `submits`, `retrieves`, `stores`, `updates`) | The system, tool, or API being invoked — e.g. `Order MCP`, `Calendar API`. |
| Delegation (`hands_off`) | The recipient of the hand-off — e.g. `Human Agent`. |
| Interaction (`selects`, `uploads`, `approves`) | The UI element or object acted on — e.g. `Appointment Options`. |
| Communication (`says`, `asks`, `informs`, `shows`, ...) | Normally omitted. If present, it identifies a specific recipient or channel rather than duplicating what `content` already carries. |

This resolves unambiguously at parse time because `action` is required and every action belongs to exactly one category (VOCABULARY.md); an implementation never has to guess which table row applies. If a Behavior doesn't need to distinguish "acted upon what" from "said what," omit `target` and use `content` alone.

### Content (optional)

The information associated with the Behavior. Content can represent a user message, an assistant message, a structured payload, displayed information, or tool parameters.

```yaml
content: "Where is my order?"
```
or
```yaml
content:
  orderId: "12345"
```

### Variables

Variables let values observed during a Session be reused later in the same Session. See VARIABLES.md for full rules.

```yaml
capture:
  orderId: "12345"
```
Later:
```yaml
with:
  orderId: "{{orderId}}"
```

### Evaluations (optional)

Evaluations define how a Behavior is verified. A Behavior MAY carry multiple Evaluations. See EVALUATIONS.md.

Examples of evaluation kinds: exact match, contains, schema validation, tool invocation validation, LLM-as-judge, custom evaluator.

## Design decision: description and assertion are the same document

ABS documents serve two purposes at once — describing intended behavior, and (optionally, via `evaluations`) asserting it should hold true when run against a real implementation. A Behavior with no `evaluations` is purely descriptive. A Behavior with `evaluations` is also a test. A single Session can freely mix descriptive and asserted Behaviors.

This applies at **two levels**. Step-level `evaluations` (on a Behavior) check one observed step in isolation — useful, but the easy case. The more valuable case is **session-level (chain) evaluations**: a top-level `evaluations` block, sibling to `behaviors`, that checks properties of the *whole trace* — relative ordering between steps, a captured variable staying consistent everywhere it's reused, an action that must never or must eventually occur. This is where ABS earns its place over doing checks by hand, since chain-level properties are exactly what's tedious to verify manually once a Session has more than a handful of steps. See EVALUATIONS.md for the full evaluator vocabulary at both levels, and its resolved default for failure propagation (non-blocking / best-effort, with an opt-in `blocking: true` checkpoint).
