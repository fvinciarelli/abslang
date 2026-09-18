<p align="center">
  <img src="https://raw.githubusercontent.com/fvinciarelli/abslang/main/docs/images/logo.svg" alt="ABS — Agent Behavior Specification" width="260">
</p>

<h3 align="center">Specify how your AI agents behave — then verify it.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/abslang"><img src="https://img.shields.io/npm/v/abslang?color=0284c7" alt="npm version"></a>
  <a href="https://pypi.org/project/abslang/"><img src="https://img.shields.io/pypi/v/abslang?color=0284c7" alt="PyPI version"></a>
  <a href="https://github.com/fvinciarelli/abslang/actions/workflows/test.yml"><img src="https://github.com/fvinciarelli/abslang/actions/workflows/test.yml/badge.svg" alt="Tests"></a>
  <a href="https://github.com/fvinciarelli/abslang/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-0284c7" alt="License"></a>
</p>

> A vendor-neutral, human-readable format for describing the observable behavior of AI agents — what users say, what agents do, and how it should be evaluated. Like OpenAPI for HTTP APIs, ABS gives agent behavior a shared, tool-independent contract.

📖 **[Full documentation](https://fvinciarelli.github.io/abslang/)** · 📦 **[GitHub](https://github.com/fvinciarelli/abslang)**

## Install

```bash
npm install -g abslang
```

## Commands

### `abslang init`

Scaffold a new ABS project with an example session and dataset.

```bash
abslang init
```

Creates `abs.config.yaml`, `sessions/order-status.abs.yaml`, and `sessions/order-status.jsonl` (3 rows).

### `abslang run`

Execute ABS sessions against an agent.

```bash
# Single session
abslang run sessions/order-status.abs.yaml --agent http://localhost:8080/chat

# With a dataset (parametrized testing — one run per row)
abslang run sessions/order-status.abs.yaml --agent $URL --dataset sessions/order-status.jsonl

# With a single variable override
abslang run sessions/order-status.abs.yaml --agent $URL --var orderId=12345

# All sessions in a directory
abslang run sessions/ --agent $URL --dataset datasets/

# CI mode with JUnit output
abslang run sessions/ --agent $STAGING --dataset datasets/ --format junit --ci > report.xml
```

| Option | Description |
|---|---|
| `--agent <url>` | Agent endpoint URL (or set `ABS_AGENT_URL`) |
| `--dataset <path>` | JSON/JSONL dataset file |
| `--var key=value` | Single variable binding (repeatable) |
| `--filter key:value` | Filter dataset rows |
| `--agent-format` | `openai` (default), `responses`, `claude`, or `gemini` |
| `--agent-auth` | `none`, `api_key`, `bearer`, or `oauth2` |
| `--agent-token` | Auth token or API key |
| `--agent-model` | Model/deployment for model endpoints (e.g. Azure OpenAI Responses) — omit when the agent owns its model |
| `--agent-forward-auth` | Forward the caller's `Authorization` header to the agent |
| `--agent-authorization` | Raw `Authorization` header value to forward |
| `--agent-refresh-url` | OAuth2 token refresh URL |
| `--agent-refresh-token` | OAuth2 refresh token |
| `--agent-client-id` | OAuth2 client ID |
| `--adapter llm_judge=<name>` | Route LLM evaluations through an adapter (`aievaluator`, `azure`, `aws`, `google`) — see below |
| `--judge-base-url` | Built-in judge on a custom OpenAI-compatible endpoint (Azure/Foundry, Ollama, vLLM) |
| `--judge-api-key` | Built-in judge API key (overrides `ABS_JUDGE_API_KEY` / `OPENAI_API_KEY`) |
| `--judge-api-key-header` | Header for the judge key (default `Authorization`; use `api-key` for Azure) |
| `--judge-model` | Built-in judge model or Azure deployment name |
| `--format` | `table` (default), `json`, or `junit` |
| `--ci` | CI mode (no colors) |
| `--timeout <n>` | Timeout per session in seconds (default: 300) |
| `--output <path>` | Write report to file |
| `--parallel <n>` | Run N dataset rows in parallel |
| `--log-format` | `pretty` (default) or `jsonl` (one event per line) |
| `--log-level` | `error`, `warn`, `info` (default), `debug` |
| `--log-file` | Write machine-readable JSONL events to a file |
| `--no-log-content` | Omit trace content and reasons from logs (privacy) |

### `abslang report`

View results from a previous `abslang run --output`.

```bash
abslang report report.json                  # Table view
abslang report report.json --format json    # Machine-readable
abslang report report.json --format junit   # CI integration
abslang report report.json --failed         # Only failed cases
abslang report report.json --detail 3       # Full trace for row #3
```

### `abslang chat`

Generate ABS YAML by describing the behavior in plain language.

```bash
# Works with OpenAI, Anthropic, or DeepSeek — auto-detects from env
abslang chat

# Or specify a provider
abslang chat --provider openai
abslang chat --provider anthropic
abslang chat --provider deepseek

# You: A customer asks for a refund. The agent should verify the order, process it, and confirm.
# → generates .abs.yaml with evaluations, datasets, and chain checks
```

Commands inside chat: `/save <path>`, `/force <path>`, `/quit`.

### `abslang generate-ci`

Generate a CI/CD workflow file.

```bash
abslang generate-ci --platform github   # GitHub Actions
abslang generate-ci --platform gitlab   # GitLab CI
```

### LLM judge adapters

Evaluations like `llm_judge`, `Groundedness`, and `Relevance` need an LLM to produce the judgment. `abslang` routes them through an adapter — you pick where the judgment runs.

**Built-in judge (zero setup — `llm_judge` + safety dimensions):**

```bash
# Auto-detects OpenAI, Anthropic, or Gemini from env
OPENAI_API_KEY=sk-... abslang run session.abs.yaml --agent $URL
ANTHROPIC_API_KEY=sk-ant-... abslang run session.abs.yaml --agent $URL
```

Point the same judge at any OpenAI-compatible endpoint — CLI flags override the
`ABS_JUDGE_BASE_URL`, `ABS_JUDGE_API_KEY`, `ABS_JUDGE_API_KEY_HEADER`, and
`ABS_JUDGE_MODEL` environment variables:

```bash
abslang run session.abs.yaml --agent $URL \
  --judge-base-url "https://<resource>.openai.azure.com/openai/v1" \
  --judge-api-key "$AZURE_OPENAI_API_KEY" \
  --judge-api-key-header api-key \
  --judge-model gpt-4o-mini
```

**Azure AI Foundry** (quality dimensions + agentic evaluators — no Python SDK needed):

```bash
export AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_KEY=... AZURE_OPENAI_DEPLOYMENT=...
abslang run session.abs.yaml --agent $URL --adapter azure
```

The npm adapter renders the official Azure prompt templates locally and calls
your deployment's chat completions endpoint.

**AWS Bedrock** (LLM-as-judge):

```bash
npm install @aws-sdk/client-bedrock-runtime
export AWS_REGION=us-east-1
abslang run session.abs.yaml --agent $URL --adapter aws
```

**Google Vertex AI** (quality + safety):

```bash
npm install @google-cloud/vertexai
export GOOGLE_CLOUD_PROJECT=... GOOGLE_CLOUD_LOCATION=us-central1
abslang run session.abs.yaml --agent $URL --adapter google
```

**AI Evaluator** (free tier):

```bash
abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator
```

Safety dimensions (`Violence`, `HateUnfairness`, `Sexual`, `SelfHarm`) work with the
built-in judge out of the box — no criteria required. Other providers can ship
adapters implementing the same interface. Your session file doesn't change — only the
`--adapter` flag.

## Test with the mock agent

```bash
# Terminal 1: start mock agent
python3 tools/mock_agent.py --scenario happy

# Terminal 2: run the example
abslang run examples/order-status.yaml --agent http://localhost:8080/chat
```

## Library usage

```typescript
import { parse, run } from 'abslang';

const session = parse('session.abs.yaml');
const result = await run(session, {
  url: 'http://localhost:8080/chat',
  format: 'openai',
});
console.log(result.passed); // true | false
```

## Links

- 📖 [Documentation](https://fvinciarelli.github.io/abslang/)
- 📦 [GitHub](https://github.com/fvinciarelli/abslang)
- 📋 [Specification](https://github.com/fvinciarelli/abslang/blob/main/SPECIFICATION.md)
- 📝 [Examples](https://github.com/fvinciarelli/abslang/tree/main/examples)
- 🐛 [Issues](https://github.com/fvinciarelli/abslang/issues)

## License

Apache 2.0
