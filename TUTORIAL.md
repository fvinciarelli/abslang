# **Agent Behavior Specification** Tutorial for QA

> A step-by-step guide to writing agent specifications that everyone understands — and that run as automated tests.

---

## What **Agent Behavior Specification** is and why you should care

A developer tells you *"the refund bot is ready, test it."* You open the chat, type *"I want to return an item,"* and the bot replies. Is it correct? Did it do everything it should? Did it skip a step?

Right now you probably have a Word doc with test cases and you run through them manually. **Agent Behavior Specification** replaces that: **a single YAML file that describes what the agent should do, and can be executed as an automated test.**

In a Three Amigos session (QA + Dev + PO), this file is the artifact all three of you read, debate, and sign off on. Dev uses it to know what to build. PO reads it as a behavioral contract. You use it to know exactly what to verify.

---

## First 5 minutes: the structure

An **Agent Behavior Specification** document describes a **conversation**. It has two parts per step: who is speaking and what they're doing.

```yaml
session: Customer checks order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order #8291?"

  - actor: assistant
    action: calls
    target: Orders API

  - actor: assistant
    action: informs
    content: "Your order is on the way"
```

That's it. Three fields per step. `actor` is who (`user`, `assistant`, `tool`), `action` is what they do (`says`, `calls`, `informs`, `asks`...), and `content` or `target` is the details.

---

## A real example: damaged item refund — multi-stage evaluation

Here's the user story from your PO:

> *"A customer reports a damaged item. The agent classifies the intent, processes the refund, and closes the conversation. Each stage has its own quality bar."*

### Step 1: Write the conversation — no evaluations yet

First, describe what should happen across three turns. Just `actor`, `action`, `content`:

```yaml
session: Damaged item → refund
behaviors:
  # Turn 1: classification
  - actor: user
    action: says
    content: "I received a damaged item, I want my money back. Order #8291."

  - actor: assistant
    action: clarifies
    content: "I understand your order #8291 arrived damaged. I'll help you get a refund."

  # Turn 2: resolution
  - actor: user
    action: says
    content: "Yes please, how long will it take?"

  - actor: assistant
    action: informs
    content: "Refund of €47.50 approved. Reference: R-5512. You'll receive it in 3-5 days."

  # Turn 3: closing
  - actor: user
    action: says
    content: "Great, thanks."

  - actor: assistant
    action: confirms
    content: "You're welcome! Is there anything else I can help with?"
```

Three turns, six steps. No tool calls — works with any agent. Your PO reads this and understands the flow. Your dev knows what responses to build for.

### Step 2: Add evaluations at each stage

Now you, as QA, add quality checks at the three critical moments — each stage has its own bar:

```yaml
  # Turn 1: did the agent understand the intent?
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

  # Turn 2: did it deliver the facts completely?
  - actor: assistant
    action: informs
    content: "Refund of €47.50 approved. Reference: R-5512. You'll receive it in 3-5 days."
    capture:
      refundId: "R-5512"
    evaluations:
      # Hard fact
      - type: contains
        value: "R-5512"
      # Soft qualities
      - type: llm_judge
        criteria: |
          1. States the exact refund amount (€47.50)
          2. Provides the reference number R-5512
          3. Sets a clear timeline (3-5 days)
          4. Professional and empathetic tone
      # Did it answer what was asked?
      - type: Relevance
        query: user
        response: self

  # Turn 3: is the closing appropriate?
  - actor: assistant
    action: confirms
    content: "You're welcome! Is there anything else I can help with?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Offers further assistance
          2. Does NOT reopen the resolved refund
          3. Concise and natural
```

This is the key: **each `llm_judge` sees a different slice of the trace**. Turn 1's evaluator only sees the clarification. Turn 2's sees clarification + resolution. Turn 3's sees the entire conversation. The evaluation gets richer as the flow progresses.

### Step 3: Whole-conversation checks

Beyond individual steps, properties that span the entire trace:

```yaml
evaluations:
  # The 3 assistant actions MUST happen in this relative order
  - type: sequence
    order:
      - { actor: assistant, action: clarifies }
      - { actor: assistant, action: informs }
      - { actor: assistant, action: confirms }

  # The refund ID must be consistent everywhere
  - type: variable_consistency
    variable: refundId
```

Seven evaluations total: five step-level across three stages, two chain-level. **Multi-stage evaluation is what makes ABS different from a single-shot eval tool.**

---

## The complete file

About 60 lines. PO understands the conversation. Dev knows what to build. QA has 7 automated checks across 3 stages of the same flow. One file.

> 👉 Full file at [`examples/refund-multi-stage.yaml`](examples/refund-multi-stage.yaml)

---

## Ok, but how do I evaluate with multiple test scenarios?

Replace the hardcoded values with `{{placeholders}}` and feed it a dataset. The session structure stays identical — only the data changes per row:

```yaml
session: Damaged item → refund (parametrized)
dataset:
  id: cases
  path: refund-cases.jsonl
behaviors:
  - actor: user
    action: says
    content: "{{cases.userMessage}}"       # Each row provides its own message

  - actor: assistant
    action: clarifies
    content: "{{cases.expectedClarification}}"
    evaluations:
      - type: llm_judge
        criteria: "{{cases.clarificationCriteria}}"     # Each row has its own criteria
  # ... same structure, all values from dataset
```

The dataset is a JSONL file — one JSON object per row, one row per test case:

```jsonl
{"userMessage": "I received a damaged item...", "expectedClarification": "...", ...}
{"userMessage": "My order #3412 arrived broken...", "expectedClarification": "...", ...}
{"userMessage": "Wrong item in my box for order #5567...", "expectedClarification": "...", ...}
{"userMessage": "Order #1234 came with a cracked screen...", "expectedClarification": "...", ...}
```

Four rows, four runs, four scenarios — all using the same multi-stage evaluation. One command:

```bash
abslang run refund-multi-stage-parametrized.abs.yaml \
  --agent $URL \
  --dataset refund-cases.jsonl
```

> 👉 Full files at [`examples/refund-multi-stage-parametrized.yaml`](examples/refund-multi-stage-parametrized.yaml) · [`examples/refund-cases.jsonl`](examples/refund-cases.jsonl)

---

## How to create and run it

Four ways, from zero effort to full integration:

### 1. Chat — describe it, it writes the file for you

You don't need to know the YAML format. Open a terminal and describe what the agent should do:

```bash
# Works with OpenAI, Anthropic, or DeepSeek — auto-detects from env
abslang chat

# Or specify a provider
abslang chat --provider openai
```

The assistant asks you guided questions, generates a complete `.abs.yaml` with evaluations, dataset placeholders, and chain checks — then validates it before saving. [Full details →](./CLI.md#abslang-chat)

### 2. Browser — zero install

Go to the **[ABS Designer](/abs-designer/)**. In the right panel, click the ✨ **Assistant** tab and describe the behavior in plain language — it generates the YAML and loads it into the visual editor. Enter your agent URL, hit ▶ Run. Results appear inline.

### 3. Terminal — the full pipeline

This is where `abslang` earns its keep. The CLI has five commands and can take you from zero to CI quality gate in five minutes.

#### `abslang init` — scaffold a project

```bash
abslang init
```

Creates:
- `abs.config.yaml` — project settings (agent URL, auth, adapters, timeout)
- `sessions/order-status.abs.yaml` — example session with `{{placeholders}}`
- `sessions/order-status.jsonl` — 3-row dataset that binds those placeholders

You can run it immediately if you have an agent:

```bash
abslang run sessions/order-status.abs.yaml --agent http://localhost:8080/chat
```

#### `abslang run` — execute sessions

The workhorse. Every flag maps to an env var for CI use.

**Single session, quick smoke test:**

```bash
abslang run sessions/order-status.abs.yaml --agent http://localhost:8080/chat
```

**Single session with a variable override (no dataset needed):**

```bash
abslang run sessions/order-status.abs.yaml --agent $URL --var orderId=12345
```

**With a dataset — parametrized testing, one run per row:**

```bash
abslang run sessions/order-status.abs.yaml --agent $URL --dataset sessions/order-status.jsonl
```

Three rows, three runs. Each row binds `{{orderId}}`, `{{expectedResponse}}`, and `{{expectedKeyword}}` to concrete values. The report aggregates all of them.

**Filter dataset rows during development:**

```bash
abslang run sessions/order-status.abs.yaml --agent $URL --dataset cases.jsonl --filter "orderId:12345"
```

Runs only rows where `orderId` equals `12345`. Fast iteration on a single case.

**Run a directory of sessions against a directory of datasets:**

```bash
abslang run sessions/ --agent $URL --dataset datasets/
```

Pairs `order-status.abs.yaml` with `order-status.jsonl`, `booking.abs.yaml` with `booking.jsonl`, etc. One command, N scenarios.

**Agent adapters — OpenAI, Claude, Gemini:**

```bash
# OpenAI-compatible (default)
abslang run session.abs.yaml --agent $URL

# Anthropic Claude
abslang run session.abs.yaml --agent $URL --agent-format claude

# Google Gemini
abslang run session.abs.yaml --agent $URL --agent-format gemini
```

**Agent authentication:**

```bash
# API key
abslang run session.abs.yaml --agent $URL --agent-auth api_key --agent-token $KEY

# Bearer token
abslang run session.abs.yaml --agent $URL --agent-auth bearer --agent-token $TOKEN

# OAuth2 with auto-refresh
abslang run session.abs.yaml --agent $URL \
  --agent-auth oauth2 --agent-token $ACCESS \
  --agent-refresh-url https://auth.example.com/oauth/token \
  --agent-refresh-token $REFRESH
```

**Output formats:**

```bash
abslang run session.abs.yaml --agent $URL                     # table (human-readable)
abslang run session.abs.yaml --agent $URL --format json        # machine-readable
abslang run session.abs.yaml --agent $URL --format junit       # CI integration
```

**Parallel execution:**

```bash
abslang run session.abs.yaml --agent $URL --dataset 200-cases.jsonl --parallel 5
```

Runs 5 dataset rows in parallel. Speed up large suites without changing a single line of your session files.

**CI mode — no colors, non-zero exit on failure:**

```bash
abslang run sessions/ --agent $STAGING --dataset datasets/ --format junit --ci > report.xml
```

Exit code 0 if everything passed. Exit code 1 if any session failed. Drops straight into GitHub Actions or GitLab CI.

**Save report to file for later inspection:**

```bash
abslang run session.abs.yaml --agent $URL --dataset cases.jsonl --output report.json
```

#### `abslang report` — inspect results

View a saved report in different formats, drill into failures:

```bash
abslang report report.json                  # Table view
abslang report report.json --format json    # Machine-readable
abslang report report.json --format junit   # CI integration
abslang report report.json --failed         # Only failed cases
abslang report report.json --detail 3       # Full trace for row #3
```

#### `abslang generate-ci` — one command to CI

```bash
abslang generate-ci --platform github   # GitHub Actions workflow
abslang generate-ci --platform gitlab   # GitLab CI workflow
```

Generates a complete workflow file that installs `abslang`, runs your sessions, and publishes test results — ready to drop into `.github/workflows/`.

#### The config file — don't retype flags

`abs.config.yaml` stores project settings so you don't retype them:

```yaml
agent:
  url: http://localhost:8080/chat
  format: openai
  auth: none

adapters:
  llm_judge: aievaluator

defaults:
  dataset: datasets/
  timeout: 120
```

Everything in the config can be overridden by CLI flags. CLI flags can be overridden by environment variables. The precedence is:

```
CLI flag  >  environment variable  >  config file  >  built-in default
```

#### Test with the mock agent — no real agent needed

```bash
# Terminal 1: start mock agent
python3 tools/mock_agent.py --scenario happy

# Terminal 2: run
abslang run examples/order-status.yaml --agent http://localhost:8080/chat
```

The mock agent speaks the same protocol as a real agent. Good for learning, demos, and CI smoke tests.

### 4. VSCode

Open any `.abs.yaml` — the editor panel opens automatically. Edit visually, run with ▶ Run.

---

## What backs `llm_judge` and dimension evaluators

When you add an `llm_judge`, `Groundedness`, `Relevance`, `Coherence`, `Fluency`, or a safety dimension (`Violence`, `HateUnfairness`, `Sexual`, `SelfHarm`), an LLM produces the judgment. `abslang` lets you pick *where* that happens — and your session file never changes when you switch.

### Evaluator types: what runs where

| Evaluator | Where the judgment can run |
|---|---|
| `llm_judge` — free-form criteria | Built-in judge (OpenAI, Anthropic, Gemini), Azure, AWS Bedrock, Google Vertex AI, AI Evaluator |
| `Groundedness` — grounded in context | Azure AI Foundry, Google Vertex AI, AI Evaluator |
| `Relevance` — answers the question | Azure AI Foundry, Google Vertex AI, AI Evaluator |
| `Coherence` — logical flow | Azure AI Foundry, Google Vertex AI, AI Evaluator |
| `Fluency` — language quality | Azure AI Foundry, Google Vertex AI, AI Evaluator |
| `Violence` / `HateUnfairness` / `Sexual` / `SelfHarm` | Built-in judge (curated rubric — no criteria to write) |

### Built-in judge: zero setup

Out of the box, `abslang` auto-detects whichever LLM provider you have available:

```bash
# OpenAI — if OPENAI_API_KEY is set
OPENAI_API_KEY=sk-... abslang run session.abs.yaml --agent $URL

# Anthropic — if ANTHROPIC_API_KEY is set
ANTHROPIC_API_KEY=sk-ant-... abslang run session.abs.yaml --agent $URL

# Gemini — if GEMINI_API_KEY is set
GEMINI_API_KEY=... abslang run session.abs.yaml --agent $URL
```

Set `ABS_JUDGE_PROVIDER` if you have more than one and want to pick explicitly:

```bash
ABS_JUDGE_PROVIDER=openai abslang run session.abs.yaml --agent $URL
```

Override the judge model with `ABS_JUDGE_MODEL`:

```bash
ABS_JUDGE_MODEL=gpt-4o-mini abslang run session.abs.yaml --agent $URL
```

No API key? Use the mock judge for testing — returns a fixed score based on response length:

```bash
ABS_MOCK_JUDGE=true abslang run session.abs.yaml --agent $URL
```

### Safety dimensions — no criteria to write

You don't have to write criteria for safety checks. Each dimension ships with a
curated rubric, so this works out of the box with the built-in judge:

```yaml
evaluations:
  - type: Violence
    response: self
    threshold: 0.9
```

Override the rubric with `criteria:` when you need a stricter or custom definition:

```yaml
evaluations:
  - type: HateUnfairness
    criteria: "The response must avoid any mention of religion or politics"
    threshold: 0.95
```

### Quality dimensions — Groundedness, Relevance, Coherence, Fluency

These measure specific quality dimensions and need a dedicated evaluator. Azure AI
Foundry ships them:

```bash
pip install "abslang[azure]"
export AZURE_OPENAI_ENDPOINT="https://<account>.services.ai.azure.com"
export AZURE_OPENAI_KEY="..."
export AZURE_OPENAI_DEPLOYMENT="<judge-model-deployment>"

abslang run session.abs.yaml --agent $URL --adapter azure
```

See the [Azure adapter docs](./docs/adapters/azure.md) for the full list (including
`azure.task_adherence`, `azure.tool_call_accuracy`, and more).

### AWS Bedrock — LLM-as-judge

Route `llm_judge` and custom metrics through a Bedrock model:

```bash
pip install "abslang[aws]"
export AWS_REGION=us-east-1
export BEDROCK_EVALUATOR_MODEL_ID=anthropic.claude-3-5-haiku-20241022-v1:0

abslang run session.abs.yaml --agent $URL --adapter aws
```

See the [AWS adapter docs](./docs/adapters/aws.md).

### Google Vertex AI — quality + safety

Route quality and safety dimensions through the Vertex AI Gen AI Evaluation service:

```bash
pip install "abslang[google]"
export GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=us-central1
gcloud auth application-default login

abslang run session.abs.yaml --agent $URL --adapter google
```

See the [Google adapter docs](./docs/adapters/google.md).

### AI Evaluator — free tier, no infrastructure

```bash
AIEVALUATOR_API_KEY=... abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator
```

### Select an engine per rule with `adapter:`

Mix engines in one session file:

```yaml
evaluations:
  - type: Groundedness
    adapter: azure          # this one via Azure
    context: kb_result.responds
    response: self
  - type: Violence
    # no adapter → built-in judge
    threshold: 0.9
```

Register the engines once on the CLI (`--adapter azure --adapter aws`) or in
`abs.config.yaml`.

### Config file — don't retype adapter flags

```yaml
# abs.config.yaml
adapters:
  llm_judge: aievaluator       # Route all LLM evaluations through AI Evaluator
  Groundedness: azure          # Or split by type
```

### The adapter contract

Any adapter is a function that receives `(trace, evaluationRule)` and returns `{ passed, score, reason }`. Azure AI Foundry, AWS Bedrock, and Google Vertex AI ship out of the box; other providers can implement the same interface. `abslang` doesn't care which one you use — your session file stays the same, only the `--adapter` flag or config changes.

```
adapter.evaluate(
  trace = [...conversation steps...],
  rule  = { type: "Groundedness", query: ..., context: ..., response: ..., threshold: 0.8 }
) → { passed: true, score: 0.92, reason: "..." }
```

---

## Action vocabulary cheat sheet

| Category | Actions | When to use |
|---|---|---|
| **Communication** | `says`, `asks`, `informs`, `greets`, `clarifies`, `confirms`, `rejects`, `suggests`, `shows` | Agent or user speaks |
| **Execution** | `calls`, `submits`, `retrieves`, `stores`, `updates` | Agent invokes tools or APIs |
| **Interaction** | `selects`, `uploads`, `approves` | User interacts with UI |
| **Delegation** | `hands_off` | Agent transfers to a human |

---

## Evaluation types: when to use each

| Evaluator | What it checks | When |
|---|---|---|
| `contains` | Text includes a substring | Hard facts: IDs, amounts, names |
| `exact_match` | Text equals exactly | Deterministic responses |
| `regex` | Text matches a pattern | Formats: emails, dates, codes |
| `schema` | Content validates against JSON Schema | API responses |
| `llm_judge` | Qualitative criteria in natural language | Tone, empathy, completeness |
| `sequence` | Multiple steps occur in order | Multi-step flows |
| `eventually` | Something happens at least once | "Must confirm at some point" |
| `never` | Something NEVER happens | Safety guards |
| `count` | Something happens N times | "Exactly 2 API calls" |
| `within` | A happens within N steps of B | "Responds within 3 steps" |
| `variable_consistency` | A captured value stays unchanged | IDs, names |
| `Groundedness` | Response is grounded in the provided context | RAG answers |
| `Relevance` | Response addresses the query | Every answer |
| `Coherence` | Response is logically consistent | Long answers |
| `Fluency` | Response is well-written | Every answer |
| `HateUnfairness` | No hate speech or bias | Safety gate |
| `Violence` | No violence or threats | Safety gate |
| `Sexual` | No explicit content | Safety gate |
| `SelfHarm` | No self-harm encouragement | Safety gate |
| `all_of` / `any_of` / `none_of` | Combine evaluators | Boolean logic |

---

## The Three Amigos session

**Before the session:** PO writes the user story. No **Agent Behavior Specification** yet.

**During the session (60-90 minutes):**

1. **15 min — Write the sequence.** The three of you describe the ideal conversation. Just `actor`, `action`, `content`. No evaluations yet.

2. **15 min — Add step evaluations.** You (QA) ask: *"What could go wrong here?"* and *"How do we know the agent did this right?"* Those questions become `evaluations` on the key steps.

3. **15 min — Add chain evaluations.** *"What must be true about the ENTIRE conversation?"* That's where `sequence`, `never`, `variable_consistency` come from.

4. **15 min — Review and sign off.** All three read the full file. Anything missing? Anything unnecessary? This is the moment to refine.

**After the session:** Dev has the spec to build against. You have the spec to test against. PO has the spec as a behavioral contract. One file, three uses.

---

## Common mistakes

| Mistake | Fix |
|---|---|
| *"I used `says` but the agent was calling an API"* | Use `calls` + `target` for APIs. `says`/`informs`/`asks` is for talking. |
| *"`sequence` fails but all steps are present"* | `sequence` checks relative order, not adjacency. If A is before B, it matches even with steps in between. |
| *"I want an IF branch in the conversation"* | v0.1: two paths = two Sessions. `---` separates them in one file. v0.2: use `optional` + `expected` for agent-driven branching (see below). |
| *"My `llm_judge` passes sometimes and fails other times"* | Vague criteria ("be friendly") produce inconsistent results. Be specific: "greets, introduces itself, doesn't interrupt." |
| *"I don't know which actor to use"* | `user` = the tester. `assistant` = the bot. `tool` = external API/system. `human` = real person (for hand-offs). |

## v0.2 — Optional Behaviors

### The problem: does the agent ask for missing data?

You're testing a chatbot that looks up orders. Sometimes the user gives the order ID upfront, sometimes not. A good agent should detect when data is missing and ask for it. A bad agent hallucinates.

In v0.1 you'd need two separate sessions. In v0.2 you write one session with an **optional** behavior:

```yaml
session: Order lookup
abs_version: "0.2"
dataset:
  id: cases
  path: cases.jsonl
behaviors:
  - id: user_asks
    actor: user
    action: says
    content: "{{cases.userQuery}}"

  - id: ask_id
    actor: assistant
    action: asks
    optional: true                          # ← v0.2: may or may not happen
    matches_when:
      type: llm_judge
      criteria: "The agent is requesting the order ID"

  - id: user_gives_id
    actor: user
    action: says
    content: "{{cases.orderId}}"
    requires: ask_id                        # ← v0.2: only if agent asked

  - id: answer
    actor: assistant
    action: informs
    content: "{{cases.expectedAnswer}}"

evaluations:
  - type: expected                          # ← v0.2: should it have matched?
    behavior: ask_id
    when: "{{cases.hasOrderId}} == false"
    reason: "Agent should ask for ID when user doesn't provide it"

  - type: never
    match: { actor: assistant, action: asks }
    when: "{{cases.hasOrderId}} == true"
```

### How it works

1. The runner sends `{{cases.userQuery}}` to your agent.
2. If `hasOrderId` is `false`, the `expected` evaluator expects `ask_id` to match.
3. The runner evaluates `matches_when` against the agent's real response — using LLM to understand intent, not just checking if it's literally an `asks` action.
4. If the agent asked → `ask_id` matches → runner sends `{{cases.orderId}}` → agent responds → `answer` matches.
5. If the agent didn't ask → `ask_id` is skipped (not a failure for optional behaviors) → `expected` evaluator FAILS because it should have matched.

### Dataset

```jsonl
{"hasOrderId": false, "userQuery": "Quiero saber de mi orden", "orderId": "5678", "expectedAnswer": "Preparando"}
{"hasOrderId": true,  "userQuery": "Estado de #8291",          "orderId": "8291", "expectedAnswer": "En camino"}
```

### Run it

```bash
abslang run examples/missing-data.abs.yaml --agent $URL --dataset examples/missing-data.jsonl
```
