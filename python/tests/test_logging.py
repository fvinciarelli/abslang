"""Structured event logging (abslang.log)."""

import json

import pytest

from abslang import log


@pytest.fixture(autouse=True)
def _reset_logging():
    log.close_logging()
    yield
    log.close_logging()


def _read(path):
    return [json.loads(line) for line in path.read_text().strip().split("\n") if line.strip()]


def test_jsonl_file_and_schema(tmp_path, capsys):
    path = tmp_path / "events.jsonl"
    log.configure_logging(level="info", format="jsonl", file=path, abslang="0.3.2")

    logger = log.RunLogger(run_id="r_test", session="smoke")
    logger.event("session.start", behaviors=2)
    logger.event("evaluation.result", step=1, passed=False, score=0.1, code="evaluator.threshold_not_met")

    records = _read(path)
    assert len(records) == 2

    first = records[0]
    assert first["v"] == 1
    assert first["event"] == "session.start"
    assert first["run_id"] == "r_test"
    assert first["session"] == "smoke"
    assert first["abslang"] == "0.3.2"
    assert first["ts"].endswith("Z")

    second = records[1]
    assert second["passed"] is False
    assert second["code"] == "evaluator.threshold_not_met"

    # Console mirrors the events on stderr, never stdout
    captured = capsys.readouterr()
    assert '"event": "session.start"' in captured.err
    assert captured.out == ""


def test_level_filter(tmp_path):
    path = tmp_path / "events.jsonl"
    log.configure_logging(level="error", format="jsonl", file=path)

    logger = log.RunLogger()
    logger.event("evaluation.result")            # info → filtered
    logger.event("agent.error", level="error")   # kept

    records = _read(path)
    assert [r["event"] for r in records] == ["agent.error"]


def test_content_can_be_disabled(tmp_path):
    path = tmp_path / "events.jsonl"
    log.configure_logging(level="info", format="jsonl", file=path, include_content=False)

    logger = log.RunLogger()
    assert logger.content_enabled() is False
    logger.event("evaluation.result", reason=None if not logger.content_enabled() else "secret")

    records = _read(path)
    assert "reason" not in records[0]


def test_disabled_by_default(capsys):
    logger = log.RunLogger()
    logger.event("session.start")
    captured = capsys.readouterr()
    assert captured.err == ""
    assert captured.out == ""


def test_close_resets_configuration(tmp_path, capsys):
    path = tmp_path / "events.jsonl"
    log.configure_logging(level="info", format="jsonl", file=path)
    log.close_logging()

    log.RunLogger().event("session.start")
    captured = capsys.readouterr()
    assert captured.err == ""
    assert not path.exists() or path.read_text() == ""
