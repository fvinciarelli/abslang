"""ABS Assistant — chat with QA/PO/PM to build spec files.

The system prompt is generated from the ABS schema, examples and assistant/*.md
by scripts/build-knowledge.mjs (see .assistant_knowledge).

Supports BYOK: OpenAI, Anthropic, and DeepSeek.
Run via: abs chat (CLI) or integrated in the web UI / VSCode.
"""

import json
import os
import re
from typing import Any

import httpx

from .assistant_knowledge import build_system_prompt


def new_conversation() -> list[dict[str, str]]:
    return []


async def chat(
    messages: list[dict[str, str]],
    api_key: str,
    model: str = "deepseek-chat",
    base_url: str = "https://api.deepseek.com/v1",
) -> str:
    """Send messages to DeepSeek, return assistant response."""
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    system = build_system_prompt(last_user)

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    *messages,
                ],
                "temperature": 0.3,
                "max_tokens": 4096,
            },
        )

    if resp.status_code >= 400:
        text = resp.text[:300]
        raise RuntimeError(f"DeepSeek returned {resp.status_code}: {text}")

    data = resp.json()
    return data.get("choices", [{}])[0].get("message", {}).get("content", "")


def extract_yaml(text: str) -> str | None:
    """Extract YAML from a markdown code block."""
    match = re.search(r"```yaml\n([\s\S]*?)```", text)
    return match.group(1).strip() if match else None
