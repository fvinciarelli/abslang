/**
 * Regression — `when`-gated evaluations must run in real CLI invocations.
 *
 * The CLI resolves `{{dataset.column}}` for behavior content but must also pass
 * the same bindings to the runner so `when:` conditions can be evaluated.
 */
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { startServer, sendJson } from "./http-helpers";

const CLI = resolve(__dirname, "..", "cli.ts");
const PACKAGE_DIR = resolve(__dirname, "..", "..");
const AGENT_ASKS = "Please provide your order number";

/**
 * Spawn the CLI asynchronously: `spawnSync` would block this process' event loop
 * and the in-process mock agent could never answer the child CLI.
 */
function runCli(sessionPath: string, agentUrl: string): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CLI, "run", sessionPath, "--agent", agentUrl, "--format", "json"],
      { cwd: PACKAGE_DIR, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI timed out after 30s"));
    }, 30000);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!stdout) {
        reject(new Error(`CLI produced no stdout. stderr: ${stderr}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function writeFixture(hasOrderId: boolean): { session: string; dataset: string } {
  const dir = mkdtempSync(join(tmpdir(), "abs-when-"));
  const dataset = join(dir, "cases.jsonl");
  writeFileSync(
    dataset,
    JSON.stringify({ userQuery: "El estado de la orden #8291", hasOrderId }) + "\n"
  );

  const session = join(dir, "when.abs.yaml");
  writeFileSync(
    session,
    `session: When gating
abs_version: "0.2"
dataset:
  id: cases
  path: ${dataset}
behaviors:
  - actor: user
    action: says
    content: "{{cases.userQuery}}"
  - actor: assistant
    action: asks
    content: "${AGENT_ASKS}"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
    when: "{{cases.hasOrderId}} == true"
`
  );

  return { session, dataset };
}

function writeAndFixture(hasOrderId: boolean, expectAsk: boolean): { session: string; dataset: string } {
  const dir = mkdtempSync(join(tmpdir(), "abs-when-and-"));
  const dataset = join(dir, "cases.jsonl");
  writeFileSync(
    dataset,
    JSON.stringify({ userQuery: "El estado de la orden #8291", hasOrderId, expectAsk }) + "\n"
  );

  const session = join(dir, "when-and.abs.yaml");
  writeFileSync(
    session,
    `session: When gating with &&
abs_version: "0.2"
dataset:
  id: cases
  path: ${dataset}
behaviors:
  - actor: user
    action: says
    content: "{{cases.userQuery}}"
  - actor: assistant
    action: asks
    content: "${AGENT_ASKS}"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
    when: "{{cases.hasOrderId}} == true && {{cases.expectAsk}} == true"
`
  );

  return { session, dataset };
}

function mockAgentAsks() {
  return startServer((_req, res) => {
    sendJson(res, { choices: [{ message: { role: "assistant", content: AGENT_ASKS } }] });
  }, "/chat");
}

describe("when-gated evaluations through the CLI", () => {
  it("runs the evaluation when the dataset condition is true", async () => {
    const srv = await mockAgentAsks();
    try {
      const { session } = writeFixture(true);
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, false);
      const never = out.results[0].chain_evaluations.find((e: any) => e.type === "never");
      assert.equal(never.passed, false);
      assert.doesNotMatch(never.reason, /when condition not met/);
    } finally {
      await srv.close();
    }
  });

  it("skips the evaluation when the dataset condition is false", async () => {
    const srv = await mockAgentAsks();
    try {
      const { session } = writeFixture(false);
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, true);
      const never = out.results[0].chain_evaluations.find((e: any) => e.type === "never");
      assert.equal(never.passed, true);
      assert.match(never.reason, /when condition not met/);
    } finally {
      await srv.close();
    }
  });

  it("evaluates && conditions — both true runs the evaluation", async () => {
    const srv = await mockAgentAsks();
    try {
      const { session } = writeAndFixture(true, true);
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, false);
      const never = out.results[0].chain_evaluations.find((e: any) => e.type === "never");
      assert.equal(never.passed, false);
      assert.doesNotMatch(never.reason, /when condition not met/);
    } finally {
      await srv.close();
    }
  });

  it("evaluates && conditions — one side false skips the evaluation", async () => {
    const srv = await mockAgentAsks();
    try {
      const { session } = writeAndFixture(false, true);
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, true);
      const never = out.results[0].chain_evaluations.find((e: any) => e.type === "never");
      assert.equal(never.passed, true);
      assert.match(never.reason, /when condition not met/);
    } finally {
      await srv.close();
    }
  });

  it("evaluates || and word synonyms — never runs when either side is true", async () => {
    const srv = await mockAgentAsks();
    try {
      const dir = mkdtempSync(join(tmpdir(), "abs-when-or-"));
      const dataset = join(dir, "cases.jsonl");
      writeFileSync(
        dataset,
        JSON.stringify({ userQuery: "El estado de la orden #8291", hasOrderId: false, expectAsk: true }) + "\n"
      );
      const session = join(dir, "when-or.abs.yaml");
      writeFileSync(
        session,
        `session: When gating with ||
abs_version: "0.2"
dataset:
  id: cases
  path: ${dataset}
behaviors:
  - actor: user
    action: says
    content: "{{cases.userQuery}}"
  - actor: assistant
    action: asks
    content: "${AGENT_ASKS}"
evaluations:
  - type: never
    match: { actor: assistant, action: asks }
    when: "{{cases.hasOrderId}} == true OR {{cases.expectAsk}} == true"
`
      );
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, false);
      const never = out.results[0].chain_evaluations.find((e: any) => e.type === "never");
      assert.equal(never.passed, false);
      assert.doesNotMatch(never.reason, /when condition not met/);
    } finally {
      await srv.close();
    }
  });
});
