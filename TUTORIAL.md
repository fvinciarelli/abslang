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

## A real example: refund for damaged item

Here's the user story from your PO:

> *"A customer reports a damaged item. The agent asks them to confirm their name and order date. Then it checks the Orders API to verify the order exists and is eligible for refund. If everything checks out, it processes the refund and tells the customer the amount and when they'll receive it."*

### Step 1: Write the conversation — no evaluations yet

First, describe what should happen, step by step. No assertions — just the sequence:

```yaml
session: Refund — damaged item
behaviors:
  - actor: user
    action: says
    content: "I received order #8291 damaged, I want to return it"

  - actor: assistant
    action: asks
    content: "I'm sorry about the damage. Can you confirm your name and order date?"

  - actor: user
    action: says
    content: "Franco Vinciarelli, ordered last Tuesday"

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
    content: "Refund of €47.50 processed, Franco. You'll receive it in 3-5 days. Reference: R-5512."
```

At this point, your PO can read and understand the flow. Your dev can see which APIs to call and with what parameters. But you, as QA, need more — you need to verify the agent actually did all of this correctly.

### Step 2: Add evaluations on the critical steps

There are two moments that matter most: when the agent asks for verification (was it empathetic? did it ask for the right info?), and when it delivers the result (did it include all the facts? did it hallucinate anything?). 

Add `evaluations` at these points:

```yaml
  - actor: assistant
    action: asks
    content: "I'm sorry about the damage. Can you confirm your name and order date?"
    evaluations:
      - type: llm_judge
        criteria: |
          1. Shows empathy for the damaged item
          2. References the order number #8291
          3. Asks for verification info before taking action
```

This uses an LLM to judge whether the response meets the criteria. For hard facts, use exact evaluators instead:

```yaml
  - actor: assistant
    action: informs
    content: "Refund of €47.50 processed, Franco. You'll receive it in 3-5 days. Reference: R-5512."
    evaluations:
      # Hard fact: the refund ID MUST appear
      - type: contains
        value: "R-5512"

      # Soft qualities: tone, completeness — use LLM
      - type: llm_judge
        criteria: |
          1. States the amount (€47.50) and timeline (3-5 days)
          2. Provides the refund reference R-5512
          3. Uses the customer's name (Franco)
          4. Reassuring tone, no upsells or deflections
```

### Step 3: Whole-conversation evaluations

Beyond checking individual steps, you want to check properties of the entire trace. These go in a top-level `evaluations` block, sibling to `behaviors`:

```yaml
evaluations:
  # The 4 assistant actions MUST happen in this relative order
  - type: sequence
    order:
      - { actor: assistant, action: asks }
      - { actor: assistant, action: calls, target: "Orders API" }
      - { actor: assistant, action: calls, target: "Refunds API" }
      - { actor: assistant, action: informs }

  # The refund ID must be the same everywhere it appears
  - type: variable_consistency
    variable: refundId

  # Must NEVER escalate to a human — this flow resolves automatically
  - type: never
    match: { actor: assistant, action: hands_off }
```

This is where **Agent Behavior Specification** earns its keep over manual test scripts. `sequence` checks ordering without you having to trace through step numbers. `variable_consistency` catches a subtle bug: the agent saying "R-5512" early but "R-5513" later. `never` is a safety guard: if this flow hands off to a human, something went wrong.

---

## The complete file

Putting it all together, the file is about 70 lines. PO understands the conversation. Dev knows what to build. You have 7 automated checks. One file.

> 👉 Full file at [`examples/refund-request.yaml`](examples/refund-request.yaml)

---

## How to create and run it

Four ways, from zero effort to full integration:

### 1. Chat — describe it, it writes the file for you

You don't need to know the YAML format. Open a terminal and describe what the agent should do:

```bash
DEEPSEEK_API_KEY=sk-... abslang chat
```

The assistant asks you guided questions, generates a complete `.abs.yaml` with evaluations, dataset placeholders, and chain checks — then validates it before saving. [Full details →](./CLI.md#abslang-chat)

### 2. Browser — zero install

Go to the **[ABS Designer](/abs-designer/)**. In the right panel, click the ✨ **Assistant** tab and describe the behavior in plain language — it generates the YAML and loads it into the visual editor. Enter your agent URL, hit ▶ Run. Results appear inline.

### 3. Terminal

```bash
abslang run session.abs.yaml --agent http://localhost:8080/chat
```

Prints step-by-step: what matched, what failed, and why.

> 💡 If your session uses `llm_judge` evaluations, you'll need an LLM API key — see [What backs `llm_judge`](#what-backs-llm_judge) below.

### 4. VSCode

Open any `.abs.yaml` — the editor panel opens automatically. Edit visually, run with ▶ Run.

---

## What backs `llm_judge`

When you add an `llm_judge` evaluation, someone has to actually call an LLM to judge the response. `abslang` gives you two paths, and you don't have to change your session file to switch between them.

### Default: built-in judge (zero setup)

Out of the box, `abslang` detects which LLM provider you have available and uses it automatically:

```bash
# If you have an OpenAI key, it just works:
OPENAI_API_KEY=sk-... abslang run session.abs.yaml --agent $URL

# Same with Anthropic:
ANTHROPIC_API_KEY=sk-ant-... abslang run session.abs.yaml --agent $URL

# Or Gemini:
GEMINI_API_KEY=... abslang run session.abs.yaml --agent $URL
```

Set `ABS_JUDGE_PROVIDER` if you have more than one and want to pick:

```bash
ABS_JUDGE_PROVIDER=openai abslang run session.abs.yaml --agent $URL
```

No API key? Use the mock judge for testing — returns a fixed score based on response length:

```bash
ABS_MOCK_JUDGE=true abslang run session.abs.yaml --agent $URL
```

### External adapter: AI Evaluator

If you use [AI Evaluator](https://aievaluator.dev), pass `--adapter` to route `llm_judge` evaluations through it instead:

```bash
# With API key (100 free evals/month):
AIEVALUATOR_API_KEY=... abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator

# Without API key (playground, 5 free evals/day):
abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator
```

This also works from `abs.config.yaml` so you don't retype it:

```yaml
# abs.config.yaml
adapters:
  llm_judge: aievaluator
```

Other providers (Azure AI, LangSmith, Galileo) can ship their own adapters too. `abslang` doesn't care which one you use — your session file stays the same, only the `--adapter` flag or config changes.

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
| *"I want an IF branch in the conversation"* | **Agent Behavior Specification** v0.1 has no branching. Two paths = two Sessions. Write one for the happy path, another for the alternative. |
| *"My `llm_judge` passes sometimes and fails other times"* | Vague criteria ("be friendly") produce inconsistent results. Be specific: "greets, introduces itself, doesn't interrupt." |
| *"I don't know which actor to use"* | `user` = the tester. `assistant` = the bot. `tool` = external API/system. `human` = real person (for hand-offs). |
