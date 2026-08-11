# Examples

Runnable versions of every example below live under [examples/](./examples/). All validated to parse as YAML.

---

## 1. Multi-stage evaluation — damaged item refund

**The defining example.** Three conversational turns, five LLM-as-judge evaluations across three stages, plus two chain evaluations. No tool calls — works with any agent. Each `llm_judge` receives the accumulated trace up to that point, so evaluations get richer as the flow progresses.

👉 Files: [refund-multi-stage.yaml](./examples/refund-multi-stage.yaml) (single case) · [refund-multi-stage-parametrized.yaml](./examples/refund-multi-stage-parametrized.yaml) (dataset-driven) · [refund-cases.jsonl](./examples/refund-cases.jsonl) (4 test scenarios)

```yaml
session: Damaged item → refund (multi-stage evaluation)
behaviors:
  # ── Turn 1: intent classification ──
  - actor: user
    action: says
    content: "I received a damaged item, I want my money back. Order #8291."

  - actor: assistant
    action: clarifies
    content: "I understand your order #8291 arrived damaged. I'll help you get a refund."
    evaluations:
      - type: llm_judge
        criteria: |
          1. Correctly classifies the intent as a refund request
          2. References the order number #8291
          3. Acknowledges the damage (not a simple return)
          4. Takes ownership of the resolution

  # ── Turn 2: resolution with delivery ──
  - actor: user
    action: says
    content: "Yes please, how long will it take?"

  - actor: assistant
    action: informs
    content: "Refund of €47.50 approved. Reference: R-5512. You'll receive it in 3-5 days."
    capture:
      refundId: "R-5512"
    evaluations:
      - type: contains
        value: "R-5512"
      - type: llm_judge
        criteria: |
          1. States the exact refund amount (€47.50)
          2. Provides the reference number R-5512
          3. Sets a clear timeline (3-5 days)
          4. Professional and empathetic tone
      - type: Relevance
        query: user
        response: self

  # ── Turn 3: closing ──
  - actor: user
    action: says
    content: "Great, thanks."

  - actor: assistant
    action: confirms
    content: "You're welcome! Is there anything else I can help with?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Offers further assistance
          2. Does NOT reopen the resolved refund
          3. Concise and natural

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: clarifies }
      - { actor: assistant, action: informs }
      - { actor: assistant, action: confirms }
  - type: variable_consistency
    variable: refundId
```

### Same flow, parametrized with a dataset

Replace hardcoded values with `{{placeholders}}`, feed it 4 rows, get 4 runs:

```bash
abslang run examples/refund-multi-stage-parametrized.yaml \
  --agent $URL \
  --dataset examples/refund-cases.jsonl
```

Each row is a different scenario (damaged item, broken item, wrong item, cracked screen) with its own expected responses and evaluation criteria. Same multi-stage structure, N test cases.

---

## 2. RAG Groundedness — anti-hallucination for RAG agents

A user asks a question. The agent queries a knowledge base. We verify the answer is grounded in the retrieved context — no hallucinations.

```yaml
session: Return policy RAG — grounded answer
dataset:
  id: cases
  path: cases.jsonl
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"        # e.g. "Can I return items bought on sale?"

  - id: kb_call
    actor: assistant
    action: calls
    target: Knowledge Base

  - id: kb_result
    actor: tool
    action: responds
    target: Knowledge Base
    content: "{{cases.kbContent}}"        # e.g. "Sale items can be returned within 14 days with receipt"

  - id: answer
    actor: assistant
    action: informs
    content: "{{cases.expectedAnswer}}"   # e.g. "Yes, sale items can be returned within 14 days with a receipt."
    evaluations:
      # Factual accuracy: every claim must be supported by kb_result
      - type: Groundedness
        query: user_asks.says
        context: kb_result.responds
        response: self
        threshold: 0.8

      # Did it actually answer what was asked?
      - type: Relevance
        query: user_asks.says
        response: self

      # Is the response logically coherent?
      - type: Coherence
        response: self

evaluations:
  # Chain check: the agent must call the KB before answering — every time
  - type: sequence
    order:
      - { actor: assistant, action: calls, target: "Knowledge Base" }
      - { actor: assistant, action: informs }
```

### What this example shows

| Feature | Where |
|---|---|
| `Groundedness` — anti-hallucination | Step-level on `answer` |
| `Relevance` — response matches query | Step-level on `answer` |
| `Coherence` — logical flow | Step-level on `answer` |
| `sequence` — correct execution order | Chain-level: KB call before answer |
| Id-based references | `query: user_asks.says`, `context: kb_result.responds`, `response: self` |
| Dataset-driven | `{{cases.userQuery}}`, `{{cases.kbContent}}`, `{{cases.expectedAnswer}}` |
| Multiple evaluators on one step | `Groundedness` + `Relevance` + `Coherence` combined |

### How to run

```bash
# Route through AI Evaluator (dimension types need an adapter)
abslang run examples/rag-groundedness.yaml \
  --agent $URL \
  --dataset datasets/rag-cases.jsonl \
  --adapter llm_judge=aievaluator
```

See [examples/rag-groundedness.yaml](./examples/rag-groundedness.yaml).

---

## 3. Refund request — free-form LLM judge + hard facts + chain checks

A customer returns a damaged item. The agent verifies eligibility across two API calls, processes the refund, and confirms.

```yaml
session: Refund request — approved
description: |
  Customer returns a damaged item. Agent verifies eligibility,
  processes the refund, and confirms — with evaluations at every step.
behaviors:
  - actor: user
    action: says
    content: "I want to return order #8291, it arrived damaged"

  - actor: assistant
    action: asks
    content: "I'm sorry about that. Can you confirm your name and order date?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Shows empathy for the damaged item
          2. References the order number #8291
          3. Asks for verification info before taking action

  - actor: user
    action: says
    content: "Franco Vinciarelli, ordered last Tuesday"
    capture:
      customerName: "Franco Vinciarelli"

  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "8291"

  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "8291"
      status: "delivered"
      eligibleForRefund: true

  - actor: assistant
    action: calls
    target: Refunds API
    with:
      orderId: "8291"
      reason: "damaged"

  - actor: tool
    action: responds
    target: Refunds API
    content:
      refundId: "R-5512"
      amount: 47.50
      status: "processed"

  - actor: assistant
    action: informs
    content: "Refund of €47.50 processed, Franco. You'll receive it in 3-5 days. Your refund ID is R-5512."
    capture:
      refundId: "R-5512"
    evaluations:
      # Hard fact — runs locally
      - type: contains
        value: "R-5512"

      # Soft quality — built-in judge auto-detects OpenAI/Anthropic/Gemini
      - type: llm_judge
        criteria: |
          1. States the refund amount (€47.50) and timeline (3-5 days)
          2. Provides the refund reference R-5512
          3. Uses the customer's name (Franco)
          4. Reassuring tone — no upsells, no deflections

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Orders API" }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }
  - type: variable_consistency
    variable: refundId
  - type: never
    match: { actor: assistant, action: hands_off }
```

### What this example shows

| Feature | Where |
|---|---|
| Step-level `llm_judge` | Multi-criteria rubrics on `asks` and `informs` |
| Hard fact `contains` | Refund ID must appear in the response |
| Both evaluator types together | Same behavior has `contains` + `llm_judge` |
| Chain `sequence` | 4 assistant actions in exact order |
| Chain `variable_consistency` | `refundId` must be the same everywhere |
| Chain `never` | Agent must resolve, not escalate |
| Variable capture | `customerName`, `refundId` captured for reuse |
| Tool round-trips | Two `calls` → `responds` pairs |

### How to run

```bash
# Built-in judge — no adapter needed
OPENAI_API_KEY=sk-... abslang run examples/refund-request.yaml --agent $URL

# Or route through AI Evaluator
abslang run examples/refund-request.yaml --agent $URL --adapter llm_judge=aievaluator
```

See [examples/refund-request.yaml](./examples/refund-request.yaml).

---

## 3. Order status (minimal intro)

The simplest possible Session: user asks, assistant calls a tool, assistant informs.

```yaml
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"
    capture:
      userQuery: "Where is my order?"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "in_transit"
      eta: "2026-07-30"
    evaluations:
      - type: schema
        schema:
          type: object
          required: [status]
          properties:
            status: { type: string }

  - actor: assistant
    action: informs
    content: "Your order is on the way"
    evaluations:
      - type: contains
        value: "on the way"
```

### How to run

```bash
abslang run examples/order-status.yaml --agent $URL
```

See [examples/order-status.yaml](./examples/order-status.yaml).

---

## 4. Missing information flow

Same scenario, but the order number isn't known yet — the assistant asks for it first. This is a separate Session (v0.1 doesn't branch within a session).

```yaml
session: Order status requires order number
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"

  - actor: user
    action: says
    content: "12345"
    capture:
      orderId: "12345"

  - actor: assistant
    action: calls
    target: Order MCP
    with:
      orderId: "{{orderId}}"

  - actor: assistant
    action: informs
    content: "Your order is on the way"

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Order MCP" }
      - { actor: assistant, action: informs }
  - type: variable_consistency
    variable: orderId
  - type: never
    match: { actor: assistant, action: hands_off }
```

See [examples/order-status-missing-info.yaml](./examples/order-status-missing-info.yaml).

---

## 5. Appointment booking (multi-step, with UI interaction)

Shows `shows`/`selects` for UI-driven choice, and two related sessions (happy path + fallback with hand-off).

```yaml
session: Appointment booking
behaviors:
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

  - actor: assistant
    action: shows
    target: Appointment Options
    content:
      slots: ["2026-08-03T09:00", "2026-08-03T14:00"]

  - actor: user
    action: selects
    target: Appointment Options
    content: "2026-08-03T09:00"
    capture:
      selectedSlot: "2026-08-03T09:00"

  - actor: assistant
    action: submits
    target: Calendar API
    with:
      slot: "{{selectedSlot}}"

  - actor: assistant
    action: confirms
    content: "You're booked for August 3rd at 9:00 AM"
```

See [examples/appointment-booking.yaml](./examples/appointment-booking.yaml) — contains both the happy path and the hand-off fallback as separate YAML documents.

---

## 6. Chatbot greeting (minimal)

The smallest valid Session — useful as a smoke test.

```yaml
session: Chatbot greeting
behaviors:
  - actor: user
    action: says
    content: "Hi"

  - actor: assistant
    action: greets
    content: "Hello! How can I help you today?"
    evaluations:
      - type: llm_judge
        criteria: "Friendly greeting that invites the user to state their need, without assuming what they want."
```

### How to run

```bash
# Built-in judge — just set an API key
OPENAI_API_KEY=sk-... abslang run examples/chatbot-greeting.yaml --agent $URL
```

See [examples/chatbot-greeting.yaml](./examples/chatbot-greeting.yaml).

---

## Evaluator types at a glance

| Category | Types | Needs |
|---|---|---|
| **Built-in** | `contains`, `exact_match`, `regex`, `schema`, `tool_call` | Nothing — runs locally |
| **Chain** | `sequence`, `eventually`, `never`, `count`, `within`, `variable_consistency` | Nothing — runs locally |
| **`llm_judge`** | Free-form criteria in natural language | Built-in judge (auto-detects OpenAI/Anthropic/Gemini) or `--adapter llm_judge=aievaluator` |
| **Dimension** | `Groundedness`, `Relevance`, `Coherence`, `Fluency` | Adapter required — `--adapter llm_judge=aievaluator` |
| **Composition** | `all_of`, `any_of`, `none_of` | Nothing — wraps other evaluators |

## v0.2 — Optional Behaviors

### Missing data detection

[examples/missing-data.abs.yaml](./examples/missing-data.abs.yaml) — Agent detects when the user didn't provide an order ID and asks for it.

```bash
abslang run examples/missing-data.abs.yaml --agent $URL --dataset examples/missing-data.jsonl
```

Two rows have `hasOrderId: true` → agent should NOT ask. Two have `hasOrderId: false` → agent MUST ask. The `expected` evaluator validates the decision.

### Multi-parameter missing data

[examples/missing-data-multi.abs.yaml](./examples/missing-data-multi.abs.yaml) — Same pattern with order ID AND email. Four combinations. A single agent response matching both optionals is handled correctly (batch resolution).

### Agent decision

[examples/agent-decision.abs.yaml](./examples/agent-decision.abs.yaml) — Agent chooses between processing a refund or escalating. Dataset row specifies which path is expected. Two optional behaviors compete; `expected` validates the winner.
