# AWS Bedrock adapter (LLM-as-judge)

Routes ABS `llm_judge` and `custom` evaluations through an Amazon Bedrock model
as the judge. No spans, no AgentCore, no agent instrumentation: the adapter builds
a judge prompt from the ABS trace and calls Bedrock directly via the Converse API.

The AgentCore Evaluations backend (on-demand `Evaluate` over OpenTelemetry spans,
with ABS spec → ground truth) is a separate, later phase.

## Install

```bash
pip install "abslang[aws]"
```

## Configure

```bash
export AWS_REGION="us-east-1"                              # or AWS_DEFAULT_REGION
export AWS_PROFILE="my-profile"                            # optional
export BEDROCK_EVALUATOR_MODEL_ID="anthropic.claude-3-5-haiku-20241022-v1:0"  # optional
```

Credentials are resolved the normal AWS way (env vars, `~/.aws/credentials`, or an
IAM role). The principal needs `bedrock:InvokeModel` for the chosen model.

## Run

```bash
# Bedrock judge for everything the adapter supports
abslang run session.abs.yaml --agent $AGENT_URL --adapter aws

# Bedrock judge for llm_judge only
abslang run session.abs.yaml --agent $AGENT_URL --adapter llm_judge=aws
```

```yaml
evaluations:
  - type: llm_judge
    adapter: aws
    criteria: "The agent resolves the refund without asking for data already provided"
    threshold: 0.8
```

## Supported evaluators

| ABS | What it does |
|---|---|
| `llm_judge` | Bedrock model scores the response 0–1 against `criteria` |
| `custom` | User-defined Bedrock metric via `prompt` + `rating_scale` |

`sequence` and `tool_call` are **not** handled by the Bedrock backend yet — those
map to AgentCore trajectory evaluators (`TrajectoryInOrderMatch`,
`TrajectoryExactOrderMatch`), which is a later phase.

## `custom` — Bedrock metrics

```yaml
evaluations:
  - type: custom
    id: aws.brand_tone
    adapter: aws
    prompt: "Rate the tone on a 1-5 scale. Response: {{response}}"
    rating_scale: 1-5
    threshold: 0.6
```

Available prompt placeholders: `{{response}}`, `{{query}}`, `{{context}}`,
`{{criteria}}`, `{{trace}}`. `rating_scale` is the scale the judge is asked to use
(`1-5`, `0-1`, or a bare number); the adapter normalizes the returned score to 0–1
before ABS applies `threshold`.
