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
- Evaluations, including the descriptive-vs-testing duality and the step-level/session-level (chain) split — see EVALUATIONS.md
- Initial Vocabulary
- Sequencing
- Alternate flows modeled as separate Sessions
- Fragments (`include:`) for composition — see COMPOSITION.md
- Tool interaction spec (`calls`, `responds`, `with`/`with_only`, `tool_call` evaluator) — see TOOLS.md
- JSON Schema (`schema/abs.schema.json`) — complete and validated by the CLI at parse time; `$id` at https://github.com/fvinciarelli/abslang/blob/main/schema/abs.schema.json
- TypeScript implementation: parser, runner, all evaluators, CLI, OpenAI/Claude/Gemini adapters, AI Evaluator adapter, table formatter, test suite
- Python implementation: parser, runner, all evaluators, CLI, AI Evaluator + Azure + AWS + Google adapters, table formatter
- UI authoring tool (`ui/`): React + Material UI, drag & drop, property sheets, YAML export
- Website (`website/`): Next.js + Tailwind + MDX docs site
- Mock agent (`tools/mock_agent.py`) for local testing

## Closed — were "formal sub-specifications" in early drafts, now done

1. **Evaluation Specification** — **Done.** EVALUATIONS.md defines 7 step-level evaluators (`exact_match`, `contains`, `regex`, `schema`, `tool_call`, `llm_judge`, `custom`) and 6 chain evaluators (`sequence`, `eventually`, `never`, `count`, `within`, `variable_consistency`), plus composition via `all_of`/`any_of`/`none_of`. Failure semantics: non-blocking/best-effort default with opt-in `blocking: true`. Implemented in both TypeScript and Python with test coverage.
2. **Variable/Context Specification** — **Done for v0.1.** VARIABLES.md covers capture, resolution, runtime bindings (dataset, CLI flag, env var), precedence. Typed variables, computed/derived values, and cross-Session sharing are intentionally deferred to v0.2+.
3. **Official JSON Schema** — **Done.** `schema/abs.schema.json` covers all v0.2 constructs, plus the additive v0.3 evaluator types (`f1`, `bleu`, `rouge`, `ground_truth`). The TypeScript CLI validates documents against it using Ajv in the parse pipeline. The schema is functionally normative.
4. **UI Authoring Model** — **Done.** `ui/` is a working React app with drag & drop, property sheets, and YAML export covering all behavior and evaluation types.

## Closed in v0.2 (optional behaviors)

- Optional behaviors (`optional`, `requires`, `matches_when`), the `expected` evaluator, `when` expressions, `after` constraints, and batch optional resolution — see SPECIFICATION.md §7 and `.plans/branching-optional-behaviors.md`.

## Closed in v0.3 (evaluation reach + observability)

- Reference-based deterministic evaluators: `f1`, `bleu`, `rouge` with the `ground_truth` common field — see EVALUATIONS.md.
- Per-rule `adapter:` selection enforced in both implementations (named adapter registry).
- Structured logs and progress: `--log-format jsonl`, `--log-level`, `--log-file`, `--no-log-content`; machine-readable `code`/`details` on evaluation results — see CLI.md.
- Azure adapter on npm (local, prompt-based, no Python SDK); safety dimensions registered to the built-in judge in TypeScript.
- AWS Bedrock and Google Vertex AI adapters on npm.
- `blocking` failure propagation to `inconclusive` downstream results implemented in both runners.
- `python -m abslang` as an alternative entry point.

## Remaining open design questions

- **Vocabulary extensibility.** Is `action` a closed enum or an open, extensible namespace? VOCABULARY.md currently recommends plain lowercase verbs as a stopgap; a formal extension syntax (`x-` prefix or similar) is still undecided.
- **Actor/Action compatibility.** Should the spec enforce which actors can perform which actions, or leave it to implementer-defined validation layers (current v0.1 stance)?
- **Session composition — `Background:` style.** Fragments already solve prefix deduplication, but a Gherkin-style `Background:` that auto-includes without explicit `include:` entries hasn't been designed.
- **Parallel and retried behavior.** v0.1 assumes a strictly linear sequence. Real agents issue parallel tool calls and retries; no syntax exists yet to represent either.
- **Content typing.** `content` currently mixes free text, structured payloads, and "displayed" UI content under one untyped field. A `content_type` field (`text` / `structured` / `ui`) may be worth adding for tooling.
- **`llm_judge` calibration/reproducibility** across model versions.
- **Chain-evaluator selector** — whether it needs partial/regex matching on `target` (currently exact match only).
- **Cross-Session variable sharing** — explicitly out of scope for v0.1, candidate for v0.2+.
- **Parameterized fragments** — "same fragment, different values" (deferred until real documents demonstrate need).
- **Cross-file fragments** — shared fragment libraries across repositories (requires resolution paths and versioning).

## Implementation status

| Component | TypeScript | Python |
|---|---|---|
| Parser (YAML, multi-doc, fragments, variables) | ✅ | ✅ |
| JSON Schema validation | ✅ | ✅ |
| Runner (OpenAI, Claude, Gemini adapters) | ✅ | ✅ |
| All step-level evaluators | ✅ | ✅ |
| All chain evaluators | ✅ | ✅ |
| Composition (`all_of`/`any_of`/`none_of`) | ✅ | ✅ |
| AI Evaluator adapter (LLM judge) | ✅ | ✅ |
| Azure AI Foundry adapter (quality + agentic) | ✅ (prompt-based, no SDK) | ✅ (SDK) |
| AWS Bedrock adapter (LLM-as-judge) | ✅ (SDK v3 client) | ✅ (boto3) |
| Google Vertex AI adapter (quality + safety) | ✅ (prompt-based, no SDK) | ✅ (SDK) |
| Safety dimensions (curated rubrics) | ✅ | ✅ |
| Reference metrics (`f1`, `bleu`, `rouge` + `ground_truth`) | ✅ | ✅ |
| Per-rule `adapter:` selection | ✅ | ✅ |
| Structured logs (`--log-format`, `--log-level`, `--log-file`, `--no-log-content`) | ✅ | ✅ |
| CLI (`init`, `chat`, `run`, `report`, `generate-ci`) | ✅ | ✅ |
| Table formatter | ✅ | ✅ |
| JSON/JUnit output | ✅ | ✅ |
| Dataset loading (JSONL/JSON) | ✅ | ✅ |
| Test suite | ✅ | ✅ |
| E2E test suite | ✅ | — |
| VSCode extension | ✅ | — |

## How to propose a change

Until a formal governance process exists, proposals should:
1. Reference the specific document and section affected.
2. State the problem being solved, not just the proposed syntax.
3. Include a worked `.yaml` example under a `proposals/` directory (to be added) rather than editing the closed core documents directly.
