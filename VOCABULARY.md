# Behavior Vocabulary

**Agent Behavior Specification** defines a standard action vocabulary, grouped by category. This is the set an implementation MUST recognize to claim v0.1 vocabulary support; it is not meant to be exhaustive of every domain-specific action a real agent might perform (see "Extending the vocabulary" below).

## Communication

| Action | Typical actor | Meaning |
|---|---|---|
| `says` | user, assistant | A plain statement or message. |
| `asks` | assistant, user | A question expecting a reply. |
| `responds` | assistant, tool, external | A reply to a prior `says`/`asks`/`calls`. |
| `informs` | assistant | Delivers information as a resolution, typically the outcome of a flow. |
| `greets` | assistant, user | Opens an interaction. |
| `clarifies` | assistant, user | Disambiguates a prior ambiguous statement. |
| `confirms` | user, assistant | Affirms a proposed action or piece of information. |
| `rejects` | user, assistant | Declines a proposed action or piece of information. |
| `suggests` | assistant | Proposes an option without asserting it as fact. |
| `shows` | assistant | Displays structured content (e.g. a list, a card, options) rather than saying it. |

## Execution

| Action | Typical actor | Meaning |
|---|---|---|
| `calls` | assistant | Invokes an external system, tool, or API. Pair with a `responds` Behavior from `tool`/`external` to capture the return value. |
| `submits` | user, assistant | Sends a completed input (e.g. a form) to a target. |
| `retrieves` | assistant, tool | Fetches data without side effects. |
| `stores` | assistant, tool | Persists data. |
| `updates` | assistant, tool | Modifies existing data. |

## Interaction

| Action | Typical actor | Meaning |
|---|---|---|
| `selects` | user | Chooses among presented options. |
| `uploads` | user | Provides a file or attachment. |
| `downloads` | user | Retrieves a file or attachment. |
| `approves` | user, human | Grants explicit approval for a proposed action. |

## Delegation

| Action | Typical actor | Meaning |
|---|---|---|
| `hands_off` | assistant | Transfers the interaction to another actor, typically `human`. |

## Extending the vocabulary

Real deployments will need domain-specific actions (`refunds`, `escalates`, `schedules`, ...). Until a formal extension syntax is ratified (see ROADMAP.md), custom actions:

- MUST declare which of the four categories above they belong to (Communication / Execution / Interaction / Delegation), since that category determines how `target` is interpreted for that action (SPECIFICATION.md §4, normative).
- SHOULD be documented alongside the Session that uses them, and
- SHOULD be written as plain lowercase verbs consistent with the style of this table, so that a future formal extension syntax (e.g. an `x-` prefix, mirroring OpenAPI's `x-` extension fields) can be adopted without renaming existing documents.

## Actor/Action compatibility

The "typical actor" column is guidance, not a hard constraint in v0.1 — nothing in the SPECIFICATION.md conformance rules currently rejects an unusual pairing (e.g. `tool` performing `says`). Implementers who want stricter validation should treat the table above as the default allow-list and layer additional constraints on top. Formalizing this as part of the spec itself is an open question — see ROADMAP.md.
