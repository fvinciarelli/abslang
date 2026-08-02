# **Agent Behavior Specification** Guide for Product Owners

> How to specify what an agent should do — without writing code, without writing tests.
> Someone else will add the evaluations later. Your job is the behavior.

---

## You don't need to learn a new tool

**Agent Behavior Specification** is YAML. It's plain text. If you can write a bullet list, you can write a **Agent Behavior Specification** spec.

Here's a user story you might write today:

> *As a customer, I want to return a damaged item so I can get my money back. The agent asks for my order number, verifies it, processes the refund, and tells me the amount and timeline.*

That story has a sequence in it: **asks → verifies → processes → tells**. **Agent Behavior Specification** just makes that sequence explicit and machine-readable. Here's the same story in **Agent Behavior Specification**:

```yaml
session: Return a damaged item
behaviors:
  - actor: user
    action: says
    content: "I received order #8291 damaged, I want to return it"

  - actor: assistant
    action: asks
    content: "Can you confirm your name and the order date?"

  - actor: user
    action: says
    content: "Franco Vinciarelli, ordered last Tuesday"

  - actor: assistant
    action: calls
    target: Orders API

  - actor: assistant
    action: calls
    target: Refunds API

  - actor: assistant
    action: informs
    content: "Refund of €47.50 processed. You'll receive it in 3-5 days."
```

That's it. You just wrote a spec. No code, no tests — just the conversation you want the agent to have.

---

## The four things you need to know

### 1. `actor` — who is doing this

| Actor | Meaning |
|---|---|
| `user` | The customer |
| `assistant` | Your agent / bot |
| `tool` | An external system the agent calls (API, database) |
| `human` | A real person (for when the agent hands off) |

### 2. `action` — what they're doing

| What you want to describe | Action to use |
|---|---|
| Someone says something | `says` |
| Agent asks a question | `asks` |
| Agent delivers information | `informs` |
| Agent greets the user | `greets` |
| Agent calls an external system | `calls` |
| Agent hands off to a human | `hands_off` |
| User selects a UI option | `selects` |
| Agent proposes options | `suggests` |
| Agent confirms an action | `confirms` |
| Agent displays something visual | `shows` |

Full vocabulary: [VOCABULARY.md](VOCABULARY.md)

### 3. `target` — what system or person is involved

For API calls: the system name. For hand-offs: the recipient.

```yaml
  - actor: assistant
    action: calls
    target: Orders API       # ← the system being called

  - actor: assistant
    action: hands_off
    target: Human Agent      # ← who receives the hand-off
```

### 4. `content` — the message or data

For conversations: the actual words. For tool responses: the data payload.

```yaml
  - actor: user
    action: says
    content: "Where is my order?"     # ← what the user says

  - actor: tool
    action: responds
    content:
      status: "shipped"               # ← what the API returned
      eta: "2026-08-03"
```

---

## Writing your first spec: step by step

### 1. Start with the user's opening message

```yaml
session: Check order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order #4456?"
```

### 2. Add the agent's response

What should the agent do after the user speaks? Look up the order? Ask for more info?

```yaml
  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "4456"
```

### 3. Add the tool's response

What does the API return? This matters because the agent's next words depend on it.

```yaml
  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "4456"
      status: "in transit"
      eta: "Friday"
```

### 4. Add the agent's response to the user

What should the agent tell the user based on that API response?

```yaml
  - actor: assistant
    action: informs
    content: "Order #4456 is on its way — estimated delivery Friday."
```

### 5. Rinse and repeat for multi-turn conversations

```yaml
  - actor: user
    action: says
    content: "Can you change the delivery address?"

  - actor: assistant
    action: asks
    content: "What's the new address?"

  # ... and so on
```

---

## What about branching? "If the user says X, the agent does Y"

**Agent Behavior Specification** v0.1 is linear — one path per file. If your flow has a decision point, you write one file for each branch.

For example, if the agent hands off to different specialists depending on what the user needs:

- `refund-request.yaml` → Triage → hands off to Refunds Agent
- `order-status.yaml` → Triage → hands off to Orders Agent
- `security-issue.yaml` → Triage → hands off to Human

Each file is a complete, self-contained conversation that anyone can read from top to bottom. Your QA team will add evaluations to each one later.

---

## What happens after you write the spec

1. **You review it with the team** (Three Amigos). Dev confirms the APIs exist. QA confirms the flow covers the edge cases they care about. You confirm it matches the user need.

2. **QA adds evaluations.** They'll annotate the key steps with `llm_judge`, `contains`, `sequence` — turning your description into an executable test. Your spec doesn't change; it gets annotations.

3. **Dev builds the agent.** Your spec is the acceptance criteria. If the agent passes the evaluations, it's done.

4. **The spec lives on.** Six months later, when someone asks "what does the refund bot actually do?", the answer is one file. Not a wiki, not a Confluence page from three teams ago — the spec.

---

## One file you can write in 10 minutes

Here's a complete example — a customer asking about an order, agent looking it up, agent reporting back:

```yaml
session: Customer asks about an order
description: Happy path — order exists and is on its way.
behaviors:
  - actor: user
    action: says
    content: "Where is my order #12345?"

  - actor: assistant
    action: calls
    target: Orders API
    with:
      orderId: "12345"

  - actor: tool
    action: responds
    target: Orders API
    content:
      orderId: "12345"
      status: "in transit"
      eta: "Friday"

  - actor: assistant
    action: informs
    content: "Order #12345 is on its way. Estimated delivery: Friday."
```

That's the whole thing. 15 lines. A dev can build from it. QA can test from it. You can read it. No code, no tests, no tooling — just the behavior.

---

## FAQ

**Do I need to install anything?**
No. **Agent Behavior Specification** files are plain YAML. You can write them in Notepad. But the [**Agent Behavior Specification** Designer](/abs-designer/) gives you a visual editor if you prefer that.

**What if I don't know the exact API responses?**
Use placeholder data. The dev will replace it with real payloads during the Three Amigos session.

**Can I use this for non-chat agents?**
Yes. **Agent Behavior Specification** describes observable behavior. If your agent sends emails, processes files, or updates a database, those are all `calls` with a `target`.

**What if the agent does different things for different users?**
Each scenario is its own file. Think of them as "the conversation when X happens." You can have as many as you need.

**Who adds the `evaluations`?**
QA. Your job is the `behaviors` — the description. QA annotates it with assertions. PO-GUIDE.md has no evaluations on purpose. That's the point: description and testing are the same format, but different roles contribute different parts.
