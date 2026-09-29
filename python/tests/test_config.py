"""Every CLI option must be settable via CLI flag, ABS_* env var, or config file.

Precedence: CLI flag > ABS_* env var > config file > built-in default.
"""

from click.testing import CliRunner

import abslang.cli as cli

SESSION = "session: S\nbehaviors:\n  - actor: user\n    action: says\n    content: hi\n"

CONFIG_FULL = """\
agent:
  url: http://cfg-agent:8080/chat
  format: claude
  auth: bearer
  token: cfg-token
  model: cfg-model
  forward_auth: true
  authorization: "Bearer cfg-auth"
  refresh_url: http://cfg/refresh
  refresh_token: cfg-refresh-token
  client_id: cfg-client
judge:
  base_url: http://judge:1/v1
  api_key: judge-key
  api_key_header: api-key
  model: judge-model
defaults:
  timeout: 120
  parallel: 4
run:
  format: json
  ci: true
logging:
  format: jsonl
  level: debug
  file: out.log.jsonl
  no_content: true
"""


class _FakeResult:
    def __init__(self):
        self.passed = True
        self.session = "S"
        self.agent = ""
        self.steps_total = 0
        self.steps_matched = 0
        self.evaluations_total = 0
        self.evaluations_passed = 0
        self.steps = []
        self.chain_evaluations = []


async def _fake_run(sess, agent_config, vars_dict, logger):
    return _FakeResult()


class _FakeLogger:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.run_id = "test"

    def event(self, *args, **kwargs):
        pass

    def elapsed_ms(self):
        return 0


def _invoke(tmp_path, monkeypatch, args, env=None):
    captured = {}

    async def run(sess, agent_config, vars_dict, logger):
        captured["agent_config"] = agent_config
        captured["vars"] = vars_dict
        captured.setdefault("all_vars", []).append(vars_dict)
        return _FakeResult()

    monkeypatch.setattr(cli, "run", run)
    monkeypatch.setattr(cli, "RunLogger", _FakeLogger)
    monkeypatch.setattr(cli, "configure_builtin_judge", lambda **kw: captured.setdefault("judge", {}).update(kw))
    monkeypatch.setattr(cli, "configure_logging", lambda **kw: captured.setdefault("logging", {}).update(kw))
    monkeypatch.setattr(cli, "close_logging", lambda: None)

    monkeypatch.chdir(tmp_path)
    result = CliRunner().invoke(cli.main, args, env=env)
    return result, captured


def test_all_options_from_config_file(tmp_path, monkeypatch):
    (tmp_path / "abs.config.yaml").write_text(CONFIG_FULL)
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, captured = _invoke(tmp_path, monkeypatch, ["run", "s.abs.yaml"])

    assert result.exit_code == 0, result.output
    ac = captured["agent_config"]
    assert ac.url == "http://cfg-agent:8080/chat"
    assert ac.format == "claude"
    assert ac.auth == "bearer"
    assert ac.token == "cfg-token"
    assert ac.model == "cfg-model"
    assert ac.forward_auth is True
    assert ac.authorization == "Bearer cfg-auth"
    assert ac.refresh_url == "http://cfg/refresh"
    assert ac.refresh_token == "cfg-refresh-token"
    assert ac.client_id == "cfg-client"
    assert ac.timeout == 120
    assert captured["judge"] == {
        "base_url": "http://judge:1/v1",
        "api_key": "judge-key",
        "api_key_header": "api-key",
        "model": "judge-model",
    }
    assert captured["logging"]["format"] == "jsonl"
    assert captured["logging"]["level"] == "debug"
    assert captured["logging"]["file"] == "out.log.jsonl"
    assert captured["logging"]["include_content"] is False
    # ci + format flags come through Click defaults
    assert "passed" in result.output  # json output (run.format: json)


def test_env_beats_config_file(tmp_path, monkeypatch):
    (tmp_path / "abs.config.yaml").write_text(CONFIG_FULL)
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, captured = _invoke(
        tmp_path, monkeypatch, ["run", "s.abs.yaml"],
        env={"ABS_AGENT_AUTH": "none", "ABS_TIMEOUT": "99", "ABS_AGENT_TOKEN": "env-token"},
    )

    assert result.exit_code == 0, result.output
    ac = captured["agent_config"]
    assert ac.auth == "none"          # env wins over config bearer
    assert ac.timeout == 99           # env wins over config 120
    assert ac.token == "env-token"


def test_cli_beats_env(tmp_path, monkeypatch):
    (tmp_path / "abs.config.yaml").write_text(CONFIG_FULL)
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, captured = _invoke(
        tmp_path, monkeypatch, ["run", "s.abs.yaml", "--timeout", "7", "--agent-auth", "oauth2"],
        env={"ABS_TIMEOUT": "99", "ABS_AGENT_AUTH": "none"},
    )

    assert result.exit_code == 0, result.output
    ac = captured["agent_config"]
    assert ac.timeout == 7
    assert ac.auth == "oauth2"


def test_builtin_defaults_without_config(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, captured = _invoke(
        tmp_path, monkeypatch, ["run", "s.abs.yaml", "--agent", "http://x:1/chat"],
    )

    assert result.exit_code == 0, result.output
    ac = captured["agent_config"]
    assert ac.timeout == 300
    assert ac.format == "openai"
    assert ac.auth == "none"
    assert ac.forward_auth is False


def test_explicit_config_file(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)
    (tmp_path / "other.yaml").write_text("agent:\n  url: http://other:1/chat\n  auth: bearer\n")

    result, captured = _invoke(
        tmp_path, monkeypatch,
        ["--config-file", "other.yaml", "run", "s.abs.yaml"],
    )

    assert result.exit_code == 0, result.output
    ac = captured["agent_config"]
    assert ac.url == "http://other:1/chat"
    assert ac.auth == "bearer"


def test_missing_config_file_errors(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, _ = _invoke(
        tmp_path, monkeypatch,
        ["--config-file", "nope.yaml", "run", "s.abs.yaml"],
    )

    assert result.exit_code != 0
    assert "config file not found" in result.output


def test_unknown_config_key_warns(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)
    (tmp_path / "abs.config.yaml").write_text(
        "agent:\n  urll: http://x:1/chat\n  url: http://ok:1/chat\n"
    )

    result, captured = _invoke(tmp_path, monkeypatch, ["run", "s.abs.yaml"])

    assert result.exit_code == 0, result.output
    assert "unknown key 'agent.urll'" in result.output
    assert captured["agent_config"].url == "http://ok:1/chat"


def test_vars_precedence(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)
    (tmp_path / "abs.config.yaml").write_text(
        "agent: { url: http://x:1/chat }\n"
        "defaults:\n  vars: { orderId: 'cfg-v' }\n"
    )

    result, captured = _invoke(
        tmp_path, monkeypatch,
        ["run", "s.abs.yaml", "--var", "orderId=cli-v"],
        env={"ABS_VAR_orderId": "env-v"},
    )

    assert result.exit_code == 0, result.output
    assert captured["vars"] == {"orderId": "cli-v"}  # CLI beats env

    result, captured = _invoke(
        tmp_path, monkeypatch, ["run", "s.abs.yaml"],
        env={"ABS_VAR_orderId": "env-v"},
    )
    assert captured["vars"] == {"orderId": "env-v"}  # env beats config


def test_boolean_flags_from_env(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)

    result, captured = _invoke(
        tmp_path, monkeypatch, ["run", "s.abs.yaml"],
        env={"ABS_AGENT_URL": "http://x:1/chat", "ABS_CI": "1", "ABS_AGENT_FORWARD_AUTH": "true"},
    )

    assert result.exit_code == 0, result.output
    assert captured["agent_config"].forward_auth is True


def test_dataset_filter_output_from_config(tmp_path, monkeypatch):
    (tmp_path / "s.abs.yaml").write_text(SESSION)
    (tmp_path / "ds.jsonl").write_text('{"a": "1", "b": "x"}\n{"a": "2", "b": "y"}\n')
    (tmp_path / "abs.config.yaml").write_text(
        "agent: { url: http://x:1/chat }\n"
        "defaults:\n"
        "  dataset: ds.jsonl\n"
        "  filter: 'a:1'\n"
        "  output: report.json\n"
    )

    result, captured = _invoke(tmp_path, monkeypatch, ["run", "s.abs.yaml", "--format", "json"])

    assert result.exit_code == 0, result.output
    assert "Report written to report.json" in result.output
    assert captured["all_vars"] == [{"a": "1", "b": "x"}]
    assert (tmp_path / "report.json").exists()
