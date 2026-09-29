"""Config file loading for abs.config.yaml (or an explicit --config-file).

Every CLI option can be set three ways, highest priority first:

    CLI flag  >  ABS_* env var  >  config file  >  built-in default

Click resolves the precedence itself: option values from this file are handed
over as ``ctx.default_map``, and env vars are declared per-option with
``envvar=``. So no manual merging is needed here — this module only loads,
validates, and flattens the config file.
"""

from pathlib import Path
from typing import Any

import yaml

# ── Schema ─────────────────────────────────────────────────────────
# section -> allowed keys. None means free-form mapping (adapters).

_KNOWN_KEYS: dict[str, set[str] | None] = {
    "agent": {
        "url", "format", "auth", "token", "model", "forward_auth",
        "authorization", "refresh_url", "refresh_token", "client_id",
    },
    "adapters": None,
    "judge": {"base_url", "api_key", "api_key_header", "model"},
    "defaults": {"dataset", "filter", "timeout", "parallel", "output", "vars"},
    "run": {"format", "ci"},
    "logging": {"format", "level", "file", "no_content"},
    "report": {"format", "failed", "detail"},
}

# (section, key) -> click parameter name (keys for ctx.default_map)
_FLAT_KEYS: dict[tuple[str, str], str] = {
    ("agent", "url"): "agent",
    ("agent", "format"): "agent_format",
    ("agent", "auth"): "agent_auth",
    ("agent", "token"): "agent_token",
    ("agent", "model"): "agent_model",
    ("agent", "forward_auth"): "agent_forward_auth",
    ("agent", "authorization"): "agent_authorization",
    ("agent", "refresh_url"): "agent_refresh_url",
    ("agent", "refresh_token"): "agent_refresh_token",
    ("agent", "client_id"): "agent_client_id",
    ("judge", "base_url"): "judge_base_url",
    ("judge", "api_key"): "judge_api_key",
    ("judge", "api_key_header"): "judge_api_key_header",
    ("judge", "model"): "judge_model",
    ("defaults", "dataset"): "dataset_path",
    ("defaults", "filter"): "filter_kv",
    ("defaults", "timeout"): "timeout",
    ("defaults", "parallel"): "parallel",
    ("defaults", "output"): "output_file",
    ("run", "format"): "output_format",
    ("run", "ci"): "ci",
    ("logging", "format"): "log_format",
    ("logging", "level"): "log_level",
    ("logging", "file"): "log_file",
    ("logging", "no_content"): "no_log_content",
    ("report", "format"): "output_format",
    ("report", "failed"): "failed",
    ("report", "detail"): "detail",
}


def load_config(path: str) -> dict[str, Any]:
    """Load a YAML or JSON config file. Raises on missing/invalid file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"config file not found: {path}")
    try:
        data = yaml.safe_load(p.read_text())
    except yaml.YAMLError as e:
        raise ValueError(f"invalid config file {path}: {e}")
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError(f"config file {path} must contain a mapping at the top level")
    return data


def discover_config() -> dict[str, Any] | None:
    """Find abs.config.yaml by walking up from cwd. None if not found."""
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        config_path = parent / "abs.config.yaml"
        if config_path.exists():
            return load_config(str(config_path))
    return None


def validate_config(config: dict[str, Any]) -> list[str]:
    """Return warnings for unknown sections/keys (typo protection)."""
    warnings: list[str] = []
    for section, value in config.items():
        known = _KNOWN_KEYS.get(section)
        if known is None:
            warnings.append(f"unknown section '{section}' in config (ignored)")
            continue
        if not isinstance(value, dict):
            warnings.append(f"section '{section}' must be a mapping (ignored)")
            continue
        for key in value:
            if key not in known:
                warnings.append(f"unknown key '{section}.{key}' in config (ignored)")
    return warnings


def flatten_config(config: dict[str, Any]) -> dict[str, Any]:
    """Flatten nested config into click parameter names (for ctx.default_map).

    Only maps keys present in the file; Click then applies them as defaults
    when neither the CLI flag nor the env var was given.
    """
    flat: dict[str, Any] = {}
    for section, value in config.items():
        if not isinstance(value, dict):
            continue
        for key, val in value.items():
            param = _FLAT_KEYS.get((section, key))
            if param is not None and val is not None:
                flat[param] = val
    return flat
