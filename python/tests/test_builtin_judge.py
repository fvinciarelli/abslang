"""Spike — built-in LLM judge with a custom (OpenAI-compatible) endpoint."""

import asyncio

import pytest

from abslang.evaluators import ObservedStep
from abslang.evaluators.builtin_judge import configure_builtin_judge, evaluate
from http_mock import send_json


def _run(coro):
    return asyncio.run(coro)


TRACE = [ObservedStep(actor="assistant", action="responds", content="Your order is on its way")]

JUDGE_ENV_VARS = (
    "ABS_JUDGE_BASE_URL",
    "ABS_JUDGE_API_KEY",
    "ABS_JUDGE_API_KEY_HEADER",
    "ABS_JUDGE_MODEL",
    "ABS_JUDGE_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
)


@pytest.fixture(autouse=True)
def _clean_judge_env(monkeypatch):
    """Isolate judge configuration and environment across tests."""
    for var in JUDGE_ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    configure_builtin_judge()
    yield
    configure_builtin_judge()


def _judge_responder(record, handler, index):
    send_json(handler, {"choices": [{"message": {"content": "Score: 0.9\nReason: looks good"}}]})


class TestBuiltinJudgeCustomEndpoint:
    def test_calls_configured_base_url_with_api_key_header(self, server_factory):
        httpd, url = server_factory(_judge_responder, "/v1")
        configure_builtin_judge(
            base_url=url, api_key="secret", api_key_header="api-key", model="gpt-4o-mini"
        )

        result = _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "Is it helpful?"}))

        assert result.passed is True
        assert abs(result.score - 0.9) < 1e-9
        req = httpd.requests[0]
        assert req["path"] == "/v1/chat/completions"
        assert req["headers"]["api-key"] == "secret"
        assert "authorization" not in req["headers"]
        assert req["body"]["model"] == "gpt-4o-mini"

    def test_defaults_to_authorization_bearer(self, server_factory):
        httpd, url = server_factory(_judge_responder, "/v1")
        configure_builtin_judge(base_url=url, api_key="secret")

        _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "Is it helpful?"}))

        assert httpd.requests[0]["headers"]["authorization"] == "Bearer secret"

    def test_no_auth_header_without_key(self, server_factory):
        httpd, url = server_factory(_judge_responder, "/v1")
        configure_builtin_judge(base_url=url)

        _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "Is it helpful?"}))

        assert "authorization" not in httpd.requests[0]["headers"]
        assert "api-key" not in httpd.requests[0]["headers"]

    def test_cli_config_overrides_env(self, server_factory, monkeypatch):
        monkeypatch.setenv("ABS_JUDGE_BASE_URL", "http://127.0.0.1:9/v1")
        monkeypatch.setenv("ABS_JUDGE_API_KEY", "from-env")
        monkeypatch.setenv("ABS_JUDGE_API_KEY_HEADER", "api-key")

        httpd, url = server_factory(_judge_responder, "/v1")
        configure_builtin_judge(
            base_url=url,
            api_key="from-cli",
            api_key_header="Authorization",
            model="cli-model",
        )

        _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "Is it helpful?"}))

        # Flags win: the request reaches the mock server, not the env URL
        assert len(httpd.requests) == 1
        assert httpd.requests[0]["headers"]["authorization"] == "Bearer from-cli"
        assert "api-key" not in httpd.requests[0]["headers"]
        assert httpd.requests[0]["body"]["model"] == "cli-model"

    def test_respects_evaluation_threshold(self, server_factory):
        httpd, url = server_factory(_judge_responder, "/v1")  # returns 0.9
        configure_builtin_judge(base_url=url)

        strict = _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "x", "threshold": 0.95}))
        assert strict.passed is False
        assert abs(strict.score - 0.9) < 1e-9

        lenient = _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "x", "threshold": 0.5}))
        assert lenient.passed is True

        defaulted = _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "x"}))
        assert defaulted.passed is True  # default threshold is 0.5

    def test_prompt_renders_tool_call_arguments(self, server_factory):
        trace = [
            ObservedStep(actor="assistant", action="calls", target="Order MCP",
                         with_={"orderId": "8291"}),
            ObservedStep(actor="tool", action="responds", target="Order MCP",
                         content={"status": "shipped"}),
        ]
        httpd, url = server_factory(_judge_responder, "/v1")
        configure_builtin_judge(base_url=url)

        _run(evaluate(trace, {"type": "llm_judge", "criteria": "x"}))

        prompt = httpd.requests[0]["body"]["messages"][1]["content"]
        assert '[assistant] calls → Order MCP: {"orderId": "8291"}' in prompt
        assert '[tool] responds → Order MCP: {"status": "shipped"}' in prompt
        assert "null" not in prompt
        assert "None" not in prompt

    def test_env_fallback_when_no_cli(self, server_factory, monkeypatch):
        httpd, url = server_factory(_judge_responder, "/v1")
        monkeypatch.setenv("ABS_JUDGE_BASE_URL", url)
        monkeypatch.setenv("ABS_JUDGE_API_KEY", "env-key")
        monkeypatch.setenv("ABS_JUDGE_API_KEY_HEADER", "api-key")
        monkeypatch.setenv("ABS_JUDGE_MODEL", "env-model")

        _run(evaluate(TRACE, {"type": "llm_judge", "criteria": "Is it helpful?"}))

        assert httpd.requests[0]["headers"]["api-key"] == "env-key"
        assert httpd.requests[0]["body"]["model"] == "env-model"
