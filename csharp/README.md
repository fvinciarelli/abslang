# AbsLang — C# / .NET

C# implementation of **Agent Behavior Specification (ABS)**. It parses `.abs.yaml`
documents, runs them against an HTTP agent, evaluates the observed trace and emits
table, JSON or JUnit reports.

## Install

```bash
dotnet add package AbsLang
```

Optional cloud adapters are separate packages:

```bash
dotnet add package AbsLang.Adapters.Aws
dotnet add package AbsLang.Adapters.Google
```

## Quick start

```csharp
using AbsLang;

var session = AbsParser.Parse("sessions/order-status.abs.yaml");
var result = await new AbsRunner().RunAsync(
    session,
    new AgentConfig { Url = "http://localhost:8080/chat" });

Console.WriteLine(AbsReports.FormatJson(result));
```

## Features

- YAML parsing (multi-document), JSON Schema validation, fragments and variables.
- Dataset loading (`.json` / `.jsonl`).
- Runner with four agent protocols: `openai`, `responses` (SSE), `claude`, `gemini`.
- Auth: `none`, `api_key`, `bearer`, `oauth2` (with refresh) and Authorization forwarding.
- Matching: communication/execution action equivalence, `with`/`with_only`,
  tool round-trips, optional behaviors, `requires`, `matches_when`, blocking propagation.
- Deterministic evaluators: `exact_match`, `contains`, `regex`, `schema`,
  `tool_call`, `sequence`, `eventually`, `never`, `count`, `within`,
  `variable_consistency`, `expected`, `when` expressions.
- Reference metrics: `f1`, `bleu`, `rouge` with `ground_truth`.
- Composition: `all_of`, `any_of`, `none_of`.
- LLM judge: built-in (OpenAI/Anthropic/Gemini), quality dimensions, safety
  dimensions and `ABS_MOCK_JUDGE=true` for demos.
- Adapter registry: `AbsEvaluators.RegisterAdapter` / `EvaluateWithAdapterAsync`,
  with named adapters selectable per rule via `adapter:`.
- Cloud adapters: `azure` and `aievaluator` in the core package; `aws` and
  `google` in satellite packages.
- Config: `abs.config.yaml` loading, validation and CLI/env/file precedence helpers.
- Structured logging: pretty, JSONL file or silent; `IncludeContent` and run events.
- Reports: table, JSON and JUnit.

Not included in this package (out of scope for now): the CLI (`dotnet tool`) and
the `abslang chat` assistant.

## Cloud adapters

```csharp
using AbsLang;

// Azure OpenAI / AI Foundry (core package)
AzureAdapter.Configure(
    endpoint: "https://my-resource.openai.azure.com",
    apiKey: "...",
    deployment: "judge");
AzureAdapter.Register();

// AI Evaluator (core package, HTTP)
AiEvaluatorAdapter.Configure(apiKey: "...");     // optional on the free tier
AiEvaluatorAdapter.Register();

// AWS Bedrock (satellite package)
using AbsLang.Adapters.Aws;
AwsAdapter.Configure(new AwsAdapterConfig { Region = "us-east-1" });
AwsAdapter.Register();

// Google Vertex AI (satellite package)
using AbsLang.Adapters.Google;
GoogleAdapter.Configure(new GoogleAdapterConfig { Project = "my-project" });
GoogleAdapter.Register();
```

Select an adapter per rule with `evaluation.Get...`/YAML `adapter: azure`, or make
it the default by calling `Register(asDefault: true)`.

## Built-in judge configuration

```csharp
AbsEvaluators.ConfigureBuiltinJudge(
    baseUrl: "https://api.openai.com/v1", // or any OpenAI-compatible endpoint
    apiKey: "...",
    apiKeyHeader: "Authorization",        // use "api-key" for Azure
    model: "gpt-4o");
```

Environment variables are also supported: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `ABS_JUDGE_BASE_URL`, `ABS_JUDGE_API_KEY`, `ABS_JUDGE_API_KEY_HEADER`,
`ABS_JUDGE_MODEL`, `ABS_JUDGE_PROVIDER` and `ABS_MOCK_JUDGE`.

## Build and test

Requires the .NET 10 SDK, or .NET 8+ with the `net10.0` targeting pack.

```bash
dotnet test AbsLang.slnx
dotnet pack src/AbsLang/AbsLang.csproj -c Release -o ./artifacts
dotnet pack src/AbsLang.Adapters.Aws/AbsLang.Adapters.Aws.csproj -c Release -o ./artifacts
dotnet pack src/AbsLang.Adapters.Google/AbsLang.Adapters.Google.csproj -c Release -o ./artifacts
```

The package multi-targets `netstandard2.0` (broad compatibility) and `net10.0`.
