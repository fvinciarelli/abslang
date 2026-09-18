/// <reference types="node" />

/**
 * The generated assistant knowledge must match its sources:
 * schema/abs.schema.json, VOCABULARY.md, examples/*.yaml, assistant/base-prompt.md.
 *
 * If this fails, run `npm run gen:knowledge` at the repo root and commit the result.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

describe("assistant knowledge parity", () => {
  it("generated assistant-knowledge.ts files are up to date", () => {
    const script = resolve(__dirname, "../../../scripts/build-knowledge.mjs");
    try {
      execFileSync(process.execPath, [script, "--check"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err: any) {
      assert.fail(
        "Generated assistant knowledge is stale. Run `npm run gen:knowledge` and commit the result.\n" +
          `${err.stdout ?? ""}${err.stderr ?? ""}`
      );
    }
  });
});
