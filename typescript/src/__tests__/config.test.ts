/// <reference types="node" />

/**
 * Config file loading and option precedence (src/config.ts).
 *
 * Mirrors python/tests/test_config.py: every option can be set via
 * CLI flag, ABS_* env var, or config file, with precedence
 * CLI > env > config file > built-in default.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadConfig,
  validateConfig,
  pickValue,
  pickFlag,
  isTruthy,
} from "../config";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "abs-config-"));
  const path = join(dir, "abs.config.yaml");
  writeFileSync(path, content);
  return path;
}

describe("loadConfig", () => {
  it("loads a YAML config with all sections", () => {
    const cfg = loadConfig(
      tmpFile(`agent:
  url: http://cfg:1/chat
  auth: bearer
  forward_auth: true
judge:
  model: jm
defaults:
  timeout: 120
  vars:
    orderId: "cfg-v"
run:
  format: json
  ci: true
logging:
  level: debug
  no_content: true
report:
  format: junit
`)
    );
    assert.equal(cfg.agent?.url, "http://cfg:1/chat");
    assert.equal(cfg.agent?.auth, "bearer");
    assert.equal(cfg.agent?.forward_auth, true);
    assert.equal(cfg.judge?.model, "jm");
    assert.equal(cfg.defaults?.timeout, 120);
    assert.deepEqual(cfg.defaults?.vars, { orderId: "cfg-v" });
    assert.equal(cfg.run?.format, "json");
    assert.equal(cfg.run?.ci, true);
    assert.equal(cfg.logging?.level, "debug");
    assert.equal(cfg.logging?.no_content, true);
    assert.equal(cfg.report?.format, "junit");
  });

  it("throws on a missing file", () => {
    assert.throws(() => loadConfig(join(tmpdir(), "does-not-exist.yaml")), /not found/);
  });

  it("throws on a non-mapping top level", () => {
    assert.throws(() => loadConfig(tmpFile("- 1\n- 2\n")), /mapping at the top level/);
  });
});

describe("validateConfig", () => {
  it("warns on unknown sections and keys", () => {
    const warnings = validateConfig({
      agent: { urll: "x", url: "http://ok:1/chat" },
      unknown_section: {},
    } as any);
    assert.deepEqual(warnings, [
      "unknown key 'agent.urll' in config (ignored)",
      "unknown section 'unknown_section' in config (ignored)",
    ]);
  });

  it("accepts free-form adapters", () => {
    const warnings = validateConfig({ adapters: { llm_judge: "aievaluator" } });
    assert.deepEqual(warnings, []);
  });

  it("warns when a section is not a mapping", () => {
    const warnings = validateConfig({ defaults: 300 } as any);
    assert.deepEqual(warnings, ["section 'defaults' must be a mapping (ignored)"]);
  });
});

describe("pickValue", () => {
  it("applies CLI > env > file > fallback", () => {
    assert.equal(pickValue("cli", "env", "file", "fb"), "cli");
    assert.equal(pickValue(undefined, "env", "file", "fb"), "env");
    assert.equal(pickValue(undefined, undefined, "file", "fb"), "file");
    assert.equal(pickValue(undefined, undefined, undefined, "fb"), "fb");
  });

  it("treats empty strings as unset", () => {
    assert.equal(pickValue("", "env", "file", "fb"), "env");
    assert.equal(pickValue(undefined, "", "file", "fb"), "file");
  });
});

describe("pickFlag", () => {
  it("applies CLI > env > file > fallback", () => {
    assert.equal(pickFlag(true, "0", false, false), true);
    assert.equal(pickFlag(undefined, "1", false, false), true);
    assert.equal(pickFlag(undefined, "false", true, false), false);
    assert.equal(pickFlag(undefined, undefined, true, false), true);
    assert.equal(pickFlag(undefined, undefined, undefined, true), true);
  });

  it("parses env var truthiness", () => {
    assert.equal(isTruthy("true"), true);
    assert.equal(isTruthy("1"), true);
    assert.equal(isTruthy("yes"), true);
    assert.equal(isTruthy("on"), true);
    assert.equal(isTruthy("0"), false);
    assert.equal(isTruthy("false"), false);
    assert.equal(isTruthy(undefined), false);
  });
});
