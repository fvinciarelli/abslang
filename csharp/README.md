# AbsLang — C# / .NET

<p>
  <a href="https://www.nuget.org/packages/AbsLang"><img src="https://img.shields.io/nuget/v/AbsLang?color=0284c7" alt="NuGet"></a>
  <a href="https://www.nuget.org/packages/AbsLang"><img src="https://img.shields.io/nuget/dt/AbsLang?color=0284c7" alt="NuGet downloads"></a>
  <a href="https://github.com/fvinciarelli/abslang/actions/workflows/test.yml"><img src="https://github.com/fvinciarelli/abslang/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-0284c7" alt="License"></a>
</p>

C# implementation of **Agent Behavior Specification (ABS)**. Parse `.abs.yaml`
documents, run them against an HTTP agent, evaluate the observed trace, and emit
table, JSON or JUnit reports — with structured events you can ship to Datadog,
OpenTelemetry, Serilog or any telemetry pipeline.

**Status:** `0.6.1` — library only (the CLI/`chat` remain in the npm/Python packages).

## Install

```bash
dotnet add package AbsLang
```

Optional cloud adapters:

```bash
dotnet add package AbsLang.Adapters.Aws      # AWS Bedrock
dotnet add package AbsLang.Adapters.Google   # Google Vertex AI
```

Azure and AI Evaluator are included in the core package.

## Quick start

```csharp
using AbsLang;

var session = AbsParser.Parse("sessions/order-status.abs.yaml");
var result = await new AbsRunner().RunAsync(
    session,
    new AgentConfig { Url = "http://localhost:8080/chat" });

Console.WriteLine(AbsReports.FormatTable(result));
```

The agent endpoint must speak one of the supported protocols: `openai`
(default), `responses`, `claude` or `gemini`.

## Complete example: multi-turn + tool round-trip

```yaml
session: Order status
behaviors:
  - actor: user
    action: says
    content: "Where is my order?"

  - actor: assistant
    action: asks
    content: "Please provide your order number"
    evaluations:
      - type: contains
        value: "order number"

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
    evaluations:
      - type: tool_call
        target: Order MCP
        with:
          orderId: "12345"

  - actor: tool
    action: responds
    target: Order MCP
    content:
      status: "in_transit"
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

```csharp
using System.Diagnostics;
using AbsLang;

var session = AbsParser.Parse("sessions/order-status.abs.yaml");
var agent = new AgentConfig { Url = "http://localhost:8080/chat" };

var logger = new RunLogger(session.Session, agent.Url);
logger.Sink = (eventName, fields) =>
{
    // fields include: ts, run_id, session, agent, step, duration_ms, passed, score...
    Console.WriteLine($"{eventName} {fields.GetValueOrDefault("duration_ms")} ms");
};

var total = Stopwatch.StartNew();
var result = await new AbsRunner().RunAsync(session, agent, logger: logger);
total.Stop();

Console.WriteLine(AbsReports.FormatTable(result));
Console.WriteLine($"total: {total.ElapsedMilliseconds} ms");

foreach (var step in result.Steps)
{
    foreach (var evaluation in step.Evaluations)
    {
        Console.WriteLine(
            $"{step.Behavior.Actor}/{step.Behavior.Action} " +
            $"{evaluation.Type} passed={evaluation.Passed} " +
            $"duration={evaluation.DurationMs} ms");
    }
}
```

Runnable version: [`samples/AbsLang.Sample`](./samples/AbsLang.Sample).

## Features

- YAML parsing (multi-document), JSON Schema validation, fragments and variables.
- Datasets (`.json` / `.jsonl`) with `{{cases.column}}` bindings.
- Runner with `openai`, `responses` (JSON + SSE), `claude` and `gemini` protocols.
- Auth: `none`, `api_key`, `bearer`, `oauth2` (refresh) and Authorization forwarding.
- Matching: communication/execution equivalence, `with` / `with_only`, tool
  round-trips, `optional`, `requires`, `matches_when`, blocking propagation.
- Deterministic evaluators: `exact_match`, `contains`, `regex`, `schema`,
  `tool_call`, `sequence`, `eventually`, `never`, `count`, `within`,
  `variable_consistency`, `expected`, `when` expressions.
- Reference metrics: `f1`, `bleu`, `rouge` with `ground_truth`.
- Composition: `all_of`, `any_of`, `none_of`.
- LLM judge: built-in (OpenAI / Anthropic / Gemini or any OpenAI-compatible
  endpoint), quality dimensions, safety dimensions, `ABS_MOCK_JUDGE=true`.
- Adapter registry: `AbsEvaluators.RegisterAdapter` /
  `EvaluateWithAdapterAsync`, with named adapters selectable per rule.
- Config file, structured logging (pretty / JSONL / silent), table / JSON / JUnit reports.

## Evaluators

| Group | Types |
|---|---|
| Deterministic | `exact_match`, `contains`, `regex`, `schema`, `tool_call` |
| Reference metrics | `f1`, `bleu`, `rouge` |
| LLM / quality | `llm_judge`, `Groundedness`, `Relevance`, `Coherence`, `Fluency` |
| Safety | `HateUnfairness`, `Violence`, `Sexual`, `SelfHarm` |
| Chain (session-level) | `sequence`, `eventually`, `never`, `count`, `within`, `variable_consistency`, `expected` |
| Composition | `all_of`, `any_of`, `none_of` |

## Built-in judge

```csharp
AbsEvaluators.ConfigureBuiltinJudge(
    baseUrl: "https://api.openai.com/v1", // or Azure/Foundry, Ollama, vLLM...
    apiKey: "...",
    apiKeyHeader: "Authorization",        // use "api-key" for Azure
    model: "gpt-4o");
```

Environment variables: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`ABS_JUDGE_BASE_URL`, `ABS_JUDGE_API_KEY`, `ABS_JUDGE_API_KEY_HEADER`,
`ABS_JUDGE_MODEL`, `ABS_JUDGE_PROVIDER`, `ABS_MOCK_JUDGE`.

## Adapters

### Azure OpenAI / AI Foundry (core package)

```csharp
AzureAdapter.Configure(
    endpoint: "https://<resource>.openai.azure.com",
    apiKey: Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY")!,
    deployment: "gpt-4o-judge");
AzureAdapter.Register();
```

Supported: `llm_judge`, `Groundedness`, `Relevance`, `Coherence`, `Fluency`, and
`custom` (`azure.task_adherence`, `azure.intent_resolution`,
`azure.tool_call_accuracy`). Environment: `AZURE_OPENAI_ENDPOINT`,
`AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`.

### AI Evaluator (core package)

```csharp
AiEvaluatorAdapter.Configure(apiKey: "..."); // optional on the free tier
AiEvaluatorAdapter.Register();
```

### AWS Bedrock (satellite package)

```csharp
using AbsLang.Adapters.Aws;

AwsAdapter.Configure(new AwsAdapterConfig { Region = "us-east-1" });
AwsAdapter.Register();
```

Supports `llm_judge` and `custom`. Credentials use the standard AWS chain.

### Google Vertex AI (satellite package)

```csharp
using AbsLang.Adapters.Google;

GoogleAdapter.Configure(new GoogleAdapterConfig { Project = "my-project" });
GoogleAdapter.Register();
```

Supports `llm_judge`, `custom`, quality dimensions and safety. Uses Application
Default Credentials (`gcloud auth application-default login`) or
`GOOGLE_ACCESS_TOKEN`.

### Select an adapter

```yaml
evaluations:
  - type: Relevance
    adapter: azure
    query: user
    response: self
```

Or globally through config:

```yaml
adapters:
  llm_judge: azure
  Relevance: azure
```

```csharp
var config = AbsConfig.LoadConfig("abs.config.yaml");
config.ApplyJudge();
config.ApplyAdapters();
var result = await new AbsRunner().RunAsync(session, config.ToAgentConfig()!);
```

## Datasets

```yaml
dataset:
  id: cases
  path: cases.jsonl
behaviors:
  - actor: user
    action: says
    content: "{{cases.message}}"
```

```csharp
var session = AbsParser.Parse("session.abs.yaml");
var rows = session.Dataset != null
    ? AbsParser.LoadDataset(Path.Combine(sessionDir, session.Dataset.Path))
    : new[] { new Dictionary<string, object?>() };

foreach (var row in rows)
{
    var vars = session.Dataset == null
        ? row
        : row.ToDictionary(kv => $"{session.Dataset.Id}.{kv.Key}", kv => kv.Value);

    var result = await new AbsRunner().RunAsync(session, agent, vars, logger);
}
```

## Observability

`RunLogger` emits stable events with `ts`, `run_id`, `session`, `agent`, `step`,
`duration_ms`, `passed`, `score`, `evaluation_type`, `reason`, etc.

In `0.6.1`:

- `duration_ms` on `agent.response`, `agent.error`, `behavior.match`,
  `behavior.skipped`, `evaluation.result` and `session.end`.
- `ts` on every event delivered to `RunLogger.Sink`.
- `EvalResult.DurationMs` per evaluation.

For Datadog, forward `Sink` events to the Logs API, or write JSONL and let the
Datadog Agent tail it:

```csharp
AbsLog.Configure(new AbsLogOptions
{
    Format = "jsonl",
    File = "/var/log/abslang/events.jsonl",
    Meta = new Dictionary<string, object?>
    {
        ["service"] = "agent-evals",
        ["env"] = "prod",
    },
});
```

For production, use a background queue around `Sink` instead of a synchronous
HTTP call.

## Build and test

Requires the .NET 10 SDK.

```bash
dotnet test AbsLang.slnx
dotnet pack src/AbsLang/AbsLang.csproj -c Release -o ./artifacts
dotnet run --project samples/AbsLang.Sample -- \
  samples/sessions/order-status.abs.yaml http://localhost:8080/chat
```

The packages multi-target `netstandard2.0` and `net10.0`.

## Limitations

- **Tools are fixtures.** The runner sends the declared `tool responds` content
  back to the agent; it does not execute your real tool/API.
- **Sequential.** The spec is linear; there is no syntax for parallel tool calls
  or retries.
- **White-box tool observation.** The agent must return tool calls in the
  protocol's tool-call format for the runner to observe them.
- **CLI/chat** are not part of this package.

## Links

- [NuGet: AbsLang](https://www.nuget.org/packages/AbsLang)
- [NuGet: AbsLang.Adapters.Aws](https://www.nuget.org/packages/AbsLang.Adapters.Aws)
- [NuGet: AbsLang.Adapters.Google](https://www.nuget.org/packages/AbsLang.Adapters.Google)
- [Specification](../SPECIFICATION.md) · [Evaluations](../EVALUATIONS.md) · [Runner](../RUNNER.md) · [Examples](../examples/)
