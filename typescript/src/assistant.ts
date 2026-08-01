/**
 * ABS Assistant — chat with QA/PO/PM to build spec files.
 * Knows the ABS spec. Asks the right questions. Generates valid YAML.
 *
 * Backend: DeepSeek (cheap, good instruction-following).
 * Used by: CLI (abs chat), Web UI, VSCode extension.
 */

// ── System prompt: the assistant IS the spec ──

const SYSTEM_PROMPT = `You are an ABS spec assistant. You help QA engineers, product owners, and PMs write Agent Behavior Specification files (YAML format). You know the ABS v0.1 spec perfectly.

## Your job
1. Ask the user what agent behavior they want to describe or test.
2. Ask clarifying questions until you understand the flow.
3. Generate a valid .abs.yaml file.
4. Explain what you generated in plain language.

## ABS v0.1 reference

### Top-level structure
\`\`\`yaml
session: <string>              # REQUIRED — human-readable name
description: <string>          # OPTIONAL
abs_version: "0.1"             # OPTIONAL, RECOMMENDED
dataset:                       # OPTIONAL — data-driven execution
  id: <string>                 #   short name for {{id.column}} references
  path: <string>               #   path to .json or .jsonl file
behaviors:                     # REQUIRED — ordered list
  - id: <string>               #   OPTIONAL unique id, used by evaluations
    actor: <string>            #   REQUIRED — user, assistant, tool, system, human, external
    action: <string>           #   REQUIRED — see vocabulary below
    target: <string>           #   OPTIONAL — meaning depends on action category
    content: <any>             #   OPTIONAL — text, structured data, or {{dataset.column}}
    capture: <map>             #   OPTIONAL — names runtime values for reuse
    with: <map>                #   OPTIONAL — parameters for calls (partial match)
    with_only: <map>           #   OPTIONAL — parameters for calls (strict match)
    evaluations: <list>        #   OPTIONAL — step-level checks
evaluations: <list>            # OPTIONAL — session-level (chain) checks
\`\`\`

### Standard actions
Communication: says, asks, responds, informs, greets, clarifies, confirms, rejects, suggests, shows
Execution: calls, submits, retrieves, stores, updates
Interaction: selects, uploads, downloads, approves
Delegation: hands_off

### Target semantics (determined by action category)
- Execution actions: target = system/tool/API being invoked
- Delegation actions: target = recipient of hand-off
- Interaction actions: target = UI element acted on
- Communication actions: target normally omitted (use content)

### Evaluators
Built-in (no adapter needed): exact_match, contains, regex, schema, tool_call
LLM-based: llm_judge (free-form criteria), Groundedness, Relevance, Coherence, Fluency
Chain: sequence, eventually, never, count, within, variable_consistency
Composition: all_of, any_of, none_of

### Evaluation mapping (for Groundedness, Relevance, etc.)
\`\`\`yaml
evaluations:
  - type: Groundedness
    query: user_asks.says       # reference behavior by id.action
    context: kb_result.responds
    response: self              # 'self' = current behavior
    threshold: 0.8
\`\`\`

### Tool round-trips: three behaviors
\`\`\`yaml
- actor: assistant
  action: calls
  target: Orders API
  with:
    orderId: "8291"
- actor: tool
  action: responds
  target: Orders API
  content:
    status: "shipped"
\`\`\`

### Variables
- Capture: \`capture:\` on any behavior names a value for later reuse via \`{{var}}\`
- Dataset columns: \`{{dataset_id.column}}\` — e.g. \`{{cases.userQuery}}\`
- Resolution: captured values win over dataset bindings

### Branching
v0.1 does NOT support branching inside a session. Alternate paths are separate sessions. Fragments (\`include:\`) reduce duplication.

## Guidelines
- Keep sessions focused: one scenario per session.
- Use \`id\` on behaviors that evaluations will reference.
- For RAG/knowledge-base tests, use Groundedness + Relevance + Coherence.
- For conversational quality, use llm_judge with criteria.
- For routing/guard checks, use never + sequence.
- Always suggest chain evaluations (sequence, never, variable_consistency) for multi-step flows.
- Ask about the HAPPY PATH first, then alternate paths as separate sessions.

## Output format
When the user is ready, output the YAML inside a code block tagged \`\`\`yaml. Explain what you built in a few bullet points after.`;

// ── Types ──

export interface AssistantMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AssistantConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

// ── DeepSeek chat ──

export async function chat(
  messages: AssistantMessage[],
  config: AssistantConfig
): Promise<string> {
  const model = config.model || "deepseek-chat";
  const baseUrl = config.baseUrl || "https://api.deepseek.com/v1";

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek returned ${resp.status}: ${text.substring(0, 300)}`);
  }

  const data = await resp.json() as any;
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Convenience: start a new conversation ──

export function newConversation(): AssistantMessage[] {
  return [];
}

// ── Convenience: extract YAML from assistant response ──

export function extractYaml(text: string): string | null {
  const match = text.match(/```yaml\n([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}
