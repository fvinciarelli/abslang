"""JSON Schema validation for ABS documents."""

import json
import os
from pathlib import Path
from typing import Any

import jsonschema


_schema: dict[str, Any] | None = None


def get_schema() -> dict[str, Any]:
    """Load the v0.1 ABS JSON Schema, cached in memory."""
    global _schema
    if _schema is not None:
        return _schema

    # Try relative to the package install, then relative to cwd
    candidates = [
        Path(__file__).parent.parent.parent.parent / "schema" / "abs.schema.json",
        Path.cwd() / "schema" / "abs.schema.json",
    ]
    for path in candidates:
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                _schema = json.load(f)
            return _schema

    raise FileNotFoundError(
        "Cannot find schema/abs.schema.json. "
        "Ensure you're running from the ABS project root."
    )


def validate_document(doc: dict[str, Any]) -> tuple[bool, list[str]]:
    """Validate an ABS document against the v0.1 JSON Schema.

    Returns (valid, errors) where errors is a list of human-readable messages.
    """
    try:
        schema = get_schema()
        jsonschema.validate(doc, schema)
        return True, []
    except jsonschema.ValidationError as e:
        return False, [f"{'.'.join(str(p) for p in e.absolute_path)}: {e.message}"]
    except jsonschema.SchemaError as e:
        return False, [f"Schema error: {e.message}"]
