"""YAML parsing, fragment expansion, variable resolution, and dataset loading."""

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .schema_validator import validate_document


# ── Types ──

@dataclass
class Behavior:
    id: str | None = None
    actor: str = ""
    action: str = ""
    target: str | None = None
    content: Any = None
    capture: dict[str, Any] | None = None
    with_: dict[str, Any] | None = None
    with_only: dict[str, Any] | None = None
    evaluations: list[dict[str, Any]] | None = None
    # v0.2 — Optional Behaviors
    optional: bool = False
    requires: str | None = None
    matches_when: dict[str, Any] | None = None


@dataclass
class ABSDocument:
    session: str
    behaviors: list[Behavior | dict[str, str]]
    description: str | None = None
    abs_version: str | None = None
    dataset: dict[str, str] | None = None
    fragments: dict[str, list[Behavior]] | None = None
    evaluations: list[dict[str, Any]] | None = None


@dataclass
class NormalizedSession:
    session: str
    behaviors: list[Behavior]
    description: str | None = None
    abs_version: str | None = None
    dataset: dict[str, str] | None = None
    evaluations: list[dict[str, Any]] | None = None


# ── YAML parsing ──

def parse_yaml_file(path: str) -> list[ABSDocument]:
    """Parse a .abs.yaml file into one or more ABSDocuments."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"File not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return parse_yaml(f.read())


def parse_yaml(raw: str) -> list[ABSDocument]:
    """Parse a YAML string into one or more ABSDocuments. Supports --- separators."""
    docs = [d.strip() for d in raw.split("---") if d.strip()]
    results = []
    for doc in docs:
        data = yaml.safe_load(doc)
        if isinstance(data, dict):
            # Validate against JSON Schema before converting
            valid, errors = validate_document(data)
            if not valid:
                raise ValueError(f"Invalid ABS document:\n" + "\n".join(errors))
            results.append(_dict_to_document(data))
    return results


def _dict_to_document(data: dict[str, Any]) -> ABSDocument:
    behaviors_raw = data.get("behaviors", [])
    behaviors: list[Behavior | dict[str, str]] = []
    for b in behaviors_raw:
        if isinstance(b, dict) and "include" in b:
            behaviors.append({"include": b["include"]})
        elif isinstance(b, dict):
            behaviors.append(Behavior(
                id=b.get("id"),
                actor=b.get("actor", ""),
                action=b.get("action", ""),
                target=b.get("target"),
                content=b.get("content"),
                capture=b.get("capture"),
                with_=b.get("with"),
                with_only=b.get("with_only"),
                evaluations=b.get("evaluations"),
                optional=b.get("optional", False),
                requires=b.get("requires"),
                matches_when=b.get("matches_when"),
            ))

    fragments_raw = data.get("fragments", {})
    fragments: dict[str, list[Behavior]] = {}
    for name, items in fragments_raw.items():
        fragments[name] = [
            Behavior(
                actor=b.get("actor", ""),
                action=b.get("action", ""),
                target=b.get("target"),
                content=b.get("content"),
                capture=b.get("capture"),
                with_=b.get("with"),
                evaluations=b.get("evaluations"),
                optional=b.get("optional", False),
                requires=b.get("requires"),
                matches_when=b.get("matches_when"),
            )
            for b in items if isinstance(b, dict) and "actor" in b
        ]

    return ABSDocument(
        session=data["session"],
        behaviors=behaviors,
        description=data.get("description"),
        abs_version=data.get("abs_version"),
        dataset=data.get("dataset"),
        fragments=fragments if fragments else None,
        evaluations=data.get("evaluations"),
    )


# ── Fragment expansion ──

def expand_fragments(doc: ABSDocument) -> NormalizedSession:
    """Expand all include: references into a flat list of Behaviors."""
    fragments = doc.fragments or {}

    def expand(behaviors: list[Behavior | dict[str, str]]) -> list[Behavior]:
        result: list[Behavior] = []
        for entry in behaviors:
            if isinstance(entry, dict) and "include" in entry:
                frag_name = entry["include"]
                if frag_name not in fragments:
                    raise ValueError(
                        f'Fragment "{frag_name}" not found. '
                        f"Available: {', '.join(fragments.keys())}"
                    )
                result.extend(fragments[frag_name])
            elif isinstance(entry, Behavior):
                result.append(entry)
        return result

    expanded = NormalizedSession(
        session=doc.session,
        behaviors=expand(doc.behaviors),
        description=doc.description,
        abs_version=doc.abs_version,
        dataset=doc.dataset,
        evaluations=doc.evaluations,
    )

    # ── v0.2 semantic validation ──
    behavior_ids = {b.id for b in expanded.behaviors if b.id}

    # Validate requires references
    for b in expanded.behaviors:
        if b.requires and b.requires not in behavior_ids:
            raise ValueError(
                f'Behavior "{b.id or "(unnamed)"}" requires "{b.requires}" '
                f'but no behavior with that id exists.'
            )

    # Validate sequence does not reference optional behaviors
    if expanded.evaluations:
        for ev in expanded.evaluations:
            if ev.get("type") == "sequence" and "order" in ev:
                for sel in ev["order"]:
                    matched = None
                    for b in expanded.behaviors:
                        if (not sel.get("actor") or b.actor == sel["actor"]) and \
                           (not sel.get("action") or b.action == sel["action"]) and \
                           (not sel.get("target") or b.target == sel["target"]):
                            matched = b
                            break
                    if matched and matched.optional:
                        raise ValueError(
                            f'sequence references behavior "{matched.id or "(unnamed)"}" '
                            f'which is optional. sequence and optional are mutually exclusive. '
                            f'Use expected + after instead.'
                        )

    return expanded


# ── Variable resolution ──

_VAR_RE = re.compile(r"\{\{([\w.]+)\}\}")


def resolve_variables(
    behaviors: list[Behavior],
    runtime_bindings: dict[str, Any] | None = None,
) -> list[Behavior]:
    """Resolve {{variable}} references in all Behaviors."""
    variables: dict[str, Any] = dict(runtime_bindings or {})
    resolved: list[Behavior] = []

    for b in behaviors:
        r = Behavior(
            id=b.id,
            actor=b.actor,
            action=b.action,
            target=b.target,
            content=_resolve_value(b.content, variables),
            capture=b.capture,
            with_=_resolve_value(b.with_, variables) if b.with_ else None,
            with_only=_resolve_value(b.with_only, variables) if b.with_only else None,
            evaluations=b.evaluations,
            optional=b.optional,
            requires=b.requires,
            matches_when=_resolve_value(b.matches_when, variables) if b.matches_when else None,
        )

        if b.capture:
            for key, value in b.capture.items():
                variables[key] = _resolve_value(value, variables)

        resolved.append(r)

    return resolved


def _resolve_value(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, str):
        def _replace(m: re.Match) -> str:
            name = m.group(1)
            if name in variables:
                return str(variables[name])
            # Leave unresolved — will be bound later
            return f"{{{{{name}}}}}"
        return _VAR_RE.sub(_replace, value)
    elif isinstance(value, dict):
        return {k: _resolve_value(v, variables) for k, v in value.items()}
    elif isinstance(value, list):
        return [_resolve_value(v, variables) for v in value]
    return value


# ── Full parse pipeline ──

def parse(
    path_or_raw: str,
    runtime_bindings: dict[str, Any] | None = None,
) -> NormalizedSession:
    """Parse a .abs.yaml file or YAML string into a NormalizedSession."""
    is_yaml = "session:" in path_or_raw or "behaviors:" in path_or_raw
    docs = parse_yaml(path_or_raw) if is_yaml else parse_yaml_file(path_or_raw)

    if len(docs) > 1:
        raise ValueError(
            "Multiple sessions detected (--- separator). Use parse_multi() to get all sessions."
        )

    doc = docs[0]
    expanded = expand_fragments(doc)
    expanded.behaviors = resolve_variables(expanded.behaviors, runtime_bindings)
    return expanded


def parse_multi(
    path_or_raw: str,
    runtime_bindings: dict[str, Any] | None = None,
) -> list[NormalizedSession]:
    """Parse a .abs.yaml file with multiple sessions (separated by ---)."""
    is_yaml = "session:" in path_or_raw or "behaviors:" in path_or_raw
    docs = parse_yaml(path_or_raw) if is_yaml else parse_yaml_file(path_or_raw)

    results: list[NormalizedSession] = []
    for doc in docs:
        expanded = expand_fragments(doc)
        expanded.behaviors = resolve_variables(expanded.behaviors, runtime_bindings)
        results.append(expanded)
    return results


# ── Dataset loading ──

def load_dataset(path: str) -> list[dict[str, Any]]:
    """Load a dataset file (.json or .jsonl)."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()

    if path.endswith(".jsonl"):
        return [json.loads(line) for line in raw.strip().split("\n") if line.strip()]

    data = json.loads(raw)
    if isinstance(data, list):
        return data
    return [data]
