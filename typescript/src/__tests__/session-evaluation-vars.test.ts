/**
 * Dataset-bound values must resolve in session-level (chain) evaluations too.
 *
 * Regression: behaviors were resolved with the dataset row, but top-level
 * `evaluations:` were copied from the document untouched. A sequence selector
 * like `target: "{{cases.toolName}}"` then compared literally against the
 * observed tool name and never matched.
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

describe("session-level evaluations with dataset variables", () => {
  it("resolves a dataset-bound tool name inside a sequence selector", async () => {
    const directory = mkdtempSync(join(tmpdir(), "abs-session-eval-vars-"));
    const dataset = join(directory, "cases.jsonl");
    writeFileSync(
      dataset,
      JSON.stringify({
        query: "What is the weather in Paris?",
        toolName: "get_weather",
        city: "Paris",
      }) + "\n"
    );

    const session = join(directory, "session.abs.yaml");
    writeFileSync(
      session,
      `session: Dataset tool name in chain sequence
dataset:
  id: cases
  path: ${dataset}
behaviors:
  - actor: user
    action: says
    content: "{{cases.query}}"

  - actor: assistant
    action: calls
    target: "{{cases.toolName}}"
    with:
      city: "{{cases.city}}"

  - actor: tool
    action: responds
    target: "{{cases.toolName}}"
    content:
      temperature: 20

  - actor: assistant
    action: informs
    content: "done"

evaluations:
  - type: sequence
    order:
      - { actor: assistant, action: calls, target: "{{cases.toolName}}" }
      - { actor: assistant, action: informs }
`
    );

    const srv = await startServer((_req, res, index) => {
      if (index === 0) {
        sendJson(res, {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "get_weather", arguments: '{"city":"Paris"}' },
                  },
                ],
              },
            },
          ],
        });
      } else {
        sendJson(res, { choices: [{ message: { role: "assistant", content: "done" } }] });
      }
    });

    try {
      const out = await runCli(session, srv.url);

      assert.equal(out.passed, true);
      assert.equal(out.results[0].trace[1].behavior.target, "get_weather");

      const sequence = out.results[0].chain_evaluations.find((e: any) => e.type === "sequence");
      assert.ok(sequence, "sequence evaluation should be present");
      assert.equal(sequence.passed, true);
      assert.doesNotMatch(sequence.reason, /\{\{cases\.toolName\}\}/);
    } finally {
      await srv.close();
    }
  });
});
