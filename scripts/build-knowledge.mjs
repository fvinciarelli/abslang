#!/usr/bin/env node
/**
 * Generates the ABS assistant knowledge from the source of truth.
 *
 * Sources:
 *   - schema/abs.schema.json          (fields, evaluators, matches_when types)
 *   - VOCABULARY.md                   (action catalog)
 *   - examples/*.yaml                 (example catalog + tags)
 *   - assistant/base-prompt.md        (fixed prompt rules)
 *   - typescript/src/evaluators/adapters/*.ts, python/src/abslang/evaluators/adapters/*.py
 *
 * Outputs (identical content, one per consumer):
 *   - typescript/src/assistant-knowledge.ts   (CLI, Node)
 *   - ui/src/assistant-knowledge.ts           (web UI, browser)
 *
 * Usage:
 *   node scripts/build-knowledge.mjs           write the generated files
 *   node scripts/build-knowledge.mjs --check   exit 1 if the committed files are stale
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = [
  join(ROOT, "typescript/src/assistant-knowledge.ts"),
  join(ROOT, "ui/src/assistant-knowledge.ts"),
];

// ── Editorial data (validated against the schema) ──

const EVALUATOR_GROUPS = [
  { name: "Built-in (no adapter, deterministic)", types: ["exact_match", "contains", "regex", "schema", "tool_call", "f1", "bleu", "rouge"] },
  { name: "LLM judge / quality dimensions", types: ["llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency"] },
  { name: "Safety dimensions", types: ["HateUnfairness", "Violence", "Sexual", "SelfHarm"] },
  { name: "Chain (session-level)", types: ["sequence", "eventually", "never", "count", "within", "variable_consistency"] },
  { name: "Composition", types: ["all_of", "any_of", "none_of"] },
  { name: "Conditional", types: ["expected"] },
  { name: "Adapter-defined", types: ["custom"] },
];

const EVALUATOR_HINTS = {
  exact_match: "value",
  contains: "value",
  regex: "pattern",
  schema: "schema",
  tool_call: "target, with, ordered",
  f1: "ground_truth",
  bleu: "ground_truth",
  rouge: "ground_truth, variant (rouge1|rouge2|rougeL), metric (precision|recall|f1)",
  llm_judge: "criteria, prompt",
  Groundedness: "query, context, response, threshold",
  Relevance: "query, response, threshold",
  Coherence: "response, threshold",
  Fluency: "response, threshold",
  HateUnfairness: "query, response, threshold",
  Violence: "query, response, threshold",
  Sexual: "query, response, threshold",
  SelfHarm: "query, response, threshold",
  sequence: "order (selector list), ordered",
  eventually: "match, after, max_steps",
  never: "match",
  count: "match, min, max",
  within: "match, max_steps",
  variable_consistency: "variable",
  all_of: "evaluations",
  any_of: "evaluations",
  none_of: "evaluations",
  expected: "behavior, when, reason, after",
  custom: "adapter",
};

const ADAPTER_NOTES = {
  aievaluator: "AI Evaluator — unified LLM judge endpoint (also used for llm_judge)",
  azure: "Azure AI Foundry — llm_judge + quality/safety dimensions + agentic evaluators",
  aws: "AWS Bedrock — Converse API models",
  google: "Google Vertex AI — Gemini models",
};

// ── Source readers ──

function readSchema() {
  return JSON.parse(readFileSync(join(ROOT, "schema/abs.schema.json"), "utf-8"));
}

function readVocabulary() {
  const wanted = new Set(["Communication", "Execution", "Interaction", "Delegation"]);
  const groups = [];
  let current = null;
  for (const line of readFileSync(join(ROOT, "VOCABULARY.md"), "utf-8").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = wanted.has(heading[1].trim()) ? { name: heading[1].trim(), entries: [] } : null;
      if (current) groups.push(current);
      continue;
    }
    if (!current) continue;
    const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row) current.entries.push({ action: row[1], actors: row[2].trim(), meaning: row[3].trim() });
  }
  if (groups.length !== wanted.size) {
    throw new Error(`VOCABULARY.md: expected ${wanted.size} action categories, found ${groups.map((g) => g.name).join(", ")}`);
  }
  for (const group of groups) {
    if (group.entries.length === 0) throw new Error(`VOCABULARY.md: no actions parsed for "${group.name}"`);
  }
  return groups;
}

function readAdapters() {
  const found = new Set();
  for (const dir of [
    join(ROOT, "typescript/src/evaluators/adapters"),
    join(ROOT, "python/src/abslang/evaluators/adapters"),
  ]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const match = file.match(/^([a-z0-9_]+)\.(ts|py)$/);
      if (!match) continue;
      if (match[1] === "__init__" || match[1].endsWith("_prompts")) continue;
      found.add(match[1]);
    }
  }
  const described = new Set(Object.keys(ADAPTER_NOTES));
  const missing = [...found].filter((name) => !described.has(name));
  const extra = [...described].filter((name) => !found.has(name));
  if (missing.length || extra.length) {
    throw new Error(
      `Adapter notes out of sync. Missing: ${missing.join(", ") || "none"}. Stale: ${extra.join(", ") || "none"}. ` +
        `Update ADAPTER_NOTES in scripts/build-knowledge.mjs.`
    );
  }
  return [...found].sort();
}

const TAG_SIGNALS = [
  [/action:\s*calls\b/, "tool-calls"],
  [/action:\s*hands_off\b/, "handoff"],
  [/action:\s*asks\b/, "clarification"],
  [/action:\s*selects\b/, "ui-selection"],
  [/^dataset:/m, "dataset"],
  [/^fragments:/m, "fragments"],
  [/^\s*-?\s*include:/m, "fragments"],
  [/optional:\s*true/, "optional"],
  [/matches_when:/, "optional"],
  [/requires:/, "optional"],
  [/capture:/, "variables"],
  [/^---\s*$/m, "multi-session"],
  [/abs_version:\s*"0\.2"/, "v0.2"],
];

function readExamples(evaluatorTypes) {
  const dir = join(ROOT, "examples");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
  return files.map((file) => {
    const content = readFileSync(join(dir, file), "utf-8").trim();
    const name = file.replace(/\.(abs\.)?ya?ml$/, "");
    const sessionMatch = content.match(/^session:\s*(.+?)\s*$/m);
    const title = sessionMatch ? sessionMatch[1].replace(/^["']|["']$/g, "") : name;
    const tags = new Set(name.split(/[-_.]+/).filter((t) => !["abs", "yaml", "example", "examples"].includes(t)));
    for (const [re, tag] of TAG_SIGNALS) if (re.test(content)) tags.add(tag);
    for (const type of evaluatorTypes) {
      if (new RegExp(`type:\\s*${type}\\b`).test(content)) tags.add(type.toLowerCase());
    }
    return { name, title, file: `examples/${file}`, tags: [...tags].sort(), content };
  });
}

// ── Validation ──

function validate(schema) {
  const enumTypes = schema.definitions.evaluation.properties.type.enum;
  const grouped = EVALUATOR_GROUPS.flatMap((g) => g.types);
  const seen = new Set();
  for (const type of grouped) {
    if (seen.has(type)) throw new Error(`Evaluator "${type}" appears in more than one group`);
    seen.add(type);
    if (!enumTypes.includes(type)) throw new Error(`Evaluator "${type}" is not in the schema enum`);
  }
  const ungrouped = enumTypes.filter((t) => !seen.has(t));
  if (ungrouped.length) throw new Error(`Schema evaluators not covered by EVALUATOR_GROUPS: ${ungrouped.join(", ")}`);
  const staleHints = Object.keys(EVALUATOR_HINTS).filter((t) => !enumTypes.includes(t));
  if (staleHints.length) throw new Error(`EVALUATOR_HINTS mentions unknown evaluators: ${staleHints.join(", ")}`);
  const version = (schema.title.match(/v(\d+\.\d+)/) || [])[1];
  if (!version) throw new Error("Cannot read the ABS version from the schema title");
  return { enumTypes, version };
}

// ── Text builders ──

function buildCore(schema, version, vocabulary, adapters) {
  const matchesWhen = schema.definitions.behavior.properties.matches_when.properties.type.enum;
  const evaluatorLines = EVALUATOR_GROUPS.map((group) => {
    const items = group.types.map((t) => (EVALUATOR_HINTS[t] ? `${t} (${EVALUATOR_HINTS[t]})` : t));
    return `- **${group.name}:** ${items.join(", ")}`;
  });
  const actionLines = vocabulary.map(
    (group) => `- **${group.name}:** ${group.entries.map((e) => `${e.action} (${e.actors}) — ${e.meaning}`).join(" ")}`
  );
  const adapterLines = adapters.map((name) => `- ${name} — ${ADAPTER_NOTES[name]}`);

  return [
    `ABS v${version} quick reference. Generated from schema/abs.schema.json (normative), VOCABULARY.md, and the adapter registry.`,
    "",
    "### Top level",
    `session (string, REQUIRED), description, abs_version: "${version}" (REQUIRED in v${version}), dataset: {id, path}, fragments: {<name>: [behaviors]}, behaviors: [ ... ] (REQUIRED, at least 1), evaluations: [ ... ] (session-level, over the whole trace).`,
    "",
    "### Behavior fields",
    `id, actor (REQUIRED): user | assistant | tool | system | human | external, action (REQUIRED, see Actions), target, content, capture, with | with_only (mutually exclusive), evaluations (step-level), optional, requires, matches_when.`,
    `- optional: true → the runner tries to match the behavior; if the agent does not emit it, the step is skipped silently (not a failure).`,
    `- matches_when: {type: ${matchesWhen.join(" | ")}, criteria | value | pattern} → semantic match instead of relying on the action.`,
    `- requires: <behavior id> → this behavior only activates if that behavior matched.`,
    `- Branching: use optional + matches_when + requires when the agent MAY or MAY NOT do a step. Use separate sessions separated by --- for genuinely different outcomes.`,
    "",
    "### Evaluations",
    ...evaluatorLines,
    `- **Common fields:** blocking, threshold (0–1), adapter, when (dataset expression — the evaluation only runs when true), dataset, prompt.`,
    `- **References:** query, context, response, ground_truth. \`response: self\` = the behavior carrying the evaluation; \`<behavior id>.<action>\` resolves a step from the trace.`,
    "",
    "### Actions",
    ...actionLines,
    "Target semantics — Execution → the system/tool/API invoked; Delegation → the hand-off recipient; Interaction → the UI element acted on; Communication → normally omitted (use content).",
    "",
    "### Adapters (configured via CLI flags/env, not in the YAML)",
    ...adapterLines,
    "",
    "### Variables & dataset",
    "- capture: names a runtime value for reuse as {{var}}; a captured value wins over dataset bindings.",
    "- Dataset columns: {{<dataset id>.<column>}} — e.g. {{cases.userQuery}}.",
    "- A reference that resolves to nothing is an error.",
  ].join("\n");
}

function buildCatalog(examples) {
  return examples
    .map((ex) => `- ${ex.name} — ${ex.title} [${ex.tags.join(", ")}]`)
    .join("\n");
}

function jsString(value) {
  return JSON.stringify(value);
}

function renderModule({ version, examples, core, basePrompt, catalog }) {
  return `// AUTO-GENERATED by scripts/build-knowledge.mjs — DO NOT EDIT.
// Source of truth: schema/abs.schema.json, VOCABULARY.md, examples/*.yaml, assistant/base-prompt.md.
// Regenerate with: npm run gen:knowledge

export const ABS_VERSION = ${jsString(version)};

export interface KnowledgeExample {
  name: string;
  title: string;
  file: string;
  tags: string[];
  content: string;
}

export const EXAMPLES: KnowledgeExample[] = ${JSON.stringify(examples, null, 2)};

export const CORE = ${jsString(core)};

export const BASE_PROMPT = ${jsString(basePrompt)};

export const EXAMPLE_CATALOG = ${jsString(catalog)};

/** Picks the examples whose tags best match the query. Deterministic; no model involved. */
export function selectExamples(query: string, limit = 3, maxChars = 8000): KnowledgeExample[] {
  const q = (query || "").toLowerCase();
  const scored = EXAMPLES.map((ex) => {
    let score = 0;
    for (const tag of ex.tags) if (q.includes(tag.toLowerCase())) score += 3;
    for (const word of ex.name.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 2 && q.includes(word)) score += 2;
    for (const word of ex.title.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 3 && q.includes(word)) score += 1;
    return { ex, score };
  });
  scored.sort((a, b) => b.score - a.score || a.ex.name.localeCompare(b.ex.name));

  const picked: KnowledgeExample[] = [];
  let total = 0;
  for (const { ex } of scored) {
    if (picked.length >= limit) break;
    if (picked.length > 0 && total + ex.content.length > maxChars) continue;
    picked.push(ex);
    total += ex.content.length;
  }
  return picked;
}

/** Builds the system prompt: fixed rules + generated reference + the most relevant examples. */
export function buildSystemPrompt(query = ""): string {
  const picked = selectExamples(query, 3);
  const fullExamples = picked
    .map((ex) => "### " + ex.name + ": " + ex.title + "\\n\\n\`\`\`yaml\\n" + ex.content + "\\n\`\`\`")
    .join("\\n\\n");
  return [
    BASE_PROMPT,
    "# ABS REFERENCE — generated from the normative JSON Schema; if it is not here, it does not exist.",
    CORE,
    "# EXAMPLE CATALOG — every example available. The most relevant ones are expanded below.",
    EXAMPLE_CATALOG,
    "# RELEVANT EXAMPLES — complete, valid .abs.yaml files. Use them as reference, adapt to the user's flow.",
    fullExamples,
  ].join("\\n\\n");
}
`;
}

// ── Main ──

const schema = readSchema();
const { enumTypes, version } = validate(schema);
const vocabulary = readVocabulary();
const adapters = readAdapters();
const examples = readExamples(enumTypes);
if (examples.length === 0) throw new Error("No examples found in examples/");
const basePrompt = readFileSync(join(ROOT, "assistant/base-prompt.md"), "utf-8").trim();

const rendered = renderModule({
  version,
  examples,
  core: buildCore(schema, version, vocabulary, adapters),
  basePrompt,
  catalog: buildCatalog(examples),
});

const mode = process.argv.includes("--check") ? "check" : "write";
let stale = 0;
for (const target of TARGETS) {
  const relative = target.replace(ROOT + "/", "");
  const current = existsSync(target) ? readFileSync(target, "utf-8") : null;
  if (current === rendered) {
    console.log(`✅ up to date  ${relative}`);
    continue;
  }
  if (mode === "check") {
    console.error(`❌ stale        ${relative}`);
    stale++;
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, rendered);
  console.log(`✏️  wrote       ${relative}`);
}

if (mode === "check" && stale > 0) {
  console.error(`\nThe generated assistant knowledge is out of date. Run: npm run gen:knowledge`);
  process.exit(1);
}
console.log(`\nKnowledge: v${version}, ${examples.length} examples, ${enumTypes.length} evaluator types, adapters: ${adapters.join(", ")}`);
