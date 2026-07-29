# ABS — Python

> Agent Behavior Specification CLI for Python. Describe, run, and evaluate AI agent interactions.

## Install

```bash
pip install abs-lang
```

## Quick start

```bash
# Scaffold a project
abs init

# Run a session against a local agent
abs run sessions/order-status.abs.yaml --agent http://localhost:8080/chat

# Run with a dataset (parametrized testing)
abs run sessions/order-status.abs.yaml --agent $URL --dataset datasets/order-status.jsonl

# View a previous report
abs report report.json
```

## Test with the mock agent

```bash
# Terminal 1: start mock agent
python tools/mock_agent.py --scenario happy

# Terminal 2: run the example
abs run examples/order-status.yaml --agent http://localhost:8080/chat
```

## Library usage

```python
from abslang import parse, run
from abslang.runner import AgentConfig
import asyncio

session = parse('session.abs.yaml')
result = asyncio.run(run(session, AgentConfig(
    url='http://localhost:8080/chat',
    format='openai',
)))
print(result.passed)
```
