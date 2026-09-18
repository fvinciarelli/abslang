"""Structured event logging for abslang runs.

The final report always goes to stdout. Progress and events go to stderr — and
optionally to a JSONL file — so pipelines like
``abslang run --format json > report.json`` stay clean.

Event schema (v1)::

    {"v": 1, "ts": "2026-01-01T00:00:00.000Z", "level": "info",
     "event": "evaluation.result", "run_id": "r_ab12cd34ef56", ...}

The catalog of events is documented in CLI.md. Keep keys snake_case and stable:
both implementations (Python and TypeScript) emit the same schema.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

LEVELS = {"debug": 10, "info": 20, "warn": 30, "warning": 30, "error": 40}
_ICONS = {"debug": "·", "info": "→", "warn": "⚠", "error": "✖"}
_ENVELOPE_KEYS = {"v", "ts", "level", "event", "run_id"}


@dataclass
class _Config:
    enabled: bool = False
    level: int = LEVELS["info"]
    format: str = "pretty"
    file: TextIO | None = None
    include_content: bool = True
    meta: dict[str, Any] = field(default_factory=dict)


_config = _Config()


def configure_logging(
    level: str = "info",
    format: str = "pretty",
    file: str | Path | TextIO | None = None,
    include_content: bool = True,
    enabled: bool = True,
    **meta: Any,
) -> None:
    """Configure console/file logging. Called once by the CLI.

    ``file`` always receives JSONL — machine-readable regardless of the console
    format. ``meta`` is attached to every event (e.g. abslang version, agent).
    """
    global _config
    handle: TextIO | None = None
    if isinstance(file, (str, Path)):
        handle = open(file, "w", encoding="utf-8")
    elif file is not None:
        handle = file
    _config = _Config(
        enabled=enabled,
        level=LEVELS.get(str(level).lower(), LEVELS["info"]),
        format="jsonl" if str(format).lower() == "jsonl" else "pretty",
        file=handle,
        include_content=include_content,
        meta=dict(meta),
    )


def close_logging() -> None:
    """Flush and close the log file, then reset the configuration."""
    global _config
    if _config.file is not None and hasattr(_config.file, "close"):
        try:
            _config.file.close()
        except Exception:
            pass
    _config = _Config()


def logging_enabled() -> bool:
    return _config.enabled


def content_enabled() -> bool:
    """Whether trace content and reasons may be written to logs."""
    return _config.include_content


def new_run_id() -> str:
    return f"r_{uuid.uuid4().hex[:12]}"


class RunLogger:
    """Logger bound to one run (session + optional dataset row)."""

    def __init__(self, run_id: str | None = None, **context: Any) -> None:
        self.run_id = run_id or new_run_id()
        self.context = {k: v for k, v in context.items() if v is not None}
        self._started = time.perf_counter()

    def content_enabled(self) -> bool:
        return _config.include_content

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._started) * 1000)

    def event(self, event: str, level: str = "info", **fields: Any) -> None:
        if not _config.enabled:
            return
        lvl = LEVELS.get(level, LEVELS["info"])
        if lvl < _config.level:
            return

        record: dict[str, Any] = {
            "v": 1,
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": "warn" if level == "warning" else level,
            "event": event,
            "run_id": self.run_id,
        }
        record.update(_config.meta)
        record.update(self.context)
        record.update({k: v for k, v in fields.items() if v is not None})

        line = json.dumps(record, default=str, ensure_ascii=False)
        if _config.file is not None:
            _config.file.write(line + "\n")
            _config.file.flush()

        if _config.format == "jsonl":
            print(line, file=sys.stderr)
        else:
            print(self._format_pretty(record, set(_config.meta)), file=sys.stderr)

    @staticmethod
    def _format_pretty(record: dict[str, Any], skip: set[str]) -> str:
        event = str(record.get("event", "?"))
        icon = _ICONS.get(str(record.get("level", "info")), "·")
        parts: list[str] = []
        for key, value in record.items():
            if key in _ENVELOPE_KEYS or key in skip:
                continue
            if isinstance(value, (dict, list)):
                value = json.dumps(value, default=str, ensure_ascii=False)
            text = str(value)
            if len(text) > 80:
                text = text[:77] + "..."
            parts.append(f"{key}={text}")
        suffix = (" " + " ".join(parts)) if parts else ""
        return f"{icon} {event}{suffix}"
