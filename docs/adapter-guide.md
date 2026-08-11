# Building an ABS Adapter

An **adapter** is a small bridge between ABS and an evaluation service. If you have an LLM evaluation platform (in-house or third-party), writing an adapter lets ABS route `llm_judge`, `Groundedness`, `Relevance`, and other LLM-based evaluators through it.

This guide walks you through building one in TypeScript. Python adapters follow the same contract.

## How adapters work

When ABS encounters an LLM-based evaluator in your session file, it calls the registered adapter instead of running the evaluation itself. The adapter receives:

```typescript
{
  type: string;        // "llm_judge", "Groundedness", "Relevance", "Coherence", "Fluency"
  trace: ObservedStep[];  // the full conversation trace so far
  // ... other evaluation-specific fields (criteria, query, context, response, threshold)
}
```

And must return:

```typescript
{
  passed: boolean;
  score: number;    // 0.0 to 1.0
  reason: string;   // human-readable explanation
}
```

## Step 1: Create the adapter function

```typescript
// adapters/my-evaluator.ts
import { registerAdapter, ObservedStep, EvalResult } from "abslang";

async function myEvaluatorAdapter(
  trace: ObservedStep[],
  evaluation: any
): Promise<EvalResult> {
  // 1. Build the payload your evaluation service expects
  const payload = {
    type: evaluation.type,
    criteria: evaluation.criteria,
    query: evaluation.query,
    context: evaluation.context,
    response: evaluation.response,
    trace: trace.map(s => ({
      actor: s.actor,
      action: s.action,
      content: s.content,
    })),
  };

  // 2. Call your evaluation service
  const resp = await fetch("https://my-evaluator.example.com/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.MY_EVALUATOR_KEY}` },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();

  // 3. Map the response to ABS format
  return {
    type: evaluation.type,
    passed: data.verdict === "pass",
    score: data.score ?? (data.verdict === "pass" ? 1.0 : 0.0),
    reason: data.explanation ?? data.verdict,
  };
}

// 4. Register it — do this before calling abslang run
registerAdapter("llm_judge", myEvaluatorAdapter);
```

## Step 2: Hook it into abslang

Your adapter needs to run before `abslang run`. The simplest way: create a wrapper script.

```typescript
// run-with-my-evaluator.ts
import "./adapters/my-evaluator";  // registers the adapter on import
// abslang CLI will pick it up automatically
```

```bash
# Run with your adapter
npx tsx run-with-my-evaluator.ts run session.abs.yaml --agent $URL
```

Or, if you're building an adapter to share as a package:

```typescript
// my-evaluator-adapter/src/index.ts
import { registerAdapter } from "abslang";

export function configureMyEvaluator(config: { apiKey: string; url?: string }) {
  registerAdapter("llm_judge", async (trace, evaluation) => {
    // ... adapter logic using config
  });
}
```

Users install and configure it:

```bash
npm install my-evaluator-adapter
```

```typescript
import { configureMyEvaluator } from "my-evaluator-adapter";
configureMyEvaluator({ apiKey: process.env.MY_KEY! });
// now abslang run will route llm_judge through your adapter
```

## The adapter contract

### Input: `evaluation` fields by type

| Field | `llm_judge` | `Groundedness` | `Relevance` | `Coherence` | `Fluency` |
|-------|-------------|----------------|-------------|-------------|-----------|
| `criteria` | ✅ | — | — | — | — |
| `query` | — | ✅ | ✅ | — | — |
| `context` | — | ✅ | — | — | — |
| `response` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `threshold` | ✅ | ✅ | ✅ | ✅ | ✅ |

All evaluators also receive the full `trace: ObservedStep[]`.

### Output

```typescript
interface EvalResult {
  type: string;
  passed: boolean;
  score: number;    // 0.0 to 1.0, used for threshold comparison
  reason: string;   // shown in reports when the evaluation fails
}
```

### Threshold handling

ABS applies the `threshold` after your adapter returns. If your adapter returns `score: 0.72` and the session file says `threshold: 0.8`, ABS marks it as `passed: false`. You don't need to handle thresholds yourself — but you can if your service does it internally.

## Python adapters

Same contract, different syntax:

```python
# adapters/my_evaluator.py
from abslang.evaluators import register_adapter, ObservedStep, EvalResult

async def my_evaluator_adapter(trace: list[ObservedStep], evaluation: dict) -> EvalResult:
    # ... call your service ...
    return EvalResult(
        type=evaluation["type"],
        passed=True,
        score=0.92,
        reason="The response addresses the query accurately",
    )

register_adapter("llm_judge", my_evaluator_adapter)
```

## Testing your adapter

```typescript
import { registerAdapter } from "abslang";

registerAdapter("llm_judge", async (trace, evaluation) => {
  return {
    type: evaluation.type,
    passed: true,
    score: 1.0,
    reason: "test adapter — always passes",
  };
});

// Now run: abslang run session.abs.yaml --agent $URL
// All llm_judge evaluations will pass through your adapter
```

## Sharing with the community

If you build an adapter for a public evaluation service, we'd love to list it. Open a PR adding it to the [adapters registry](./adapters.md) with:

- Package name and install instructions
- A 2-sentence description
- Configuration example

Examples of adapters that can be built with this contract: Azure AI Evaluation, LangSmith, Galileo, Promptfoo, DeepEval, Ragas, your in-house evaluation service.
