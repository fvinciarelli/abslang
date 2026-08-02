# ABS — TypeScript

> **Agent Behavior Specification** CLI for Node.js. Describe, run, and evaluate AI agent interactions.

## Install

```bash
npm install -g abslang
```

## Quick start

```bash
# Scaffold a project
abslang init

# Run a session against a local agent
abslang run sessions/order-status.abs.yaml --agent http://localhost:8080/chat

# Run with a dataset (parametrized testing)
abslang run sessions/order-status.abs.yaml --agent $URL --dataset datasets/order-status.jsonl

# View a previous report
abslang report report.json
```

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
console.log(result.passed);
```
