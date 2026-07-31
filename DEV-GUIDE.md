# ABS Guide for Developers

> How to read, write, and implement agent specs — with a focus on tool calls, API contracts, and the execution model.

---

## Your role with ABS

As a developer, you interact with ABS in three ways:

1. **You read specs** written by QA and PO during Three Amigos. The spec tells you what APIs to call, with what parameters, and what the agent should say.
2. **You write specs** when you're designing a new flow and want to nail down the tool interactions before coding.
3. **You build agents** that pass ABS evaluations. The spec is your acceptance criteria.

This guide focuses on the parts that matter most to you: tool calls, API contracts, parameter matching, and the runner.

---

## The tool round-trip: three Behaviors, independently assertable

When your agent calls an API, ABS represents it as three separate steps:

```yaml
# 1. The agent calls the tool
- actor: assistant
  action: calls
  target: Orders API
  with:
    orderId: "8291"

# 2. The tool responds
- actor: tool
  action: responds
  target: Orders API
  content:
    orderId: "8291"
    status: "in_transit"
    eta: "2026-08-03"

# 3. The agent tells the user about it
- actor: assistant
  action: informs
  content: "Your order is on its way — estimated delivery August 3rd."
```

**Why three steps instead of one?** Because QA can verify each independently:

- Step 1: Did the agent call the right tool with the right parameters?
- Step 2: Did the tool return a valid response (schema check)?
- Step 3: Did the agent accurately communicate the result (no hallucination)?

If you merge the tool response into the `informs` step, QA can't check whether the agent faithfully reported what the API actually returned.

---

## Parameter matching: `with` vs `with_only`

### `with` — partial match (default)

The observed call must contain all the declared keys. Extra keys are fine.

```yaml
- actor: assistant
  action: calls
  target: Orders API
  with:
    orderId: "8291"
```

Your agent can pass additional parameters (`locale`, `tracingId`, `userId`) without breaking the spec. This is the default because it makes specs resilient to implementation details.

### `with_only` — strict match

The observed call must contain exactly the declared keys. No extras allowed.

```yaml
- actor: assistant
  action: calls
  target: Payment API
  with_only:
    orderId: "8291"
    amount: 47.50
```

Use `with_only` for security-critical or compliance-sensitive calls where an extra parameter would change behavior or introduce risk.

### When to use which

| Situation | Use |
|---|---|
| Call has contextual params (trace ID, locale) that vary per environment | `with` |
| Call parameters are a stable, well-defined contract | `with` |
| Extra parameters could change behavior or introduce risk | `with_only` |
| Compliance: must audit that exactly N params were sent | `with_only` |

---

## Multiple tool calls

Agents often call several tools before responding to the user. ABS represents this as consecutive `calls` Behaviors:

```yaml
- actor: assistant
  action: calls
  target: Orders API
  with:
    orderId: "8291"

- actor: assistant
  action: calls
  target: Inventory API
  with:
    sku: "SKU-001"
```

### Ordering

By default, the runner expects calls in the order they appear. If order doesn't matter, QA can add:

```yaml
  evaluations:
    - type: tool_call
      ordered: false
```

This tells the runner: "both calls must happen, but in either order." Use this for independent calls that happen to be batched together.

### Tool response for each call

If the agent continues after receiving tool responses, declare each response as a `tool` Behavior:

```yaml
- actor: tool
  action: responds
  target: Orders API
  content:
    orderId: "8291"
    status: "shipped"

- actor: tool
  action: responds
  target: Inventory API
  content:
    sku: "SKU-001"
    inStock: true
```

---

## Variables: capture once, reuse everywhere

Variables let the spec capture values from the conversation and reuse them in later tool calls:

```yaml
- actor: user
  action: says
  content: "My order number is 8291"
  capture:
    orderId: "8291"

# Five steps later...
- actor: assistant
  action: calls
  target: Refunds API
  with:
    orderId: "{{orderId}}"      # ← resolved to "8291"
```

### How resolution works

1. `capture` binds a value from the conversation
2. `{{variable}}` references it anywhere downstream
3. Runtime bindings (dataset, CLI `--var`, env) fill in values not captured in the session

### For developers building agents

Your agent doesn't need to know about ABS variables. They're a spec-side concern. The runner resolves `{{orderId}}` before comparing against your agent's actual output. You just need to call the right API with the right parameters.

---

## The runner: how your agent gets tested

When QA runs a spec against your agent, here's what happens:

```
1. Parse the ABS YAML
2. For each Behavior in order:
   a. user says → POST to your agent's /chat endpoint
   b. assistant calls → check your agent's tool_calls against the spec
   c. tool responds → send tool result back to your agent, continue
   d. assistant informs/asks/etc → match your agent's response
3. Run all evaluations against the observed trace
4. Report pass/fail
```

### What your agent needs to expose

One HTTP endpoint that accepts the OpenAI chat format:

```
POST /chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Where is my order?" }
  ]
}
```

Your agent responds with:

```json
{
  "message": {
    "role": "assistant",
    "content": "Please provide your order number"
  }
}
```

Or, if it calls a tool:

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
          "name": "Orders API",
          "arguments": "{\"orderId\": \"8291\"}"
        }
      }
    ]
  }
}
```

### Supported formats

| Format | Protocol |
|---|---|
| `openai` (default) | OpenAI Chat Completions API |
| `claude` | Anthropic Messages API |
| `gemini` | Google Gemini API |

If your agent speaks a different protocol, you can write a thin adapter. The runner calls `adapter.send(messages) → response` for every turn.

---

## Tool names and `target` matching

The `target` field in a `calls` Behavior is matched against `function.name` in the agent's `tool_calls` block:

```yaml
# ABS spec:
target: Orders API

# Your agent must produce:
{ "function": { "name": "Orders API" } }
```

The match is exact. If your agent calls `get_order` but the spec says `Orders API`, that's a mismatch. Align tool names during Three Amigos.

---

## Schema validation on tool responses

QA can validate tool response payloads with JSON Schema:

```yaml
- actor: tool
  action: responds
  target: Orders API
  content:
    orderId: "8291"
    status: "shipped"
  evaluations:
    - type: schema
      schema:
        type: object
        required: [orderId, status, eta]
        properties:
          orderId: { type: string }
          status: { type: string, enum: [shipped, pending, cancelled] }
          eta: { type: string, format: date }
        additionalProperties: false
```

This checks that your API returns all required fields, with the right types, and no unexpected fields. It catches API contract drift before it reaches production.

---

## Integrating with MCP, REST, or custom backends

ABS doesn't care how your agent implements tool calls. The spec just says "the agent called Orders API with these parameters." Under the hood you can use:

- **MCP (Model Context Protocol)** — `target` is the MCP server name
- **REST** — `target` is the API name, `with` is the JSON body
- **Function calling** — `target` is the function name, `with` is the arguments
- **Custom orchestration** — as long as your agent's `tool_calls` block matches the spec

The contract between ABS and your agent is the `tool_calls` shape. Everything else is your implementation.

---

## Building against a spec: the workflow

```
Three Amigos produces:  refund.abs.yaml
            │
            ▼
┌─────────────────────────────────────┐
│  You read:                          │
│  - calls Orders API with orderId    │
│  - calls Refunds API with orderId   │
│  - informs with amount and timeline │
│                                     │
│  You build:                         │
│  - /chat endpoint                   │
│  - Orders API tool definition       │
│  - Refunds API tool definition      │
│  - Prompt that follows the flow     │
└─────────────────────────────────────┘
            │
            ▼
  QA runs: abs run refund.abs.yaml
            │
            ▼
  ✅ 8/8 steps matched · 7/7 evals passed
  or
  ❌ Step 4: expected 'Refunds API', got 'Payment API'
```

The spec is your acceptance criteria. You're done when it's green.

---

## Common developer questions

**Do I need to install ABS to build my agent?**
No. The spec is YAML. Read it, implement against it. QA runs ABS.

**What if my agent does things between steps that aren't in the spec?**
Extra steps between spec Behaviors are fine. The runner only checks that the expected steps happen in order — other stuff can happen between them.

**What if my agent calls tools in a different order than the spec?**
That's a mismatch unless QA set `ordered: false`. Talk about tool ordering during Three Amigos.

**Can I use streaming responses?**
Yes. The runner handles both streaming and non-streaming responses. Set `stream: true` in your adapter config.

**How do I test my agent locally during development?**
```bash
python tools/mock_agent.py --port 8080
abs run session.abs.yaml --agent http://localhost:8080/chat
```

The mock agent returns predefined responses so you can verify your spec parses and evaluates correctly before connecting to a real agent.

**What if my agent needs auth?**
The runner supports `api_key`, `bearer`, and `oauth2` auth. QA configures it via CLI flags or environment variables. Your agent just needs to accept the standard headers.

**Can I run ABS in CI?**
Yes. `abs run --format junit --ci` produces a JUnit XML report that GitHub Actions, GitLab CI, and Jenkins understand natively.

```bash
abs run sessions/ --agent $STAGING_URL --format junit --ci > report.xml
```
