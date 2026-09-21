"""ABS Assistant — chat with QA/PO/PM to build spec files.

The system prompt is generated from the ABS schema, examples and assistant/*.md
by scripts/build-knowledge.mjs (see assistant_knowledge).

Supports BYOK: OpenAI-compatible endpoints (OpenAI, Azure OpenAI, DeepSeek,
Ollama, vLLM) and the Anthropic Messages API.

Parameter names differ per model (e.g. gpt-5 expects max_completion_tokens and
rejects temperature). Nothing is guessed from the model name: the caller
passes max_tokens_param / temperature / omit_temperature / extra_params
explicitly. Used by: CLI (abs chat).

Keep in sync with typescript/src/assistant.ts.
"""

import re
from dataclasses import dataclass
from typing import Any

import httpx

from .assistant_knowledge import build_system_prompt


@dataclass
class AssistantConfig:
    api_key: str
    model: str | None = None
    base_url: str | None = None
    provider: str | None = None  # "openai" | "anthropic" | "deepseek" | other
    max_tokens: int | None = None  # Default: 4096
    temperature: float | None = None  # Default: 0.3. Ignored when omit_temperature.
    omit_temperature: bool = False
    max_tokens_param: str | None = None  # Default: "max_tokens". Use "max_completion_tokens" for gpt-5/o-series.
    extra_params: dict[str, Any] | None = None  # Merged last, wins over defaults.


def new_conversation() -> list[dict[str, str]]:
    return []


async def chat(messages: list[dict[str, str]], config: AssistantConfig) -> str:
    """Send the conversation to the provider, return the assistant response."""
    # The latest user message selects which examples to inject into the prompt.
    last_user = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    system = build_system_prompt(last_user)

    if config.provider == "anthropic":
        return await _chat_anthropic(messages, config, system)
    return await _chat_openai_compatible(messages, config, system)


# ── OpenAI-compatible: OpenAI, Azure OpenAI, DeepSeek, Ollama, vLLM ──

def _build_openai_body(
    model: str,
    messages: list[dict[str, str]],
    system: str,
    config: AssistantConfig,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        config.max_tokens_param or "max_tokens": config.max_tokens or 4096,
    }
    if not config.omit_temperature:
        body["temperature"] = 0.3 if config.temperature is None else config.temperature
    if config.extra_params:
        body.update(config.extra_params)
    return body


async def _chat_openai_compatible(
    messages: list[dict[str, str]],
    config: AssistantConfig,
    system: str,
) -> str:
    model = config.model or "deepseek-chat"
    base_url = config.base_url or "https://api.deepseek.com/v1"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config.api_key}",
            },
            json=_build_openai_body(model, messages, system, config),
        )

    if resp.status_code >= 400:
        text = resp.text[:300]
        hint = ""
        if "max_completion_tokens" in text:
            hint += "\nHint: this model expects max_completion_tokens. Retry with --max-tokens-param max_completion_tokens"
        if "temperature" in text:
            hint += "\nHint: this model rejects temperature. Retry with --omit-temperature"
        raise RuntimeError(f"Chat provider returned {resp.status_code}: {text}{hint}")

    data = resp.json()
    choices = data.get("choices") or [{}]
    return (choices[0].get("message") or {}).get("content", "")


# ── Anthropic Messages API ──

async def _chat_anthropic(
    messages: list[dict[str, str]],
    config: AssistantConfig,
    system: str,
) -> str:
    model = config.model or "claude-sonnet-4-20250514"
    base_url = config.base_url or "https://api.anthropic.com/v1"

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{base_url}/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": config.api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": model,
                "max_tokens": config.max_tokens or 4096,
                **({} if config.omit_temperature else {"temperature": 0.3 if config.temperature is None else config.temperature}),
                "system": system,  # top-level field, not a message with role "system"
                "messages": [
                    {"role": m["role"], "content": m["content"]}
                    for m in messages
                    if m.get("role") != "system"
                ],
                **(config.extra_params or {}),
            },
        )

    if resp.status_code >= 400:
        raise RuntimeError(f"Anthropic returned {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    parts = data.get("content") if isinstance(data.get("content"), list) else []
    return "".join(
        p.get("text", "")
        for p in parts
        if isinstance(p, dict) and p.get("type") == "text"
    )


# ── Convenience: extract YAML from assistant response ──

def extract_yaml(text: str) -> str | None:
    """Extract YAML from a markdown code block."""
    match = re.search(r"```yaml\n([\s\S]*?)```", text)
    return match.group(1).strip() if match else None


# ── Convenience: extract Mermaid from assistant response ──

def extract_mermaid(text: str) -> str | None:
    """Extract Mermaid from a markdown code block."""
    match = re.search(r"```mermaid\n([\s\S]*?)```", text)
    return match.group(1).strip() if match else None
