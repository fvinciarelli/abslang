"""Config file loading for abs.config.yaml."""

import os
from pathlib import Path
from typing import Any

import yaml


def find_config() -> dict[str, Any] | None:
    """Find abs.config.yaml by walking up from cwd."""
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        config_path = parent / "abs.config.yaml"
        if config_path.exists():
            with open(config_path, "r") as f:
                return yaml.safe_load(f) or {}
    return None


def merge_config(cli_options: dict[str, Any]) -> dict[str, Any]:
    """Merge CLI options with config file. CLI wins over config."""
    config = find_config() or {}
    merged: dict[str, Any] = {}

    # Agent
    agent_cfg = config.get("agent", {})
    merged["agent_url"] = cli_options.get("agent_url") or os.environ.get("ABS_AGENT_URL") or agent_cfg.get("url")
    merged["agent_format"] = cli_options.get("agent_format") or agent_cfg.get("format", "openai")
    merged["agent_auth"] = cli_options.get("agent_auth") or agent_cfg.get("auth", "none")
    merged["agent_token"] = cli_options.get("agent_token") or os.environ.get("ABS_AGENT_TOKEN") or agent_cfg.get("token")
    merged["agent_model"] = cli_options.get("agent_model") or os.environ.get("ABS_AGENT_MODEL") or agent_cfg.get("model")
    merged["agent_forward_auth"] = bool(
        cli_options.get("agent_forward_auth")
        or _env_flag(os.environ.get("ABS_AGENT_FORWARD_AUTH"))
        or agent_cfg.get("forward_auth", False)
    )
    merged["agent_authorization"] = (
        cli_options.get("agent_authorization")
        or os.environ.get("ABS_AGENT_AUTHORIZATION")
        or agent_cfg.get("authorization")
    )

    # Adapters
    adapters_cfg = config.get("adapters", {})
    merged["adapters"] = cli_options.get("adapters") or adapters_cfg

    # Defaults
    defaults_cfg = config.get("defaults", {})
    merged["timeout"] = cli_options.get("timeout") or defaults_cfg.get("timeout", 300)
    merged["dataset"] = cli_options.get("dataset") or defaults_cfg.get("dataset")

    return merged


def _env_flag(value: str | None) -> bool:
    """Truthy parsing for env-var booleans."""
    if not value:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}
