# ABS VSCode Extension

Visual editor and test runner for Agent Behavior Specification files.

## Features

- **Visual editor** — build ABS sessions with a point-and-click interface
- **Test runner** — execute sessions against your agent with one click (▶ Run)
- **Project scaffolding** — `ABS: Init Project` creates a ready-to-use structure

## Usage

1. Open any `.abs.yaml` file — the ABS Editor opens automatically
2. Click behaviors in the left panel, edit properties on the right
3. Click **▶ Run** to test against your configured agent

## Configuration

| Setting | Default | Description |
|---|---|---|
| `abs.agentUrl` | `http://localhost:8080/chat` | Agent endpoint URL |
| `abs.agentFormat` | `openai` | `openai`, `claude`, or `gemini` |
| `abs.agentAuth` | `none` | `none`, `api_key`, `bearer`, or `oauth2` |
| `abs.agentToken` | — | API key or token |
| `abs.aiEvaluatorApiKey` | — | AI Evaluator key for LLM judge |
