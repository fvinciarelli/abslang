# abslang — the tool around the spec

Install: `npm install -g abslang` or `pip install abslang`. Both implementations
parse the same files and emit the same report shape.

Commands:
- `abslang init [dir]` — scaffold a session + dataset example.
- `abslang chat` — this assistant; writes .abs.yaml (BYOK: OpenAI, Azure OpenAI, DeepSeek, Anthropic, Ollama/vLLM via --base-url).
- `abslang run <session.abs.yaml> --agent <url>` — execute against your agent.
- `abslang report <report.json>` — view a previous run (--failed, --detail N).
- `abslang generate-ci` — scaffold a CI job.

Run flags:
- Agent: `--agent <url>`, `--agent-format openai|responses|claude|gemini`, `--agent-auth none|api_key|bearer|oauth2`, `--agent-token`, `--agent-model`, `--agent-forward-auth`.
- Data: `--dataset <file|dir>`, `--filter key:value`, `--var k=v`.
- Evaluator adapters: `--adapter llm_judge=azure` (repeatable), `--judge-base-url`, `--judge-api-key`, `--judge-api-key-header`, `--judge-model`.
- Output: `--format table|json|junit` (default table), `--output <file>`, `--ci`, `--timeout <s>`, `--parallel <n>`.
- Logs: `--log-format pretty|jsonl`, `--log-level error|warn|info|debug`, `--log-file <file>`, `--no-log-content`.
- Chat params (for models with different fields): `--model`, `--base-url`, `--max-tokens`, `--max-tokens-param max_tokens|max_completion_tokens`, `--temperature`, `--omit-temperature`, `--param key=value` (repeatable).

Streams and exit codes: the report goes to stdout; progress and structured events
go to stderr (and a JSONL file with `--log-file`). Exit 0 = all passed, 1 = failures,
2 = usage error. `--format json` is the machine-readable audit report.

Docs: CLI.md (commands, report and event catalogs), RUNNER.md (execution model),
EVALUATIONS.md (evaluators and adapters), VARIABLES.md (dataset bindings).
