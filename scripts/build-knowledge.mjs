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
 * Outputs (same content, one per consumer):
 *   - typescript/src/assistant-knowledge.ts   (CLI, Node)
 *   - ui/src/assistant-knowledge.ts           (web UI, browser)
 *   - python/src/abslang/assistant_knowledge.py (Python CLI)
 *
 * Usage:
 *   node scripts/build-knowledge.mjs           write the generated files
 *   node scripts/build-knowledge.mjs --check   exit 1 if the committed files are stale
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderPythonModule } from "./lib/render-python.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  rouge: "ground_truth; variant: rouge1|rouge2|rougeL; metric: precision|recall|f1",
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

// Short glosses for the actions where the verb alone is ambiguous. Everything
// else is listed with actors only, to keep the core small.
const ACTION_GLOSS = {
  responds: "reply to a prior says/asks/calls",
  informs: "final resolution / outcome",
  clarifies: "disambiguates a prior statement",
  shows: "displays structured content",
  calls: "invokes a system/tool/API; pair with a tool responds",
  submits: "sends completed input, e.g. a form",
  hands_off: "transfers to another actor, usually human",
};

// Mapping rules injected only when the user pastes a diagram (see looksLikeMermaid).
const MERMAID_GUIDE = `Mermaid to ABS mapping rules:
- flowchart / graph nodes: every node where someone does something becomes a behavior. Rectangles are ordinary steps. Diamonds are decisions: the agent MAY take that path, so model it as an optional behavior with matches_when. Labels starting with "User:" map to actor user; "Assistant:" to actor assistant; tool/API names to actor tool.
- Edges express order: chain the behaviors in that order. An edge going back to an earlier node means a repeated or alternate pass: model it with optional + requires, or split it into separate sessions separated by ---.
- sequenceDiagram: participants are actors. A Runner/Client participant is the test driver, not an actor; an Evaluator participant is not an actor either — evaluator messages become evaluations. Every arrow is a behavior.
- Notes, diamond labels, and edges labeled evaluate/validate/grounded become evaluations attached to the closest preceding behavior, or session-level chain evaluations (expected, never, sequence).
- Never invent steps that are not in the diagram. Keep the user's labels as content. When the diagram is ambiguous, generate the closest valid ABS and list your assumptions in one line.`;

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

function readMermaidExamples() {
  const dir = join(ROOT, "assistant/mermaid");
  if (!existsSync(dir)) throw new Error("assistant/mermaid/ directory is missing");
  const diagrams = readdirSync(dir).filter((f) => f.endsWith(".mmd")).sort();
  if (diagrams.length === 0) throw new Error("assistant/mermaid/ has no .mmd files");
  const paired = new Set(readdirSync(dir).filter((f) => f.endsWith(".abs.yaml")).map((f) => f.replace(/\.abs\.yaml$/, "")));
  const examples = diagrams.map((file) => {
    const name = file.replace(/\.mmd$/, "");
    if (!paired.has(name)) throw new Error(`assistant/mermaid/${name}.mmd has no matching ${name}.abs.yaml`);
    paired.delete(name);
    return {
      name,
      diagram: readFileSync(join(dir, file), "utf-8").trim(),
      yaml: readFileSync(join(dir, `${name}.abs.yaml`), "utf-8").trim(),
    };
  });
  if (paired.size > 0) throw new Error(`Orphan mermaid mappers (no .mmd): ${[...paired].join(", ")}`);
  return examples;
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
  const actions = new Set(readVocabulary().flatMap((g) => g.entries.map((e) => e.action)));
  const staleGlosses = Object.keys(ACTION_GLOSS).filter((a) => !actions.has(a));
  if (staleGlosses.length) throw new Error(`ACTION_GLOSS mentions unknown actions: ${staleGlosses.join(", ")}`);
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
    (group) =>
      `- **${group.name}:** ` +
      group.entries
        .map((e) => `${e.action} (${e.actors})${ACTION_GLOSS[e.action] ? ` — ${ACTION_GLOSS[e.action]}` : ""}`)
        .join(", ")
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
  return examples.map((ex) => `- ${ex.name} — ${ex.title}`).join("\n");
}

function jsString(value) {
  return JSON.stringify(value);
}

function renderModule({ version, examples, core, basePrompt, catalog, mermaidExamples, tooling, reportGuide }) {
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

export const TOOLING = ${jsString(tooling)};

export const REPORT_GUIDE = ${jsString(reportGuide)};

export const MERMAID_GUIDE = ${jsString(MERMAID_GUIDE)};

export interface MermaidExample {
  name: string;
  diagram: string;
  yaml: string;
}

export const MERMAID_EXAMPLES: MermaidExample[] = ${JSON.stringify(mermaidExamples, null, 2)};

const MERMAID_MARKERS = [
  /\`\`\`mermaid/i,
  /\\bflowchart\\b/i,
  /\\bsequenceDiagram\\b/i,
  /\\bgraph\\s+(TD|LR|TB|RL|BT)\\b/i,
  /\\bclassDiagram\\b/i,
  /\\bstateDiagram\\b/i,
  /\\berDiagram\\b/i,
  /\\bgantt\\b/i,
  /\\bjourney\\b/i,
];

/** True when the text looks like pasted Mermaid source. */
export function looksLikeMermaid(text: string): boolean {
  return MERMAID_MARKERS.some((re) => re.test(text || ""));
}

const ABS_OUTPUT_MARKERS = [
  '"run_id":',
  '"rows_total":',
  '"row_vars":',
  '"steps_matched":',
  '"evaluations_total":',
  '"chain_evaluations":',
  '"observed":',
  'evaluation.result',
  'behavior.match',
  'report.written',
];

/** True when the text looks like an abslang run output: report JSON, JSONL events, or a trace. */
export function looksLikeAbsOutput(text: string): boolean {
  return ABS_OUTPUT_MARKERS.some((marker) => (text || "").includes(marker));
}

/** Picks the examples whose tags best match the query. Deterministic; no model involved. */
export function selectExamples(query: string, limit = 3, maxChars = 5000): KnowledgeExample[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const scored = EXAMPLES.map((ex) => {
    let score = 0;
    for (const tag of ex.tags) if (q.includes(tag.toLowerCase())) score += 3;
    for (const word of ex.name.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 2 && q.includes(word)) score += 2;
    for (const word of ex.title.toLowerCase().split(/[^a-z0-9]+/)) if (word.length > 3 && q.includes(word)) score += 1;
    return { ex, score };
  });
  const ranked = scored.some((s) => s.score > 0)
    ? scored.sort((a, b) => b.score - a.score || a.ex.content.length - b.ex.content.length || a.ex.name.localeCompare(b.ex.name))
    : scored.sort((a, b) => a.ex.content.length - b.ex.content.length);

  const picked: KnowledgeExample[] = [];
  let total = 0;
  for (const { ex } of ranked) {
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
  const sections = [
    BASE_PROMPT,
    "# ABS REFERENCE — generated from the normative JSON Schema; if it is not here, it does not exist.",
    CORE,
    "# ABSLANG TOOLING — the CLI that runs these files.",
    TOOLING,
    "# EXAMPLE CATALOG — every example available. The most relevant ones are expanded below.",
    EXAMPLE_CATALOG,
    "# RELEVANT EXAMPLES — complete, valid .abs.yaml files. Use them as reference, adapt to the user's flow.",
    fullExamples,
  ];
  if (looksLikeMermaid(query)) {
    sections.push("# MERMAID INPUT — the user pasted a diagram. Convert it directly to ABS using these rules.");
    sections.push(MERMAID_GUIDE);
    for (const m of MERMAID_EXAMPLES) {
      sections.push(
        "## Mermaid input: " + m.name + "\\n\\n\`\`\`mermaid\\n" + m.diagram + "\\n\`\`\`\\n\\n" +
          "## ABS output for " + m.name + "\\n\\n\`\`\`yaml\\n" + m.yaml + "\\n\`\`\`"
      );
    }
  }
  if (looksLikeAbsOutput(query)) {
    sections.push("# ABS RUN OUTPUT — the user pasted a report, event log, or trace. Explain it for QA/PM.");
    sections.push(REPORT_GUIDE);
  }
  return sections.join("\\n\\n");
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
const mermaidExamples = readMermaidExamples();
const basePrompt = readFileSync(join(ROOT, "assistant/base-prompt.md"), "utf-8").trim();
const tooling = readFileSync(join(ROOT, "assistant/tooling.md"), "utf-8").trim();
const reportGuide = readFileSync(join(ROOT, "assistant/report-guide.md"), "utf-8").trim();

const data = {
  version,
  examples,
  core: buildCore(schema, version, vocabulary, adapters),
  basePrompt,
  catalog: buildCatalog(examples),
  mermaidExamples,
  mermaidGuide: MERMAID_GUIDE,
  tooling,
  reportGuide,
};
const outputs = [
  { path: join(ROOT, "typescript/src/assistant-knowledge.ts"), content: renderModule(data) },
  { path: join(ROOT, "ui/src/assistant-knowledge.ts"), content: renderModule(data) },
  { path: join(ROOT, "python/src/abslang/assistant_knowledge.py"), content: renderPythonModule(data) },
];

const mode = process.argv.includes("--check") ? "check" : "write";
let stale = 0;
for (const target of outputs) {
  const relative = target.path.replace(ROOT + "/", "");
  const current = existsSync(target.path) ? readFileSync(target.path, "utf-8") : null;
  if (current === target.content) {
    console.log(`✅ up to date  ${relative}`);
    continue;
  }
  if (mode === "check") {
    console.error(`❌ stale        ${relative}`);
    stale++;
    continue;
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, target.content);
  console.log(`✏️  wrote       ${relative}`);
}

if (mode === "check" && stale > 0) {
  console.error(`\nThe generated assistant knowledge is out of date. Run: npm run gen:knowledge`);
  process.exit(1);
}
console.log(`\nKnowledge: v${version}, ${examples.length} examples, ${enumTypes.length} evaluator types, adapters: ${adapters.join(", ")}`);
