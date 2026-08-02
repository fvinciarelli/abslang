# Composition

## The problem

What an author has in mind when specifying an agent is a **tree**. A conversation starts the same way for everybody and opens up at the points where the user can do more than one thing:

```
"I need to book a dentist appointment"
        │
   calls Calendar API
        │
   shows Appointment Options
        ├── user selects a slot   ──→ submits ──→ confirms
        └── user rejects all      ──→ hands_off to a human
```

What ABS stores is the set of **root-to-leaf paths** through that tree, one Session per path (SPECIFICATION.md §8). Two leaves means two Sessions, and everything above the branch point is written twice. Three decision points means eight Sessions, and every edit to the opening has to be made eight times.

This duplication is not an oversight. It follows directly from storing a tree as a list of paths, and it has a concrete cost that the v0.1 example files originally demonstrated: the first Session recorded the `tool` `responds` step after calling the Calendar API and the second Session silently omitted it, even though both were supposed to describe the same opening. Copies drift. (The example has since been fixed; this paragraph remains as a record of why fragments matter.) That is the failure mode this chapter closes.

## The mechanism: fragments

A **fragment** is a named, reusable list of Behaviors. It is declared once under a top-level `fragments:` key and inserted into a Session with an `include:` entry in the `behaviors:` list.

```yaml
fragments:
  request-dentist-appointment:
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

---
session: Appointment booking, slot accepted
behaviors:
  - include: request-dentist-appointment
  - actor: user
    action: selects
    target: Appointment Options
    content: "2026-08-03T09:00"
  # ...

---
session: Appointment booking, no slot fits
behaviors:
  - include: request-dentist-appointment
  - actor: user
    action: rejects
    target: Appointment Options
  # ...
```

The shared opening exists once. Both Sessions still read top to bottom. And because `include:` is an ordinary entry in the `behaviors:` list, it can appear at **any** position — not only first. Sessions that share an *ending* (every flow closes with the same confirmation and escalation) or a *middle* factor out just as well, which a prefix-only mechanism cannot express.

## Expansion is the whole design

The single rule that makes composition safe is this: **fragments are expanded away before anything else happens** (SPECIFICATION.md §7.3). An implementation replaces each `include:` with a copy of the fragment's Behaviors, in place, recursively, and what remains is an ordinary linear v0.1 Session. Only then does it interpret ordering, resolve variables, or run any evaluation.

Everything already closed in v0.1 therefore stays closed, untouched:

- **Sequencing** (§5) still applies to a flat, ordered list.
- **Variable resolution** (§6) still means "nearest prior `capture:` in the same Session" — a Session that, post-expansion, contains the fragment's steps as its own.
- **Chain evaluations** (`sequence`, `never`, `variable_consistency`, …) still operate on *one* trace, because a Session still describes exactly one path.

Composition is a **writing convenience, not a new concept in the model**. A human reader sees the shortcut; an evaluator never does.

This is also the reason **Agent Behavior Specification** does not put branches inside a Session. A branch would mean a Session no longer describes a single trace, and every chain evaluator — each defined in terms of "the observed trace" — would have to be redefined. Fragments buy the deduplication without reopening any of that.

## What a fragment may contain

A fragment holds Behaviors, and those Behaviors are ordinary in every respect: they may carry `target`, `content`, `with`, `capture`, `{{variable}}` references, and **step-level** `evaluations`. Those assertions travel with the step into every Session that includes it, which is a large part of the point — a shared opening carries its shared checks.

A fragment **may not** carry **session-level** `evaluations`. Chain evaluators are statements about a complete trace, and a fragment is not a trace; it is an excerpt that may be preceded and followed by arbitrary steps. Assertions about the whole path belong to the Session that owns that path.

## Fragments and variables

Fragments introduce **no new scoping rules**, deliberately. After expansion there is one Session, and VARIABLES.md applies verbatim.

Two consequences worth stating plainly:

**A fragment can capture for its includer.** If the shared opening captures `orderId`, a Session can reference `{{orderId}}` ten steps later. It works because, by the time resolution runs, both live in the same Session.

**A fragment can also reference what it does not capture.** A fragment is free to use `{{orderId}}` and leave the capturing to whoever includes it. That makes fragments powerful but *not necessarily self-contained*: the same fragment can be valid in one Session and an error in another. This is a real trade-off, accepted in exchange for having zero new scoping machinery. Authors should document which variables a fragment expects to already exist.

## Deliberately out of scope for v0.1

**Parameterized fragments** — "the same opening but for an optometrist instead of a dentist." Tempting, and the point at which a readable format starts becoming a programming language embedded in YAML. Deferred until real documents demonstrate the need; a Session can always include a fragment for the shared part and write the varying step longhand.

**Cross-file fragments** — a shared library of fragments across repositories. Requires resolution paths and versioning (OpenAPI's `$ref` to external files, and the tooling burden that comes with it). v0.1 scopes fragment names to a single file.

**Fragments as a unit of reuse across Sessions of different agents** — this is really the cross-file question plus a governance question, and belongs with the Variable/Context Specification.

See ROADMAP.md.
