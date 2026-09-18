# Azure AI Foundry Evaluation adapter

Routes ABS LLM-based evaluations through Microsoft Azure AI Foundry Evaluation
(modalidad local SDK). The adapter never re-runs your agent: it receives the trace
ABS already collected, maps it to Azure's expected input, calls the evaluator, and
returns a normalized `EvalResult`.

## Install

```bash
pip install abslang[azure]
```

Optional (cloud evaluation runs, Foundry dashboard publishing):

```bash
pip install abslang[azure-cloud]
```

## Configure

Set the Azure OpenAI deployment used as the judge:

```bash
export AZURE_OPENAI_ENDPOINT="https://<account>.services.ai.azure.com"
export AZURE_OPENAI_KEY="..."
export AZURE_OPENAI_DEPLOYMENT="<judge-model-deployment>"   # e.g. gpt-4o-mini
export AZURE_OPENAI_API_VERSION="2024-02-15-preview"       # optional
```

The evaluators are AI-assisted: they call an Azure OpenAI model as the judge and
incur token usage per evaluation.

## Run

```bash
# Azure for everything the adapter supports
abslang run session.abs.yaml --agent $AGENT_URL --adapter azure

# Azure for a single type
abslang run session.abs.yaml --agent $AGENT_URL --adapter Groundedness=azure

# Select Azure per-rule in the YAML (adapter: azure), register once on the CLI
abslang run session.abs.yaml --agent $AGENT_URL --adapter azure
```

```yaml
evaluations:
  - type: Groundedness
    adapter: azure        # selects azure for this rule only
    query: user_asks.says
    context: kb_result.responds
    response: self
    threshold: 0.8
```

If a rule declares `adapter: azure` but azure was never registered, the runner
reports a clear error instead of silently falling back:

```
Adapter 'azure' is not registered for 'Groundedness'.
Run with --adapter Groundedness=azure (or --adapter azure).
```

## TypeScript (npm)

The npm package ships the same `--adapter azure` without the Python
`azure-ai-evaluation` dependency. The adapter reimplements modality A locally:
it renders the official Azure prompt templates (MIT-licensed, from
`azure-ai-evaluation` 1.18.5) and calls your Azure OpenAI deployment's chat
completions endpoint. No Foundry project, no Entra ID, no eval runs.

```bash
# No extra install — the adapter is part of abslang (npm)
export AZURE_OPENAI_ENDPOINT="https://<account>.services.ai.azure.com"
export AZURE_OPENAI_KEY="..."
export AZURE_OPENAI_DEPLOYMENT="<judge-model-deployment>"
export AZURE_OPENAI_API_VERSION="2024-02-15-preview"   # optional

abslang run session.abs.yaml --agent $AGENT_URL --adapter azure
abslang run session.abs.yaml --agent $AGENT_URL --adapter Groundedness=azure
```

Same evaluator coverage and same score normalization as Python:

| Evaluator | npm implementation |
|---|---|
| `Groundedness`, `Relevance`, `Coherence`, `Fluency` | Official prompt templates, rendered and called locally |
| `llm_judge` | Azure OpenAI judge (identical system prompt and parsing as Python) |
| `custom` `azure.*` (agentic) | Official prompt templates with the conversation built from the ABS trace |

**Fidelity notes.** The quality dimensions and `llm_judge` are faithful to the
Python SDK. The agentic evaluators (`azure.task_adherence`,
`azure.intent_resolution`, `azure.tool_call_accuracy`) reuse the official prompt
templates but with a simplified conversation rendering from the ABS trace: the
Python SDK applies additional preprocessing (`reformat_conversation_history`,
`reformat_agent_response`) that is not reproduced in JavaScript. Scores are
comparable in direction, not guaranteed byte-identical. If you need strict
parity with the Azure SDK, run the Python CLI. Prompt templates can drift
between `azure-ai-evaluation` releases; the npm port is pinned to 1.18.5.

## Supported evaluators

| ABS | Azure evaluator | Inputs |
|---|---|---|
| `Groundedness` | `GroundednessEvaluator` | `query` (opt), `response`, `context` |
| `Relevance` | `RelevanceEvaluator` | `query`, `response` (`context` opt) |
| `Coherence` | `CoherenceEvaluator` | `query`, `response` |
| `Fluency` | `FluencyEvaluator` | `response` |
| `llm_judge` | Azure OpenAI judge (chat completions) | `criteria` |
| `custom` id `azure.task_adherence` | `TaskAdherenceEvaluator` | conversation (`query` + `response` arrays) |
| `custom` id `azure.intent_resolution` | `IntentResolutionEvaluator` | conversation |
| `custom` id `azure.tool_call_accuracy` | `ToolCallAccuracyEvaluator` | conversation + `tool_definitions` |

### `custom` — agentic evaluators

```yaml
evaluations:
  - type: custom
    id: azure.task_adherence
    threshold: 0.6

  - type: custom
    id: azure.tool_call_accuracy
    threshold: 0.6
```

`azure.tool_call_accuracy` needs tool definitions. The adapter derives minimal
definitions from the observed `calls` in the trace (tool name + parameter types) by
default. Provide a `tools:` block in the session for richer definitions (full JSON
schema, descriptions, required fields):

```yaml
session: Order status with tool schema
tools:
  - name: Order MCP
    description: Look up an order by id
    parameters:
      type: object
      properties:
        orderId: { type: string }
      required: [orderId]
```

## Score normalization

Azure returns 1–5 Likert scores for many evaluators. The adapter normalizes
everything to 0–1 (values above 1 are divided by 5) before returning, so ABS
`threshold` (0–1) always works:

- Azure `4` (1–5) → `0.8`
- Azure `pass` label → `1.0` / `fail` → `0.0`

The runner applies `threshold` over the normalized score.

## Conversation mapping

For agentic evaluators, the ABS trace is converted to OpenAI-style messages:

- `user`/`system` steps → `query` (context)
- consecutive `assistant` `calls` → one assistant message with `tool_call` content items
- `tool` `responds` → a `tool` message with a `tool_result` content item
- other `assistant` steps → text messages in `response`

`tool_call_id` is preserved when the runner captured it; otherwise synthetic ids
are generated and tool results are paired positionally with their calls.
