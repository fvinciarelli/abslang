# Agent Behavior Specification (ABS)

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
| `--agent-format` | `openai` (default), `claude`, or `gemini` |
| `--agent-auth` | `none`, `api_key`, `bearer`, or `oauth2` |
| `--agent-token` | Auth token or API key |
| `--adapter llm_judge=<name>` | Route LLM evaluations through an adapter (`aievaluator`, `local`, `azure`) — see below |
| `--format` | `table` (default), `json`, or `junit` |
| `--ci` | CI mode (no colors) |
| `--timeout <n>` | Timeout per session in seconds (default: 300) |
| `--output <path>` | Write report to file |
| `--parallel <n>` | Run N dataset rows in parallel |

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

**Built-in judge (zero setup, `llm_judge` only):**

```bash
# Auto-detects OpenAI, Anthropic, or Gemini from env
OPENAI_API_KEY=sk-... abslang run session.abs.yaml --agent $URL
ANTHROPIC_API_KEY=sk-ant-... abslang run session.abs.yaml --agent $URL
```

**AI Evaluator (currently the only adapter available for dimension types):**

```bash
abslang run session.abs.yaml --agent $URL --adapter llm_judge=aievaluator
```

**Private LLM (Ollama, vLLM, any OpenAI-compatible endpoint):**

```bash
abslang run session.abs.yaml --agent $URL \
  --adapter llm_judge=local \
  --adapter-url http://localhost:11434/v1
```

**Other providers** (Azure, Vertex AI, LangSmith, Galileo) can ship adapters implementing the same interface. Your session file doesn't change — only the `--adapter` flag.

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
