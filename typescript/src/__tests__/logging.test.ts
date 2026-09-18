/// <reference types="node" />

/**
 * Structured event logging (src/log.ts).
 *
 * The event schema is shared with the Python implementation
 * (python/tests/test_logging.py): stable keys, JSONL on demand.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeLogging, configureLogging, RunLogger } from "../log";

function tmpFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "abs-log-")), name);
}

function readEvents(path: string): any[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("structured logging", () => {
  it("writes JSONL events with the shared schema", () => {
    closeLogging();
    const file = tmpFile("events.jsonl");
    configureLogging({ level: "info", format: "jsonl", file, meta: { abslang: "0.3.2" } });

    const logger = new RunLogger({ runId: "r_test", session: "smoke" });
    logger.event("session.start", "info", { behaviors: 2 });
    logger.event("evaluation.result", "info", {
      step: 1,
      passed: false,
      score: 0.1,
      code: "evaluator.threshold_not_met",
    });
    closeLogging();

    const records = readEvents(file);
    assert.equal(records.length, 2);

    assert.equal(records[0].v, 1);
    assert.equal(records[0].event, "session.start");
    assert.equal(records[0].run_id, "r_test");
    assert.equal(records[0].session, "smoke");
    assert.equal(records[0].abslang, "0.3.2");
    assert.ok(String(records[0].ts).endsWith("Z"));

    assert.equal(records[1].passed, false);
    assert.equal(records[1].code, "evaluator.threshold_not_met");
  });

  it("filters events below the configured level", () => {
    closeLogging();
    const file = tmpFile("events.jsonl");
    configureLogging({ level: "error", format: "jsonl", file });

    const logger = new RunLogger();
    logger.event("evaluation.result", "info");
    logger.event("agent.error", "error", { code: "agent.http_error" });
    closeLogging();

    const records = readEvents(file);
    assert.deepEqual(records.map((r) => r.event), ["agent.error"]);
  });

  it("exposes whether content logging is enabled", () => {
    closeLogging();
    const file = tmpFile("events.jsonl");
    configureLogging({ level: "info", format: "jsonl", file, includeContent: false });
    const logger = new RunLogger();
    assert.equal(logger.contentEnabled(), false);
    closeLogging();
  });

  it("is disabled by default", () => {
    closeLogging();
    const logger = new RunLogger();
    assert.equal(logger.contentEnabled(), true);
    logger.event("session.start"); // must not throw or write anywhere
  });
});
