# Runner

> How **Agent Behavior Specification** goes from a file on disk to a green checkmark in CI.

The Runner takes a **Agent Behavior Specification** session, plays it against a real agent, and tells you whether the agent behaved as expected. It is the piece that makes **Agent Behavior Specification** not just documentation, but a test.

---

## The two things you need

To run a **Agent Behavior Specification** session you only need two things:

1. **A session file** — your `.abs.yaml`
2. **An agent URL** — an HTTP endpoint that speaks a simple chat protocol

That's it. The Runner handles the rest.

```bash
abslang run ./order-status.abs.yaml --agent http://localhost:8080/chat
```

---

## How the Runner thinks

The Runner has one simple rule:

> **Everything with `actor: user` goes to the agent. Everything else is what the agent should do in response.**

It walks the session top to bottom. When it finds a `user` Behavior, it sends it to the agent and waits. When the agent responds, the Runner captures the full response — messages, tool calls, everything — and moves on.

At the end, it compares what it observed against what the session said should happen, runs the evaluations, and prints a report.

### Picture it

```
Session (what you wrote)          Reality (what the agent did)
═══════════════════════           ═══════════════════════════
                                  
user says "Hi"          ──────→   POST /chat  { "messages": [{"role":"user","content":"Hi"}] }
                                  
assistant greets        ←──────   { "role": "assistant", "content": "Hello! How can I help?" }
  "Hello! How can..."                 ✅  matched, contains "How can I help"
                                  
user says "Order 12345" ──────→   POST /chat  { "messages": [..., {"role":"user","content":"Order 12345"}] }
                                  
assistant calls          ←──────   { "role": "assistant", "tool_calls": [{"function": {"name": "get_order", ...}}] }
  Order MCP                           ✅  matched, called Order MCP
                                  
tool responds            ←──────   { "role": "tool", "content": "{\"status\": \"shipped\"}" }
  { status: shipped }                ✅  matched
                                  
assistant informs        ←──────   { "role": "assistant", "content": "Your order has shipped!" }
  "Your order..."                    ✅  matched
     │                               
     └── evaluation: contains "shipped"  →  ✅  PASS
```

---

## The Agent Contract

For the Runner to talk to an agent, the agent needs to expose exactly one thing: an HTTP endpoint that accepts a list of messages and returns the assistant's next message.

### Request

```json
POST /chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Where is my order?" }
  ]
}
```

### Response

```json
{
  "message": {
    "role": "assistant",
    "content": "Please provide your order number"
  }
}
```

Or, if the agent calls a tool:

```json
{
  "message": {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      {
        "id": "call_1",
        "type": "function",
        "function": {
          "name": "get_order",
          "arguments": "{\"orderId\": \"12345\"}"
        }
      }
    ]
  }
}
```

The Runner will then send the tool result back and continue the conversation.

### That's the whole contract

This is the same shape used by OpenAI, Anthropic, and most open-source models. If your agent already has an OpenAI-compatible endpoint, it probably already speaks this protocol. If not, it's a thin translation layer away.

The spec deliberately does not mandate a specific API format — `openai` is the default, but the Runner supports pluggable agent adapters for anything that isn't. See [Agent adapters](#agent-adapters) below.



---

## The Evaluator Adapter

**Agent Behavior Specification** defines *what* to check. An evaluator adapter defines *how* to check it. The built-in evaluators (`exact_match`, `contains`, `regex`, `schema`, `tool_call`, `sequence`, `eventually`, `never`, `count`, `within`, `variable_consistency`) ship with the Runner. `llm_judge` and `custom` go through adapters.

### Adapter interface

An adapter is anything that implements this function:

```
evaluate(trace, evaluation_rule) → EvalResult
```

Where:

| Input | What it is |
|-------|------------|
| `trace` | The full observed conversation so far — every message, tool call, and response the agent produced |
| `evaluation_rule` | The `evaluations` entry from the ABS session — `type`, `value`, `criteria`, whatever the adapter needs |

| Output | What it is |
|--------|------------|
| `EvalResult.passed` | `true` or `false` |
| `EvalResult.score` | A number between 0 and 1 (for threshold-based checks) |
| `EvalResult.reason` | A human-readable explanation of why it passed or failed |

### Example: the LLM-as-judge adapter

When the Runner encounters this in a session:

```yaml
evaluations:
  - type: llm_judge
    criteria: "Response clearly states the order is in transit, in a friendly tone, without inventing a delivery date."
```

It calls the configured LLM-judge adapter:

```
adapter.evaluate(
  trace = [
    { role: "user", content: "Where is my order?" },
    { role: "assistant", content: "Your order is on the way!" },
  ],
  rule = {
    type: "llm_judge",
    criteria: "Response clearly states the order is in transit, in a friendly tone..."
  }
)
```

And the adapter returns:

```
EvalResult {
  passed: true,
  score: 0.92,
  reason: "The response states the order is on the way (in transit), uses a friendly tone with an exclamation mark, and does not mention a specific delivery date."
}
```

### Built-in evaluators (no adapter needed)

These run locally, no external service required:

| Evaluator | What it checks |
|-----------|---------------|
| `exact_match` | Observed content equals expected value |
| `contains` | Observed content contains substring |
| `regex` | Observed content matches pattern |
| `schema` | Observed content validates against JSON Schema |
| `tool_call` | Tool was called with correct target and parameters |
| `sequence` | Steps occurred in order |
| `never` | Something never happened |
| `eventually` | Something happened at least once |
| `count` | Something happened N times |
| `within` | Something happened within N steps of something else |
| `variable_consistency` | A captured variable had the same value everywhere |

Adapters implement these evaluator types (the runner dispatches to the configured adapter):

| Evaluator | What it checks |
|---|---|
| `llm_judge` | Free-form criteria evaluated by an LLM |
| `Groundedness` | Response is supported by the provided context |
| `Relevance` | Response addresses the query |
| `Coherence` | Logical flow and internal consistency |
| `Fluency` | Natural language quality |
| `custom` | Arbitrary evaluator identified by `id` |

Safety dimensions (`HateUnfairness`, `Violence`, `Sexual`, `SelfHarm`) are a special
case: they ship with a curated rubric and run on the **built-in judge** out of the
box — no adapter, no criteria. You can still route them to an external engine with
`adapter:` if one supports them.

### Adapter registry

Adapters are registered by evaluator type. The Runner ships with a built-in judge that auto-detects OpenAI, Anthropic, or Gemini from your environment. You can override it with an external adapter like AI Evaluator:

```bash
abslang run session.abs.yaml --agent $URL --adapter azure   # Azure AI Foundry
abslang run session.abs.yaml --agent $URL --adapter aws     # AWS Bedrock
abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator
```

Or in a config file:

```yaml
# abs.config.yaml
adapters:
  llm_judge: aievaluator
  Groundedness: azure
```

---

## Evaluator adapters

An adapter is where the LLM judgment actually happens. The runner ships with three
ready-to-use engines, plus a built-in judge that needs nothing but an API key.

**Built-in judge** — auto-detects OpenAI, Anthropic, or Gemini from your environment
and handles `llm_judge` plus the safety dimensions:

```bash
OPENAI_API_KEY=sk-... abslang run session.abs.yaml --agent $AGENT_URL
ANTHROPIC_API_KEY=sk-ant-... abslang run session.abs.yaml --agent $AGENT_URL
GEMINI_API_KEY=... abslang run session.abs.yaml --agent $AGENT_URL
```

**Azure AI Foundry** — `Groundedness`, `Relevance`, `Coherence`, `Fluency`, plus
agentic evaluators (`azure.task_adherence`, `azure.tool_call_accuracy`, …):

```bash
pip install "abslang[azure]"
export AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_KEY=... AZURE_OPENAI_DEPLOYMENT=...
abslang run session.abs.yaml --agent $AGENT_URL --adapter azure
```

**AWS Bedrock** — `llm_judge` and custom metrics through a Bedrock model:

```bash
pip install "abslang[aws]"
export AWS_REGION=us-east-1
abslang run session.abs.yaml --agent $AGENT_URL --adapter aws
```

**AI Evaluator** — free tier, no infrastructure:

```bash
abslang run session.abs.yaml --agent $AGENT_URL --adapter llm_judge=aievaluator
```

Any provider can ship an adapter implementing the same interface — **Agent Behavior
Specification** doesn't care which one you use. It just calls
`adapter.evaluate(trace, rule)` and expects an `EvalResult` back. See
[docs/adapters/](./docs/adapters/) for the shipped adapters and
[docs/adapter-guide.md](./docs/adapter-guide.md) to build your own.

For the full evaluator type reference, see [EVALUATIONS.md](./EVALUATIONS.md).

---

## Report format

`abslang run` produces three output formats, following the same pattern as the AI Evaluator CLI:

### Table (default, human)

```
┌──────────────────────────────────────────────────────────┐
│  **Agent Behavior Specification** — Results                                           │
├──────────────────────────────────────────────────────────┤
│  Session:  Order status requires order number            │
│  Agent:    http://localhost:8080/chat                     │
│  Result:   ✅ PASSED                                     │
│  Steps:    5/5 matched · 4/4 evaluations passed          │
├────┬────────────────────────────────────┬────────┬───────┤
│  # │ Step                               │ Result │       │
├────┼────────────────────────────────────┼────────┼───────┤
│  1 │ user says "Where is my order?"     │   →    │  sent │
│  2 │ assistant asks "order number"      │   ✅   │ match │
│  3 │ user says "12345"                  │   →    │  sent │
│  4 │ assistant calls Order MCP          │   ✅   │ match │
│  5 │ assistant informs "on the way"     │   ✅   │ match │
│    │   └─ contains "on the way"         │   ✅   │  pass │
│  C │ sequence: asks → calls → informs   │   ✅   │  pass │
│  C │ variable_consistency: orderId      │   ✅   │  pass │
│  C │ never: hands_off                   │   ✅   │  pass │
└────┴────────────────────────────────────┴────────┴───────┘
```

### JSON (`--format json`)

```json
{
  "session": "Order status requires order number",
  "agent": "http://localhost:8080/chat",
  "passed": true,
  "steps_total": 5,
  "steps_matched": 5,
  "evaluations_total": 4,
  "evaluations_passed": 4,
  "trace": [
    { "step": 1, "actor": "user", "action": "says", "sent": true },
    { "step": 2, "actor": "assistant", "action": "asks", "matched": true },
    { "step": 3, "actor": "user", "action": "says", "sent": true },
    {
      "step": 4,
      "actor": "assistant",
      "action": "calls",
      "matched": true,
      "observed": { "target": "Order MCP", "with": { "orderId": "12345" } }
    },
    {
      "step": 5,
      "actor": "assistant",
      "action": "informs",
      "matched": true,
      "observed_content": "Your order is on the way",
      "evaluations": [
        { "type": "contains", "value": "on the way", "passed": true, "score": 1.0 }
      ]
    }
  ],
  "chain_evaluations": [
    { "type": "sequence", "passed": true },
    { "type": "variable_consistency", "variable": "orderId", "passed": true },
    { "type": "never", "match": { "action": "hands_off" }, "passed": true }
  ]
}
```

### JUnit XML (`--format junit`)

For CI pipelines (GitHub Actions, GitLab CI, Jenkins). One `<testcase>` per step-level evaluation, plus one per chain evaluation.

---

## What the Runner does NOT do

The Runner is not an agent framework. It does not:

- Write prompts or orchestrate chains of thought
- Modify the agent under test
- Decide which model or framework the agent should use
- Require the agent to be built a certain way

It only plays the user's part, watches the agent, and reports what happened. The agent remains a black box — exactly as it should be for a behavioral test.

---

## Agent adapters

Agents speak different protocols. The Runner ships with built-in adapters for the three most common ones:

| Adapter | Protocol |
|---------|----------|
| `openai` (default) | OpenAI Chat Completions API |
| `claude` | Anthropic Messages API |
| `gemini` | Google Gemini API |

If your agent already exposes an endpoint compatible with any of these, it works out of the box. If not, you write a thin adapter:

```
agent_adapter.send(messages) → response
```

The adapter translates between the Runner's internal message format and whatever your agent expects. A custom adapter is a function or HTTP middleware — the Runner calls it for every turn.

### Authentication

Agents are rarely wide open. The Runner supports the four most common auth methods, passed via CLI flags or environment variables:

| Method | Flag | What it does |
|--------|------|-------------|
| `none` (default) | — | No auth headers sent |
| `api_key` | `--agent-auth api_key --agent-token $KEY` | Sends `X-API-Key: $KEY` header |
| `bearer` | `--agent-auth bearer --agent-token $TOKEN` | Sends `Authorization: Bearer $TOKEN` header |
| `oauth2` | `--agent-auth oauth2 --agent-token $TOKEN` | Sends `Authorization: Bearer $TOKEN` with automatic refresh if a refresh URL is configured |

For `oauth2`, the Runner can optionally handle token refresh automatically:

```bash
abslang run session.abs.yaml \
  --agent $AGENT_URL \
  --agent-auth oauth2 \
  --agent-token $ACCESS_TOKEN \
  --agent-refresh-url https://auth.example.com/oauth/token \
  --agent-refresh-token $REFRESH_TOKEN \
  --agent-client-id $CLIENT_ID
```

In CI, these typically come from secrets:

```bash
abslang run session.abs.yaml \
  --agent $STAGING_AGENT \
  --agent-auth bearer \
  --agent-token $AGENT_API_KEY
```

The spec says nothing about auth — it's an operational detail, not a behavioral one. The same session file runs against a local agent with no auth and a production agent behind OAuth2 without changing a single line.

---

## Execution model: step by step

```
1. Parse the session YAML
2. Expand fragments into a flat list of Behaviors
3. Create an empty trace
4. For each Behavior, in order:
   a. If actor is "user":
      - Send the content to the agent
      - Collect the agent's response
      - Append both to the trace
   b. If actor is "assistant" and action is "calls":
      - Look at the agent's last response for a tool_call
      - Match the tool name against target, arguments against with
      - If the tool needs a response to continue (the agent is waiting),
        send back the next actor:tool / action:responds Behavior's content
      - Append the tool call and tool response to the trace
   c. If actor is "tool":
      - Skip — this was already handled in (b) as the tool response payload.
        Its evaluations still run against the observed tool response.
   d. If actor is anything else (assistant says/informs/asks/etc):
      - Peek at the next agent response in the trace
      - Match it against this Behavior (actor, action, target, content shape)
      - If it matches, append it to the trace and continue
      - If it doesn't match, record the mismatch and continue
5. Run all step-level evaluations against the trace
6. Run all session-level (chain) evaluations against the full trace
7. Print the report
8. Exit 0 if everything passed, exit 1 otherwise
```

### How tool calls are captured

When the agent responds with a `tool_calls` block, the Runner captures everything in it:

```json
// What the agent sent back:
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "get_order",
        "arguments": "{\"orderId\": \"12345\"}"
      }
    }
  ]
}
```

This is matched against the session's expected `calls` Behavior:

```yaml
- actor: assistant
  action: calls
  target: Order MCP          # ← matched against function.name
  with:
    orderId: "12345"         # ← matched against function.arguments
```

If the session declares that the tool responds (the `actor: tool` Behavior), the Runner sends that payload back to the agent so the conversation can continue. The tool response is also captured and matched against the `tool` Behavior for evaluation:

```yaml
- actor: tool
  action: responds
  target: Order MCP
  content:
    status: "shipped"
  evaluations:
    - type: schema
      schema:
        type: object
        required: [status]
```

This means the Runner sees the full round-trip: the assistant asking for the tool, what parameters it passed, what the tool returned, and what the assistant said about it afterward. Everything is assertable.

### Matching rules

- `actor` and `action` must match exactly
- `target` (if present) must match the observed tool name, recipient, or UI element
- `with` (if present) must match the observed tool arguments (deep equality)
- `content` (if present) is checked for structural compatibility — a string doesn't need to match exactly (that's what `exact_match` evaluation is for), but if ABS says `content: { status: "shipped" }` and the agent says `"Your order shipped"`, that's a structural mismatch recorded in the report

---

## Relation to the core spec

RUNNER.md is a companion to SPECIFICATION.md, not part of the normative spec. It describes the reference implementation's behavior. Other Runner implementations may make different choices (streaming, different agent protocols, different report formats) while remaining ABS-conformant as long as they parse sessions per SPECIFICATION.md and implement the evaluation types per EVALUATIONS.md.

**Agent Behavior Specification** the specification says *what to describe and how to verify it*. The Runner says *how to execute it against a real agent*. They are designed together but versioned separately.
