"""Mirrors typescript/src/__tests__/assistant.test.ts: request shapes, error
labels/hints, provider branches, and extraction helpers. No network."""

import asyncio

import pytest

from abslang import assistant
from abslang.assistant import (
    AssistantConfig,
    chat,
    extract_mermaid,
    extract_yaml,
)


class FakeResponse:
    def __init__(self, status_code=200, body=None, text=""):
        self.status_code = status_code
        self._body = body
        self.text = text

    def json(self):
        return self._body


class FakeClient:
    """Replaces httpx.AsyncClient; records POST calls."""

    calls = []
    next_response = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, headers=None, json=None, **kwargs):
        FakeClient.calls.append({"url": url, "headers": headers, "json": json})
        return FakeClient.next_response


@pytest.fixture(autouse=True)
def fake_http(monkeypatch):
    FakeClient.calls = []
    FakeClient.next_response = FakeResponse(body={"choices": [{"message": {"content": "hello"}}]})
    monkeypatch.setattr(assistant.httpx, "AsyncClient", FakeClient)


def run(coro):
    return asyncio.run(coro)


def test_sends_generated_system_prompt_for_latest_user_message():
    out = run(
        chat(
            [{"role": "user", "content": "I need a refund flow"}],
            AssistantConfig(api_key="test-key", model="test-model", base_url="http://example.test/v1"),
        )
    )
    assert out == "hello"

    assert len(FakeClient.calls) == 1
    call = FakeClient.calls[0]
    assert call["url"] == "http://example.test/v1/chat/completions"
    assert call["headers"]["Authorization"] == "Bearer test-key"
    body = call["json"]
    assert body["model"] == "test-model"
    assert body["temperature"] == 0.3

    system = next(m for m in body["messages"] if m["role"] == "system")
    assert "ABS v" in system["content"] and "quick reference" in system["content"]
    user = next(m for m in body["messages"] if m["role"] == "user")
    assert user["content"] == "I need a refund flow"


def test_sends_token_limit_field_temperature_and_extra_params():
    # gpt-5 style: max_completion_tokens, no temperature, reasoning_effort
    run(
        chat(
            [{"role": "user", "content": "hi"}],
            AssistantConfig(
                api_key="k",
                max_tokens=1234,
                max_tokens_param="max_completion_tokens",
                omit_temperature=True,
                extra_params={"reasoning_effort": "low"},
            ),
        )
    )
    body = FakeClient.calls[0]["json"]
    assert body["max_completion_tokens"] == 1234
    assert "max_tokens" not in body
    assert "temperature" not in body
    assert body["reasoning_effort"] == "low"

    # classic style with an explicit temperature
    run(
        chat(
            [{"role": "user", "content": "hi"}],
            AssistantConfig(api_key="k", temperature=0.9),
        )
    )
    body = FakeClient.calls[1]["json"]
    assert body["max_tokens"] == 4096
    assert body["temperature"] == 0.9


def test_hints_the_cli_flags_when_the_provider_rejects_a_parameter():
    FakeClient.next_response = FakeResponse(
        status_code=400,
        text="Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    )
    with pytest.raises(RuntimeError, match=r"--max-tokens-param max_completion_tokens"):
        run(
            chat(
                [{"role": "user", "content": "hi"}],
                AssistantConfig(api_key="k", model="gpt-5.1-mini"),
            )
        )

    FakeClient.next_response = FakeResponse(
        status_code=400,
        text="Unsupported value: 'temperature' does not support 0.3 with this model.",
    )
    with pytest.raises(RuntimeError, match=r"--omit-temperature"):
        run(
            chat(
                [{"role": "user", "content": "hi"}],
                AssistantConfig(api_key="k", model="gpt-5.1-mini"),
            )
        )


def test_includes_mermaid_mapping_when_user_pastes_a_diagram():
    run(
        chat(
            [{"role": "user", "content": "```mermaid\nflowchart TD\n A-->B\n```"}],
            AssistantConfig(api_key="k"),
        )
    )
    system = next(m for m in FakeClient.calls[0]["json"]["messages"] if m["role"] == "system")
    assert "MERMAID INPUT" in system["content"]


def test_throws_a_readable_error_when_the_provider_fails():
    FakeClient.next_response = FakeResponse(status_code=401, text="unauthorized")
    with pytest.raises(RuntimeError, match=r"Chat provider returned 401"):
        run(
            chat(
                [{"role": "user", "content": "hi"}],
                AssistantConfig(api_key="bad"),
            )
        )


def test_uses_anthropic_messages_api_when_provider_is_anthropic():
    FakeClient.next_response = FakeResponse(
        body={"content": [{"type": "text", "text": "hola "}, {"type": "text", "text": "mundo"}]}
    )
    out = run(
        chat(
            [{"role": "user", "content": "quiero un test"}],
            AssistantConfig(
                api_key="sk-ant",
                provider="anthropic",
                model="claude-test",
                base_url="https://api.anthropic.test/v1",
            ),
        )
    )
    assert out == "hola mundo"

    call = FakeClient.calls[0]
    assert call["url"] == "https://api.anthropic.test/v1/messages"
    assert call["headers"]["x-api-key"] == "sk-ant"
    assert call["headers"]["anthropic-version"] == "2023-06-01"
    body = call["json"]
    assert body["model"] == "claude-test"
    assert body["max_tokens"] == 4096
    assert isinstance(body["system"], str) and "ABS v" in body["system"]
    assert body["messages"] == [{"role": "user", "content": "quiero un test"}]


def test_surfaces_anthropic_error_with_its_own_label():
    FakeClient.next_response = FakeResponse(status_code=400, text="bad request")
    with pytest.raises(RuntimeError, match=r"Anthropic returned 400"):
        run(
            chat(
                [{"role": "user", "content": "hi"}],
                AssistantConfig(api_key="k", provider="anthropic"),
            )
        )


def test_extracts_fenced_yaml():
    text = "Here you go:\n\n```yaml\nsession: X\nbehaviors:\n  - actor: user\n    action: says\n```\n\nDone."
    assert extract_yaml(text) == "session: X\nbehaviors:\n  - actor: user\n    action: says"
    assert extract_yaml("no code block here") is None


def test_extracts_fenced_mermaid():
    text = "Diagram:\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n"
    assert extract_mermaid(text) == "sequenceDiagram\n  A->>B: hi"
    assert extract_mermaid("no diagram") is None
