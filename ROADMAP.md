# Roadmap

## Closed in v0.1 (conceptual core)

- Scope
- Session
- Behavior
- Actor
- Action
- Target
- Target semantics normativized: meaning is determined by Action category, MUST rule — see SPECIFICATION.md §4
- Content
- Variables
- Evaluations (minimal set), including the descriptive-vs-testing duality and the step-level/session-level (chain) split — see EVALUATIONS.md
- Initial Vocabulary
- Sequencing
- Alternate flows modeled as separate Sessions

## Not yet closed — formal sub-specifications

These are specification chapters, not conceptual design — the model exists, the precise rules don't yet:

1. **Evaluation Specification** — the core design is now **decided**: ABS is descriptive and testable by the same document (no `evaluations` = pure description); Evaluations exist at two levels, step-level (one Behavior) and session-level/chain (the whole trace, via `sequence`, `eventually`, `never`, `count`, `within`, `variable_consistency`); composition uses `all_of`/`any_of`/`none_of`; failure propagation defaults to non-blocking/best-effort with an opt-in `blocking: true` checkpoint. See EVALUATIONS.md. Still open: `llm_judge` calibration/reproducibility across model versions, whether the chain-evaluator selector needs partial/regex matching, and the precise algorithm for propagating `inconclusive` status through variable dependencies.
2. **Variable/Context Specification** — typed variables, computed/derived values, and whether cross-Session variable sharing should exist at all.
3. **Official JSON Schema** — a normative machine-checkable schema for the document format in SPECIFICATION.md. A draft, non-normative version exists at `schema/abs.schema.json` as a starting point.
4. **UI Authoring Model** — how a visual/no-code editor constructs and edits ABS documents without exposing raw YAML to non-technical authors.

## Open design questions

Carried over from initial review, not yet resolved by any of the closed sections above:

- **Vocabulary extensibility.** Is `action` a closed enum or an open, extensible namespace? VOCABULARY.md currently recommends plain lowercase verbs as a stopgap; a formal extension syntax (`x-` prefix or similar) is still undecided.
- **Actor/Action compatibility.** Should the spec enforce which actors can perform which actions, or leave it to implementer-defined validation layers (current v0.1 stance)?
- **Session composition.** Alternate flows currently duplicate their shared prefix across separate Sessions. A `background:`/`includes:` mechanism (similar in spirit to Gherkin's `Background:`) would remove the duplication but hasn't been designed.
- **Parallel and retried behavior.** v0.1 assumes a strictly linear sequence. Real agents issue parallel tool calls and retries; no syntax exists yet to represent either.
- **Content typing.** `content` currently mixes free text, structured payloads, and "displayed" UI content under one untyped field. A `content_type` field (`text` / `structured` / `ui`) may be worth adding for tooling (e.g. an editor that needs to know whether to render a chat bubble or a card) once EXAMPLES.md usage patterns stabilize.

## How to propose a change

Until a formal governance process exists, proposals should:
1. Reference the specific document and section affected.
2. State the problem being solved, not just the proposed syntax.
3. Include a worked `.yaml` example under a `proposals/` directory (to be added) rather than editing the closed core documents directly.
